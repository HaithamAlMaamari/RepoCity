import {
  MAX_SELECTED_FILES,
  SAMPLING_POLICY,
  TREE_API_SCHEMA_VERSION,
} from '../src/data/github-contract';
import {
  ApiFailure,
  buildRepositoryPayload,
  GithubClient,
  resolveRepository,
} from './github';

interface WorkerEnv {
  ASSETS: Fetcher;
  GITHUB_TOKEN?: string;
}

interface RepositoryRequest {
  owner: string;
  repo: string;
  commit?: string;
  maxFiles: number;
}

export default {
  async fetch(request: Request, env: WorkerEnv, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(request);

    const requestId = crypto.randomUUID();
    try {
      if (request.method !== 'GET') {
        return apiError(405, 'method_not_allowed', 'Only GET is supported.', false, requestId, { Allow: 'GET' });
      }

      const parsed = parseRepositoryRequest(url);
      if (!parsed) return apiError(404, 'route_not_found', 'API route not found.', false, requestId);
      return await handleRepositoryRequest(request, parsed, env, ctx, requestId);
    } catch (error) {
      if (error instanceof ApiFailure) {
        const headers: HeadersInit = error.retryAfter ? { 'Retry-After': error.retryAfter } : {};
        return apiError(error.status, error.code, error.message, error.retryable, requestId, headers);
      }
      console.error('Unhandled RepoCity API error', { requestId, error });
      return apiError(500, 'internal_error', 'RepoCity could not complete the request.', true, requestId);
    }
  },
};

async function handleRepositoryRequest(
  request: Request,
  parsed: RepositoryRequest,
  env: WorkerEnv,
  ctx: ExecutionContext,
  requestId: string,
): Promise<Response> {
  const controller = new AbortController();
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort('timeout');
  }, 25_000);
  const cancel = () => controller.abort('client disconnected');
  request.signal.addEventListener('abort', cancel, { once: true });

  try {
    const client = new GithubClient(env.GITHUB_TOKEN, controller.signal);
    const resolved = await resolveRepository(client, parsed.owner, parsed.repo, parsed.commit);
    const cacheRequest = createCacheRequest(request.url, resolved.repository.fullName, resolved.revision.commitSha, parsed.maxFiles);
    const cache = caches.default;
    const cached = await cache.match(cacheRequest);
    if (cached) return publicResponse(cached, 'HIT', client.getRateLimit(), requestId);

    const payload = await buildRepositoryPayload(client, resolved, parsed.maxFiles);
    const serialized = JSON.stringify(payload);
    if (serialized.length > 8_000_000) {
      throw new ApiFailure(413, 'response_too_large', 'Repository result exceeds RepoCity\'s response budget.');
    }

    const etag = `"v${TREE_API_SCHEMA_VERSION}-${resolved.revision.commitSha}-${parsed.maxFiles}-${SAMPLING_POLICY}"`;
    const cachedResponse = new Response(serialized, {
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'public, max-age=31536000, immutable',
        ETag: etag,
      },
    });
    ctx.waitUntil(cache.put(cacheRequest, cachedResponse.clone()));
    return publicResponse(cachedResponse, 'MISS', client.getRateLimit(), requestId);
  } catch (error) {
    if (controller.signal.aborted) {
      if (timedOut) throw new ApiFailure(504, 'request_timed_out', 'Repository processing timed out.', true);
      throw new ApiFailure(499, 'request_cancelled', 'Request was cancelled.');
    }
    throw error;
  } finally {
    clearTimeout(timeout);
    request.signal.removeEventListener('abort', cancel);
  }
}

export function parseRepositoryRequest(url: URL): RepositoryRequest | null {
  const segments = url.pathname.split('/');
  if (segments.length !== 6 || segments[1] !== 'api' || segments[2] !== 'repositories' || segments[5] !== 'tree') {
    return null;
  }

  let owner: string;
  let repo: string;
  try {
    owner = decodeURIComponent(segments[3]);
    repo = decodeURIComponent(segments[4]);
  } catch {
    throw new ApiFailure(400, 'invalid_request', 'Repository path is not valid URL encoding.');
  }
  if (!/^[A-Za-z0-9-]{1,39}$/.test(owner) || !/^[A-Za-z0-9._-]{1,100}$/.test(repo) || repo === '.' || repo === '..') {
    throw new ApiFailure(400, 'invalid_request', 'Use a valid GitHub owner and repository name.');
  }

  const allowed = new Set(['commit', 'maxFiles']);
  for (const key of url.searchParams.keys()) {
    if (!allowed.has(key) || url.searchParams.getAll(key).length !== 1) {
      throw new ApiFailure(400, 'invalid_request', `Invalid query parameter: ${key}`);
    }
  }

  const commitValue = url.searchParams.get('commit') ?? undefined;
  const commit = commitValue?.toLowerCase();
  if (commit && !/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(commit)) {
    throw new ApiFailure(400, 'invalid_request', 'Commit must be a full Git object SHA.');
  }

  const maxFilesValue = url.searchParams.get('maxFiles');
  const maxFiles = maxFilesValue === null ? MAX_SELECTED_FILES : Number(maxFilesValue);
  if (!Number.isInteger(maxFiles) || maxFiles < 1 || maxFiles > MAX_SELECTED_FILES) {
    throw new ApiFailure(400, 'invalid_request', `maxFiles must be between 1 and ${MAX_SELECTED_FILES}.`);
  }

  return { owner, repo, commit, maxFiles };
}

function createCacheRequest(requestUrl: string, fullName: string, commitSha: string, maxFiles: number): Request {
  const url = new URL(requestUrl);
  url.pathname = `/__repocity-cache/v${TREE_API_SCHEMA_VERSION}/${fullName}/${commitSha}`;
  url.search = new URLSearchParams({
    maxFiles: String(maxFiles),
    sampling: SAMPLING_POLICY,
  }).toString();
  return new Request(url, { method: 'GET' });
}

function publicResponse(
  response: Response,
  cacheStatus: 'HIT' | 'MISS',
  rateLimit: ReturnType<GithubClient['getRateLimit']>,
  requestId: string,
): Response {
  const headers = new Headers(response.headers);
  headers.set('Cache-Control', 'private, max-age=0, must-revalidate');
  headers.set('X-RepoCity-Cache', cacheStatus);
  headers.set('X-Request-Id', requestId);
  if (rateLimit.limit) headers.set('X-RateLimit-Limit', rateLimit.limit);
  if (rateLimit.remaining) headers.set('X-RateLimit-Remaining', rateLimit.remaining);
  if (rateLimit.reset) headers.set('X-RateLimit-Reset', rateLimit.reset);
  if (rateLimit.resource) headers.set('X-RateLimit-Resource', rateLimit.resource);
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

function apiError(
  status: number,
  code: string,
  message: string,
  retryable: boolean,
  requestId: string,
  extraHeaders: HeadersInit = {},
): Response {
  return Response.json({ error: { code, message, retryable, requestId } }, {
    status,
    headers: {
      ...Object.fromEntries(new Headers(extraHeaders)),
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'X-Request-Id': requestId,
    },
  });
}

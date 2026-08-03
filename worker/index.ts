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
  INGEST_GLOBAL_RATE_LIMITER: RateLimit;
  INGEST_ACTOR_RATE_LIMITER: RateLimit;
}

const PUBLIC_INGESTION_KEY = 'public-repository-ingestion-v1';
const RATE_LIMIT_SECONDS = 60;

/**
 * Content Security Policy for the served application.
 *
 * `script-src` is strict `'self'`: the build emits one same-origin module and
 * no inline script. `style-src` allows `'unsafe-inline'` because index.html
 * ships a single inline <style> block and Three.js writes inline style
 * attributes on the canvas; a hash would break silently on every CSS edit, and
 * style injection is a far smaller risk than script injection, which stays
 * locked down. Google Fonts needs the stylesheet host in `style-src` and the
 * font host in `font-src`. `connect-src 'self'` is what keeps the browser from
 * ever talking to GitHub directly -- the Worker is the only route out.
 */
const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com",
  "img-src 'self' data: blob:",
  "connect-src 'self'",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  'upgrade-insecure-requests',
].join('; ');

/** Applied to every response RepoCity serves, assets and API alike. */
const SECURITY_HEADERS: Readonly<Record<string, string>> = {
  'Content-Security-Policy': CONTENT_SECURITY_POLICY,
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'X-Frame-Options': 'DENY',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'Permissions-Policy': 'accelerometer=(), camera=(), geolocation=(), gyroscope=(), microphone=(), payment=(), usb=()',
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
};

/** Return a copy of `response` carrying the security headers. */
export function withSecurityHeaders(response: Response): Response {
  const headers = new Headers(response.headers);
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) headers.set(name, value);
  // 101/204/304 and friends must not be given a body.
  if (response.status === 101 || response.status === 204 || response.status === 304) {
    return new Response(null, { status: response.status, statusText: response.statusText, headers });
  }
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
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
    if (!url.pathname.startsWith('/api/')) {
      return withSecurityHeaders(await env.ASSETS.fetch(request));
    }

    const requestId = crypto.randomUUID();
    try {
      if (request.method !== 'GET') {
        return apiError(405, 'method_not_allowed', 'Only GET is supported.', false, requestId, { Allow: 'GET' });
      }

      const parsed = parseRepositoryRequest(url);
      if (!parsed) return apiError(404, 'route_not_found', 'API route not found.', false, requestId);
      await enforceRateLimit(request, env, requestId);
      return await handleRepositoryRequest(request, parsed, env, ctx, requestId);
    } catch (error) {
      if (error instanceof ApiFailure) {
        const headers: HeadersInit = error.retryAfter ? { 'Retry-After': error.retryAfter } : {};
        return apiError(error.status, error.code, error.message, error.retryable, requestId, headers);
      }
      console.error('Unhandled RepoCity API error', {
        requestId,
        name: error instanceof Error ? error.name : 'UnknownError',
      });
      return apiError(500, 'internal_error', 'RepoCity could not complete the request.', true, requestId);
    }
  },
};

async function enforceRateLimit(request: Request, env: WorkerEnv, requestId: string): Promise<void> {
  const actorKey = await rateLimitActorKey(request);
  let actorAllowed: boolean;
  let globalAllowed: boolean;
  try {
    ({ success: actorAllowed } = await env.INGEST_ACTOR_RATE_LIMITER.limit({ key: actorKey }));
    if (!actorAllowed) {
      throw new ApiFailure(429, 'request_rate_limited', 'RepoCity is receiving too many repository requests. Try again shortly.', true, String(RATE_LIMIT_SECONDS));
    }
    ({ success: globalAllowed } = await env.INGEST_GLOBAL_RATE_LIMITER.limit({ key: PUBLIC_INGESTION_KEY }));
  } catch (error) {
    if (error instanceof ApiFailure) throw error;
    console.error('RepoCity rate limiter failed', {
      requestId,
      name: error instanceof Error ? error.name : 'UnknownError',
    });
    throw new ApiFailure(503, 'rate_limit_unavailable', 'RepoCity cannot safely accept ingestion requests right now.', true, String(RATE_LIMIT_SECONDS));
  }
  if (!globalAllowed) {
    throw new ApiFailure(429, 'request_rate_limited', 'RepoCity is receiving too many repository requests. Try again shortly.', true, String(RATE_LIMIT_SECONDS));
  }
}

async function rateLimitActorKey(request: Request): Promise<string> {
  const actor = request.headers.get('CF-Connecting-IP') ?? 'unknown-client';
  const bytes = new TextEncoder().encode(`repocity-actor-v1\0${actor}`);
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return `actor-${[...digest].map((byte) => byte.toString(16).padStart(2, '0')).join('')}`;
}

async function handleRepositoryRequest(
  request: Request,
  parsed: RepositoryRequest,
  env: WorkerEnv,
  ctx: ExecutionContext,
  requestId: string,
): Promise<Response> {
  const controller = new AbortController();
  let abortSource: 'client' | 'timeout' | null = null;
  const abort = (source: 'client' | 'timeout', reason: string) => {
    if (abortSource) return;
    abortSource = source;
    controller.abort(reason);
  };
  const timeout = setTimeout(() => {
    abort('timeout', 'timeout');
  }, 25_000);
  const cancel = () => abort('client', 'client disconnected');
  if (request.signal.aborted) cancel();
  else request.signal.addEventListener('abort', cancel, { once: true });
  const abortFailure = () => abortSource === 'timeout'
    ? new ApiFailure(504, 'request_timed_out', 'Repository processing timed out.', true)
    : new ApiFailure(499, 'request_cancelled', 'Request was cancelled.');
  const throwIfAborted = () => {
    if (!controller.signal.aborted) return;
    throw abortFailure();
  };
  const waitFor = <T>(operation: Promise<T>): Promise<T> => {
    if (controller.signal.aborted) return Promise.reject(abortFailure());
    return new Promise<T>((resolve, reject) => {
      const onAbort = () => reject(abortFailure());
      controller.signal.addEventListener('abort', onAbort, { once: true });
      operation.then(
        (value) => { controller.signal.removeEventListener('abort', onAbort); resolve(value); },
        (error: unknown) => { controller.signal.removeEventListener('abort', onAbort); reject(error); },
      );
    });
  };

  try {
    throwIfAborted();
    const client = new GithubClient(env.GITHUB_TOKEN, controller.signal);
    const resolved = await waitFor(resolveRepository(client, parsed.owner, parsed.repo, parsed.commit));
    throwIfAborted();
    const cacheRequest = createCacheRequest(request.url, resolved.repository.fullName, resolved.revision.commitSha, parsed.maxFiles);
    const cache = caches.default;
    const cached = await waitFor(cache.match(cacheRequest));
    throwIfAborted();
    if (cached) return publicResponse(cached, 'HIT', requestId);

    const payload = await waitFor(buildRepositoryPayload(client, resolved, parsed.maxFiles));
    throwIfAborted();
    const serialized = JSON.stringify(payload);
    if (new TextEncoder().encode(serialized).byteLength > 8_000_000) {
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
    return publicResponse(cachedResponse, 'MISS', requestId);
  } catch (error) {
    if (controller.signal.aborted) throwIfAborted();
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
  const invalidOwner = !/^[A-Za-z0-9-]{1,39}$/.test(owner) || owner.startsWith('-') || owner.endsWith('-') || owner.includes('--');
  if (invalidOwner || !/^[A-Za-z0-9._-]{1,100}$/.test(repo) || repo === '.' || repo === '..') {
    throw new ApiFailure(400, 'invalid_request', 'Use a valid GitHub owner and repository name.');
  }

  const allowed = new Set(['commit', 'maxFiles']);
  const seen = new Set<string>();
  for (const key of url.searchParams.keys()) {
    if (!allowed.has(key) || seen.has(key)) {
      throw new ApiFailure(400, 'invalid_request', `Invalid query parameter: ${key}`);
    }
    seen.add(key);
  }

  const commitValue = url.searchParams.get('commit') ?? undefined;
  const commit = commitValue?.toLowerCase();
  if (commitValue !== undefined && !/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(commit ?? '')) {
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

/**
 * GitHub's own `X-RateLimit-*` headers are deliberately NOT forwarded. They
 * describe the shared server credential's quota, not the caller's, so passing
 * them on both leaks the deployment's remaining budget to anonymous clients
 * and tells an abuser exactly how close the instance is to exhaustion.
 * RepoCity's own limits are communicated with 429 + Retry-After instead.
 */
function publicResponse(
  response: Response,
  cacheStatus: 'HIT' | 'MISS',
  requestId: string,
): Response {
  const headers = new Headers(response.headers);
  headers.set('Cache-Control', 'private, max-age=0, must-revalidate');
  headers.set('X-RepoCity-Cache', cacheStatus);
  headers.set('X-Request-Id', requestId);
  return withSecurityHeaders(
    new Response(response.body, { status: response.status, statusText: response.statusText, headers }),
  );
}

function apiError(
  status: number,
  code: string,
  message: string,
  retryable: boolean,
  requestId: string,
  extraHeaders: HeadersInit = {},
): Response {
  return withSecurityHeaders(Response.json({ error: { code, message, retryable, requestId } }, {
    status,
    headers: {
      ...Object.fromEntries(new Headers(extraHeaders)),
      'Cache-Control': 'no-store',
      'X-Request-Id': requestId,
    },
  }));
}

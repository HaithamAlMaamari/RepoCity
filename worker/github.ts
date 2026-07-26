import { detectLanguage } from '../src/data/github';
import {
  LANGUAGE_POLICY,
  SAMPLING_POLICY,
  TREE_API_SCHEMA_VERSION,
} from '../src/data/github-contract';
import type {
  LanguageTotal,
  RepositoryFile,
  RepositoryIdentity,
  RepositorySubmodule,
  RepositoryTreePayload,
  RevisionIdentity,
} from '../src/data/github-contract';
import { compareText, sampleFiles } from './sampling';

const GITHUB_ORIGIN = 'https://api.github.com';
const GITHUB_API_VERSION = '2026-03-10';
const MAX_GITHUB_REQUESTS = 190;
const MAX_JSON_BYTES = 9_000_000;
const MAX_TREE_ENTRIES = 250_000;
const MAX_TREE_DEPTH = 64;

interface GithubRepositoryResponse {
  owner: { login: string };
  name: string;
  fullName: string;
  defaultBranch: string;
  private: boolean;
  disabled: boolean;
}

interface GithubCommitResponse {
  sha: string;
  treeSha: string;
}

interface GithubTreeEntry {
  path: string;
  mode: string;
  type: 'blob' | 'tree' | 'commit';
  sha: string;
  size: number;
}

interface GithubTreeResponse {
  sha: string;
  truncated: boolean;
  tree: GithubTreeEntry[];
}

export interface ResolvedRepository {
  repository: RepositoryIdentity;
  revision: RevisionIdentity;
}

export interface RateLimitState {
  limit: string | null;
  remaining: string | null;
  reset: string | null;
  resource: string | null;
}

export class ApiFailure extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly retryable = false,
    readonly retryAfter?: string,
  ) {
    super(message);
  }
}

export class GithubClient {
  private requestCount = 0;
  private rateLimit: RateLimitState = { limit: null, remaining: null, reset: null, resource: null };

  constructor(
    private readonly token: string | undefined,
    private readonly signal: AbortSignal,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  getRateLimit(): RateLimitState {
    return { ...this.rateLimit };
  }

  async getJson(path: string, retry = true): Promise<unknown> {
    const url = new URL(path, GITHUB_ORIGIN);
    if (url.origin !== GITHUB_ORIGIN) throw new ApiFailure(500, 'invalid_upstream_url', 'Invalid upstream URL.');

    let current = url;
    for (let redirects = 0; redirects <= 3; redirects++) {
      if (++this.requestCount > MAX_GITHUB_REQUESTS) {
        throw new ApiFailure(422, 'traversal_budget_exceeded', 'Repository traversal exceeded its safe request budget.');
      }

      let response: Response;
      try {
        const fetcher = this.fetchImpl;
        response = await fetcher(current, {
          method: 'GET',
          redirect: 'manual',
          signal: this.signal,
          headers: this.headers(),
        });
      } catch (error) {
        if (this.signal.aborted) throw error;
        console.error('GitHub fetch failed', {
          path: current.pathname,
          name: error instanceof Error ? error.name : 'UnknownError',
          message: error instanceof Error ? error.message : String(error),
        });
        if (retry) return this.getJson(path, false);
        throw new ApiFailure(503, 'github_unavailable', 'GitHub is temporarily unavailable.', true);
      }

      this.captureRateLimit(response.headers);

      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get('location');
        await response.body?.cancel();
        if (!location || redirects === 3) {
          throw new ApiFailure(502, 'invalid_upstream_response', 'GitHub returned an invalid redirect.');
        }
        const redirected = new URL(location, current);
        if (redirected.protocol !== 'https:' || redirected.hostname !== 'api.github.com') {
          throw new ApiFailure(502, 'invalid_upstream_response', 'GitHub redirected to an untrusted host.');
        }
        current = redirected;
        continue;
      }

      if (!response.ok) {
        if (retry && [502, 503, 504].includes(response.status)) {
          await response.body?.cancel();
          return this.getJson(path, false);
        }
        await response.body?.cancel();
        throw this.mapError(response);
      }

      const contentType = response.headers.get('content-type') ?? '';
      if (!contentType.toLowerCase().includes('json')) {
        await response.body?.cancel();
        throw new ApiFailure(502, 'invalid_upstream_response', 'GitHub returned an unexpected content type.');
      }

      const declaredLength = Number(response.headers.get('content-length'));
      if (Number.isFinite(declaredLength) && declaredLength > MAX_JSON_BYTES) {
        await response.body?.cancel();
        throw new ApiFailure(413, 'response_too_large', 'GitHub returned more data than RepoCity can process safely.');
      }

      const text = await response.text();
      if (text.length > MAX_JSON_BYTES) {
        throw new ApiFailure(413, 'response_too_large', 'GitHub returned more data than RepoCity can process safely.');
      }
      try {
        return JSON.parse(text) as unknown;
      } catch {
        throw new ApiFailure(502, 'invalid_upstream_response', 'GitHub returned malformed JSON.');
      }
    }

    throw new ApiFailure(502, 'invalid_upstream_response', 'GitHub returned too many redirects.');
  }

  private headers(): Headers {
    const headers = new Headers({
      Accept: 'application/vnd.github+json',
      'User-Agent': 'RepoCity/1',
      'X-GitHub-Api-Version': GITHUB_API_VERSION,
    });
    if (this.token) headers.set('Authorization', `Bearer ${this.token}`);
    return headers;
  }

  private captureRateLimit(headers: Headers): void {
    this.rateLimit = {
      limit: headers.get('x-ratelimit-limit'),
      remaining: headers.get('x-ratelimit-remaining'),
      reset: headers.get('x-ratelimit-reset'),
      resource: headers.get('x-ratelimit-resource'),
    };
  }

  private mapError(response: Response): ApiFailure {
    const remaining = response.headers.get('x-ratelimit-remaining');
    const retryAfter = response.headers.get('retry-after') ?? undefined;
    if (response.status === 401) {
      return new ApiFailure(502, 'github_authentication_failed', 'RepoCity could not authenticate with GitHub.');
    }
    if (response.status === 404) {
      return new ApiFailure(404, 'repository_not_found', 'Repository not found.');
    }
    if (response.status === 409) {
      return new ApiFailure(409, 'repository_empty', 'This repository has no Git tree to visualize.');
    }
    if (response.status === 403 && remaining === '0' || response.status === 429) {
      return new ApiFailure(429, 'github_rate_limited', 'GitHub request limit reached. Try again later.', true, retryAfter);
    }
    if (response.status >= 500) {
      return new ApiFailure(503, 'github_unavailable', 'GitHub is temporarily unavailable.', true, retryAfter);
    }
    return new ApiFailure(502, 'github_request_failed', `GitHub rejected the request with status ${response.status}.`);
  }
}

export async function resolveRepository(
  client: GithubClient,
  owner: string,
  repo: string,
  requestedCommit?: string,
): Promise<ResolvedRepository> {
  const metadata = parseRepository(await client.getJson(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`));
  if (metadata.private || metadata.disabled) {
    throw new ApiFailure(404, 'repository_not_found', 'Repository not found.');
  }

  const ref = requestedCommit ?? metadata.defaultBranch;
  const commit = parseCommit(await client.getJson(
    `/repos/${encodeURIComponent(metadata.owner.login)}/${encodeURIComponent(metadata.name)}/commits/${encodeURIComponent(ref)}`,
  ));

  return {
    repository: {
      owner: metadata.owner.login,
      name: metadata.name,
      fullName: metadata.fullName,
      defaultBranch: metadata.defaultBranch,
      htmlUrl: `https://github.com/${metadata.owner.login}/${metadata.name}`,
    },
    revision: {
      commitSha: commit.sha,
      treeSha: commit.treeSha,
    },
  };
}

export async function buildRepositoryPayload(
  client: GithubClient,
  resolved: ResolvedRepository,
  maxFiles: number,
): Promise<RepositoryTreePayload> {
  const entries = await loadCompleteTree(client, resolved.repository, resolved.revision.treeSha);
  const files: RepositoryFile[] = [];
  const submodules: RepositorySubmodule[] = [];
  const directoryPaths = new Set<string>();
  const allPaths = new Set<string>();
  const languages = new Map<string, LanguageTotal>();
  let totalBytes = 0;

  for (const entry of entries) {
    if (allPaths.has(entry.path)) {
      throw new ApiFailure(502, 'invalid_upstream_response', `GitHub returned duplicate path: ${entry.path}`);
    }
    allPaths.add(entry.path);

    if (entry.type === 'tree') {
      directoryPaths.add(entry.path);
      continue;
    }
    if (entry.type === 'commit') {
      submodules.push({ path: entry.path, sha: entry.sha, mode: '160000' });
      continue;
    }

    const language = detectLanguage(entry.path);
    const file = { path: entry.path, sha: entry.sha, mode: entry.mode, size: entry.size, language };
    files.push(file);
    totalBytes += entry.size;
    const aggregate = languages.get(language) ?? { language, files: 0, bytes: 0 };
    aggregate.files++;
    aggregate.bytes += entry.size;
    languages.set(language, aggregate);
  }

  const selectedFiles = sampleFiles(files, maxFiles, resolved.revision.commitSha);
  const directoriesWithChildren = new Set<string>();
  for (const entry of entries) {
    const segments = entry.path.split('/');
    for (let index = 1; index < segments.length; index++) {
      directoriesWithChildren.add(segments.slice(0, index).join('/'));
    }
  }
  const emptyDirectories = [...directoryPaths]
    .filter((directory) => !directoriesWithChildren.has(directory))
    .sort(compareText);

  return {
    schemaVersion: TREE_API_SCHEMA_VERSION,
    repository: resolved.repository,
    revision: resolved.revision,
    coverage: {
      tree: 'complete',
      selection: selectedFiles.length === files.length ? 'complete' : 'sampled',
    },
    totals: {
      files: files.length,
      directories: directoryPaths.size,
      submodules: submodules.length,
      bytes: totalBytes,
    },
    selection: {
      maxFiles,
      returnedFiles: selectedFiles.length,
      omittedFiles: files.length - selectedFiles.length,
      policy: selectedFiles.length === files.length ? 'all' : SAMPLING_POLICY,
      seed: resolved.revision.commitSha,
      languagePolicy: LANGUAGE_POLICY,
    },
    languages: [...languages.values()].sort((a, b) => b.bytes - a.bytes || compareText(a.language, b.language)),
    files: selectedFiles,
    submodules: submodules.sort((a, b) => compareText(a.path, b.path)),
    emptyDirectories,
  };
}

async function loadCompleteTree(
  client: GithubClient,
  repository: RepositoryIdentity,
  rootTreeSha: string,
): Promise<GithubTreeEntry[]> {
  const entries: GithubTreeEntry[] = [];

  async function visit(treeSha: string, prefix: string, depth: number): Promise<void> {
    if (depth > MAX_TREE_DEPTH) {
      throw new ApiFailure(422, 'tree_too_deep', 'Repository tree exceeds RepoCity\'s safe depth limit.');
    }

    const recursive = parseTree(await client.getJson(treeUrl(repository, treeSha, true)));
    if (recursive.sha !== treeSha) {
      throw new ApiFailure(502, 'invalid_upstream_response', 'GitHub returned the wrong repository subtree.');
    }
    if (!recursive.truncated) {
      for (const entry of recursive.tree) addEntry(entries, prefixEntry(entry, prefix));
      return;
    }

    const direct = parseTree(await client.getJson(treeUrl(repository, treeSha, false)));
    if (direct.sha !== treeSha) {
      throw new ApiFailure(502, 'invalid_upstream_response', 'GitHub returned the wrong repository subtree.');
    }
    if (direct.truncated) {
      throw new ApiFailure(422, 'traversal_incomplete', 'GitHub could not provide a complete repository subtree.');
    }

    for (const entry of direct.tree) {
      const prefixed = prefixEntry(entry, prefix);
      addEntry(entries, prefixed);
      if (entry.type === 'tree') await visit(entry.sha, `${prefixed.path}/`, depth + 1);
    }
  }

  await visit(rootTreeSha, '', 0);
  return entries;
}

function treeUrl(repository: RepositoryIdentity, treeSha: string, recursive: boolean): string {
  const base = `/repos/${encodeURIComponent(repository.owner)}/${encodeURIComponent(repository.name)}/git/trees/${treeSha}`;
  return recursive ? `${base}?recursive=1` : base;
}

function addEntry(entries: GithubTreeEntry[], entry: GithubTreeEntry): void {
  if (entries.length >= MAX_TREE_ENTRIES) {
    throw new ApiFailure(413, 'repository_too_large', 'Repository contains more entries than RepoCity can process safely.');
  }
  entries.push(entry);
}

function prefixEntry(entry: GithubTreeEntry, prefix: string): GithubTreeEntry {
  return { ...entry, path: `${prefix}${entry.path}` };
}

function parseRepository(value: unknown): GithubRepositoryResponse {
  const root = object(value, 'repository');
  const owner = object(root.owner, 'repository owner');
  const login = githubName(owner.login, 'repository owner');
  const name = githubName(root.name, 'repository name', 100, true);
  const fullName = string(root.full_name, 'repository full name');
  const defaultBranch = string(root.default_branch, 'default branch');
  if (fullName.toLowerCase() !== `${login}/${name}`.toLowerCase()) {
    throw new ApiFailure(502, 'invalid_upstream_response', 'GitHub returned an inconsistent repository identity.');
  }
  if (typeof root.private !== 'boolean' || typeof root.disabled !== 'boolean') {
    throw new ApiFailure(502, 'invalid_upstream_response', 'GitHub returned invalid repository visibility.');
  }
  return { owner: { login }, name, fullName: `${login}/${name}`, defaultBranch, private: root.private, disabled: root.disabled };
}

function parseCommit(value: unknown): GithubCommitResponse {
  const root = object(value, 'commit');
  const commit = object(root.commit, 'commit data');
  const tree = object(commit.tree, 'commit tree');
  return { sha: gitSha(root.sha, 'commit SHA'), treeSha: gitSha(tree.sha, 'tree SHA') };
}

function parseTree(value: unknown): GithubTreeResponse {
  const root = object(value, 'tree response');
  if (typeof root.truncated !== 'boolean' || !Array.isArray(root.tree)) {
    throw new ApiFailure(502, 'invalid_upstream_response', 'GitHub returned an invalid tree response.');
  }
  return {
    sha: gitSha(root.sha, 'tree SHA'),
    truncated: root.truncated,
    tree: root.tree.map((item, index) => parseTreeEntry(item, index)),
  };
}

function parseTreeEntry(value: unknown, index: number): GithubTreeEntry {
  const entry = object(value, `tree entry ${index}`);
  const type = entry.type;
  if (type !== 'blob' && type !== 'tree' && type !== 'commit') {
    throw new ApiFailure(502, 'invalid_upstream_response', `GitHub returned an unknown tree entry type at index ${index}.`);
  }
  const mode = string(entry.mode, `tree entry ${index} mode`);
  if (type === 'tree' && mode !== '040000' || type === 'commit' && mode !== '160000' ||
      type === 'blob' && !['100644', '100755', '120000'].includes(mode)) {
    throw new ApiFailure(502, 'invalid_upstream_response', `GitHub returned an invalid tree entry mode at index ${index}.`);
  }
  const size = type === 'blob' ? nonNegativeInteger(entry.size, `tree entry ${index} size`) : 0;
  return {
    path: safePath(entry.path, `tree entry ${index} path`),
    mode,
    type,
    sha: gitSha(entry.sha, `tree entry ${index} SHA`),
    size,
  };
}

function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ApiFailure(502, 'invalid_upstream_response', `GitHub returned invalid ${label}.`);
  }
  return value as Record<string, unknown>;
}

function string(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new ApiFailure(502, 'invalid_upstream_response', `GitHub returned invalid ${label}.`);
  }
  return value;
}

function githubName(value: unknown, label: string, max = 39, allowPunctuation = false): string {
  const result = string(value, label);
  const pattern = allowPunctuation ? /^[A-Za-z0-9._-]+$/ : /^[A-Za-z0-9-]+$/;
  if (result.length > max || !pattern.test(result)) {
    throw new ApiFailure(502, 'invalid_upstream_response', `GitHub returned invalid ${label}.`);
  }
  return result;
}

function gitSha(value: unknown, label: string): string {
  const result = string(value, label).toLowerCase();
  if (!/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(result)) {
    throw new ApiFailure(502, 'invalid_upstream_response', `GitHub returned invalid ${label}.`);
  }
  return result;
}

function safePath(value: unknown, label: string): string {
  const result = string(value, label);
  const segments = result.split('/');
  if (result.startsWith('/') || result.endsWith('/') || result.includes('\\') || result.includes('\0') ||
      segments.some((segment) => !segment || segment === '.' || segment === '..')) {
    throw new ApiFailure(502, 'invalid_upstream_response', `GitHub returned invalid ${label}.`);
  }
  return result;
}

function nonNegativeInteger(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new ApiFailure(502, 'invalid_upstream_response', `GitHub returned invalid ${label}.`);
  }
  return value as number;
}

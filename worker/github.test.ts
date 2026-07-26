import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildRepositoryPayload, GithubClient, resolveRepository } from './github';

const COMMIT = '1'.repeat(40);
const ROOT_TREE = '2'.repeat(40);
const CHILD_TREE = '3'.repeat(40);
const FILE_A = '4'.repeat(40);
const FILE_B = '5'.repeat(40);

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'Content-Type': 'application/json', 'X-RateLimit-Limit': '5000', 'X-RateLimit-Remaining': '4990' },
  });
}

function metadata() {
  return {
    owner: { login: 'canonical' },
    name: 'repo',
    full_name: 'canonical/repo',
    default_branch: 'main',
    private: false,
    disabled: false,
  };
}

function commit() {
  return { sha: COMMIT, commit: { tree: { sha: ROOT_TREE } } };
}

function resolvedRepository() {
  return {
    repository: {
      owner: 'canonical', name: 'repo', fullName: 'canonical/repo', defaultBranch: 'main',
      htmlUrl: 'https://github.com/canonical/repo',
    },
    revision: { commitSha: COMMIT, treeSha: ROOT_TREE },
  };
}

afterEach(() => vi.restoreAllMocks());

describe('GitHub ingestion', () => {
  it('resolves canonical identity and immutable commit before reading the tree', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(json(metadata()))
      .mockResolvedValueOnce(json(commit()));
    const client = new GithubClient(undefined, new AbortController().signal, fetchMock);
    const resolved = await resolveRepository(client, 'old-owner', 'old-repo');

    expect(resolved.repository.fullName).toBe('canonical/repo');
    expect(resolved.revision).toEqual({ commitSha: COMMIT, treeSha: ROOT_TREE });
    expect(String(fetchMock.mock.calls[1][0])).toContain('/commits/main');
  });

  it('splits only a truncated subtree and returns exact totals', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(json({ sha: ROOT_TREE, truncated: true, tree: [] }))
      .mockResolvedValueOnce(json({
        sha: ROOT_TREE,
        truncated: false,
        tree: [
          { path: 'src', mode: '040000', type: 'tree', sha: CHILD_TREE },
          { path: 'README.md', mode: '100644', type: 'blob', sha: FILE_A, size: 8 },
        ],
      }))
      .mockResolvedValueOnce(json({
        sha: CHILD_TREE,
        truncated: false,
        tree: [{ path: 'index.ts', mode: '100644', type: 'blob', sha: FILE_B, size: 12 }],
      }));
    const client = new GithubClient(undefined, new AbortController().signal, fetchMock);
    const resolved = resolvedRepository();

    const payload = await buildRepositoryPayload(client, resolved, 5_000);

    expect(payload.totals).toEqual({ files: 2, directories: 1, submodules: 0, bytes: 20 });
    expect(payload.files.map((item) => item.path)).toEqual(['README.md', 'src/index.ts']);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('rejects private repositories even when the server can see them', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(json({ ...metadata(), private: true }));
    const client = new GithubClient('server-secret', new AbortController().signal, fetchMock);
    await expect(resolveRepository(client, 'private', 'repo')).rejects.toMatchObject({
      status: 404,
      code: 'repository_not_found',
    });
  });
});

describe('GitHub transport safety', () => {
  it.each([
    [new Response('{}', { headers: { 'Content-Type': 'text/html' } }), 502, 'invalid_upstream_response'],
    [new Response('{', { headers: { 'Content-Type': 'application/json' } }), 502, 'invalid_upstream_response'],
    [new Response('{}', { headers: { 'Content-Type': 'application/json', 'Content-Length': '9000001' } }), 413, 'response_too_large'],
  ])('normalizes malformed successful responses', async (response, status, code) => {
    const client = new GithubClient(undefined, new AbortController().signal, vi.fn().mockResolvedValue(response));

    await expect(client.getJson('/test')).rejects.toMatchObject({ status, code });
  });

  it('retries a failed response body once and returns a typed outage', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(new Response(new ReadableStream({
      start(controller) { controller.error(new Error('stream failed')); },
    }), { headers: { 'Content-Type': 'application/json' } })));
    const client = new GithubClient(undefined, new AbortController().signal, fetchMock);

    await expect(client.getJson('/test')).rejects.toMatchObject({
      status: 503,
      code: 'github_unavailable',
      retryable: true,
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('stops reading a chunked body when the actual byte budget is exceeded', async () => {
    const cancel = vi.fn().mockRejectedValue(new Error('cancel failed'));
    const body = new ReadableStream<Uint8Array>({
      pull(controller) { controller.enqueue(new Uint8Array(9_000_001)); },
      cancel,
    });
    const fetchMock = vi.fn().mockResolvedValue(new Response(body, { headers: { 'Content-Type': 'application/json' } }));
    const client = new GithubClient(undefined, new AbortController().signal, fetchMock);

    await expect(client.getJson('/test')).rejects.toMatchObject({ status: 413, code: 'response_too_large' });
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('follows bounded same-origin redirects with manual redirect mode', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(null, { status: 302, headers: { Location: '/next' } }))
      .mockResolvedValueOnce(json({ ok: true }));
    const client = new GithubClient('secret', new AbortController().signal, fetchMock);

    await expect(client.getJson('/start')).resolves.toEqual({ ok: true });
    expect(String(fetchMock.mock.calls[1][0])).toBe('https://api.github.com/next');
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ redirect: 'manual' });
  });

  it.each(['https://api.github.com:444/private', 'https://user:pass@api.github.com/private', 'http://['])('rejects an untrusted or malformed redirect: %s', async (location) => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 302, headers: { Location: location } }));
    const client = new GithubClient('secret', new AbortController().signal, fetchMock);

    await expect(client.getJson('/start')).rejects.toMatchObject({ status: 502, code: 'invalid_upstream_response' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('stops after the redirect budget', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 302, headers: { Location: '/again' } }));
    const client = new GithubClient(undefined, new AbortController().signal, fetchMock);

    await expect(client.getJson('/start')).rejects.toMatchObject({ status: 502, code: 'invalid_upstream_response' });
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it('retries an HTTP 500 once', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(null, { status: 500 }))
      .mockResolvedValueOnce(json({ ok: true }));
    const client = new GithubClient(undefined, new AbortController().signal, fetchMock);

    await expect(client.getJson('/test')).resolves.toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('does not immediately retry an outage with Retry-After', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 503, headers: { 'Retry-After': '120' } }));
    const client = new GithubClient(undefined, new AbortController().signal, fetchMock);

    await expect(client.getJson('/test')).rejects.toMatchObject({
      status: 503,
      code: 'github_unavailable',
      retryable: true,
      retryAfter: '120',
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each([
    [429, { 'Retry-After': '60' }],
    [403, { 'Retry-After': '30', 'X-RateLimit-Remaining': '42' }],
    [403, { 'X-RateLimit-Remaining': '0' }],
  ])('classifies GitHub rate limits for status %i', async (status, headers) => {
    const response = new Response(null, { status, headers });
    const client = new GithubClient(undefined, new AbortController().signal, vi.fn().mockResolvedValue(response));

    await expect(client.getJson('/test')).rejects.toMatchObject({
      status: 429,
      code: 'github_rate_limited',
      retryable: true,
    });
  });

  it('enforces the total GitHub request budget before fetching', async () => {
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(json({ ok: true })));
    const client = new GithubClient(undefined, new AbortController().signal, fetchMock);

    for (let index = 0; index < 190; index++) await client.getJson('/test');
    await expect(client.getJson('/test')).rejects.toMatchObject({ status: 422, code: 'traversal_budget_exceeded' });
    expect(fetchMock).toHaveBeenCalledTimes(190);
  });
});

describe('GitHub tree validation', () => {
  it('rejects a subtree that remains truncated during fallback traversal', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(json({ sha: ROOT_TREE, truncated: true, tree: [] }))
      .mockResolvedValueOnce(json({ sha: ROOT_TREE, truncated: true, tree: [] }));
    const client = new GithubClient(undefined, new AbortController().signal, fetchMock);

    await expect(buildRepositoryPayload(client, resolvedRepository(), 5_000)).rejects.toMatchObject({
      status: 422,
      code: 'traversal_incomplete',
    });
  });

  it('rejects invalid tree modes and unsafe paths', async () => {
    const invalidEntries = [
      { path: 'src/index.ts', mode: '040000', type: 'blob', sha: FILE_A, size: 1 },
      { path: '../secret', mode: '100644', type: 'blob', sha: FILE_A, size: 1 },
    ];

    for (const entry of invalidEntries) {
      const client = new GithubClient(undefined, new AbortController().signal, vi.fn().mockResolvedValue(json({
        sha: ROOT_TREE,
        truncated: false,
        tree: [entry],
      })));
      await expect(buildRepositoryPayload(client, resolvedRepository(), 5_000)).rejects.toMatchObject({
        status: 502,
        code: 'invalid_upstream_response',
      });
    }
  });

  it('rejects aggregate byte totals outside the safe numeric range', async () => {
    const fetchMock = vi.fn().mockResolvedValue(json({
      sha: ROOT_TREE,
      truncated: false,
      tree: [
        { path: 'a.bin', mode: '100644', type: 'blob', sha: FILE_A, size: Number.MAX_SAFE_INTEGER },
        { path: 'b.bin', mode: '100644', type: 'blob', sha: FILE_B, size: 1 },
      ],
    }));
    const client = new GithubClient(undefined, new AbortController().signal, fetchMock);

    await expect(buildRepositoryPayload(client, resolvedRepository(), 5_000)).rejects.toMatchObject({
      status: 413,
      code: 'repository_too_large',
    });
  });

  it('rejects upstream dot-segment repository names', async () => {
    const fetchMock = vi.fn().mockResolvedValue(json({ ...metadata(), name: '.', full_name: 'canonical/.' }));
    const client = new GithubClient(undefined, new AbortController().signal, fetchMock);

    await expect(resolveRepository(client, 'canonical', 'repo')).rejects.toMatchObject({
      status: 502,
      code: 'invalid_upstream_response',
    });
  });
});

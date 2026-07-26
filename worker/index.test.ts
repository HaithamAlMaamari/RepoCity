import { afterEach, describe, expect, it, vi } from 'vitest';
import worker, { parseRepositoryRequest } from './index';

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('parseRepositoryRequest', () => {
  it('accepts a valid repository request', () => {
    expect(parseRepositoryRequest(new URL('https://repo.city/api/repositories/owner/repo/tree?maxFiles=1200'))).toEqual({
      owner: 'owner', repo: 'repo', commit: undefined, maxFiles: 1200,
    });
  });

  it('rejects invalid paths, duplicate parameters, and abbreviated commits', () => {
    expect(() => parseRepositoryRequest(new URL('https://repo.city/api/repositories/a%2Fb/repo/tree'))).toThrow('valid GitHub');
    expect(() => parseRepositoryRequest(new URL('https://repo.city/api/repositories/bad--owner/repo/tree'))).toThrow('valid GitHub');
    expect(() => parseRepositoryRequest(new URL('https://repo.city/api/repositories/owner/repo/tree?maxFiles=1&maxFiles=2'))).toThrow('Invalid query');
    expect(() => parseRepositoryRequest(new URL('https://repo.city/api/repositories/owner/repo/tree?commit=abc'))).toThrow('full Git object SHA');
    expect(() => parseRepositoryRequest(new URL('https://repo.city/api/repositories/owner/repo/tree?commit='))).toThrow('full Git object SHA');
  });

  it('returns null for unknown API routes', () => {
    expect(parseRepositoryRequest(new URL('https://repo.city/api/unknown'))).toBeNull();
  });
});

function workerEnv(): Parameters<typeof worker.fetch>[1] {
  return { ASSETS: { fetch: vi.fn() } as unknown as Fetcher };
}

function executionContext(): Parameters<typeof worker.fetch>[2] {
  return { waitUntil: vi.fn() } as unknown as ExecutionContext;
}

function abortingFetch(rejectionDelay = 0) {
  return vi.fn((_input: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
    const signal = init?.signal;
    const rejectAbort = () => {
      const run = () => reject(new DOMException('aborted', 'AbortError'));
      if (rejectionDelay > 0) setTimeout(run, rejectionDelay);
      else run();
    };
    if (signal?.aborted) rejectAbort();
    else signal?.addEventListener('abort', rejectAbort, { once: true });
  }));
}

describe('Worker request cancellation', () => {
  it('returns a retryable timeout when upstream work exceeds 25 seconds', async () => {
    vi.useFakeTimers();
    const fetchMock = abortingFetch();
    vi.stubGlobal('fetch', fetchMock);
    const responsePromise = worker.fetch(
      new Request('https://repo.city/api/repositories/owner/repo/tree'),
      workerEnv(),
      executionContext(),
    );

    await vi.advanceTimersByTimeAsync(25_000);
    const response = await responsePromise;
    const payload = await response.json() as { error: { code: string; retryable: boolean; requestId: string } };

    expect(response.status).toBe(504);
    expect(payload.error).toMatchObject({ code: 'request_timed_out', retryable: true });
    expect(response.headers.get('X-Request-Id')).toBe(payload.error.requestId);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('does not start usable upstream work for an already-cancelled request', async () => {
    const requestController = new AbortController();
    requestController.abort();
    const fetchMock = abortingFetch();
    vi.stubGlobal('fetch', fetchMock);

    const response = await worker.fetch(
      new Request('https://repo.city/api/repositories/owner/repo/tree', { signal: requestController.signal }),
      workerEnv(),
      executionContext(),
    );
    const payload = await response.json() as { error: { code: string; retryable: boolean } };

    expect(response.status).toBe(499);
    expect(payload.error).toMatchObject({ code: 'request_cancelled', retryable: false });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('preserves client cancellation when upstream rejection arrives after the timeout deadline', async () => {
    vi.useFakeTimers();
    const requestController = new AbortController();
    const fetchMock = abortingFetch(26_000);
    vi.stubGlobal('fetch', fetchMock);
    const responsePromise = worker.fetch(
      new Request('https://repo.city/api/repositories/owner/repo/tree', { signal: requestController.signal }),
      workerEnv(),
      executionContext(),
    );

    requestController.abort();
    await vi.advanceTimersByTimeAsync(26_000);
    const response = await responsePromise;
    const payload = await response.json() as { error: { code: string } };

    expect(response.status).toBe(499);
    expect(payload.error.code).toBe('request_cancelled');
  });

  it('does not return a cache hit that resolves after the timeout', async () => {
    vi.useFakeTimers();
    const commitSha = '1'.repeat(40);
    const treeSha = '2'.repeat(40);
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        owner: { login: 'owner' }, name: 'repo', full_name: 'owner/repo', default_branch: 'main', private: false, disabled: false,
      }), { headers: { 'Content-Type': 'application/json' } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        sha: commitSha, commit: { tree: { sha: treeSha } },
      }), { headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);
    const cacheMatch = vi.fn(() => new Promise<Response>(() => {}));
    vi.stubGlobal('caches', { default: { match: cacheMatch, put: vi.fn() } });
    const responsePromise = worker.fetch(
      new Request('https://repo.city/api/repositories/owner/repo/tree'),
      workerEnv(),
      executionContext(),
    );

    await vi.advanceTimersByTimeAsync(25_000);
    const response = await responsePromise;
    const payload = await response.json() as { error: { code: string } };

    expect(response.status).toBe(504);
    expect(payload.error.code).toBe('request_timed_out');
    expect(cacheMatch).toHaveBeenCalledTimes(1);
  });
});

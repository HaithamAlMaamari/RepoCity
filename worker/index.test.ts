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
  const allow = () => ({ limit: vi.fn().mockResolvedValue({ success: true }) as unknown as RateLimit['limit'] });
  return {
    ASSETS: { fetch: vi.fn() } as unknown as Fetcher,
    INGEST_ACTOR_RATE_LIMITER: allow() as RateLimit,
    INGEST_GLOBAL_RATE_LIMITER: allow() as RateLimit,
  };
}

function rateLimitedEnv(
  actorLimit: ReturnType<typeof vi.fn>,
  globalLimit = vi.fn().mockResolvedValue({ success: true }),
): Parameters<typeof worker.fetch>[1] {
  return {
    ...workerEnv(),
    INGEST_ACTOR_RATE_LIMITER: { limit: actorLimit } as unknown as RateLimit,
    INGEST_GLOBAL_RATE_LIMITER: { limit: globalLimit } as unknown as RateLimit,
  };
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

describe('Worker ingestion rate limiting', () => {
  it('rejects over-limit requests before starting GitHub work', async () => {
    const actorLimit = vi.fn().mockResolvedValue({ success: false });
    const globalLimit = vi.fn().mockResolvedValue({ success: true });
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const response = await worker.fetch(
      new Request('https://repo.city/api/repositories/owner/repo/tree', {
        headers: { 'CF-Connecting-IP': '203.0.113.10' },
      }),
      rateLimitedEnv(actorLimit, globalLimit),
      executionContext(),
    );
    const payload = await response.json() as { error: { code: string; retryable: boolean } };

    expect(response.status).toBe(429);
    expect(response.headers.get('Retry-After')).toBe('60');
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(payload.error).toMatchObject({ code: 'request_rate_limited', retryable: true });
    expect(actorLimit).toHaveBeenCalledWith({ key: expect.stringMatching(/^actor-[0-9a-f]{64}$/) });
    expect(JSON.stringify(actorLimit.mock.calls)).not.toContain('203.0.113.10');
    expect(globalLimit).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('enforces the public-ingestion bucket after the actor bucket', async () => {
    const actorLimit = vi.fn().mockResolvedValue({ success: true });
    const globalLimit = vi.fn().mockResolvedValue({ success: false });

    const response = await worker.fetch(
      new Request('https://repo.city/api/repositories/owner/repo/tree'),
      rateLimitedEnv(actorLimit, globalLimit),
      executionContext(),
    );

    expect(response.status).toBe(429);
    expect(actorLimit).toHaveBeenCalledTimes(1);
    expect(globalLimit).toHaveBeenCalledWith({ key: 'public-repository-ingestion-v1' });
  });

  it('separates actor buckets without exposing raw addresses', async () => {
    const actorLimit = vi.fn().mockResolvedValue({ success: false });
    const firstAddress = '203.0.113.30';
    const secondAddress = '203.0.113.31';

    for (const address of [firstAddress, secondAddress]) {
      await worker.fetch(
        new Request('https://repo.city/api/repositories/owner/repo/tree', {
          headers: { 'CF-Connecting-IP': address },
        }),
        rateLimitedEnv(actorLimit),
        executionContext(),
      );
    }

    const keys = actorLimit.mock.calls.map(([input]) => (input as { key: string }).key);
    expect(keys[0]).not.toBe(keys[1]);
    expect(keys.join(' ')).not.toContain(firstAddress);
    expect(keys.join(' ')).not.toContain(secondAddress);
  });

  it('fails closed without logging request or repository identifiers when the limiter errors', async () => {
    const actorLimit = vi.fn().mockRejectedValue(new Error('binding unavailable'));
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});

    const response = await worker.fetch(
      new Request('https://repo.city/api/repositories/private-interest/repo/tree'),
      rateLimitedEnv(actorLimit),
      executionContext(),
    );
    const payload = await response.json() as { error: { code: string; retryable: boolean } };

    expect(response.status).toBe(503);
    expect(response.headers.get('Retry-After')).toBe('60');
    expect(payload.error).toMatchObject({ code: 'rate_limit_unavailable', retryable: true });
    expect(JSON.stringify(log.mock.calls)).not.toContain('private-interest');
  });

  it('fails closed when required limiter bindings are missing at runtime', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const env = { ASSETS: { fetch: vi.fn() } as unknown as Fetcher } as Parameters<typeof worker.fetch>[1];

    const response = await worker.fetch(
      new Request('https://repo.city/api/repositories/owner/repo/tree'),
      env,
      executionContext(),
    );
    const payload = await response.json() as { error: { code: string } };

    expect(response.status).toBe(503);
    expect(payload.error.code).toBe('rate_limit_unavailable');
  });

  it('checks valid ingestion requests but not rejected methods', async () => {
    const actorLimit = vi.fn().mockResolvedValue({ success: true });
    const globalLimit = vi.fn().mockResolvedValue({ success: true });
    const controller = new AbortController();
    controller.abort();

    const cancelled = await worker.fetch(
      new Request('https://repo.city/api/repositories/owner/repo/tree', { signal: controller.signal }),
      rateLimitedEnv(actorLimit, globalLimit),
      executionContext(),
    );
    expect(cancelled.status).toBe(499);
    expect(actorLimit).toHaveBeenCalledWith({ key: expect.stringMatching(/^actor-[0-9a-f]{64}$/) });
    expect(globalLimit).toHaveBeenCalledWith({ key: 'public-repository-ingestion-v1' });

    const methodError = await worker.fetch(
      new Request('https://repo.city/api/repositories/owner/repo/tree', { method: 'POST' }),
      rateLimitedEnv(actorLimit, globalLimit),
      executionContext(),
    );
    expect(methodError.status).toBe(405);
    expect(actorLimit).toHaveBeenCalledTimes(1);
    expect(globalLimit).toHaveBeenCalledTimes(1);
  });
});

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

    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
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

    await vi.waitFor(() => expect(cacheMatch).toHaveBeenCalledTimes(1));
    await vi.advanceTimersByTimeAsync(25_000);
    const response = await responsePromise;
    const payload = await response.json() as { error: { code: string } };

    expect(response.status).toBe(504);
    expect(payload.error.code).toBe('request_timed_out');
    expect(cacheMatch).toHaveBeenCalledTimes(1);
  });
});

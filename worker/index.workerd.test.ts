import { env } from 'cloudflare:workers';
import { createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GithubClient } from './github';
import worker from './index';

const COMMIT = '1'.repeat(40);
const TREE = '2'.repeat(40);
const FILE = '3'.repeat(40);
const IncomingRequest = Request<unknown, IncomingRequestCfProperties>;

afterEach(() => vi.unstubAllGlobals());

describe('RepoCity Worker in Workerd', () => {
  it('delegates non-API requests to the assets binding', async () => {
    const ctx = createExecutionContext();
    const response = await worker.fetch(new IncomingRequest('https://repo.city/health'), env, ctx);

    expect(response.status).toBe(200);
    expect(await response.text()).toContain('<title>repo.city');
  });

  it('returns consistent method errors with hardened headers', async () => {
    const ctx = createExecutionContext();
    const response = await worker.fetch(new IncomingRequest('https://repo.city/api/repositories/owner/repo/tree', {
      method: 'POST',
    }), env, ctx);
    const payload = await response.json<{ error: { code: string; requestId: string } }>();

    expect(response.status).toBe(405);
    expect(response.headers.get('Allow')).toBe('GET');
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(response.headers.get('X-Request-Id')).toBe(payload.error.requestId);
    expect(payload.error.code).toBe('method_not_allowed');
  });

  // SECURITY.md lists "documented CSP and deployment security headers" as a
  // release requirement. These assertions are what make that claim true.
  it('serves the application with its full security header set', async () => {
    const ctx = createExecutionContext();
    const response = await worker.fetch(new IncomingRequest('https://repo.city/'), env, ctx);

    const csp = response.headers.get('Content-Security-Policy') ?? '';
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("script-src 'self'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("frame-ancestors 'none'");
    // The browser must never be able to reach GitHub directly.
    expect(csp).toContain("connect-src 'self'");
    expect(csp).not.toContain("script-src 'self' 'unsafe-inline'");

    expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(response.headers.get('X-Frame-Options')).toBe('DENY');
    expect(response.headers.get('Referrer-Policy')).toBe('strict-origin-when-cross-origin');
    expect(response.headers.get('Cross-Origin-Opener-Policy')).toBe('same-origin');
    expect(response.headers.get('Strict-Transport-Security')).toContain('max-age=');
    expect(response.headers.get('Permissions-Policy')).toContain('geolocation=()');
  });

  it('observes already-aborted incoming requests in the runtime', async () => {
    const controller = new AbortController();
    controller.abort();
    const ctx = createExecutionContext();
    const response = await worker.fetch(new IncomingRequest('https://repo.city/api/repositories/owner/repo/tree', {
      signal: controller.signal,
    }), env, ctx);
    const payload = await response.json<{ error: { code: string } }>();

    expect(response.status).toBe(499);
    expect(payload.error.code).toBe('request_cancelled');
  });

  it('bounds streamed upstream bodies using Workerd streams', async () => {
    const cancel = vi.fn();
    const body = new ReadableStream<Uint8Array>({
      pull(controller) { controller.enqueue(new Uint8Array(9_000_001)); },
      cancel,
    });
    const fetchMock = vi.fn().mockResolvedValue(new Response(body, { headers: { 'Content-Type': 'application/json' } }));
    const client = new GithubClient(undefined, new AbortController().signal, fetchMock);

    await expect(client.getJson('/test')).rejects.toMatchObject({ status: 413, code: 'response_too_large' });
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it('persists successful immutable payloads in the runtime Cache API', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      const headers = {
        'Content-Type': 'application/json',
        'X-RateLimit-Limit': '5000',
        'X-RateLimit-Remaining': '4999',
      };
      if (url.pathname === '/repos/owner/repo') {
        return new Response(JSON.stringify({
          owner: { login: 'owner' }, name: 'repo', full_name: 'owner/repo', default_branch: 'main', private: false, disabled: false,
        }), { headers });
      }
      if (url.pathname === '/repos/owner/repo/commits/main') {
        return new Response(JSON.stringify({ sha: COMMIT, commit: { tree: { sha: TREE } } }), { headers });
      }
      if (url.pathname === `/repos/owner/repo/git/trees/${TREE}`) {
        return new Response(JSON.stringify({
          sha: TREE,
          truncated: false,
          tree: [{ path: 'README.md', mode: '100644', type: 'blob', sha: FILE, size: 12 }],
        }), { headers });
      }
      throw new Error(`Unexpected GitHub request: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    const requestUrl = 'https://repo.city/api/repositories/owner/repo/tree?maxFiles=5000';

    const firstContext = createExecutionContext();
    const first = await worker.fetch(new IncomingRequest(requestUrl), env, firstContext);
    await waitOnExecutionContext(firstContext);
    const firstBody = await first.json<{ totals: Record<string, number> }>();

    const secondContext = createExecutionContext();
    const second = await worker.fetch(new IncomingRequest(requestUrl), env, secondContext);
    await waitOnExecutionContext(secondContext);

    expect(first.status).toBe(200);
    expect(first.headers.get('X-RepoCity-Cache')).toBe('MISS');
    expect(first.headers.get('Cache-Control')).toBe('private, max-age=0, must-revalidate');
    expect(firstBody.totals).toEqual({ files: 1, directories: 0, submodules: 0, bytes: 12 });
    expect(second.status).toBe(200);
    expect(second.headers.get('X-RepoCity-Cache')).toBe('HIT');
    expect(second.headers.get('ETag')).toBe(first.headers.get('ETag'));

    // GitHub answered both upstream calls with X-RateLimit-* describing the
    // server credential's quota. Neither the MISS nor the HIT may pass it on.
    for (const header of ['X-RateLimit-Limit', 'X-RateLimit-Remaining', 'X-RateLimit-Reset', 'X-RateLimit-Resource']) {
      expect(first.headers.get(header)).toBeNull();
      expect(second.headers.get(header)).toBeNull();
    }
    expect(first.headers.get('Content-Security-Policy')).toContain("default-src 'self'");
    expect(fetchMock.mock.calls.filter(([input]) => String(input).includes('/git/trees/'))).toHaveLength(1);
  });
});

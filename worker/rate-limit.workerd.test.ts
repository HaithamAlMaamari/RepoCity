import { env } from 'cloudflare:workers';
import { createExecutionContext } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import worker from './index';

const IncomingRequest = Request<unknown, IncomingRequestCfProperties>;

async function admittedStatus(address: string): Promise<number> {
  const controller = new AbortController();
  controller.abort();
  return (await worker.fetch(new IncomingRequest('https://repo.city/api/repositories/owner/repo/tree', {
    signal: controller.signal,
    headers: { 'CF-Connecting-IP': address },
  }), env, createExecutionContext())).status;
}

describe('RepoCity Workerd rate-limit bindings', () => {
  it('enforces actor and global thresholds with the configured counter order', async () => {
    const actorResponses: number[] = [];
    for (let index = 0; index < 4; index++) {
      actorResponses.push(await admittedStatus('203.0.113.20'));
    }
    expect(actorResponses).toEqual([499, 499, 499, 429]);

    const globalResponses: number[] = [];
    for (let index = 0; index < 8; index++) {
      globalResponses.push(await admittedStatus(`203.0.113.${index + 40}`));
    }
    expect(globalResponses).toEqual([...Array<number>(7).fill(499), 429]);
  });
});

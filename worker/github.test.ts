import { describe, expect, it, vi } from 'vitest';
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
    const resolved = {
      repository: {
        owner: 'canonical', name: 'repo', fullName: 'canonical/repo', defaultBranch: 'main',
        htmlUrl: 'https://github.com/canonical/repo',
      },
      revision: { commitSha: COMMIT, treeSha: ROOT_TREE },
    };

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

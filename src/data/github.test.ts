import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildNestedTree, fetchRepoTree } from './github';
import { LANGUAGE_POLICY, TREE_API_SCHEMA_VERSION } from './github-contract';
import type { RepositoryFile } from './github-contract';

const COMMIT = '1'.repeat(40);
const TREE = '2'.repeat(40);

function responsePayload() {
  return {
    schemaVersion: TREE_API_SCHEMA_VERSION,
    repository: {
      owner: 'canonical',
      name: 'repo',
      fullName: 'canonical/repo',
      defaultBranch: 'main',
      htmlUrl: 'https://github.com/canonical/repo',
    },
    revision: { commitSha: COMMIT, treeSha: TREE },
    coverage: { tree: 'complete', selection: 'complete' },
    totals: { files: 1, directories: 1, submodules: 0, bytes: 10 },
    selection: {
      maxFiles: 5_000,
      returnedFiles: 1,
      omittedFiles: 0,
      policy: 'all',
      seed: COMMIT,
      languagePolicy: LANGUAGE_POLICY,
    },
    languages: [{ language: 'typescript', files: 1, bytes: 10 }],
    files: [{ path: 'src/index.ts', sha: '3'.repeat(40), mode: '100644', size: 10, language: 'typescript' }],
    submodules: [],
    emptyDirectories: [],
  };
}

afterEach(() => vi.unstubAllGlobals());

describe('fetchRepoTree', () => {
  it('uses the same-origin API and forwards immutable state and cancellation', async () => {
    const signal = new AbortController().signal;
    const fetchMock = vi.fn<typeof fetch>(async () => Response.json(responsePayload()));
    vi.stubGlobal('fetch', fetchMock);

    const result = await fetchRepoTree({ owner: 'old', repo: 'repo', commit: COMMIT, maxFiles: 5_000, signal });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`/api/repositories/old/repo/tree?maxFiles=5000&commit=${COMMIT}`);
    expect(init?.signal).toBe(signal);
    expect(result.repository.fullName).toBe('canonical/repo');
    expect(result.root.children[0].path).toBe('src');
  });

  it('uses typed API errors without exposing upstream bodies', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({
      error: { code: 'repository_not_found', message: 'Repository not found.', retryable: false },
    }, { status: 404 })));
    await expect(fetchRepoTree({ owner: 'missing', repo: 'repo' })).rejects.toThrow('Repository not found.');
  });
});

describe('buildNestedTree', () => {
  const file = (path: string, size: number): RepositoryFile => ({
    path,
    size,
    sha: path.padEnd(40, 'a').slice(0, 40).replace(/[^a-f0-9]/g, 'a'),
    mode: '100644',
    language: 'typescript',
  });

  it('preserves a shared top-level directory in a sampled file set', () => {
    const root = buildNestedTree([file('src/a.ts', 4), file('src/b.ts', 6)], 'repo');
    expect(root.children.map((node) => node.path)).toEqual(['src']);
    expect(root.children[0].size).toBe(10);
  });

  it('sorts equal-size children deterministically and rejects duplicates', () => {
    const root = buildNestedTree([file('b.ts', 1), file('a.ts', 1)], 'repo');
    expect(root.children.map((node) => node.path)).toEqual(['a.ts', 'b.ts']);
    expect(() => buildNestedTree([file('a.ts', 1), file('a.ts', 1)], 'repo')).toThrow('Duplicate');
  });
});

import { describe, expect, it } from 'vitest';
import {
  LANGUAGE_POLICY,
  SAMPLING_POLICY,
  TREE_API_SCHEMA_VERSION,
  parseRepositoryTreePayload,
} from './github-contract';

const COMMIT = 'a'.repeat(40);
const TREE = 'b'.repeat(40);
const FILE = 'c'.repeat(40);

function payload() {
  return {
    schemaVersion: TREE_API_SCHEMA_VERSION,
    repository: {
      owner: 'example',
      name: 'project',
      fullName: 'example/project',
      defaultBranch: 'main',
      htmlUrl: 'https://github.com/example/project',
    },
    revision: { commitSha: COMMIT, treeSha: TREE },
    coverage: { tree: 'complete', selection: 'complete' },
    totals: { files: 1, directories: 1, submodules: 0, bytes: 12 },
    selection: {
      maxFiles: 5_000,
      returnedFiles: 1,
      omittedFiles: 0,
      policy: 'all',
      seed: COMMIT,
      languagePolicy: LANGUAGE_POLICY,
    },
    languages: [{ language: 'typescript', files: 1, bytes: 12 }],
    files: [{ path: 'src/index.ts', sha: FILE, mode: '100644', size: 12, language: 'typescript' }],
    submodules: [],
    emptyDirectories: [],
  };
}

describe('parseRepositoryTreePayload', () => {
  it('accepts a consistent versioned payload', () => {
    expect(parseRepositoryTreePayload(payload()).repository.fullName).toBe('example/project');
  });

  it('rejects unsupported schemas and unsafe paths', () => {
    expect(() => parseRepositoryTreePayload({ ...payload(), schemaVersion: 2 })).toThrow('schema version');
    const unsafe = payload();
    unsafe.files[0].path = '../secret';
    expect(() => parseRepositoryTreePayload(unsafe)).toThrow('files[0].path');
  });

  it('rejects selection totals that do not match returned files', () => {
    const inconsistent = payload();
    inconsistent.selection.policy = SAMPLING_POLICY;
    inconsistent.selection.returnedFiles = 2;
    expect(() => parseRepositoryTreePayload(inconsistent)).toThrow('selection counts');
  });
});

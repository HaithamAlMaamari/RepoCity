import { describe, expect, it } from 'vitest';
import {
  LANGUAGE_POLICY,
  SAMPLING_POLICY,
  TREE_API_SCHEMA_VERSION,
  parseApiError,
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
    emptyDirectories: [] as string[],
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

  it('accepts internally consistent sampled payloads', () => {
    const sampled = payload();
    sampled.coverage.selection = 'sampled';
    sampled.totals.files = 2;
    sampled.totals.bytes = 20;
    sampled.totals.directories = 3;
    sampled.selection.returnedFiles = 1;
    sampled.selection.omittedFiles = 1;
    sampled.selection.policy = SAMPLING_POLICY;
    sampled.languages[0].files = 2;
    sampled.languages[0].bytes = 20;

    expect(parseRepositoryTreePayload(sampled).coverage.selection).toBe('sampled');
  });

  it.each([
    ['selection limit', (value: ReturnType<typeof payload>) => { value.selection.maxFiles = 0; }],
    ['returned selection limit', (value: ReturnType<typeof payload>) => {
      value.files.push({ path: 'src/other.ts', sha: 'd'.repeat(40), mode: '100644', size: 12, language: 'typescript' });
      value.totals.files = 2;
      value.totals.bytes = 24;
      value.selection.maxFiles = 1;
      value.selection.returnedFiles = 2;
      value.languages[0].files = 2;
      value.languages[0].bytes = 24;
    }],
    ['sampling policy', (value: ReturnType<typeof payload>) => { value.selection.policy = SAMPLING_POLICY; }],
    ['sampling seed', (value: ReturnType<typeof payload>) => { value.selection.seed = TREE; }],
    ['submodule totals', (value: ReturnType<typeof payload>) => { value.totals.submodules = 1; }],
    ['directory totals', (value: ReturnType<typeof payload>) => { value.totals.directories = 0; value.emptyDirectories = ['empty']; }],
    ['language file totals', (value: ReturnType<typeof payload>) => { value.languages[0].files = 2; }],
    ['language byte totals', (value: ReturnType<typeof payload>) => { value.languages[0].bytes = 11; }],
    ['duplicate paths', (value: ReturnType<typeof payload>) => { value.emptyDirectories = ['src/index.ts']; }],
    ['invalid file mode', (value: ReturnType<typeof payload>) => { value.files[0].mode = '040000'; }],
    ['undeclared file language', (value: ReturnType<typeof payload>) => { value.files[0].language = 'javascript'; }],
    ['selected byte totals', (value: ReturnType<typeof payload>) => { value.files[0].size = 13; }],
    ['repository URL identity', (value: ReturnType<typeof payload>) => { value.repository.htmlUrl = 'https://github.com/other/project'; }],
    ['repository name', (value: ReturnType<typeof payload>) => { value.repository.name = '..'; value.repository.fullName = 'example/..'; value.repository.htmlUrl = 'https://github.com/example/..'; }],
    ['repository owner', (value: ReturnType<typeof payload>) => { value.repository.owner = 'bad--owner'; value.repository.fullName = 'bad--owner/project'; value.repository.htmlUrl = 'https://github.com/bad--owner/project'; }],
    ['derived directory totals', (value: ReturnType<typeof payload>) => { value.totals.directories = 0; }],
    ['leaf ancestor hierarchy', (value: ReturnType<typeof payload>) => { value.emptyDirectories = ['src/index.ts/empty']; value.totals.directories = 3; }],
  ])('rejects inconsistent %s', (_label, mutate) => {
    const invalid = payload();
    mutate(invalid);
    expect(() => parseRepositoryTreePayload(invalid)).toThrow();
  });

  it('rejects duplicate language aggregates', () => {
    const invalid = payload();
    invalid.languages.push({ ...invalid.languages[0] });
    expect(() => parseRepositoryTreePayload(invalid)).toThrow('duplicate language');
  });

  it('accepts empty trees and zero-byte files', () => {
    const empty = payload();
    empty.totals = { files: 0, directories: 0, submodules: 0, bytes: 0 };
    empty.selection.returnedFiles = 0;
    empty.selection.omittedFiles = 0;
    empty.languages = [];
    empty.files = [];
    expect(parseRepositoryTreePayload(empty).totals).toEqual(empty.totals);

    const zeroByte = payload();
    zeroByte.totals.bytes = 0;
    zeroByte.languages[0].bytes = 0;
    zeroByte.files[0].size = 0;
    expect(parseRepositoryTreePayload(zeroByte).totals.bytes).toBe(0);
  });

  it('rejects a sampled language bucket smaller than its selected files', () => {
    const invalid = payload();
    invalid.coverage.selection = 'sampled';
    invalid.totals.files = 3;
    invalid.totals.bytes = 30;
    invalid.selection.omittedFiles = 2;
    invalid.selection.policy = SAMPLING_POLICY;
    invalid.languages = [
      { language: 'typescript', files: 2, bytes: 10 },
      { language: 'javascript', files: 1, bytes: 20 },
    ];
    invalid.files[0].size = 12;

    expect(() => parseRepositoryTreePayload(invalid)).toThrow('totals for language');
  });
});

describe('parseApiError', () => {
  it('accepts a complete typed API error', () => {
    expect(parseApiError({
      error: { code: 'github_rate_limited', message: 'Try later.', retryable: true, requestId: 'request-1' },
    })).toEqual({
      error: { code: 'github_rate_limited', message: 'Try later.', retryable: true, requestId: 'request-1' },
    });
  });

  it.each([
    null,
    {},
    { error: { code: '', message: 'No code.', retryable: false } },
    { error: { code: 'bad', message: '', retryable: false } },
    { error: { code: 'bad', message: 'Bad.', retryable: 'false' } },
    { error: { code: 'bad', message: 'Bad.', retryable: false, requestId: '' } },
  ])('returns null for malformed errors', (value) => {
    expect(parseApiError(value)).toBeNull();
  });
});

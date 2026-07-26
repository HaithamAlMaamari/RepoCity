export const TREE_API_SCHEMA_VERSION = 1 as const;
export const MAX_SELECTED_FILES = 5_000;
export const SAMPLING_POLICY = 'district-language-bottom-k-v1' as const;
export const LANGUAGE_POLICY = 'extension-v1' as const;

export interface RepositoryIdentity {
  owner: string;
  name: string;
  fullName: string;
  defaultBranch: string;
  htmlUrl: string;
}

export interface RevisionIdentity {
  commitSha: string;
  treeSha: string;
}

export interface RepositoryTotals {
  files: number;
  directories: number;
  submodules: number;
  bytes: number;
}

export interface RepositoryFile {
  path: string;
  sha: string;
  mode: string;
  size: number;
  language: string;
}

export interface RepositorySubmodule {
  path: string;
  sha: string;
  mode: '160000';
}

export interface LanguageTotal {
  language: string;
  files: number;
  bytes: number;
}

export interface RepositoryTreePayload {
  schemaVersion: typeof TREE_API_SCHEMA_VERSION;
  repository: RepositoryIdentity;
  revision: RevisionIdentity;
  coverage: {
    tree: 'complete';
    selection: 'complete' | 'sampled';
  };
  totals: RepositoryTotals;
  selection: {
    maxFiles: number;
    returnedFiles: number;
    omittedFiles: number;
    policy: 'all' | typeof SAMPLING_POLICY;
    seed: string;
    languagePolicy: typeof LANGUAGE_POLICY;
  };
  languages: LanguageTotal[];
  files: RepositoryFile[];
  submodules: RepositorySubmodule[];
  emptyDirectories: string[];
}

export interface ApiErrorPayload {
  error: {
    code: string;
    message: string;
    retryable: boolean;
    requestId?: string;
  };
}

export function parseRepositoryTreePayload(value: unknown): RepositoryTreePayload {
  const root = record(value, 'response');
  if (root.schemaVersion !== TREE_API_SCHEMA_VERSION) {
    throw new Error('RepoCity API returned an unsupported schema version.');
  }

  const repositoryValue = record(root.repository, 'repository');
  const repository: RepositoryIdentity = {
    owner: text(repositoryValue.owner, 'repository.owner'),
    name: text(repositoryValue.name, 'repository.name'),
    fullName: text(repositoryValue.fullName, 'repository.fullName'),
    defaultBranch: text(repositoryValue.defaultBranch, 'repository.defaultBranch'),
    htmlUrl: httpsUrl(repositoryValue.htmlUrl, 'repository.htmlUrl'),
  };
  if (repository.fullName !== `${repository.owner}/${repository.name}`) {
    throw new Error('RepoCity API returned an inconsistent repository identity.');
  }

  const revisionValue = record(root.revision, 'revision');
  const revision: RevisionIdentity = {
    commitSha: sha(revisionValue.commitSha, 'revision.commitSha'),
    treeSha: sha(revisionValue.treeSha, 'revision.treeSha'),
  };

  const coverageValue = record(root.coverage, 'coverage');
  if (coverageValue.tree !== 'complete') {
    throw new Error('RepoCity API did not provide a complete repository tree.');
  }
  if (coverageValue.selection !== 'complete' && coverageValue.selection !== 'sampled') {
    throw new Error('RepoCity API returned an invalid selection state.');
  }

  const totalsValue = record(root.totals, 'totals');
  const totals: RepositoryTotals = {
    files: integer(totalsValue.files, 'totals.files'),
    directories: integer(totalsValue.directories, 'totals.directories'),
    submodules: integer(totalsValue.submodules, 'totals.submodules'),
    bytes: integer(totalsValue.bytes, 'totals.bytes'),
  };

  const selectionValue = record(root.selection, 'selection');
  const policy = selectionValue.policy;
  if (policy !== 'all' && policy !== SAMPLING_POLICY) {
    throw new Error('RepoCity API returned an unknown sampling policy.');
  }
  if (selectionValue.languagePolicy !== LANGUAGE_POLICY) {
    throw new Error('RepoCity API returned an unknown language policy.');
  }
  const selection = {
    maxFiles: integer(selectionValue.maxFiles, 'selection.maxFiles'),
    returnedFiles: integer(selectionValue.returnedFiles, 'selection.returnedFiles'),
    omittedFiles: integer(selectionValue.omittedFiles, 'selection.omittedFiles'),
    policy,
    seed: sha(selectionValue.seed, 'selection.seed'),
    languagePolicy: LANGUAGE_POLICY,
  } satisfies RepositoryTreePayload['selection'];

  const files = array(root.files, 'files').map((item, index) => {
    const file = record(item, `files[${index}]`);
    return {
      path: repositoryPath(file.path, `files[${index}].path`),
      sha: sha(file.sha, `files[${index}].sha`),
      mode: text(file.mode, `files[${index}].mode`),
      size: integer(file.size, `files[${index}].size`),
      language: text(file.language, `files[${index}].language`),
    };
  });

  const submodules = array(root.submodules, 'submodules').map((item, index) => {
    const submodule = record(item, `submodules[${index}]`);
    if (submodule.mode !== '160000') {
      throw new Error(`RepoCity API returned an invalid submodule mode at index ${index}.`);
    }
    return {
      path: repositoryPath(submodule.path, `submodules[${index}].path`),
      sha: sha(submodule.sha, `submodules[${index}].sha`),
      mode: '160000' as const,
    };
  });

  const languages = array(root.languages, 'languages').map((item, index) => {
    const language = record(item, `languages[${index}]`);
    return {
      language: text(language.language, `languages[${index}].language`),
      files: integer(language.files, `languages[${index}].files`),
      bytes: integer(language.bytes, `languages[${index}].bytes`),
    };
  });

  const emptyDirectories = array(root.emptyDirectories, 'emptyDirectories').map((item, index) =>
    repositoryPath(item, `emptyDirectories[${index}]`),
  );

  if (selection.returnedFiles !== files.length || selection.omittedFiles !== totals.files - files.length) {
    throw new Error('RepoCity API returned inconsistent selection counts.');
  }
  if ((coverageValue.selection === 'sampled') !== (files.length < totals.files)) {
    throw new Error('RepoCity API returned an inconsistent selection state.');
  }

  return {
    schemaVersion: TREE_API_SCHEMA_VERSION,
    repository,
    revision,
    coverage: { tree: 'complete', selection: coverageValue.selection },
    totals,
    selection,
    languages,
    files,
    submodules,
    emptyDirectories,
  };
}

export function parseApiError(value: unknown): ApiErrorPayload | null {
  try {
    const root = record(value, 'error response');
    const error = record(root.error, 'error');
    return {
      error: {
        code: text(error.code, 'error.code'),
        message: text(error.message, 'error.message'),
        retryable: typeof error.retryable === 'boolean' ? error.retryable : false,
        requestId: typeof error.requestId === 'string' ? error.requestId : undefined,
      },
    };
  } catch {
    return null;
  }
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`RepoCity API returned invalid ${label}.`);
  }
  return value as Record<string, unknown>;
}

function array(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`RepoCity API returned invalid ${label}.`);
  return value;
}

function text(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`RepoCity API returned invalid ${label}.`);
  }
  return value;
}

function integer(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new Error(`RepoCity API returned invalid ${label}.`);
  }
  return value as number;
}

function sha(value: unknown, label: string): string {
  const result = text(value, label).toLowerCase();
  if (!/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(result)) {
    throw new Error(`RepoCity API returned invalid ${label}.`);
  }
  return result;
}

function repositoryPath(value: unknown, label: string): string {
  const result = text(value, label);
  const segments = result.split('/');
  if (result.startsWith('/') || result.endsWith('/') || result.includes('\\') || result.includes('\0') ||
      segments.some((segment) => !segment || segment === '.' || segment === '..')) {
    throw new Error(`RepoCity API returned invalid ${label}.`);
  }
  return result;
}

function httpsUrl(value: unknown, label: string): string {
  const result = text(value, label);
  let url: URL;
  try {
    url = new URL(result);
  } catch {
    throw new Error(`RepoCity API returned invalid ${label}.`);
  }
  if (url.protocol !== 'https:' || url.hostname !== 'github.com') {
    throw new Error(`RepoCity API returned invalid ${label}.`);
  }
  return result;
}

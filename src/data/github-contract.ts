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
  const owner = githubName(repositoryValue.owner, 'repository.owner', 39, false);
  const name = githubName(repositoryValue.name, 'repository.name', 100, true);
  const repository: RepositoryIdentity = {
    owner,
    name,
    fullName: text(repositoryValue.fullName, 'repository.fullName'),
    defaultBranch: text(repositoryValue.defaultBranch, 'repository.defaultBranch'),
    htmlUrl: githubRepositoryUrl(repositoryValue.htmlUrl, owner, name),
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
    maxFiles: boundedInteger(selectionValue.maxFiles, 'selection.maxFiles', 1, MAX_SELECTED_FILES),
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
      mode: fileMode(file.mode, `files[${index}].mode`),
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
      files: boundedInteger(language.files, `languages[${index}].files`, 1, Number.MAX_SAFE_INTEGER),
      bytes: integer(language.bytes, `languages[${index}].bytes`),
    };
  });

  const emptyDirectories = array(root.emptyDirectories, 'emptyDirectories').map((item, index) =>
    repositoryPath(item, `emptyDirectories[${index}]`),
  );

  if (selection.returnedFiles !== files.length || selection.omittedFiles !== totals.files - files.length) {
    throw new Error('RepoCity API returned inconsistent selection counts.');
  }
  if (selection.returnedFiles > selection.maxFiles) {
    throw new Error('RepoCity API returned more files than the selection limit.');
  }
  if ((coverageValue.selection === 'sampled') !== (files.length < totals.files)) {
    throw new Error('RepoCity API returned an inconsistent selection state.');
  }
  const expectedPolicy = coverageValue.selection === 'complete' ? 'all' : SAMPLING_POLICY;
  if (selection.policy !== expectedPolicy || selection.seed !== revision.commitSha) {
    throw new Error('RepoCity API returned inconsistent sampling metadata.');
  }
  if (totals.submodules !== submodules.length || emptyDirectories.length > totals.directories) {
    throw new Error('RepoCity API returned inconsistent tree totals.');
  }

  const paths = new Set<string>();
  const leafPaths = new Set([...files, ...submodules].map((item) => item.path));
  const emptyDirectoryPaths = new Set(emptyDirectories);
  for (const item of [...files, ...submodules, ...emptyDirectories.map((path) => ({ path }))]) {
    if (paths.has(item.path)) throw new Error(`RepoCity API returned duplicate path: ${item.path}`);
    paths.add(item.path);
  }
  const derivedDirectories = new Set<string>();
  for (const path of leafPaths) {
    const segments = path.split('/');
    for (let index = 1; index < segments.length; index++) {
      const parent = segments.slice(0, index).join('/');
      if (leafPaths.has(parent) || emptyDirectoryPaths.has(parent)) {
        throw new Error(`RepoCity API returned an invalid path hierarchy at: ${parent}`);
      }
      derivedDirectories.add(parent);
    }
  }
  for (const path of emptyDirectoryPaths) {
    const segments = path.split('/');
    for (let index = 1; index <= segments.length; index++) {
      const directory = segments.slice(0, index).join('/');
      if (index < segments.length && (leafPaths.has(directory) || emptyDirectoryPaths.has(directory))) {
        throw new Error(`RepoCity API returned an invalid path hierarchy at: ${directory}`);
      }
      derivedDirectories.add(directory);
    }
  }
  if (derivedDirectories.size > totals.directories ||
      (coverageValue.selection === 'complete' && derivedDirectories.size !== totals.directories)) {
    throw new Error('RepoCity API returned inconsistent directory totals.');
  }

  const languageTotals = new Map<string, { files: number; bytes: number }>();
  let languageFiles = 0;
  let languageBytes = 0;
  for (const language of languages) {
    if (languageTotals.has(language.language)) {
      throw new Error(`RepoCity API returned duplicate language: ${language.language}`);
    }
    languageTotals.set(language.language, language);
    languageFiles = safeSum(languageFiles, language.files, 'language file totals');
    languageBytes = safeSum(languageBytes, language.bytes, 'language byte totals');
  }
  if (languageFiles !== totals.files || languageBytes !== totals.bytes) {
    throw new Error('RepoCity API returned inconsistent language totals.');
  }

  const selectedLanguages = new Map<string, { files: number; bytes: number }>();
  let selectedBytes = 0;
  for (const file of files) {
    selectedBytes = safeSum(selectedBytes, file.size, 'selected file bytes');
    const declared = languageTotals.get(file.language);
    if (!declared) throw new Error(`RepoCity API returned an undeclared file language: ${file.language}`);
    const selected = selectedLanguages.get(file.language) ?? { files: 0, bytes: 0 };
    selected.files++;
    selected.bytes = safeSum(selected.bytes, file.size, 'selected language bytes');
    selectedLanguages.set(file.language, selected);
  }
  if (selectedBytes > totals.bytes) throw new Error('RepoCity API returned inconsistent selected file bytes.');
  for (const [language, selected] of selectedLanguages) {
    const declared = languageTotals.get(language)!;
    if (selected.files > declared.files || selected.bytes > declared.bytes ||
        (coverageValue.selection === 'complete' && (selected.files !== declared.files || selected.bytes !== declared.bytes))) {
      throw new Error(`RepoCity API returned inconsistent totals for language: ${language}`);
    }
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
    if (typeof error.retryable !== 'boolean') throw new Error('RepoCity API returned invalid error.retryable.');
    return {
      error: {
        code: text(error.code, 'error.code'),
        message: text(error.message, 'error.message'),
        retryable: error.retryable,
        requestId: error.requestId === undefined ? undefined : text(error.requestId, 'error.requestId'),
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

function boundedInteger(value: unknown, label: string, minimum: number, maximum: number): number {
  const result = integer(value, label);
  if (result < minimum || result > maximum) throw new Error(`RepoCity API returned invalid ${label}.`);
  return result;
}

function safeSum(total: number, value: number, label: string): number {
  const result = total + value;
  if (!Number.isSafeInteger(result)) throw new Error(`RepoCity API returned invalid ${label}.`);
  return result;
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

function githubName(value: unknown, label: string, max: number, allowPunctuation: boolean): string {
  const result = text(value, label);
  const pattern = allowPunctuation ? /^[A-Za-z0-9._-]+$/ : /^[A-Za-z0-9-]+$/;
  const invalidOwner = !allowPunctuation && (result.startsWith('-') || result.endsWith('-') || result.includes('--'));
  if (result.length > max || !pattern.test(result) || invalidOwner || (allowPunctuation && (result === '.' || result === '..'))) {
    throw new Error(`RepoCity API returned invalid ${label}.`);
  }
  return result;
}

function githubRepositoryUrl(value: unknown, owner: string, name: string): string {
  const result = text(value, 'repository.htmlUrl');
  if (result !== `https://github.com/${owner}/${name}`) {
    throw new Error('RepoCity API returned invalid repository.htmlUrl.');
  }
  return result;
}

function fileMode(value: unknown, label: string): string {
  const result = text(value, label);
  if (!['100644', '100755', '120000'].includes(result)) {
    throw new Error(`RepoCity API returned invalid ${label}.`);
  }
  return result;
}

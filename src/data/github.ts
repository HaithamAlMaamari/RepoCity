/**
 * RepoCity repository tree client and language classifier.
 *
 * Fetches the validated same-origin Worker contract and converts its sampled
 * files into a nested, size-sorted TreeNode for the city layout.
 */

import {
  MAX_SELECTED_FILES,
  parseApiError,
  parseRepositoryTreePayload,
} from './github-contract';
import type { RepositoryFile, RepositoryTreePayload } from './github-contract';

// ---------------------------------------------------------------------------
//  Public types
// ---------------------------------------------------------------------------

/** Options controlling which repository is fetched and how it is processed. */
export interface FetchOptions {
  /** Repository owner (user or organisation). */
  owner: string;
  /** Repository name. */
  repo: string;
  /** Optional immutable commit SHA. Defaults to the current default branch. */
  commit?: string;
  /** Maximum number of files returned by deterministic sampling. */
  maxFiles?: number;
  /** Cancels this request when a newer repository is requested. */
  signal?: AbortSignal;
}

/** Result of a successful `fetchRepoTree` call. */
export interface FetchResult extends RepositoryTreePayload {
  /** Root directory node of the reconstructed tree. */
  root: TreeNode;
}

/** A single node in the reconstructed repository tree. */
export interface TreeNode {
  /** File or directory name (last path segment). */
  name: string;
  /** Full path within the repository (empty string for the root). */
  path: string;
  /** Node type – `'file'` or `'dir'`. */
  type: 'file' | 'dir';
  /** Size in bytes. For directories this is the recursive sum of children. */
  size: number;
  /** Child nodes (empty for files). Sorted by size descending. */
  children: TreeNode[];
  /** Detected programming language (files only). */
  language?: string;
}

// ---------------------------------------------------------------------------
//  Constants
// ---------------------------------------------------------------------------

/** Fallback when the caller does not supply `maxFiles`. */
const DEFAULT_MAX_FILES = MAX_SELECTED_FILES;

/** Mapping from file extension → human-readable language name. */
const EXTENSION_TO_LANGUAGE: Readonly<Record<string, string>> = {
  '.js': 'javascript',
  '.jsx': 'javascript',
  '.mjs': 'javascript',
  '.cjs': 'javascript',

  '.ts': 'typescript',
  '.tsx': 'typescript',
  '.mts': 'typescript',
  '.cts': 'typescript',

  '.py': 'python',
  '.rs': 'rust',
  '.go': 'go',

  '.c': 'c',
  '.h': 'c',

  '.cpp': 'cpp',
  '.cc': 'cpp',
  '.cxx': 'cpp',
  '.hpp': 'cpp',
  '.hh': 'cpp',
  '.hxx': 'cpp',

  '.java': 'java',
  '.cs': 'csharp',
  '.scala': 'scala',
  '.sc': 'scala',
  '.kt': 'kotlin',
  '.kts': 'kotlin',
  '.swift': 'swift',
  '.dart': 'dart',
  '.groovy': 'groovy',
  '.gvy': 'groovy',
  '.gradle': 'groovy',

  '.hs': 'haskell',
  '.lhs': 'haskell',
  '.elm': 'elm',
  '.fs': 'fsharp',
  '.fsi': 'fsharp',
  '.fsx': 'fsharp',
  '.ml': 'ocaml',
  '.mli': 'ocaml',
  '.clj': 'clojure',
  '.cljs': 'clojure',
  '.cljc': 'clojure',
  '.edn': 'clojure',
  '.cr': 'crystal',
  '.nim': 'nim',
  '.nims': 'nim',
  '.zig': 'zig',
  '.jl': 'julia',
  '.m': 'objc',
  '.mm': 'objcpp',

  '.ex': 'elixir',
  '.exs': 'elixir',
  '.erl': 'erlang',
  '.hrl': 'erlang',
  '.lua': 'lua',
  '.pl': 'perl',
  '.pm': 'perl',
  '.r': 'r',
  '.rmd': 'r',
  '.hx': 'haxe',
  '.coffee': 'coffeescript',
  '.el': 'elisp',

  '.html': 'html',
  '.htm': 'html',

  '.css': 'css',
  '.scss': 'scss',
  '.sass': 'sass',
  '.less': 'less',
  '.styl': 'css',

  '.vue': 'vue',
  '.svelte': 'svelte',

  '.hbs': 'handlebars',
  '.handlebars': 'handlebars',
  '.pug': 'pug',
  '.jade': 'pug',
  '.liquid': 'liquid',
  '.j2': 'jinja',
  '.jinja': 'jinja',
  '.jinja2': 'jinja',
  '.twig': 'twig',
  '.mustache': 'mustache',
  '.ejs': 'ejs',

  '.glsl': 'glsl',
  '.vert': 'glsl',
  '.frag': 'glsl',
  '.geom': 'glsl',
  '.comp': 'glsl',
  '.hlsl': 'hlsl',
  '.wgsl': 'wgsl',

  '.graphql': 'graphql',
  '.gql': 'graphql',
  '.sql': 'sql',

  '.tex': 'tex',
  '.latex': 'tex',
  '.bib': 'tex',
  '.rst': 'rst',
  '.adoc': 'asciidoc',
  '.asciidoc': 'asciidoc',

  '.json': 'json',
  '.md': 'markdown',
  '.mdx': 'markdown',
  '.markdown': 'markdown',
  '.yml': 'yaml',
  '.yaml': 'yaml',
  '.toml': 'toml',
  '.xml': 'xml',
  '.proto': 'protobuf',
  '.tf': 'terraform',
  '.tfvars': 'terraform',
  '.hcl': 'terraform',
  '.nix': 'nix',
  '.sol': 'solidity',
  '.wat': 'wasm',
  '.wasm': 'wasm',

  '.sh': 'shell',
  '.bash': 'shell',
  '.zsh': 'shell',
  '.fish': 'shell',
  '.ps1': 'powershell',
  '.psm1': 'powershell',
  '.psd1': 'powershell',
  '.bat': 'shell',
  '.cmd': 'shell',
  '.vim': 'vimscript',
  '.cmake': 'cmake',
  '.s': 'assembly',
  '.asm': 'assembly',

  '.rb': 'ruby',
  '.rake': 'ruby',
  '.gemspec': 'ruby',
  '.php': 'php',
  '.phtml': 'php',

  '.dockerfile': 'dockerfile',
  '.lock': 'lockfile',
  '.ini': 'ini',
  '.cfg': 'ini',
  '.conf': 'ini',
  '.env': 'env',
  '.txt': 'text',
  '.properties': 'properties',

  // Long-tail languages
  '.tcl': 'tcl',
  '.f': 'fortran',
  '.f90': 'fortran',
  '.f95': 'fortran',
  '.f03': 'fortran',
  '.for': 'fortran',
  '.cob': 'cobol',
  '.cbl': 'cobol',
  '.pas': 'pascal',
  '.pp': 'pascal',
  '.ada': 'ada',
  '.adb': 'ada',
  '.ads': 'ada',
  '.v': 'verilog',
  '.vh': 'verilog',
  '.sv': 'systemverilog',
  '.svh': 'systemverilog',
  '.vhd': 'vhdl',
  '.vhdl': 'vhdl',
  '.scm': 'scheme',
  '.ss': 'scheme',
  '.rkt': 'racket',
  '.lisp': 'lisp',
  '.cl': 'lisp',
  '.lsp': 'lisp',
  '.re': 'reason',
  '.rei': 'reason',
  '.res': 'rescript',
  '.resi': 'rescript',
  '.purs': 'purescript',
  '.idr': 'idris',
  '.lidr': 'idris',
  '.gleam': 'gleam',
  '.raku': 'raku',
  '.rakumod': 'raku',
  '.nu': 'nushell',
  '.bzl': 'starlark',
  '.bazel': 'starlark',
  '.awk': 'awk',
  '.nb': 'mathematica',
  '.wl': 'mathematica',

  // Image / asset buckets (otherwise these dump into "Other")
  '.png': 'image',
  '.jpg': 'image',
  '.jpeg': 'image',
  '.gif': 'image',
  '.webp': 'image',
  '.bmp': 'image',
  '.tiff': 'image',
  '.tif': 'image',
  '.ico': 'image',
  '.svg': 'image',
  '.avif': 'image',

  // Fonts
  '.ttf': 'font',
  '.otf': 'font',
  '.woff': 'font',
  '.woff2': 'font',
  '.eot': 'font',

  // Data formats
  '.csv': 'data',
  '.tsv': 'data',
  '.parquet': 'data',
  '.arrow': 'data',
  '.feather': 'data',
  '.jsonl': 'data',
  '.ndjson': 'data',

  // Audio
  '.mp3': 'audio',
  '.wav': 'audio',
  '.ogg': 'audio',
  '.flac': 'audio',
  '.m4a': 'audio',

  // Video
  '.mp4': 'video',
  '.webm': 'video',
  '.mov': 'video',
  '.avi': 'video',
  '.mkv': 'video',

  // Binaries / archives
  '.zip': 'binary',
  '.tar': 'binary',
  '.gz': 'binary',
  '.bz2': 'binary',
  '.7z': 'binary',
  '.rar': 'binary',
  '.exe': 'binary',
  '.dll': 'binary',
  '.so': 'binary',
  '.dylib': 'binary',
  '.a': 'binary',
  '.o': 'binary',
  '.obj': 'binary',
  '.bin': 'binary',
  '.pdf': 'binary',

  // JSON variants & legacy
  '.json5': 'json',
  '.jsonc': 'json',
  '.geojson': 'json',
};

// ---------------------------------------------------------------------------
//  Exported functions
// ---------------------------------------------------------------------------

/**
 * Fetch a complete, commit-specific repository result from RepoCity's
 * same-origin Worker and convert selected files to a nested tree.
 *
 * @param options - Which repo to fetch and optional processing constraints.
 * @returns The reconstructed tree together with metadata.
 * @throws On network failure, API rejection, cancellation, or invalid data.
 *
 * @example
 * ```ts
 * const result = await fetchRepoTree({ owner: 'facebook', repo: 'react' });
 * console.log(result.root.children.length);
 * ```
 */
export async function fetchRepoTree(
  options: FetchOptions,
): Promise<FetchResult> {
  const maxFiles = options.maxFiles ?? DEFAULT_MAX_FILES;
  if (!Number.isInteger(maxFiles) || maxFiles < 1 || maxFiles > MAX_SELECTED_FILES) {
    throw new Error(`File limit must be between 1 and ${MAX_SELECTED_FILES}.`);
  }

  const query = new URLSearchParams({ maxFiles: String(maxFiles) });
  if (options.commit) query.set('commit', options.commit);
  const url = `/api/repositories/${encodeURIComponent(options.owner)}/${encodeURIComponent(options.repo)}/tree?${query}`;
  const response = await fetch(url, { signal: options.signal, headers: { Accept: 'application/json' } });

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new Error('RepoCity API returned an unreadable response.');
  }
  if (!response.ok) {
    const error = parseApiError(body);
    throw new Error(error?.error.message ?? `RepoCity API request failed with status ${response.status}.`);
  }

  const payload = parseRepositoryTreePayload(body);
  return {
    ...payload,
    root: buildNestedTree(payload.files, payload.repository.name),
  };
}

/**
 * Detect the programming language of a file from its name or extension.
 *
 * @param filename - The file name (e.g. `"src/index.ts"` or `"Dockerfile"`).
 * @returns A human-readable language identifier, or `'unknown'`.
 *
 * @example
 * ```ts
 * detectLanguage('app.tsx');        // → 'typescript'
 * detectLanguage('Dockerfile');     // → 'dockerfile'
 * detectLanguage('README');         // → 'unknown'
 * ```
 */
export function detectLanguage(filename: string): string {
  const basename = filename.split('/').pop() ?? filename;
  const lower = basename.toLowerCase();

  // ── Filenames that identify a language by name (no usable extension) ──
  if (lower === 'dockerfile' || lower.endsWith('.dockerfile')) return 'dockerfile';
  if (lower === 'makefile' || lower === 'gnumakefile' || lower.endsWith('.mk')) return 'makefile';
  if (lower === 'cmakelists.txt') return 'cmake';
  if (lower === 'rakefile' || lower === 'gemfile' || lower === 'vagrantfile') return 'ruby';
  if (lower === 'jenkinsfile') return 'groovy';
  if (lower === 'procfile') return 'yaml';
  if (lower === 'build' || lower === 'workspace' || lower.endsWith('.bazel') || lower.endsWith('.bzl')) return 'starlark';

  // Project-meta dotfiles — these are everywhere in real repos and would
  // otherwise dump into "Other". Map them to dedicated buckets so the
  // sidebar legend stays informative.
  if (lower === '.gitignore' || lower === '.gitattributes' || lower === '.gitmodules'
      || lower === '.gitkeep' || lower === '.mailmap') {
    return 'gitignore';
  }
  if (lower === '.editorconfig') return 'editorconfig';
  if (lower === 'license' || lower === 'license.txt' || lower === 'license.md'
      || lower === 'copying' || lower === 'copying.txt'
      || lower === 'notice' || lower === 'notice.txt'
      || lower === 'authors' || lower === 'contributors'
      || lower === 'patents') {
    return 'license';
  }
  if (lower === 'readme' || lower === 'changelog' || lower === 'history'
      || lower === 'todo' || lower === 'news') {
    return 'markdown';
  }
  // Various .*rc files (.babelrc, .eslintrc, .prettierrc, .stylelintrc, etc.)
  // are JSON unless they have an explicit extension.
  if (/^\.[a-z]+rc$/.test(lower)) return 'json';
  // .npmrc / .yarnrc are properties-style configs.
  if (lower === '.npmrc' || lower === '.yarnrc' || lower === '.nvmrc' || lower === '.tool-versions') {
    return 'properties';
  }

  const dotIndex = basename.lastIndexOf('.');
  if (dotIndex === -1) {
    return 'unknown';
  }
  // For files whose name STARTS with a dot (e.g. ".env.production"),
  // dotIndex may be 0 — treat the whole name after the leading dot as ext.
  const ext = (dotIndex === 0
    ? basename.slice(0).toLowerCase()
    : basename.slice(dotIndex).toLowerCase());
  return EXTENSION_TO_LANGUAGE[ext] ?? 'unknown';
}

/**
 * Build a nested tree from repository-relative selected file paths. Parent
 * directories are synthesized because the Worker intentionally returns only
 * selected files, not a partial set of directory entries.
 */
export function buildNestedTree(items: readonly RepositoryFile[], repoName: string): TreeNode {
  const sorted = [...items].sort((a, b) => compareText(a.path, b.path));
  const root: TreeNode = {
    name: repoName,
    path: '',
    type: 'dir',
    size: 0,
    children: [],
  };

  const nodeByPath = new Map<string, TreeNode>();
  nodeByPath.set('', root);

  for (const item of sorted) {
    if (nodeByPath.has(item.path)) throw new Error(`Duplicate repository path: ${item.path}`);
    const segments = item.path.split('/');
    const name = segments[segments.length - 1];
    const parentPath = segments.slice(0, -1).join('/');

    let currentPath = '';
    for (let i = 0; i < segments.length - 1; i++) {
      const segment = segments[i];
      const nextPath = currentPath ? `${currentPath}/${segment}` : segment;

      let dirNode = nodeByPath.get(nextPath);
      if (dirNode?.type === 'file') throw new Error(`Repository path collides with file: ${nextPath}`);
      if (!dirNode) {
        dirNode = {
          name: segment,
          path: nextPath,
          type: 'dir',
          size: 0,
          children: [],
        };
        nodeByPath.set(nextPath, dirNode);

        const parent = nodeByPath.get(currentPath) ?? root;
        parent.children.push(dirNode);
      }
      currentPath = nextPath;
    }

    const leaf: TreeNode = {
      name,
      path: item.path,
      type: 'file',
      size: item.size,
      children: [],
      language: item.language,
    };
    nodeByPath.set(item.path, leaf);
    const immediateParent = nodeByPath.get(parentPath) ?? root;
    immediateParent.children.push(leaf);
  }

  computeSizesAndSort(root);
  return root;
}

/**
 * Recursively:
 * 1. Sum file sizes into each directory's `size` field.
 * 2. Sort every `children` array so the largest items come first.
 */
function computeSizesAndSort(node: TreeNode): number {
  if (node.type === 'file') {
    return node.size;
  }

  let total = 0;
  for (const child of node.children) {
    total += computeSizesAndSort(child);
  }

  node.size = total;

  node.children.sort((a, b) => b.size - a.size || compareText(a.path, b.path));

  return total;
}

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * file-class.ts — is this file part of the repository's *work*, or is it
 * bulk the repository merely carries?
 *
 * Building height is a rank, and rank over every rendered file hands the
 * skyline to whatever happens to be biggest: `test.mp4` in react,
 * `pnpm-lock.yaml` in vue, `uv.lock` in flask, `o200k_base.tiktoken` in
 * vscode. Those files are the least interesting thing in the repository and
 * they were the most prominent object in the city.
 *
 * So heights are ranked among SOURCE files only. Everything else keeps its
 * byte-proportional plot — a huge lockfile still occupies a lot of ground —
 * but is capped to a low, wide depot: infrastructure, not a landmark.
 *
 * The classification is a pure function of (path, language, size), so it
 * costs nothing at build time and cannot perturb any seeded random stream.
 */

/** Which skyline tier a rendered file belongs to. */
export type BuildingCategory = 'source' | 'infrastructure';

/**
 * Extension → language bucket.
 *
 * Lives here rather than in city.ts because the treemap needs it too: plot
 * area now depends on whether a file is source or infrastructure, and that
 * decision needs a language. Keeping a private copy in each caller is how this
 * codebase ended up with language detection written three times over.
 */
const EXTENSION_LANGUAGES: Record<string, string> = {
  js: 'javascript', jsx: 'javascript', mjs: 'javascript', cjs: 'javascript',
  ts: 'typescript', tsx: 'typescript',
  py: 'python', rs: 'rust', go: 'go', c: 'c', h: 'c', cpp: 'cpp', cc: 'cpp', hpp: 'cpp',
  java: 'java', cs: 'csharp', kt: 'kotlin', swift: 'swift', dart: 'dart', scala: 'scala',
  hs: 'haskell', fs: 'fsharp', ml: 'ocaml', clj: 'clojure', cr: 'crystal', zig: 'zig', nim: 'nim',
  ex: 'elixir', exs: 'elixir', erl: 'erlang', lua: 'lua', r: 'r', jl: 'julia',
  html: 'html', htm: 'html', css: 'css', scss: 'scss', sass: 'sass', less: 'less',
  vue: 'vue', svelte: 'svelte', json: 'json', md: 'markdown', mdx: 'markdown',
  yml: 'yaml', yaml: 'yaml', toml: 'toml', xml: 'xml', proto: 'protobuf',
  sh: 'shell', bash: 'shell', zsh: 'shell', bat: 'shell', cmd: 'shell', ps1: 'powershell',
  rb: 'ruby', php: 'php', pl: 'perl', lock: 'lockfile',
  ini: 'ini', cfg: 'ini', conf: 'ini', env: 'env', txt: 'text',
  png: 'image', jpg: 'image', jpeg: 'image', gif: 'image', svg: 'image', webp: 'image', ico: 'image',
  ttf: 'font', otf: 'font', woff: 'font', woff2: 'font',
  csv: 'data', tsv: 'data', zip: 'binary', gz: 'binary', exe: 'binary', dll: 'binary', so: 'binary',
  tf: 'terraform', nix: 'nix', sol: 'solidity', glsl: 'glsl', vert: 'glsl', frag: 'glsl', wgsl: 'wgsl',
  graphql: 'graphql', sql: 'sql', tex: 'tex', rst: 'rst',
};

/** Language bucket for a filename, or `'unknown'`. */
export function detectLanguage(filename: string): string {
  const extension = filename.toLowerCase().split('.').pop() ?? '';
  return EXTENSION_LANGUAGES[extension] ?? 'unknown';
}

/**
 * Language buckets that are never source: the classifier in data/github.ts
 * already folds media, fonts, archives and lockfiles into these.
 */
const NON_SOURCE_LANGUAGES: ReadonlySet<string> = new Set([
  'lockfile', 'image', 'font', 'data', 'audio', 'video', 'binary',
]);

/** Directories whose contents are vendored or generated, never authored here. */
const VENDOR_SEGMENTS: ReadonlySet<string> = new Set([
  'node_modules', 'vendor', 'vendored', 'third_party', 'thirdparty',
  'bower_components', 'site-packages', '.venv', 'venv',
  'build', 'dist', 'out',
]);

/** Lockfiles whose extension makes them look like ordinary config. */
const LOCK_FILENAMES: ReadonlySet<string> = new Set([
  'package-lock.json', 'npm-shrinkwrap.json', 'packages.lock.json',
  'yarn.lock', 'pnpm-lock.yaml', 'bun.lock', 'bun.lockb', 'deno.lock',
  'cargo.lock', 'poetry.lock', 'pdm.lock', 'uv.lock', 'pipfile.lock',
  'composer.lock', 'gemfile.lock', 'podfile.lock', 'mix.lock',
  'pubspec.lock', 'flake.lock', 'go.sum', 'gradle.lockfile',
  'conan.lock', 'herd.lock',
]);

/**
 * Extensions that always carry generated or opaque bulk. Some of these have
 * a friendly language name (`.wasm` → wasm) but no human reads them.
 */
const GENERATED_EXTENSIONS: ReadonlySet<string> = new Set([
  'map', 'snap', 'wasm', 'pb', 'onnx', 'tflite', 'safetensors', 'ckpt',
  'pt', 'pth', 'h5', 'pkl', 'npy', 'npz', 'joblib', 'model', 'vocab',
  'bpe', 'tiktoken', 'dat', 'db', 'sqlite', 'sqlite3', 'mdb', 'bin',
  'pdf', 'psd', 'ai', 'sketch', 'fig', 'blend', 'fbx', 'glb', 'gltf',
  'obj', 'stl', 'pack', 'idx', 'dump', 'iso', 'dmg', 'jar', 'war',
  'whl', 'deb', 'rpm', 'apk', 'nupkg', 'crate',
]);

/**
 * Text-ish buckets that are legitimate at normal sizes but are always a
 * generated blob once they get big (locale dumps, fixtures, corpora).
 */
const BULK_DATA_LANGUAGES: ReadonlySet<string> = new Set([
  'json', 'yaml', 'toml', 'xml', 'text', 'ini', 'properties', 'csv',
  'unknown', 'sql',
]);

/** Above this, a text-ish blob stops being a file somebody edits. */
const BULK_DATA_BYTES = 512 * 1024;
/** Above this, an unrecognised extension is a data blob, whatever it is. */
const OPAQUE_BLOB_BYTES = 128 * 1024;

/**
 * Buckets that are not code: prose, documentation, config and data. A file
 * in one of these is a legitimate source file — it still gets a normal
 * building and a normal height rank — but it should not be what the UI
 * calls the repository's tallest source file. Flask's CHANGES.rst winning
 * that label is technically true and completely uninteresting.
 */
const NON_CODE_LANGUAGES: ReadonlySet<string> = new Set([
  'markdown', 'rst', 'asciidoc', 'tex', 'text', 'license',
  'html', 'xml', 'svg',
  'json', 'yaml', 'toml', 'ini', 'env', 'properties', 'csv', 'data',
  'gitignore', 'editorconfig', 'lockfile', 'unknown',
  'image', 'font', 'audio', 'video', 'binary',
]);

/**
 * Does this language bucket represent code somebody writes, as opposed to
 * prose, markup, configuration or data?
 *
 * @example
 * ```ts
 * isCodeLanguage('python');    // true
 * isCodeLanguage('rst');       // false
 * ```
 */
export function isCodeLanguage(language: string): boolean {
  return !NON_CODE_LANGUAGES.has(language.toLowerCase());
}

function basenameOf(path: string): string {
  const slash = path.lastIndexOf('/');
  return (slash < 0 ? path : path.slice(slash + 1)).toLowerCase();
}

function extensionOf(basename: string): string {
  const dot = basename.lastIndexOf('.');
  return dot <= 0 ? '' : basename.slice(dot + 1);
}

/**
 * Decide whether a rendered file competes for the skyline.
 *
 * @param path     Repository-relative path, e.g. `"src/index.ts"`.
 * @param language Detected language bucket (`node.language`).
 * @param size     File size in bytes.
 *
 * @example
 * ```ts
 * classifyBuilding('src/index.ts', 'typescript', 4200);   // 'source'
 * classifyBuilding('pnpm-lock.yaml', 'yaml', 900_000);    // 'infrastructure'
 * classifyBuilding('assets/test.mp4', 'video', 5_000_000) // 'infrastructure'
 * ```
 */
export function classifyBuilding(path: string, language: string, size: number): BuildingCategory {
  const lower = path.toLowerCase();
  for (const segment of lower.split('/').slice(0, -1)) {
    if (VENDOR_SEGMENTS.has(segment)) return 'infrastructure';
  }

  const basename = basenameOf(lower);
  if (LOCK_FILENAMES.has(basename)) return 'infrastructure';
  if (basename.endsWith('.lock') || basename.endsWith('.lockb')) return 'infrastructure';
  // pnpm-lock.yaml, package-lock.json and friends under any prefix.
  if (/(^|[-.])lock\.(json|ya?ml|toml)$/.test(basename)) return 'infrastructure';
  // Bundler output that happens to keep a source extension.
  if (/\.(min|bundle|chunk)\.[a-z0-9]+$/.test(basename)) return 'infrastructure';

  const extension = extensionOf(basename);
  if (GENERATED_EXTENSIONS.has(extension)) return 'infrastructure';

  const bucket = language.toLowerCase();
  if (NON_SOURCE_LANGUAGES.has(bucket)) return 'infrastructure';
  if (BULK_DATA_LANGUAGES.has(bucket) && size >= BULK_DATA_BYTES) return 'infrastructure';
  // No recognised extension and megabytes of it: a data blob by definition.
  if (bucket === 'unknown' && size >= OPAQUE_BLOB_BYTES) return 'infrastructure';

  return 'source';
}

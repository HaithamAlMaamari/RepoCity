/**
 * palette.ts
 *
 * "2049" palette — a strictly constrained neon-city scheme. Every color
 * lives on the cyan↔magenta spectrum with amber used as a rare accent
 * (< 5% of elements). This keeps the whole scene reading as one place
 * instead of a rainbow of competing languages.
 *
 * Languages are differentiated by HUE POSITION within this narrow range
 * and by SATURATION/VALUE — not by picking every color of the wheel.
 *
 * Core brand anchors (used everywhere — UI, effects, lights, etc):
 *   #ff2d8a  — hot magenta (primary)
 *   #00d4ff  — electric cyan (secondary)
 *   #ffb347  — amber (rare accent)
 *
 * Language colors are all inside these three zones.
 */

const PALETTE: Record<string, [number, number, number]> = {
  // ── CYAN ZONE (cool languages: typed, low-level, data) ──────
  typescript: [0.00, 0.83, 1.00],   // pure cyan
  go:         [0.22, 0.90, 0.92],   // cool teal-cyan
  dockerfile: [0.14, 0.62, 1.00],   // ice blue
  css:        [0.40, 0.75, 1.00],   // sky blue
  yaml:       [0.35, 0.88, 0.95],   // pale cyan
  c:          [0.55, 0.82, 0.95],   // soft cyan-white
  cpp:        [0.60, 0.72, 0.98],   // periwinkle

  // — Typed / compiled / functional —
  csharp:     [0.20, 0.78, 0.95],   // sky-cyan (MS palette echo)
  scala:      [0.30, 0.70, 0.95],   // cool blue
  haskell:    [0.45, 0.80, 0.95],   // pale cyan
  elm:        [0.40, 0.85, 0.92],   // mint-cyan
  fsharp:     [0.10, 0.75, 0.98],   // electric cyan
  ocaml:      [0.55, 0.78, 0.95],   // periwinkle
  clojure:    [0.35, 0.85, 0.85],   // teal-cyan
  crystal:    [0.50, 0.80, 0.98],   // icy cyan
  nim:        [0.40, 0.92, 0.85],   // mint
  zig:        [0.50, 0.78, 0.98],   // cool blue
  dart:       [0.15, 0.85, 0.95],   // turquoise
  groovy:     [0.55, 0.85, 0.90],   // mint-cyan
  objc:       [0.20, 0.62, 0.95],   // medium blue
  objcpp:     [0.30, 0.62, 0.92],   // slate-blue
  powershell: [0.18, 0.55, 0.95],   // deep blue
  assembly:   [0.40, 0.50, 0.65],   // steel-blue
  vimscript:  [0.40, 0.85, 0.85],   // mint
  cmake:      [0.45, 0.62, 0.85],   // slate-blue
  makefile:   [0.40, 0.55, 0.70],   // cool gray
  nix:        [0.40, 0.70, 0.95],   // sky
  terraform:  [0.45, 0.55, 0.92],   // purple-blue
  protobuf:   [0.40, 0.62, 0.85],   // cool slate
  toml:       [0.50, 0.70, 0.85],   // slate
  xml:        [0.55, 0.65, 0.80],   // cool gray-blue
  solidity:   [0.55, 0.62, 0.78],   // gray-blue
  wasm:       [0.55, 0.75, 0.92],   // steel-blue
  sass:       [0.50, 0.78, 0.95],   // sky
  scss:       [0.45, 0.78, 0.95],   // sky
  less:       [0.40, 0.75, 0.95],   // cool sky

  // ── MAGENTA ZONE (dynamic/scripting languages) ──────────────
  python:     [0.92, 0.25, 0.78],   // vivid magenta
  ruby:       [1.00, 0.22, 0.55],   // crimson-magenta
  php:        [0.82, 0.32, 0.95],   // violet-magenta
  kotlin:     [0.90, 0.30, 0.88],   // pink-magenta
  swift:      [1.00, 0.32, 0.72],   // hot pink
  html:       [1.00, 0.18, 0.55],   // magenta-red
  markdown:   [0.75, 0.45, 0.95],   // lavender-magenta
  svelte:     [1.00, 0.28, 0.45],   // coral-magenta
  rust:       [1.00, 0.35, 0.50],   // coral
  vue:        [0.55, 0.78, 0.95],   // sits in cyan zone (soft)

  // — Dynamic / scripting —
  elixir:     [0.78, 0.45, 0.95],   // lavender-magenta
  erlang:     [0.85, 0.30, 0.65],   // red-magenta
  lua:        [0.55, 0.40, 0.95],   // deep purple-magenta
  perl:       [0.95, 0.35, 0.78],   // pink
  r:          [0.85, 0.35, 0.85],   // magenta-pink
  julia:      [0.78, 0.40, 0.95],   // vibrant purple
  haxe:       [1.00, 0.35, 0.40],   // red
  coffeescript:[0.90, 0.45, 0.62],  // dusty pink
  elisp:      [0.78, 0.35, 0.95],   // purple

  // — Templating / markup (web rendering layer) —
  handlebars: [1.00, 0.30, 0.45],   // red-pink
  pug:        [0.95, 0.32, 0.55],   // coral
  liquid:     [0.92, 0.40, 0.65],   // pink
  jinja:      [0.92, 0.42, 0.62],   // rose
  twig:       [0.78, 0.50, 0.92],   // lavender
  mustache:   [0.95, 0.35, 0.50],   // red-coral
  ejs:        [0.95, 0.38, 0.58],   // pink-coral

  // — Shader languages —
  glsl:       [0.95, 0.30, 0.50],   // coral
  hlsl:       [1.00, 0.32, 0.45],   // red
  wgsl:       [0.95, 0.35, 0.55],   // coral-pink

  // — Query / data languages —
  graphql:    [1.00, 0.20, 0.62],   // brand pink (graphql's real color)
  sql:        [0.45, 0.62, 0.95],   // cool blue (move to cyan family)

  // — Document languages —
  tex:        [0.78, 0.40, 0.85],   // lavender
  rst:        [0.65, 0.45, 0.85],   // lavender
  asciidoc:   [0.92, 0.38, 0.62],   // rose

  // — Long-tail languages (rare but real, kept on-palette) —
  matlab:     [0.95, 0.40, 0.55],   // coral
  mathematica:[0.92, 0.35, 0.58],   // pink-coral
  tcl:        [0.55, 0.50, 0.92],   // blue-purple
  fortran:    [0.50, 0.55, 0.92],   // periwinkle
  cobol:      [0.45, 0.62, 0.88],   // slate
  pascal:     [0.52, 0.65, 0.92],   // slate-blue
  ada:        [0.58, 0.70, 0.95],   // pale slate
  verilog:    [0.95, 0.42, 0.50],   // coral
  systemverilog:[1.00, 0.38, 0.52], // red-coral
  vhdl:       [0.55, 0.60, 0.92],   // blue-purple
  scheme:     [0.95, 0.42, 0.55],   // warm coral
  racket:     [0.95, 0.30, 0.55],   // coral-magenta
  lisp:       [0.92, 0.40, 0.78],   // pink-magenta
  rescript:   [0.95, 0.35, 0.45],   // red-coral
  reason:     [1.00, 0.40, 0.55],   // coral
  purescript: [0.50, 0.60, 0.92],   // blue-purple
  idris:      [0.78, 0.35, 0.92],   // purple
  gleam:      [0.95, 0.45, 0.85],   // pink
  raku:       [0.92, 0.35, 0.62],   // rose
  nushell:    [0.30, 0.85, 0.92],   // teal-cyan
  starlark:   [0.45, 0.78, 0.90],   // sky
  awk:        [0.52, 0.62, 0.78],   // cool slate

  // — Asset / data buckets (so they don't fall to "Other") —
  image:      [0.78, 0.42, 0.92],   // soft purple-pink (visuals → magenta zone)
  font:       [0.40, 0.55, 0.85],   // cool blue (typography → cyan zone)
  data:       [0.35, 0.70, 0.92],   // cyan (data → cyan zone)
  audio:      [0.85, 0.42, 0.78],   // pink (audio → magenta zone)
  video:      [0.90, 0.38, 0.65],   // pink-coral
  binary:     [0.40, 0.42, 0.52],   // dark steel

  // — Project-meta files —
  gitignore:  [0.45, 0.52, 0.62],   // cool gray
  editorconfig:[0.48, 0.55, 0.68],  // cool gray-blue
  license:    [0.62, 0.58, 0.55],   // warm gray
  properties: [0.50, 0.58, 0.72],   // cool slate

  // ── AMBER (reserved for hero language only) ─────────────────
  javascript: [1.00, 0.70, 0.20],   // hero amber — JS gets the special color
  java:       [1.00, 0.55, 0.30],   // orange-amber (the other "warm" veteran)

  // ── NEUTRAL DIM (utility/meta files — stay quiet) ───────────
  json:       [0.50, 0.55, 0.70],   // cool graphite
  shell:      [0.55, 0.62, 0.75],   // steel
  lockfile:   [0.32, 0.35, 0.45],   // dark steel
  ini:        [0.50, 0.52, 0.60],   // dim neutral
  env:        [0.55, 0.55, 0.62],   // dim neutral
  text:       [0.45, 0.48, 0.55],   // dim neutral
  unknown:    [0.35, 0.40, 0.52],   // cool neutral
};

/**
 * Warmth per language, 0..1 — 0 = fully cyan window tint, 1 = fully
 * magenta. Amber-family languages push all the way to warm, most
 * others land near 0 or 1 to keep windows clearly bichromatic.
 */
const WARMTH: Record<string, number> = {
  // cyan zone → cool windows
  typescript: 0.05, go: 0.08, dockerfile: 0.05, css: 0.15,
  yaml: 0.10, c: 0.20, cpp: 0.20, vue: 0.25,
  csharp: 0.15, scala: 0.15, haskell: 0.15, elm: 0.10,
  fsharp: 0.05, ocaml: 0.20, clojure: 0.12, crystal: 0.10,
  nim: 0.08, zig: 0.10, dart: 0.05, groovy: 0.15,
  objc: 0.18, objcpp: 0.22, powershell: 0.18, assembly: 0.30,
  vimscript: 0.15, cmake: 0.25, makefile: 0.30,
  nix: 0.10, terraform: 0.20, protobuf: 0.18, toml: 0.20,
  xml: 0.25, solidity: 0.30, wasm: 0.18,
  sass: 0.15, scss: 0.15, less: 0.18, sql: 0.18,

  // magenta zone → warm windows (magenta-biased)
  python: 0.85, ruby: 0.90, php: 0.88, kotlin: 0.88,
  swift: 0.92, html: 0.90, markdown: 0.75, svelte: 0.92, rust: 0.88,
  elixir: 0.80, erlang: 0.88, lua: 0.78, perl: 0.85, r: 0.85,
  julia: 0.78, haxe: 0.92, coffeescript: 0.85, elisp: 0.78,
  handlebars: 0.92, pug: 0.92, liquid: 0.88, jinja: 0.88,
  twig: 0.80, mustache: 0.92, ejs: 0.90,
  glsl: 0.92, hlsl: 0.92, wgsl: 0.90,
  graphql: 0.92, tex: 0.78, rst: 0.75, asciidoc: 0.88,
  matlab: 0.85, mathematica: 0.88, tcl: 0.55, scheme: 0.85,
  racket: 0.90, lisp: 0.85, rescript: 0.92, reason: 0.92,
  idris: 0.78, gleam: 0.88, raku: 0.88,
  verilog: 0.92, systemverilog: 0.92,

  // long-tail typed/cyan
  fortran: 0.20, cobol: 0.22, pascal: 0.20, ada: 0.18,
  vhdl: 0.25, purescript: 0.20, nushell: 0.10, starlark: 0.15,
  awk: 0.45,

  // asset buckets
  image: 0.85, font: 0.20, data: 0.15,
  audio: 0.82, video: 0.85, binary: 0.45,

  // amber zone → fully warm (uses the amber hero glow)
  javascript: 1.0, java: 1.0,

  // neutral
  json: 0.35, shell: 0.50, lockfile: 0.50, unknown: 0.40,
  ini: 0.45, env: 0.45, text: 0.40,
  gitignore: 0.45, editorconfig: 0.40, license: 0.55, properties: 0.35,
};

const hashCache = new Map<string, [number, number, number]>();

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  if (s === 0) return [l, l, l];
  const hue2rgb = (p: number, q: number, t: number) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  return [hue2rgb(p, q, h + 1 / 3), hue2rgb(p, q, h), hue2rgb(p, q, h - 1 / 3)];
}

/**
 * Hash-based fallback color — CONSTRAINED to cyan or magenta only.
 * We map the hash to a hue in either [170°, 200°] (cyan) or [300°, 340°]
 * (magenta), never anywhere else. Keeps unknown languages on-palette.
 */
function hashColor(lang: string): [number, number, number] {
  let h = 0;
  for (let i = 0; i < lang.length; i++) {
    h = ((h << 5) - h) + lang.charCodeAt(i);
    h |= 0;
  }
  const abs = Math.abs(h);
  const cyanSide = (abs & 1) === 0;
  let hue: number;
  if (cyanSide) {
    // 170° - 200°
    hue = (170 + (abs % 30)) / 360;
  } else {
    // 300° - 340°
    hue = (300 + (abs % 40)) / 360;
  }
  return hslToRgb(hue, 0.80, 0.60);
}

export function languageColor(language: string): [number, number, number] {
  if (!language) return PALETTE.unknown;
  const k = language.toLowerCase();
  if (k in PALETTE) return PALETTE[k];
  const cached = hashCache.get(k);
  if (cached) return cached;
  const c = hashColor(k);
  hashCache.set(k, c);
  return c;
}

export function languageEmissiveBoost(language: string): number {
  if (!language) return 0.5;
  return WARMTH[language.toLowerCase()] ?? 0.5;
}

export function languageDisplayName(lang: string): string {
  const map: Record<string, string> = {
    javascript: 'JavaScript', typescript: 'TypeScript', python: 'Python',
    rust: 'Rust', go: 'Go', c: 'C', cpp: 'C++', java: 'Java',
    html: 'HTML', css: 'CSS', json: 'JSON', markdown: 'Markdown',
    yaml: 'YAML', shell: 'Shell', ruby: 'Ruby', php: 'PHP',
    swift: 'Swift', kotlin: 'Kotlin', vue: 'Vue', svelte: 'Svelte',
    dockerfile: 'Dockerfile', lockfile: 'Lockfile',
    csharp: 'C#', scala: 'Scala', haskell: 'Haskell', elm: 'Elm',
    fsharp: 'F#', ocaml: 'OCaml', clojure: 'Clojure', crystal: 'Crystal',
    nim: 'Nim', zig: 'Zig', dart: 'Dart', groovy: 'Groovy',
    objc: 'Objective-C', objcpp: 'Objective-C++',
    powershell: 'PowerShell', assembly: 'Assembly', vimscript: 'Vim Script',
    cmake: 'CMake', makefile: 'Makefile',
    nix: 'Nix', terraform: 'Terraform', protobuf: 'Protocol Buffers',
    toml: 'TOML', xml: 'XML', solidity: 'Solidity', wasm: 'WebAssembly',
    sass: 'Sass', scss: 'SCSS', less: 'Less', sql: 'SQL',
    elixir: 'Elixir', erlang: 'Erlang', lua: 'Lua', perl: 'Perl',
    r: 'R', julia: 'Julia', haxe: 'Haxe', coffeescript: 'CoffeeScript',
    elisp: 'Emacs Lisp',
    handlebars: 'Handlebars', pug: 'Pug', liquid: 'Liquid',
    jinja: 'Jinja', twig: 'Twig', mustache: 'Mustache', ejs: 'EJS',
    glsl: 'GLSL', hlsl: 'HLSL', wgsl: 'WGSL',
    graphql: 'GraphQL', tex: 'TeX', rst: 'reStructuredText',
    asciidoc: 'AsciiDoc', ini: 'INI', env: 'dotenv', text: 'Text',
    matlab: 'MATLAB', mathematica: 'Mathematica', tcl: 'Tcl',
    fortran: 'Fortran', cobol: 'COBOL', pascal: 'Pascal', ada: 'Ada',
    verilog: 'Verilog', systemverilog: 'SystemVerilog', vhdl: 'VHDL',
    scheme: 'Scheme', racket: 'Racket', lisp: 'Lisp',
    rescript: 'ReScript', reason: 'Reason', purescript: 'PureScript',
    idris: 'Idris', gleam: 'Gleam', raku: 'Raku',
    nushell: 'Nushell', starlark: 'Starlark', awk: 'AWK',
    image: 'Images', font: 'Fonts', data: 'Data',
    audio: 'Audio', video: 'Video', binary: 'Binary',
    gitignore: 'Git Config', editorconfig: 'EditorConfig',
    license: 'License', properties: 'Properties',
    unknown: 'Other',
  };
  return map[lang.toLowerCase()] ?? lang;
}

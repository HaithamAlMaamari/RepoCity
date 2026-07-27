/**
 * city.ts — buildings with procedural neon window grid.
 *
 * Single InstancedMesh + MeshStandardMaterial + ONE onBeforeCompile.
 *
 * Shader safety rules (learned the hard way):
 *  - NO references to Three.js internal varyings that may not exist
 *    (vInstanceColor is NOT a thing; vNormal is view-space).
 *  - All custom data flows through OUR OWN attributes/varyings:
 *      aId, aTint, aLit, aBase  →  vId, vTint, vLit, vBase, vWP, vLP, vN
 *  - customProgramCacheKey so the patched program never collides with
 *    other MeshStandardMaterial programs.
 */

import * as THREE from 'three';
import { languageColor, languageEmissiveBoost } from './palette';
import type { LayoutCell } from './layout';
import { buildArchitectureDetails } from './architecture-details';
import type { ArchitectureDetails } from './architecture-details';

export interface Building {
  position: [number, number, number];
  scale: [number, number, number];
  color: [number, number, number];
  path: string;
  size: number;
  language: string;
  totalHeight: number;
  profile: 'block' | 'setback' | 'tower' | 'mega';
}

export interface CityData {
  mesh: THREE.InstancedMesh;
  details: ArchitectureDetails;
  buildings: Building[];
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number };
  maxHeight: number;
  update(dt: number): void;
  setHovered(id: number): void;
  setSelected(id: number): void;
  setMatchMask(mask: Uint8Array): void;
  dispose(): void;
}

export function signHash(i: number): number {
  const x = Math.sin(i * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}

/* ── Building GLSL (vertex additions) ─────────────────── */

const VERT_DECL = /* glsl */ `
attribute float aId;
attribute float aTint;
attribute float aLit;
attribute vec3 aBase;
attribute float aMatch;
varying float vId;
varying float vTint;
varying float vLit;
varying vec3 vBase;
varying float vMatch;
varying vec3 vWP;
varying vec3 vLP;
varying vec3 vN;
`;

const VERT_ASSIGN = /* glsl */ `
{
  vec4 wp4 = modelMatrix * instanceMatrix * vec4( transformed, 1.0 );
  vWP = wp4.xyz;
  vLP = position;
  vN = normalize( mat3( modelMatrix ) * mat3( instanceMatrix ) * objectNormal );
  vId = aId;
  vTint = aTint;
  vLit = aLit;
  vBase = aBase;
  vMatch = aMatch;
}
#include <fog_vertex>
`;

/* ── Building GLSL (fragment additions) ───────────────── */

const FRAG_DECL = /* glsl */ `
varying float vId;
varying float vTint;
varying float vLit;
varying vec3 vBase;
varying float vMatch;
varying vec3 vWP;
varying vec3 vLP;
varying vec3 vN;
uniform float uTime;
uniform float uHover;
uniform float uSelect;

float rcHash( float n ) { return fract( sin( n ) * 43758.5453 ); }
`;

const FRAG_EMISSIVE = /* glsl */ `
{
  if (vMatch < 0.5) discard;
  vec3 N = normalize( vN );
  float sideMask = 1.0 - step( 0.5, abs( N.y ) );
  float topMask = smoothstep( 0.5, 0.8, N.y );

  /* ---- window grid (world-space => consistent floor heights) ---- */
  float wsY = 0.55;
  float wsX = 0.66;
  float onX = abs( N.x );
  float horiz = mix( vWP.x, vWP.z, onX );

  float yCell = floor( vWP.y / wsY );
  float yFrac = fract( vWP.y / wsY );
  float yShape = smoothstep( 0.16, 0.30, yFrac ) * ( 1.0 - smoothstep( 0.60, 0.76, yFrac ) );

  float hCell = floor( horiz / wsX );
  float hFrac = fract( horiz / wsX );
  float hShape = smoothstep( 0.16, 0.30, hFrac ) * ( 1.0 - smoothstep( 0.68, 0.82, hFrac ) );

  float seed = yCell * 7.31 + hCell * 11.13 + onX * 31.7;
  float litRoll = rcHash( seed );
  float litMask = clamp( step( 0.44, litRoll ) + vLit, 0.0, 1.0 );

  float flickRoll = rcHash( seed + 13.7 );
  float flickOn = step( 0.90, flickRoll );
  float flick = sin( uTime * 3.6 + flickRoll * 40.0 ) * 0.45 + 0.65;
  float winBright = mix( 1.0, flick, flickOn ) * mix( 1.0, 1.45, vLit );

  float windowShape = yShape * hShape * sideMask * litMask * winBright;

  /* ---- window colour: cyan↔magenta↔amber via language tint ---- */
  float floorShift = rcHash( yCell * 3.17 + vId * 0.31 ) * 0.22;
  float et = clamp( vTint + floorShift - 0.10, 0.0, 1.0 );
  vec3 coolC = vec3( 0.06, 0.62, 0.82 );
  vec3 magC  = vec3( 0.82, 0.12, 0.46 );
  vec3 warmC = vec3( 0.82, 0.46, 0.14 );
  float t1 = clamp( et / 0.9, 0.0, 1.0 );
  float t2 = clamp( ( et - 0.9 ) / 0.1, 0.0, 1.0 );
  vec3 winTint = mix( mix( coolC, magC, t1 ), warmC, t2 );
  vec3 winColor = mix( winTint, vBase + winTint * 0.5, 0.45 );

  vec3 windowGlow = winColor * windowShape * 2.0;

  /* ---- neon rim on the top edge of every wall ---- */
  float rim = smoothstep( 0.435, 0.5, vLP.y ) * sideMask;
  float rimPulse = sin( uTime * 2.2 + vId * 0.41 ) * 0.12 + 0.88;
  float rimBright = mix( 0.7, 1.3, vLit );
  vec3 rimColor = mix( vec3( 0.0, 0.68, 0.84 ), vec3( 0.86, 0.12, 0.46 ), et );
  vec3 rimGlow = rimColor * rim * rimPulse * rimBright * 1.25;

  /* ---- vertical corner strips ---- */
  float cornX = smoothstep( 0.40, 0.5, abs( vLP.x ) );
  float cornZ = smoothstep( 0.40, 0.5, abs( vLP.z ) );
  float corner = cornX * cornZ * sideMask;
  vec3 cornerGlow = rimColor * corner * rimBright * 0.35;

  /* ---- rooftop edge outline ---- */
  float topEdge = clamp(
    smoothstep( 0.42, 0.5, abs( vLP.x ) ) + smoothstep( 0.42, 0.5, abs( vLP.z ) ),
    0.0, 1.0 ) * topMask;
  vec3 roofGlow = rimColor * topEdge * rimPulse * 0.7;

  /* ---- hover / selection ---- */
  float isHover = 1.0 - step( 0.5, abs( vId - uHover ) );
  float isSel = 1.0 - step( 0.5, abs( vId - uSelect ) );
  float pulse = sin( uTime * 4.5 ) * 0.1 + 0.9;
  float boost = 1.0 + isHover * ( pulse * 0.25 ) + isSel * 0.55;

  totalEmissiveRadiance += ( windowGlow + rimGlow + cornerGlow + roofGlow ) * boost;
}
`;

/* ── shared uniform handles ───────────────────────────── */

interface BuildingUniforms {
  uTime: { value: number };
  uHover: { value: number };
  uSelect: { value: number };
}

function detectLang(fn: string): string {
  const ext = fn.toLowerCase().split('.').pop() ?? '';
  const m: Record<string, string> = {
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
  return m[ext] ?? 'unknown';
}

/* ── public API ───────────────────────────────────────── */

export function buildCity(cells: LayoutCell[]): CityData {
  if (cells.length === 0) {
    const g = new THREE.BoxGeometry(1, 1, 1);
    const m = new THREE.MeshStandardMaterial();
    const mesh = new THREE.InstancedMesh(g, m, 0);
    return {
      mesh, buildings: [], bounds: { minX: 0, maxX: 0, minZ: 0, maxZ: 0 }, maxHeight: 0,
      details: buildArchitectureDetails([]),
      update() {}, setHovered() {}, setSelected() {}, setMatchMask() {},
      dispose() { g.dispose(); m.dispose(); },
    };
  }

  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const c of cells) {
    const r = c.rect;
    if (r.x < minX) minX = r.x;
    if (r.x + r.w > maxX) maxX = r.x + r.w;
    if (r.y < minZ) minZ = r.y;
    if (r.y + r.h > maxZ) maxZ = r.y + r.h;
  }

  const n = cells.length;
  const buildings: Building[] = new Array(n);
  const aId = new Float32Array(n);
  const aTint = new Float32Array(n);
  const aLit = new Float32Array(n);
  const aBase = new Float32Array(n * 3);
  const aMatch = new Float32Array(n).fill(1);
  let maxHeight = 0;

  for (let i = 0; i < n; i++) {
    const c = cells[i];
    const r = c.rect;
    const lang = c.node.language ?? detectLang(c.node.name);
    const rawSize = c.node.size;
    const visualSize = Math.max(rawSize, 1);
    const t = Math.min(Math.log10(visualSize) / 6, 1);
    const h = 0.6 + Math.pow(t, 0.55) * 34;
    const jitter = 1.0 + (signHash(i * 3 + 17) - 0.5) * 0.3;
    const totalHeight = Math.max(0.6, h * jitter);
    const profile: Building['profile'] =
      t < 0.22 ? 'block' : t < 0.48 ? 'setback' : t < 0.76 ? 'tower' : 'mega';
    const coreRatio = profile === 'block' ? 1 : profile === 'setback' ? 0.76 : profile === 'tower' ? 0.82 : 0.52;
    const coreHeight = totalHeight * coreRatio;
    if (totalHeight > maxHeight) maxHeight = totalHeight;

    const col = languageColor(lang);
    buildings[i] = {
      position: [r.x + r.w / 2, coreHeight / 2, r.y + r.h / 2],
      scale: [Math.max(0.05, r.w * 0.9), coreHeight, Math.max(0.05, r.h * 0.9)],
      color: col,
      path: c.node.path, size: rawSize, language: lang, totalHeight, profile,
    };
    aId[i] = i;
    aTint[i] = languageEmissiveBoost(lang);
    aLit[i] = signHash(i * 7 + 42) > 0.90 ? 1.0 : 0.0;
    aBase[i * 3] = col[0]; aBase[i * 3 + 1] = col[1]; aBase[i * 3 + 2] = col[2];
  }

  /* geometry + per-instance attributes */
  const geo = new THREE.BoxGeometry(1, 1, 1);
  geo.setAttribute('aId', new THREE.InstancedBufferAttribute(aId, 1));
  geo.setAttribute('aTint', new THREE.InstancedBufferAttribute(aTint, 1));
  geo.setAttribute('aLit', new THREE.InstancedBufferAttribute(aLit, 1));
  geo.setAttribute('aBase', new THREE.InstancedBufferAttribute(aBase, 3));
  const matchAttribute = new THREE.InstancedBufferAttribute(aMatch, 1);
  matchAttribute.setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute('aMatch', matchAttribute);

  /* material with the ONE onBeforeCompile in the app */
  const uniforms: BuildingUniforms = {
    uTime: { value: 0 },
    uHover: { value: -1 },
    uSelect: { value: -1 },
  };

  const material = new THREE.MeshStandardMaterial({
    color: 0x10101f,
    roughness: 0.62,
    metalness: 0.30,
  });
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = uniforms.uTime;
    shader.uniforms.uHover = uniforms.uHover;
    shader.uniforms.uSelect = uniforms.uSelect;

    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\n' + VERT_DECL)
      .replace('#include <fog_vertex>', VERT_ASSIGN);

    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\n' + FRAG_DECL)
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n' + FRAG_EMISSIVE);
  };
  material.customProgramCacheKey = () => 'repocity-buildings-v2';

  const mesh = new THREE.InstancedMesh(geo, material, n);
  mesh.instanceMatrix.setUsage(THREE.StaticDrawUsage);
  mesh.frustumCulled = true;

  const d = new THREE.Object3D();
  for (let i = 0; i < n; i++) {
    const b = buildings[i];
    d.position.set(b.position[0], b.position[1], b.position[2]);
    d.scale.set(b.scale[0], b.scale[1], b.scale[2]);
    d.updateMatrix();
    mesh.setMatrixAt(i, d.matrix);
  }
  mesh.instanceMatrix.needsUpdate = true;
  mesh.computeBoundingSphere();

  const details = buildArchitectureDetails(buildings);

  return {
    mesh, details, buildings,
    bounds: { minX, maxX, minZ, maxZ },
    maxHeight,
    update(dt: number) { uniforms.uTime.value += dt; },
    setHovered(id: number) { uniforms.uHover.value = id; },
    setSelected(id: number) { uniforms.uSelect.value = id; },
    setMatchMask(mask: Uint8Array) {
      for (let i = 0; i < n; i++) aMatch[i] = mask[i] ?? 0;
      matchAttribute.needsUpdate = true;
    },
    dispose() { geo.dispose(); material.dispose(); details.dispose(); },
  };
}

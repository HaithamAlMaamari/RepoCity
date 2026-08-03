/**
 * city.ts — buildings with procedural neon window grid.
 *
 * Single InstancedMesh + MeshStandardMaterial + ONE onBeforeCompile.
 *
 * Shader safety rules (learned the hard way):
 *  - NO references to Three.js internal varyings that may not exist
 *    (vInstanceColor is NOT a thing; vNormal is view-space; vFogDepth is
 *    three's, so the fog replacement in facade-shader.ts recomputes depth
 *    from the public `cameraPosition` uniform instead).
 *  - All custom data flows through OUR OWN attributes/varyings:
 *      aId, aTint, aLit, aBase, aKind, aSpan  →  vId, vTint, vLit, vBase,
 *                                    vKind, vSpan, vWP, vLP, vN
 *  - The window grid itself lives in facade-shader.ts; crowns include the
 *    same chunk so the two can no longer drift apart.
 *  - customProgramCacheKey so the patched program never collides with
 *    other MeshStandardMaterial programs.
 *
 * ── Skyline rules ────────────────────────────────────────────────────────
 * Height is a rank among SOURCE files (see file-class.ts). Non-source bulk
 * keeps its byte-proportional plot but is capped to a low, wide depot, so a
 * 4 MB lockfile reads as infrastructure instead of owning the skyline.
 */

import * as THREE from 'three';
import { languageColor, languageEmissiveBoost } from './palette';
import type { LayoutCell } from './layout';
import { buildArchitectureDetails } from './architecture-details';
import type { ArchitectureDetails } from './architecture-details';
import { classifyBuilding, isCodeLanguage, type BuildingCategory } from './file-class';
import { FACADE_GLSL, fogFragmentGLSL } from './facade-shader';

export interface Building {
  position: [number, number, number];
  scale: [number, number, number];
  parcel: [number, number];
  color: [number, number, number];
  path: string;
  size: number;
  language: string;
  totalHeight: number;
  profile: 'block' | 'setback' | 'tower' | 'mega' | 'depot';
  /** `'source'` competes for the skyline; `'infrastructure'` is capped low. */
  category: BuildingCategory;
}

export interface CityData {
  mesh: THREE.InstancedMesh;
  details: ArchitectureDetails;
  buildings: Building[];
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number };
  maxHeight: number;
  /**
   * The building that owns the skyline — see {@link tallestSourceBuilding}:
   * the tallest source file in a code language, falling back to any source
   * file and then to any building. `null` only for an empty city. This is
   * what the "TALLEST" stat should report; the old max-over-everything
   * answer was a lockfile, a video, or a changelog.
   */
  tallestSourceFile: Building | null;
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

/**
 * The building the "TALLEST" stat should name.
 *
 * Three tiers, in order of preference:
 *   1. the tallest source file written in a code language,
 *   2. the tallest source file of any kind (docs-only repositories),
 *   3. the tallest building at all (asset-only repositories).
 *
 * Tier 1 exists because "tallest source" is meant to name the repository's
 * centre of gravity. Ranking by height alone hands it to a changelog:
 * flask's CHANGES.rst is genuinely its largest tracked source file and
 * genuinely tells you nothing. Height ranking itself is untouched — an .rst
 * is still an ordinary building — this only decides the label.
 *
 * Ties break on path so the answer is stable for a given repository.
 */
export function tallestSourceBuilding(buildings: readonly Building[]): Building | null {
  let code: Building | null = null;
  let source: Building | null = null;
  let any: Building | null = null;
  const taller = (candidate: Building, best: Building | null): boolean =>
    !best || candidate.totalHeight > best.totalHeight
    || (candidate.totalHeight === best.totalHeight && candidate.path < best.path);

  for (const b of buildings) {
    if (taller(b, any)) any = b;
    if (b.category !== 'source') continue;
    if (taller(b, source)) source = b;
    if (isCodeLanguage(b.language) && taller(b, code)) code = b;
  }
  return code ?? source ?? any;
}

/* ── Building GLSL (vertex additions) ─────────────────── */

const VERT_DECL = /* glsl */ `
attribute float aId;
attribute float aTint;
attribute float aLit;
attribute vec3 aBase;
attribute float aMatch;
attribute float aKind;
attribute float aSpan;
varying float vId;
varying float vTint;
varying float vLit;
varying vec3 vBase;
varying float vMatch;
varying float vKind;
varying float vSpan;
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
  vKind = aKind;
  vSpan = aSpan;
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
varying float vKind;
varying float vSpan;
varying vec3 vWP;
varying vec3 vLP;
varying vec3 vN;
uniform float uTime;
uniform float uHover;
uniform float uSelect;

/* read by the fog replacement below: how neon, and how small on screen */
float rcGlowKey = 0.0;
float rcAssistKey = 0.0;
` + FACADE_GLSL;

const FRAG_EMISSIVE = /* glsl */ `
{
  /* Derivatives first: they are evaluated before any discard so the 2x2
     quad still has neighbours to differentiate against. assist is 0
     whenever this building is more than 24 px wide on screen, which makes
     every branch below collapse to the original near-camera shading. */
  float assist = rcAssist( vWP, vSpan );
  if (vMatch < 0.5) discard;

  vec3 N = normalize( vN );
  float sideMask = 1.0 - step( 0.5, abs( N.y ) );
  float topMask = smoothstep( 0.5, 0.8, N.y );
  float depot = vKind;

  /* ---- window grid (world-space => consistent floor heights) ---- */
  float yCell;
  float seed;
  float grid = rcWindowGrid( vWP, N, abs( N.x ) * 31.7, vLit, assist, yCell, seed );

  float flickRoll = rcHash( seed + 13.7 );
  float flickOn = step( 0.90, flickRoll );
  float flick = sin( uTime * 3.6 + flickRoll * 40.0 ) * 0.45 + 0.65;
  /* Flicker is per-cell, so it becomes temporal noise once cells are
     sub-pixel — fade it out with everything else that aliases. */
  float winBright = mix( mix( 1.0, flick, flickOn ), 1.0, assist ) * mix( 1.0, 1.45, vLit );

  float windowShape = grid * sideMask * winBright;

  /* ---- window colour: cyan↔magenta↔amber via language tint ---- */
  float floorShift = rcHash( yCell * 3.17 + vId * 0.31 ) * 0.22 * ( 1.0 - assist );
  float et = clamp( vTint + floorShift - 0.10, 0.0, 1.0 );
  vec3 coolC = vec3( 0.06, 0.62, 0.82 );
  vec3 magC  = vec3( 0.82, 0.12, 0.46 );
  vec3 warmC = vec3( 0.82, 0.46, 0.14 );
  float t1 = clamp( et / 0.9, 0.0, 1.0 );
  float t2 = clamp( ( et - 0.9 ) / 0.1, 0.0, 1.0 );
  vec3 winTint = mix( mix( coolC, magC, t1 ), warmC, t2 );
  vec3 winColor = mix( winTint, vBase + winTint * 0.5, 0.45 );

  /* Averaging the grid conserves its energy, and that energy is far too
     little to survive tone mapping at overview distance — hence the gain.
     Depots keep a dim grid so byte-huge junk never out-glows real code. */
  float windowGain = rcDistantGain( assist ) * mix( 1.0, 0.42, depot );
  vec3 windowGlow = winColor * windowShape * 2.0 * windowGain;

  /* ---- facade luminance floor: distant blocks keep language colour ---- */
  float up = clamp( vLP.y + 0.5, 0.0, 1.0 );
  vec3 facadeTint = mix( vBase, winTint, 0.45 );
  /* Depots are wide roofs seen from above: without a roof wash they read as
     black holes in a distant city, so their tops get a stronger floor. */
  float facadeAmt = assist * ( sideMask * ( 0.05 + 0.14 * up ) + topMask * mix( 0.09, 0.30, depot ) );
  vec3 facadeGlow = facadeTint * facadeAmt;

  /* ---- neon rim on the top edge of every wall ---- */
  float rim = rcEdgeBand( vLP.y, 0.435, 0.5, 1.1, assist ) * sideMask;
  float rimPulse = sin( uTime * 2.2 + vId * 0.41 ) * 0.12 + 0.88;
  float rimBright = mix( 0.7, 1.3, vLit );
  vec3 rimColor = mix( vec3( 0.0, 0.68, 0.84 ), vec3( 0.86, 0.12, 0.46 ), et );
  vec3 rimGlow = rimColor * rim * rimPulse * rimBright * 1.25 * rcDistantEdgeGain( assist );

  /* ---- vertical corner strips ---- */
  float cornX = rcEdgeBand( abs( vLP.x ), 0.40, 0.5, 0.7, assist );
  float cornZ = rcEdgeBand( abs( vLP.z ), 0.40, 0.5, 0.7, assist );
  float corner = cornX * cornZ * sideMask;
  vec3 cornerGlow = rimColor * corner * rimBright * 0.35 * rcDistantEdgeGain( assist );

  /* ---- rooftop edge outline (the depot's signature) ---- */
  float topEdge = clamp(
    rcEdgeBand( abs( vLP.x ), 0.42, 0.5, 1.0, assist ) + rcEdgeBand( abs( vLP.z ), 0.42, 0.5, 1.0, assist ),
    0.0, 1.0 ) * topMask;
  vec3 roofGlow = rimColor * topEdge * rimPulse * 0.7 * rcDistantEdgeGain( assist ) * mix( 1.0, 2.2, depot );

  /* ---- hover / selection ---- */
  float isHover = 1.0 - step( 0.5, abs( vId - uHover ) );
  float isSel = 1.0 - step( 0.5, abs( vId - uSelect ) );
  float pulse = sin( uTime * 4.5 ) * 0.1 + 0.9;
  float boost = 1.0 + isHover * ( pulse * 0.25 ) + isSel * 0.55;

  vec3 rcGlow = ( windowGlow + facadeGlow + rimGlow + cornerGlow + roofGlow ) * boost;
  totalEmissiveRadiance += rcGlow;
  rcGlowKey = clamp( dot( rcGlow, vec3( 0.45 ) ), 0.0, 1.0 );
  rcAssistKey = assist;
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

/** Size-then-path ordering: stable for a given repository, never random. */
function rankOrder(cells: LayoutCell[], indices: readonly number[]): number[] {
  return [...indices].sort((a, b) => {
    const sizeOrder = cells[a].node.size - cells[b].node.size;
    return sizeOrder || (cells[a].node.path < cells[b].node.path ? -1 : cells[a].node.path > cells[b].node.path ? 1 : 0);
  });
}

/* ── public API ───────────────────────────────────────── */

export function buildCity(cells: LayoutCell[]): CityData {
  if (cells.length === 0) {
    const g = new THREE.BoxGeometry(1, 1, 1);
    const m = new THREE.MeshStandardMaterial();
    const mesh = new THREE.InstancedMesh(g, m, 0);
    return {
      mesh, buildings: [], bounds: { minX: 0, maxX: 0, minZ: 0, maxZ: 0 }, maxHeight: 0,
      tallestSourceFile: null,
      details: buildArchitectureDetails([]),
      update() {}, setHovered() {}, setSelected() {}, setMatchMask() {},
      dispose() { mesh.dispose(); g.dispose(); m.dispose(); },
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
  const aKind = new Float32Array(n);
  // Horizontal footprint of each core, in world units. The fragment shader
  // turns it into an on-screen width and uses that — not camera distance —
  // to decide whether this building still resolves. See facade-shader.ts.
  const aSpan = new Float32Array(n);
  const aMatch = new Float32Array(n).fill(1);
  let maxHeight = 0;

  /* ---- source vs infrastructure ---- */
  const languages: string[] = new Array(n);
  const categories: BuildingCategory[] = new Array(n);
  for (let i = 0; i < n; i++) {
    const node = cells[i].node;
    languages[i] = node.language ?? detectLang(node.name);
    categories[i] = classifyBuilding(node.path, languages[i], node.size);
  }
  // An assets-only repository still deserves a skyline, so fall back to
  // ranking everything rather than rendering a city of flat slabs.
  const anySource = categories.some((category) => category === 'source');
  const sourceIndices: number[] = [];
  const infraIndices: number[] = [];
  for (let i = 0; i < n; i++) {
    if (!anySource) categories[i] = 'source';
    (categories[i] === 'source' ? sourceIndices : infraIndices).push(i);
  }

  const rankByIndex = new Uint32Array(n);
  const sourceOrder = rankOrder(cells, sourceIndices);
  for (let rank = 0; rank < sourceOrder.length; rank++) rankByIndex[sourceOrder[rank]] = rank;
  const infraOrder = rankOrder(cells, infraIndices);
  for (let rank = 0; rank < infraOrder.length; rank++) rankByIndex[infraOrder[rank]] = rank;

  const sourceCount = sourceOrder.length;
  const infraCount = infraOrder.length;
  const landmarkCount = Math.min(sourceCount, 16, Math.max(3, Math.ceil(sourceCount * 0.05)));
  const ordinaryCount = sourceCount - landmarkCount;

  for (let i = 0; i < n; i++) {
    const c = cells[i];
    const r = c.rect;
    const lang = languages[i];
    const category = categories[i];
    const rawSize = c.node.size;
    const rank = rankByIndex[i];

    let totalHeight: number;
    let profile: Building['profile'];
    let coreRatio: number;
    let footprintScale: number;
    if (category === 'source') {
      const percentile = sourceCount > 1 ? rank / (sourceCount - 1) : 1;
      totalHeight = rank >= ordinaryCount
        ? 48 + 24 * ((rank - ordinaryCount) / Math.max(1, landmarkCount - 1))
        : 6 + 24 * Math.pow(rank / Math.max(1, ordinaryCount - 1), 1.5);
      profile = rank >= ordinaryCount ? 'mega' : percentile < 0.4 ? 'block' : percentile < 0.7 ? 'setback' : 'tower';
      coreRatio = profile === 'block' ? 1 : profile === 'setback' ? 0.76 : profile === 'tower' ? 0.82 : 0.52;
      footprintScale = Math.min(0.9, 12 / Math.max(r.w, r.h));
    } else {
      // Depots: byte-proportional ground, capped height, wider fill. The
      // ceiling sits below the shortest ordinary building on purpose.
      const percentile = infraCount > 1 ? rank / (infraCount - 1) : 1;
      totalHeight = 2.4 + 3.2 * percentile;
      profile = 'depot';
      coreRatio = 0.88;
      footprintScale = Math.min(0.92, 18 / Math.max(r.w, r.h));
    }
    const coreHeight = totalHeight * coreRatio;
    if (totalHeight > maxHeight) maxHeight = totalHeight;

    const col = languageColor(lang);
    buildings[i] = {
      position: [r.x + r.w / 2, coreHeight / 2, r.y + r.h / 2],
      scale: [r.w * footprintScale, coreHeight, r.h * footprintScale],
      parcel: [r.w, r.h],
      color: col,
      path: c.node.path, size: rawSize, language: lang, totalHeight, profile, category,
    };
    aId[i] = i;
    aTint[i] = languageEmissiveBoost(lang);
    aLit[i] = signHash(i * 7 + 42) > 0.90 ? 1.0 : 0.0;
    aKind[i] = category === 'source' ? 0 : 1;
    aSpan[i] = Math.min(r.w * footprintScale, r.h * footprintScale);
    aBase[i * 3] = col[0]; aBase[i * 3 + 1] = col[1]; aBase[i * 3 + 2] = col[2];
  }

  /* geometry + per-instance attributes */
  const geo = new THREE.BoxGeometry(1, 1, 1);
  geo.setAttribute('aId', new THREE.InstancedBufferAttribute(aId, 1));
  geo.setAttribute('aTint', new THREE.InstancedBufferAttribute(aTint, 1));
  geo.setAttribute('aLit', new THREE.InstancedBufferAttribute(aLit, 1));
  geo.setAttribute('aBase', new THREE.InstancedBufferAttribute(aBase, 3));
  geo.setAttribute('aKind', new THREE.InstancedBufferAttribute(aKind, 1));
  geo.setAttribute('aSpan', new THREE.InstancedBufferAttribute(aSpan, 1));
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
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n' + FRAG_EMISSIVE)
      .replace('#include <fog_fragment>', fogFragmentGLSL('vWP', 'rcAssistKey', 'rcGlowKey'));
  };
  material.customProgramCacheKey = () => 'repocity-buildings-v4';

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
    tallestSourceFile: tallestSourceBuilding(buildings),
    update(dt: number) { uniforms.uTime.value += dt; details.update(dt); },
    setHovered(id: number) { uniforms.uHover.value = id; details.setHovered(id); },
    setSelected(id: number) { uniforms.uSelect.value = id; details.setSelected(id); },
    setMatchMask(mask: Uint8Array) {
      for (let i = 0; i < n; i++) aMatch[i] = mask[i] ?? 0;
      matchAttribute.needsUpdate = true;
    },
    dispose() { mesh.dispose(); geo.dispose(); material.dispose(); details.dispose(); },
  };
}

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
 *      aId, aTint, aBase, aKind, aSpan  →  vId, vTint, vBase,
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
import { classifyBuilding, detectLanguage, isCodeLanguage, type BuildingCategory } from './file-class';
import { BLOCK_TYPOLOGY, districtKeyOf, typologyFor, type Typology } from './typology';
import {
  FACADE_GLSL, fogFragmentGLSL, glslFloat as f,
  FLOOR_SHIFT_RANGE, planSpan, RIM_BRIGHT, WINDOW_EMISSIVE,
} from './facade-shader';

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
  /**
   * What kind of building this is, inherited from its directory so a folder's
   * files read as one neighbourhood. Size decides how big; this decides what
   * shape. See typology.ts.
   */
  typology: Typology;
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
attribute vec3 aBase;
attribute float aMatch;
attribute float aKind;
attribute float aSpan;
varying float vId;
varying float vTint;
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
  float grid = rcWindowGrid( vWP, N, abs( N.x ) * 31.7, assist, yCell, seed );

  float flickRoll = rcHash( seed + 13.7 );
  float flickOn = step( 0.90, flickRoll );
  float flick = sin( uTime * 3.6 + flickRoll * 40.0 ) * 0.45 + 0.65;
  /* Flicker is per-cell, so it becomes temporal noise once cells are
     sub-pixel — fade it out with everything else that aliases. */
  float winBright = mix( mix( 1.0, flick, flickOn ), 1.0, assist );

  float windowShape = grid * sideMask * winBright;

  /* ---- window colour: cyan↔magenta↔amber via language tint ---- */
  float floorShift = rcHash( yCell * 3.17 + vId * 0.31 ) * ${f(FLOOR_SHIFT_RANGE)} * ( 1.0 - assist );
  float et;
  vec3 winTint = rcWindowTint( vTint, floorShift, et );
  vec3 winColor = rcNormalizeLuma( mix( winTint, vBase + winTint * 0.5, 0.45 ) );

  /* Averaging the grid conserves its energy, and that energy is far too
     little to survive tone mapping at overview distance — hence the gain.
     Depots keep a dim grid so byte-huge junk never out-glows real code. */
  float windowGain = rcDistantGain( assist ) * mix( 1.0, 0.42, depot );
  vec3 windowGlow = winColor * windowShape * ${f(WINDOW_EMISSIVE)} * windowGain;

  /* ---- facade luminance floor: distant blocks keep language colour ---- */
  float up = clamp( vLP.y + 0.5, 0.0, 1.0 );
  /* Normalised for the same reason the windows are: at full assist this term
     IS the building's silhouette, so leaving it raw would reintroduce the
     magenta-reads-dimmer gap in the one place a distant city is read from. */
  vec3 facadeTint = rcNormalizeLuma( mix( vBase, winTint, 0.45 ) );
  /* Depots are wide roofs seen from above: without a roof wash they read as
     black holes in a distant city, so their tops get a stronger floor. */
  float facadeAmt = assist * ( sideMask * ( 0.05 + 0.14 * up ) + topMask * mix( 0.09, 0.30, depot ) );
  vec3 facadeGlow = facadeTint * facadeAmt;

  /* ---- neon rim on the top edge of every wall ---- */
  float rim = rcEdgeBand( vLP.y, 0.435, 0.5, 1.1, assist ) * sideMask;
  float rimPulse = sin( uTime * 2.2 + vId * 0.41 ) * 0.12 + 0.88;
  float rimBright = ${f(RIM_BRIGHT)};
  vec3 rimColor = rcNormalizeLuma( mix( vec3( 0.0, 0.68, 0.84 ), vec3( 0.86, 0.12, 0.46 ), et ) );
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


/** Size-then-path ordering: stable for a given repository, never random. */
function rankOrder(cells: LayoutCell[], indices: readonly number[]): number[] {
  return [...indices].sort((a, b) => {
    const sizeOrder = cells[a].node.size - cells[b].node.size;
    return sizeOrder || (cells[a].node.path < cells[b].node.path ? -1 : cells[a].node.path > cells[b].node.path ? 1 : 0);
  });
}

/* ── public API ───────────────────────────────────────── */

/**
 * Shortest and tallest a source building can be, in world units.
 *
 * Absolute, deliberately. Scaling them with the city was tried and is wrong:
 * land area grows in proportion to the file count, so a building's PLOT is
 * already the same size whatever the repository's size — and scaling height on
 * top of that makes tall buildings get slimmer as a repository grows, which is
 * the drift this work exists to remove. Holding the range fixed is what keeps
 * a building's proportions identical at 200 files and at 20,000.
 *
 * The consequence is that a very large city covers more ground relative to its
 * height, exactly as a real one does. That is a framing question — the camera
 * should move in rather than fit everything on screen — not a reason to
 * distort the buildings.
 */
const SOURCE_MIN_HEIGHT = 6;
const SOURCE_MAX_HEIGHT = 72;
/** Depots stay below the shortest ordinary building. */
const DEPOT_MIN_HEIGHT = 2.4;
const DEPOT_MAX_HEIGHT = 5.6;
/**
 * Shape of the height ramp across the source-file rank percentile.
 *
 * Above 1 the low city stays low and the skyline concentrates its drama at the
 * top, which is what makes a handful of towers read as landmarks without
 * needing a separate tier.
 *
 * At 2.0 the 99th-percentile building was only about three times the median,
 * so the skyline's top edge came out nearly flat and nothing in the city read
 * as a landmark. At 3.0 the mass sits lower and the tallest few genuinely
 * tower over it. The curve is still strictly increasing, so "height is
 * file-size rank" is exactly as true as it was — only the shape of the ramp
 * changed, never its ordering.
 */
const HEIGHT_CURVE = 3.0;

/**
 * Smallest share of a building handed to its cap.
 *
 * The core taper reaches zero at percentile 0, which left the shortest
 * buildings with no space above the core for a parapet — so the bottom 40% of
 * every skyline was bare boxes that stopped short of their own declared
 * height. A floor here means every roof has an edge to light, and because it
 * makes the taper *flatter* at the low end it cannot disturb the rule that a
 * bigger file never renders a shorter lit mass.
 */
const MIN_CAP_FRACTION = 0.06;

/** Smoothstep on an already-normalised 0..1 input. */
function smoothstep01(t: number): number {
  const k = t < 0 ? 0 : t > 1 ? 1 : t;
  return k * k * (3 - 2 * k);
}

/**
 * Fraction of its parcel a building covers, leaving a gutter for the parcel
 * line and whatever street runs alongside it.
 */
const SOURCE_PARCEL_FILL = 0.9;
/** Depots sprawl: they are ground, not architecture. */
const DEPOT_PARCEL_FILL = 0.94;

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
  const buildings: Building[] = new Array<Building>(n);
  const aId = new Float32Array(n);
  const aTint = new Float32Array(n);
  const aBase = new Float32Array(n * 3);
  const aKind = new Float32Array(n);
  // Horizontal footprint of each core, in world units. The fragment shader
  // turns it into an on-screen width and uses that — not camera distance —
  // to decide whether this building still resolves. See facade-shader.ts.
  const aSpan = new Float32Array(n);
  const aMatch = new Float32Array(n).fill(1);
  let maxHeight = 0;

  /* ---- source vs infrastructure ---- */
  const languages: string[] = new Array<string>(n);
  const categories: BuildingCategory[] = new Array<BuildingCategory>(n);
  for (let i = 0; i < n; i++) {
    const node = cells[i].node;
    languages[i] = node.language ?? detectLanguage(node.name);
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
  /*
   * Landmarks are a *labelling* of the top of the same height curve, not a
   * separate tier with its own range. The old floor of 3 meant a repository
   * with four source files rendered three 48-72 unit megatowers beside one
   * 6-unit stub.
   */
  const landmarkCount = sourceCount <= 4 ? 0 : Math.min(16, Math.max(1, Math.round(sourceCount * 0.05)));
  const ordinaryCount = sourceCount - landmarkCount;

  for (let i = 0; i < n; i++) {
    const c = cells[i];
    const r = c.rect;
    const lang = languages[i];
    const category = categories[i];
    const rawSize = c.node.size;
    const rank = rankByIndex[i];
    // Depots are ground, not architecture: they keep the plain block form.
    const typology = category === 'source'
      ? typologyFor(districtKeyOf(c.node.path))
      : BLOCK_TYPOLOGY;

    let totalHeight: number;
    let profile: Building['profile'];
    let coreRatio: number;
    let parcelFill: number;
    if (category === 'source') {
      const percentile = sourceCount > 1 ? rank / (sourceCount - 1) : 1;
      /*
       * One continuous curve for every source file. There used to be two
       * disjoint ranges — ordinary files ran 6..30 and landmarks started at
       * 48 — so two files adjacent in size could differ in height by 60% with
       * nothing rendered in between.
       */
      totalHeight = SOURCE_MIN_HEIGHT +
        (SOURCE_MAX_HEIGHT - SOURCE_MIN_HEIGHT) * Math.pow(percentile, HEIGHT_CURVE);
      profile = rank >= ordinaryCount ? 'mega' : percentile < 0.4 ? 'block' : percentile < 0.7 ? 'setback' : 'tower';
      /*
       * The lit core shrinks smoothly as buildings get taller, handing the top
       * of the silhouette to crowns and spires. Stepping it per profile made
       * the visible mass *drop* 23% at the 0.4 boundary — a bigger file
       * rendering a shorter box than its smaller neighbour.
       */
      coreRatio = 1 - Math.max(MIN_CAP_FRACTION, 0.45 * smoothstep01(percentile));
      parcelFill = SOURCE_PARCEL_FILL;
    } else {
      // Depots: byte-proportional ground, capped height, wider fill. The
      // ceiling sits below the shortest ordinary building on purpose.
      const percentile = infraCount > 1 ? rank / (infraCount - 1) : 1;
      totalHeight = DEPOT_MIN_HEIGHT + (DEPOT_MAX_HEIGHT - DEPOT_MIN_HEIGHT) * percentile;
      profile = 'depot';
      coreRatio = 0.88;
      parcelFill = DEPOT_PARCEL_FILL;
    }
    /*
     * Footprint is now per-axis, and there is no absolute span cap.
     *
     * It used to be a single scalar, `min(0.9, 12 / max(w, h))`, applied to
     * both axes: an ISOTROPIC shrink triggered by an ANISOTROPIC test. A
     * 40x10 parcel therefore produced a 12x3 building — a needle marooned in
     * the middle of its own plot, with the surrounding ground left bare. That
     * was the largest single source of both the gaps between buildings and the
     * "why is this one tiny" reading, and it was driven purely by the parcel's
     * aspect ratio, nothing about the file.
     *
     * A building now simply fills its plot on both axes. Very large plots
     * therefore make genuinely large buildings, which is honest; keeping them
     * to a sane size is `normalizeSize`'s job, not this one's.
     */
    /*
     * The typology narrows the plot's SHORT axis only, so a slab stands along
     * the long axis rather than becoming a needle, and the slack it leaves
     * opens beside it as a side street. Filling both axes made every building
     * a near-square box — the treemap already drives plots toward an aspect
     * ratio near 1 — which is what made the city read as a stamped compound.
     */
    const shortIsW = r.w <= r.h;
    const planFill = category === 'source' ? typology.planFill : 1;
    const footprintW = r.w * parcelFill * (shortIsW ? planFill : 1);
    const footprintD = r.h * parcelFill * (shortIsW ? 1 : planFill);
    const coreHeight = totalHeight * coreRatio;
    if (totalHeight > maxHeight) maxHeight = totalHeight;

    /*
     * Sit in the slack rather than centring in it, so a district's buildings
     * line up along the same edge and the gap between rows reads as a street
     * instead of as scattered space. Half of the slack, so nothing ever
     * touches the plot boundary its details still have to fit inside.
     */
    const slackW = (r.w * parcelFill - footprintW) * 0.5 * typology.align;
    const slackD = (r.h * parcelFill - footprintD) * 0.5 * typology.align;

    const col = languageColor(lang);
    buildings[i] = {
      position: [r.x + r.w / 2 + slackW, coreHeight / 2, r.y + r.h / 2 + slackD],
      scale: [footprintW, coreHeight, footprintD],
      parcel: [r.w, r.h],
      color: col,
      path: c.node.path, size: rawSize, language: lang, totalHeight, profile, category,
      typology,
    };
    aId[i] = i;
    aTint[i] = languageEmissiveBoost(lang);
    aKind[i] = category === 'source' ? 0 : 1;
    aSpan[i] = planSpan(footprintW, footprintD);
    aBase[i * 3] = col[0]; aBase[i * 3 + 1] = col[1]; aBase[i * 3 + 2] = col[2];
  }

  /* geometry + per-instance attributes */
  const geo = new THREE.BoxGeometry(1, 1, 1);
  geo.setAttribute('aId', new THREE.InstancedBufferAttribute(aId, 1));
  geo.setAttribute('aTint', new THREE.InstancedBufferAttribute(aTint, 1));
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
  material.customProgramCacheKey = () => 'repocity-buildings-v7';

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

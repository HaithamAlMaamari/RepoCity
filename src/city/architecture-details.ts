/**
 * Architectural secondary masses for the city skyline.
 *
 * The primary building mesh stays instanced and shader-driven. These
 * secondary masses create the readable silhouettes that a plain box cannot:
 * podiums, setbacks, crowns, spires — and, for non-source bulk, the flat
 * depot cap. Each layer is batched into one InstancedMesh, so the detail
 * costs a handful of draw calls rather than one object per building.
 *
 * The crown material's window grid is NOT a second copy of the building
 * shader: both include FACADE_GLSL from facade-shader.ts, which owns the
 * cell sizes, the smoothstep pairs, the hash weights and the distance
 * response. Changing a constant there changes both surfaces at once.
 */

import * as THREE from 'three';
import type { Building } from './city';
import {
  FACADE_GLSL, fogFragmentGLSL, glslFloat, normalizeLuma, planSpan, WINDOW_EMISSIVE,
} from './facade-shader';

/**
 * Crowns carry slightly less window emissive than a core, as they always
 * have. Expressed against the core's value rather than as its own literal, so
 * the two cannot drift apart the next time the bloom threshold is weighed —
 * which is the exact way the window grid and the crown grid diverged before.
 */
const CROWN_WINDOW_EMISSIVE = Number((WINDOW_EMISSIVE * 0.95).toFixed(3));

export interface ArchitectureDetails {
  group: THREE.Group;
  update(dt: number): void;
  setHovered(id: number): void;
  setSelected(id: number): void;
  setMatchMask(mask: Uint8Array): void;
  dispose(): void;
}

interface InstanceSpec {
  ownerId: number;
  x: number;
  y: number;
  z: number;
  sx: number;
  sy: number;
  sz: number;
}

/**
 * Horizontal footprint of the OWNING building, in world units. Detail pieces
 * are keyed to their tower's on-screen size rather than their own: a spire is
 * always a couple of pixels wide, so gating it on its own width would light
 * it up in a close-up. See facade-shader.ts.
 */
function ownerSpan(building: Building): number {
  return planSpan(building.scale[0], building.scale[2]);
}

/* ── The cap: everything above the lit core ───────────────────────────────
 *
 * Every piece up here used to be placed at a hardcoded fraction of the
 * building's NOMINAL height — 0.86, 0.89, 0.66, 0.885, 0.98 — while the core
 * beneath it was sized `totalHeight * coreRatio`. Two different height bases.
 * That was survivable while `coreRatio` was a per-profile constant those
 * fractions had been fitted against (0.76 / 0.82 / 0.52), but Stage 2 made it
 * a continuous taper running 1.0 down to 0.55 and did not refit them. The core
 * of a tall tower now stops at 0.55 of its height while its crown still starts
 * at 0.80, so EVERY tower rendered its top floating in mid-air, 15-25% of the
 * building's height clear of the body — up to 18 world units of nothing.
 *
 * Refitting the fractions would fix today's numbers and rot again the next
 * time the height curve moves. So the fractions are gone. A piece is placed
 * from the core's ACTUAL rendered top, and the pieces tile the space up to the
 * declared height contiguously. Two things then hold by construction rather
 * than by tuning:
 *
 *   - the rendered top always equals `totalHeight`, whatever `coreRatio` does
 *     later — which also makes `rooftops.ts` and the camera's framing correct
 *     for free, since both already measure to `totalHeight`;
 *   - no piece is ever wider than the piece beneath it, so a wide parapet can
 *     never jut out of a narrow tower's waist. That was the second half of the
 *     "inverted layers" reading: the ledge is emitted at the core top, and the
 *     crown used to start BELOW it.
 */

/** A single mass stacked above the core, in world Y. */
export interface CapPiece {
  kind: 'podium' | 'ledge' | 'crown' | 'spire';
  bottom: number;
  top: number;
  /** Multiple of the core's footprint. Only the brim may exceed 1. */
  widthScale: number;
  /** 0 = no lit roof edge; otherwise the strip's brightness. */
  stripIntensity: number;
}

export interface CapPlan {
  /** Ground level of the building. */
  baseY: number;
  /** Top of the lit core — where the cap must start. */
  coreTop: number;
  /** Declared top. The cap's highest piece lands exactly here. */
  apex: number;
  /** `apex - coreTop`: the vertical space the cap has to fill. */
  budget: number;
  /** Ordered bottom-up. Ground pieces first, then the cap. */
  pieces: CapPiece[];
  /** Top of the highest non-spire piece — where a rooftop mast belongs. */
  roofY: number;
}

/**
 * How far each piece reaches down into the one below it, in world units.
 *
 * Small enough never to read at any framing, large enough to survive Float32
 * instance matrices at large world coordinates, where the relative epsilon at
 * ±500 units is ~6e-5. A seam cannot open even if a share rounds badly.
 */
const CAP_OVERLAP = 0.05;
/** Or this share of the piece's own height, whichever is larger. */
const CAP_OVERLAP_FRACTION = 0.06;

/** Share of the cap budget spent on the parapet that caps the core. */
const BRIM_SHARE = 0.22;
/** ...but a parapet is trim, not a storey. */
const BRIM_MAX_HEIGHT = 0.18;

const SPIRE_WIDTH_RATIO = 0.06;
/** So a spire is never sub-pixel on a small building. */
const SPIRE_MIN_WIDTH = 0.16;
/**
 * ...and never a lollipop on a stick. The old floor was absolute, so on a
 * 0.02-unit-wide building the spire came out eight times wider than the tower
 * carrying it.
 */
const SPIRE_MAX_RATIO = 0.35;

/**
 * How many stacked crowns a size band can carry, and whether it may end in a
 * mast.
 *
 * The size band decides how much room there is; the TYPOLOGY decides what to
 * do with it. Keeping those separate is what stops the city being four shapes:
 * a `tower` in one district steps back twice under a mast, and a `tower` in
 * the district next door is a slab, without either of them being wrong about
 * how big its file is.
 */
const BAND_MAX_STEPS: Record<Building['profile'], number> = {
  block: 1, setback: 2, tower: 3, mega: 3, depot: 0,
};
const BAND_ALLOWS_MAST: Record<Building['profile'], boolean> = {
  block: false, setback: false, tower: true, mega: true, depot: false,
};

/** Share of the post-brim budget a mast takes before the crowns divide it. */
const MAST_SHARE = 0.28;

/** Width of the parapet that caps the core, per profile. */
const BRIM_WIDTH: Record<Building['profile'], number> = {
  block: 1.05, setback: 1.04, tower: 1.04, mega: 1.05, depot: 1.06,
};
/** Brightness of the parapet's own lit edge. */
const BRIM_STRIP: Record<Building['profile'], number> = {
  block: 0.5, setback: 0.78, tower: 0.78, mega: 0.78, depot: 1.0,
};

/**
 * Height weights for a stack of `steps` crowns, tallest at the bottom.
 *
 * Equal steps read as a wedding cake; a descending series reads as a building
 * that is setting back as it rises, which is the shape the profile names have
 * always promised.
 */
function crownWeights(steps: number): number[] {
  return Array.from({ length: steps }, (_, i) => steps - i);
}

/**
 * Lay out everything above the core for one building.
 *
 * Pure: no THREE, no randomness, no I/O — so the vertical contract can be
 * asserted directly instead of through an InstancedMesh. Same reasoning as
 * `brightness-probe.ts`: the defect lived in geometry that could not be
 * inspected without a GPU, so it was never inspected.
 */
export function planCap(building: Building): CapPlan {
  const baseY = building.position[1] - building.scale[1] / 2;
  const coreTop = baseY + building.scale[1];
  const apex = baseY + building.totalHeight;
  const budget = Math.max(0, apex - coreTop);
  const pieces: CapPiece[] = [];

  /* Ground masses sit on the floor, not in the budget. */
  if (building.profile === 'mega') {
    pieces.push({ kind: 'podium', bottom: baseY, top: baseY + 0.4, widthScale: 1.12, stripIntensity: 0 });
  } else if (building.profile === 'depot') {
    pieces.push({ kind: 'podium', bottom: baseY, top: baseY + 0.24, widthScale: 1.06, stripIntensity: 0 });
  }

  if (budget <= 0) {
    return { baseY, coreTop, apex, budget, pieces, roofY: coreTop };
  }

  const narrow = Math.min(building.scale[0], building.scale[2]);
  const typology = building.typology;
  const steps = Math.min(typology.steps, BAND_MAX_STEPS[building.profile]);
  const mast = typology.mast && BAND_ALLOWS_MAST[building.profile] && steps > 0;

  /*
   * A depot's parapet IS its whole cap — no crown, no spire; it is meant to
   * read as ground rather than architecture. This is also the one profile
   * whose geometry was already correct, so it must come out unchanged.
   */
  const brimHeight = steps === 0
    ? budget
    : Math.min(BRIM_MAX_HEIGHT, budget * BRIM_SHARE);

  let cursor = coreTop;
  let previousWidth = Infinity;
  const push = (
    height: number, widthScale: number, kind: CapPiece['kind'], stripIntensity: number,
  ): void => {
    const capped = Math.min(widthScale, previousWidth);
    const overlap = Math.max(CAP_OVERLAP, height * CAP_OVERLAP_FRACTION);
    pieces.push({
      kind,
      // Reaching down into the piece below is what makes a gap impossible.
      bottom: Math.max(baseY, cursor - overlap),
      top: cursor + height,
      widthScale: capped,
      stripIntensity,
    });
    previousWidth = capped;
    cursor += height;
  };

  push(brimHeight, BRIM_WIDTH[building.profile], 'ledge', BRIM_STRIP[building.profile]);

  /*
   * The mast is paid for first so the crowns divide only what is left; then
   * the LAST piece emitted takes whatever remains, so rounding can never leave
   * a sliver of unfilled height between the top crown and the declared apex.
   */
  const afterBrim = apex - cursor;
  const mastHeight = mast ? afterBrim * MAST_SHARE : 0;
  const crownTop = apex - mastHeight;
  const weights = crownWeights(steps);
  const weightTotal = weights.reduce((sum, w) => sum + w, 0);
  const crownBudget = crownTop - cursor;

  for (let i = 0; i < steps; i++) {
    const last = i === steps - 1;
    const height = last ? crownTop - cursor : (crownBudget * weights[i]) / weightTotal;
    // Each step keeps `narrowing` of the one below it, so the silhouette
    // tapers by the district's own character rather than a fixed table.
    const widthScale = Math.pow(typology.narrowing, i + 1);
    // Only the topmost crown is outlined; lighting every setback reads busy.
    push(height, widthScale, 'crown', last ? 0.78 : 0);
  }

  if (mast) {
    const widthScale = Math.min(
      SPIRE_MAX_RATIO,
      Math.max(SPIRE_WIDTH_RATIO, SPIRE_MIN_WIDTH / Math.max(narrow, 1e-6)),
    );
    push(apex - cursor, widthScale, 'spire', 0);
  }

  let roofY = coreTop;
  for (const piece of pieces) {
    if (piece.kind !== 'spire' && piece.top > roofY) roofY = piece.top;
  }
  return { baseY, coreTop, apex, budget, pieces, roofY };
}

interface StripSpec extends InstanceSpec {
  color: [number, number, number];
}

interface CrownUniforms {
  time: { value: number };
  hover: { value: number };
  selected: { value: number };
}

export function buildArchitectureDetails(buildings: Building[]): ArchitectureDetails {
  const group = new THREE.Group();
  const disposables: { dispose(): void }[] = [];
  const podiums: InstanceSpec[] = [];
  const ledges: InstanceSpec[] = [];
  const crowns: InstanceSpec[] = [];
  const spires: InstanceSpec[] = [];
  const strips: StripSpec[] = [];
  const maskUpdaters: ((mask: Uint8Array) => void)[] = [];

  /*
   * One path for every profile. `planCap` decides the vertical layout; this
   * loop only turns each piece into an instance and routes it to the mesh that
   * owns its material. A profile can no longer place a piece by hand, which is
   * how the crowns drifted off their cores in the first place.
   */
  for (let ownerId = 0; ownerId < buildings.length; ownerId++) {
    const b = buildings[ownerId];
    const w = b.scale[0];
    const d = b.scale[2];

    for (const piece of planCap(b).pieces) {
      const spec: InstanceSpec = {
        ownerId,
        x: b.position[0],
        y: (piece.bottom + piece.top) / 2,
        z: b.position[2],
        sx: w * piece.widthScale,
        sy: piece.top - piece.bottom,
        sz: d * piece.widthScale,
      };
      if (piece.kind === 'podium') podiums.push(spec);
      else if (piece.kind === 'ledge') ledges.push(spec);
      else if (piece.kind === 'crown') crowns.push(spec);
      else spires.push(spec);

      if (piece.stripIntensity > 0) {
        addStrips(strips, b, ownerId, piece.top, spec.sx, spec.sz, piece.stripIntensity);
      }
    }
  }

  for (const specs of [podiums, ledges, crowns, strips]) {
    for (const spec of specs) constrainToParcel(spec, buildings[spec.ownerId], 1);
  }
  for (const spec of spires) constrainToParcel(spec, buildings[spec.ownerId], 1.8);

  const bodyMaterial = new THREE.MeshStandardMaterial({
    color: 0x17243b,
    roughness: 0.68,
    metalness: 0.38,
    emissive: 0x020814,
    emissiveIntensity: 0.35,
  });
  applyMassShading(bodyMaterial, 'repocity-mass-body-v2', [0.030, 0.048, 0.078]);
  const crownUniforms: CrownUniforms = {
    time: { value: 0 },
    hover: { value: -1 },
    selected: { value: -1 },
  };
  const upperMaterial = buildCrownMaterial(crownUniforms);
  const spireMaterial = new THREE.MeshStandardMaterial({
    color: 0x142038,
    roughness: 0.48,
    metalness: 0.72,
    emissive: 0x031022,
    emissiveIntensity: 0.3,
  });
  applyMassShading(spireMaterial, 'repocity-mass-spire-v2', [0.028, 0.046, 0.080]);

  addBoxes(group, podiums, buildings, bodyMaterial, disposables, maskUpdaters);
  addBoxes(group, ledges, buildings, bodyMaterial, disposables, maskUpdaters);
  addCrownBoxes(group, crowns, buildings, upperMaterial, disposables, maskUpdaters);
  addSpires(group, spires, buildings, spireMaterial, disposables, maskUpdaters);
  addStripsMesh(group, strips, disposables, maskUpdaters);

  return {
    group,
    update(dt) { crownUniforms.time.value += dt; },
    setHovered(id) { crownUniforms.hover.value = id; },
    setSelected(id) { crownUniforms.selected.value = id; },
    setMatchMask(mask) { for (const update of maskUpdaters) update(mask); },
    dispose() {
      for (const disposable of disposables) disposable.dispose();
    },
  };
}

function addBoxes(
  group: THREE.Group,
  specs: InstanceSpec[],
  buildings: Building[],
  material: THREE.MeshStandardMaterial,
  disposables: { dispose(): void }[],
  maskUpdaters: ((mask: Uint8Array) => void)[],
): void {
  if (specs.length === 0) return;
  const geometry = new THREE.BoxGeometry(1, 1, 1);
  attachOwnerSpans(geometry, specs, buildings);
  const mesh = new THREE.InstancedMesh(geometry, material, specs.length);
  const dummy = new THREE.Object3D();
  for (let i = 0; i < specs.length; i++) {
    const s = specs[i];
    dummy.position.set(s.x, s.y, s.z);
    dummy.scale.set(s.sx, s.sy, s.sz);
    dummy.updateMatrix();
    mesh.setMatrixAt(i, dummy.matrix);
  }
  mesh.instanceMatrix.needsUpdate = true;
  mesh.frustumCulled = false;
  group.add(mesh);
  disposables.push(mesh, geometry);
  // The material is shared by all boxes in this layer and disposed once by
  // the caller's disposable list.
  if (!disposables.includes(material)) disposables.push(material);
  maskUpdaters.push((mask) => updateMatrices(mesh, specs, mask));
}

function addCrownBoxes(
  group: THREE.Group,
  specs: InstanceSpec[],
  buildings: Building[],
  material: THREE.MeshStandardMaterial,
  disposables: { dispose(): void }[],
  maskUpdaters: ((mask: Uint8Array) => void)[],
): void {
  if (specs.length === 0) return;
  const geometry = new THREE.BoxGeometry(1, 1, 1);
  const ownerIds = new Float32Array(specs.length);
  const spans = new Float32Array(specs.length);
  const colors = new Float32Array(specs.length * 3);
  const mesh = new THREE.InstancedMesh(geometry, material, specs.length);
  const dummy = new THREE.Object3D();
  for (let i = 0; i < specs.length; i++) {
    const spec = specs[i];
    const color = buildings[spec.ownerId].color;
    ownerIds[i] = spec.ownerId;
    spans[i] = ownerSpan(buildings[spec.ownerId]);
    colors[i * 3] = color[0];
    colors[i * 3 + 1] = color[1];
    colors[i * 3 + 2] = color[2];
    dummy.position.set(spec.x, spec.y, spec.z);
    dummy.scale.set(spec.sx, spec.sy, spec.sz);
    dummy.updateMatrix();
    mesh.setMatrixAt(i, dummy.matrix);
  }
  geometry.setAttribute('aOwnerId', new THREE.InstancedBufferAttribute(ownerIds, 1));
  geometry.setAttribute('aCrownSpan', new THREE.InstancedBufferAttribute(spans, 1));
  geometry.setAttribute('aCrownColor', new THREE.InstancedBufferAttribute(colors, 3));
  mesh.instanceMatrix.needsUpdate = true;
  mesh.frustumCulled = false;
  group.add(mesh);
  disposables.push(mesh, geometry);
  if (!disposables.includes(material)) disposables.push(material);
  maskUpdaters.push((mask) => updateMatrices(mesh, specs, mask));
}

/**
 * Structural masses (podiums, ledges, depot caps, spires) carry no windows,
 * so at overview distance they were the black holes between lit facades:
 * an unlit dark blue that the scene fog then took the rest of the way to
 * black. This gives them the same treatment the facades get — a distance-
 * gated silhouette lift and the capped fog — and nothing else, so the
 * near-camera look is byte-identical (rcFarFactor is 0 up close).
 */
function applyMassShading(
  material: THREE.MeshStandardMaterial,
  cacheKey: string,
  lift: readonly [number, number, number],
): void {
  const liftGlsl = `vec3( ${lift[0]}, ${lift[1]}, ${lift[2]} )`;
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aOwnerSpan;\nvarying float vMassSpan;\nvarying vec3 vMassWorld;')
      .replace('#include <fog_vertex>', `
        vMassSpan = aOwnerSpan;
        vMassWorld = ( modelMatrix * instanceMatrix * vec4( transformed, 1.0 ) ).xyz;
        #include <fog_vertex>`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        varying float vMassSpan;
        varying vec3 vMassWorld;
        float rcMassAssist = 0.0;
${FACADE_GLSL}`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        rcMassAssist = rcAssist( vMassWorld, vMassSpan );
        totalEmissiveRadiance += ${liftGlsl} * rcMassAssist;`)
      .replace('#include <fog_fragment>', fogFragmentGLSL('vMassWorld', 'rcMassAssist', '0.3'));
  };
  material.customProgramCacheKey = () => cacheKey;
}

/** Per-instance owning-building footprint, for `rcAssist` in the shader. */
function attachOwnerSpans(
  geometry: THREE.BufferGeometry,
  specs: readonly InstanceSpec[],
  buildings: readonly Building[],
): void {
  const spans = new Float32Array(specs.length);
  for (let i = 0; i < specs.length; i++) spans[i] = ownerSpan(buildings[specs[i].ownerId]);
  geometry.setAttribute('aOwnerSpan', new THREE.InstancedBufferAttribute(spans, 1));
}

function buildCrownMaterial(uniforms: CrownUniforms): THREE.MeshStandardMaterial {
  const material = new THREE.MeshStandardMaterial({
    color: 0x14243c,
    roughness: 0.58,
    metalness: 0.42,
    emissive: 0x020814,
    emissiveIntensity: 0.35,
  });
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uCrownTime = uniforms.time;
    shader.uniforms.uCrownHover = uniforms.hover;
    shader.uniforms.uCrownSelected = uniforms.selected;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
        attribute float aOwnerId;
        attribute float aCrownSpan;
        attribute vec3 aCrownColor;
        varying float vOwnerId;
        varying float vCrownSpan;
        varying vec3 vCrownColor;
        varying vec3 vCrownWorld;
        varying vec3 vCrownLocal;
        varying vec3 vCrownNormal;`)
      .replace('#include <fog_vertex>', `
        vOwnerId = aOwnerId;
        vCrownSpan = aCrownSpan;
        vCrownColor = aCrownColor;
        vCrownLocal = position;
        vCrownWorld = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;
        vCrownNormal = normalize(mat3(modelMatrix) * mat3(instanceMatrix) * objectNormal);
        #include <fog_vertex>`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        varying float vOwnerId;
        varying float vCrownSpan;
        varying vec3 vCrownColor;
        varying vec3 vCrownWorld;
        varying vec3 vCrownLocal;
        varying vec3 vCrownNormal;
        uniform float uCrownTime;
        uniform float uCrownHover;
        uniform float uCrownSelected;
        float rcCrownGlowKey = 0.0;
        float rcCrownAssistKey = 0.0;
${FACADE_GLSL}`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        {
          float assist = rcAssist(vCrownWorld, vCrownSpan);
          vec3 crownN = normalize(vCrownNormal);
          float sideMask = 1.0 - step(0.5, abs(crownN.y));
          float yCell;
          float seed;
          float windows = rcWindowGrid(vCrownWorld, crownN, vOwnerId * 0.37, assist, yCell, seed) * sideMask;
          float rim = rcEdgeBand(vCrownLocal.y, 0.435, 0.5, 1.1, assist) * sideMask;
          float activeBoost = step(abs(vOwnerId - uCrownHover), 0.5) * 0.25 + step(abs(vOwnerId - uCrownSelected), 0.5) * 0.55;
          float pulse = 0.92 + sin(uCrownTime * 4.0 + vOwnerId * 0.23) * 0.08;
          /* Crowns sit at the top of the silhouette, so they carry most of a
             distant skyline: same energy-conserving gain as the cores. */
          float facade = assist * (sideMask * 0.10 + smoothstep(0.5, 0.8, crownN.y) * 0.08);
          /* Crowns are coloured by the raw language colour, whose luminance
             spans the same 1.56x the facades' did — and they sit at the top
             of the silhouette, so an unnormalised crown is the most visible
             place for a magenta language to read dimmer than a cyan one. */
          vec3 crownColor = rcNormalizeLuma(vCrownColor);
          vec3 glow = crownColor * (windows * ${glslFloat(CROWN_WINDOW_EMISSIVE)} * rcDistantGain(assist) + rim * 0.7 * rcDistantEdgeGain(assist) + facade)
            * (1.0 + activeBoost) * pulse;
          totalEmissiveRadiance += glow;
          rcCrownGlowKey = clamp(dot(glow, vec3(0.45)), 0.0, 1.0);
          rcCrownAssistKey = assist;
        }`)
      .replace('#include <fog_fragment>', fogFragmentGLSL('vCrownWorld', 'rcCrownAssistKey', 'rcCrownGlowKey'));
  };
  material.customProgramCacheKey = () => 'repocity-crowns-v6';
  return material;
}

function addSpires(
  group: THREE.Group,
  specs: InstanceSpec[],
  buildings: Building[],
  material: THREE.MeshStandardMaterial,
  disposables: { dispose(): void }[],
  maskUpdaters: ((mask: Uint8Array) => void)[],
): void {
  if (specs.length === 0) return;
  /*
   * Centre-origin, like every other detail geometry. It used to be translated
   * to base-origin while being placed with a centre `y`, so a spire sat half
   * its own length too high and overshot the building's declared top by 12%.
   */
  const geometry = new THREE.CylinderGeometry(0.5, 0.9, 1, 6);
  attachOwnerSpans(geometry, specs, buildings);
  const mesh = new THREE.InstancedMesh(geometry, material, specs.length);
  const dummy = new THREE.Object3D();
  for (let i = 0; i < specs.length; i++) {
    const s = specs[i];
    dummy.position.set(s.x, s.y, s.z);
    dummy.scale.set(s.sx, s.sy, s.sz);
    dummy.updateMatrix();
    mesh.setMatrixAt(i, dummy.matrix);
  }
  mesh.instanceMatrix.needsUpdate = true;
  mesh.frustumCulled = false;
  group.add(mesh);
  disposables.push(mesh, geometry);
  if (!disposables.includes(material)) disposables.push(material);
  maskUpdaters.push((mask) => updateMatrices(mesh, specs, mask));
}

/**
 * A lit outline around a roof edge.
 *
 * `roofY` is the ROOF PLANE, not a mass's centre. It used to be called with
 * the crown's centre for three of the five profiles and with the roof for the
 * other two — the same argument meaning two different things — so on a tall
 * tower the strip that is meant to trace the roofline sat several units down
 * the crown's flank instead.
 */
function addStrips(
  target: StripSpec[],
  b: Building,
  ownerId: number,
  roofY: number,
  width: number,
  depth: number,
  intensity = 0.78,
): void {
  // Normalised like every other language-coloured surface: two strips of the
  // same width on neighbouring roofs should differ in hue, not in brightness.
  const level = normalizeLuma(b.color);
  const color: [number, number, number] = [level[0] * intensity, level[1] * intensity, level[2] * intensity];
  const z = depth / 2 + 0.025;
  const x = width / 2 + 0.025;
  target.push(
    { ownerId, x: b.position[0], y: roofY, z: b.position[2] - z, sx: width * 0.78, sy: 0.075, sz: 0.035, color },
    { ownerId, x: b.position[0], y: roofY, z: b.position[2] + z, sx: width * 0.78, sy: 0.075, sz: 0.035, color },
    { ownerId, x: b.position[0] - x, y: roofY, z: b.position[2], sx: 0.035, sy: 0.075, sz: depth * 0.78, color },
    { ownerId, x: b.position[0] + x, y: roofY, z: b.position[2], sx: 0.035, sy: 0.075, sz: depth * 0.78, color },
  );
}

function addStripsMesh(
  group: THREE.Group,
  specs: StripSpec[],
  disposables: { dispose(): void }[],
  maskUpdaters: ((mask: Uint8Array) => void)[],
): void {
  if (specs.length === 0) return;
  const geometry = new THREE.BoxGeometry(1, 1, 1);
  const material = new THREE.MeshBasicMaterial({
    transparent: true,
    opacity: 0.58,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    fog: true,
  });
  const mesh = new THREE.InstancedMesh(geometry, material, specs.length);
  const dummy = new THREE.Object3D();
  const color = new THREE.Color();
  for (let i = 0; i < specs.length; i++) {
    const s = specs[i];
    dummy.position.set(s.x, s.y, s.z);
    dummy.scale.set(s.sx, s.sy, s.sz);
    dummy.updateMatrix();
    mesh.setMatrixAt(i, dummy.matrix);
    mesh.setColorAt(i, color.setRGB(...s.color));
  }
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  mesh.frustumCulled = false;
  mesh.renderOrder = 2;
  group.add(mesh);
  disposables.push(mesh, geometry, material);
  maskUpdaters.push((mask) => updateMatrices(mesh, specs, mask));
}

function updateMatrices(mesh: THREE.InstancedMesh, specs: InstanceSpec[], mask: Uint8Array): void {
  const dummy = new THREE.Object3D();
  for (let i = 0; i < specs.length; i++) {
    const spec = specs[i];
    const visible = mask[spec.ownerId] === 1 ? 1 : 0;
    dummy.position.set(spec.x, spec.y, spec.z);
    dummy.scale.set(spec.sx * visible, spec.sy * visible, spec.sz * visible);
    dummy.updateMatrix();
    mesh.setMatrixAt(i, dummy.matrix);
  }
  mesh.instanceMatrix.needsUpdate = true;
}

/** How far toward its plot edge a detail may reach. */
const DETAIL_PARCEL_LIMIT = 0.99;

function constrainToParcel(spec: InstanceSpec, building: Building, geometryWidth: number): void {
  /*
   * Details are bounded by the PLOT, not by the core.
   *
   * This used to track the core's own fill ratio, which was fine while cores
   * varied in width — but now every core fills exactly 90% of its parcel, so
   * that rule clamped every parapet and ledge flush with the wall beneath it
   * and the overhang that makes them read as architecture disappeared. Bounding
   * by the plot instead lets a ledge sit proud of its core while still never
   * crossing into the neighbouring parcel or the street.
   *
   * The margin below the plot edge also retains enough room for Float32
   * instance-matrix precision on extremely narrow parcels.
   */
  const parcelW = building.parcel[0] * DETAIL_PARCEL_LIMIT;
  const parcelD = building.parcel[1] * DETAIL_PARCEL_LIMIT;
  spec.sx = Math.min(spec.sx, parcelW / geometryWidth);
  spec.sz = Math.min(spec.sz, parcelD / geometryWidth);
  const worldW = spec.sx * geometryWidth;
  const worldD = spec.sz * geometryWidth;
  const minX = building.position[0] - parcelW / 2 + worldW / 2;
  const maxX = building.position[0] + parcelW / 2 - worldW / 2;
  const minZ = building.position[2] - parcelD / 2 + worldD / 2;
  const maxZ = building.position[2] + parcelD / 2 - worldD / 2;
  spec.x = Math.max(minX, Math.min(maxX, spec.x));
  spec.z = Math.max(minZ, Math.min(maxZ, spec.z));
}

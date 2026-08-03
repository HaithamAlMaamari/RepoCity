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
import { FACADE_GLSL, fogFragmentGLSL } from './facade-shader';

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
  return Math.min(building.scale[0], building.scale[2]);
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

  for (let ownerId = 0; ownerId < buildings.length; ownerId++) {
    const b = buildings[ownerId];
    const total = b.totalHeight;
    const baseY = b.position[1] - b.scale[1] / 2;
    const w = b.scale[0];
    const d = b.scale[2];

    if (b.profile === 'setback') {
      const y = baseY + b.scale[1];
      ledges.push({ ownerId, x: b.position[0], y, z: b.position[2], sx: w * 1.04, sy: 0.18, sz: d * 1.04 });
      crowns.push({ ownerId, x: b.position[0], y: baseY + total * 0.86, z: b.position[2], sx: w * 0.62, sy: total * 0.28, sz: d * 0.62 });
      addStrips(strips, b, ownerId, baseY + total * 0.86, w * 0.62, d * 0.62);
    } else if (b.profile === 'tower') {
      const y = baseY + b.scale[1];
      ledges.push({ ownerId, x: b.position[0], y, z: b.position[2], sx: w * 1.04, sy: 0.18, sz: d * 1.04 });
      crowns.push({ ownerId, x: b.position[0], y: baseY + total * 0.89, z: b.position[2], sx: w * 0.42, sy: total * 0.18, sz: d * 0.42 });
      addStrips(strips, b, ownerId, baseY + total * 0.89, w * 0.42, d * 0.42);
      spires.push({ ownerId, x: b.position[0], y: baseY + total * 0.98, z: b.position[2], sx: Math.max(w * 0.06, 0.16), sy: total * 0.14, sz: Math.max(d * 0.06, 0.16) });
    } else if (b.profile === 'mega') {
      podiums.push({ ownerId, x: b.position[0], y: baseY + 0.20, z: b.position[2], sx: w * 1.12, sy: 0.40, sz: d * 1.12 });
      ledges.push({ ownerId, x: b.position[0], y: baseY + b.scale[1], z: b.position[2], sx: w * 1.05, sy: 0.22, sz: d * 1.05 });
      crowns.push({ ownerId, x: b.position[0], y: baseY + total * 0.66, z: b.position[2], sx: w * 0.68, sy: total * 0.28, sz: d * 0.68 });
      addStrips(strips, b, ownerId, baseY + total * 0.66, w * 0.68, d * 0.68);
      crowns.push({ ownerId, x: b.position[0], y: baseY + total * 0.885, z: b.position[2], sx: w * 0.44, sy: total * 0.19, sz: d * 0.44 });
      addStrips(strips, b, ownerId, baseY + total * 0.885, w * 0.44, d * 0.44);
      spires.push({ ownerId, x: b.position[0], y: baseY + total * 0.97, z: b.position[2], sx: Math.max(w * 0.055, 0.18), sy: total * 0.10, sz: Math.max(d * 0.055, 0.18) });
    } else if (b.profile === 'depot') {
      // Non-source bulk: a loading apron, a heavy parapet, and a bright
      // roof edge. No crown, no spire — nothing that reads as a landmark.
      podiums.push({ ownerId, x: b.position[0], y: baseY + 0.12, z: b.position[2], sx: w * 1.06, sy: 0.24, sz: d * 1.06 });
      ledges.push({ ownerId, x: b.position[0], y: baseY + total * 0.94, z: b.position[2], sx: w * 1.06, sy: total * 0.12, sz: d * 1.06 });
      addStrips(strips, b, ownerId, baseY + total, w * 1.02, d * 1.02, 1.0);
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
          float windows = rcWindowGrid(vCrownWorld, crownN, vOwnerId * 0.37, 0.0, assist, yCell, seed) * sideMask;
          float rim = rcEdgeBand(vCrownLocal.y, 0.435, 0.5, 1.1, assist) * sideMask;
          float activeBoost = step(abs(vOwnerId - uCrownHover), 0.5) * 0.25 + step(abs(vOwnerId - uCrownSelected), 0.5) * 0.55;
          float pulse = 0.92 + sin(uCrownTime * 4.0 + vOwnerId * 0.23) * 0.08;
          /* Crowns sit at the top of the silhouette, so they carry most of a
             distant skyline: same energy-conserving gain as the cores. */
          float facade = assist * (sideMask * 0.10 + smoothstep(0.5, 0.8, crownN.y) * 0.08);
          vec3 glow = vCrownColor * (windows * 1.9 * rcDistantGain(assist) + rim * 0.7 * rcDistantEdgeGain(assist) + facade)
            * (1.0 + activeBoost) * pulse;
          totalEmissiveRadiance += glow;
          rcCrownGlowKey = clamp(dot(glow, vec3(0.45)), 0.0, 1.0);
          rcCrownAssistKey = assist;
        }`)
      .replace('#include <fog_fragment>', fogFragmentGLSL('vCrownWorld', 'rcCrownAssistKey', 'rcCrownGlowKey'));
  };
  material.customProgramCacheKey = () => 'repocity-crowns-v3';
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
  const geometry = new THREE.CylinderGeometry(0.5, 0.9, 1, 6);
  geometry.translate(0, 0.5, 0);
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

function addStrips(
  target: StripSpec[],
  b: Building,
  ownerId: number,
  y: number,
  width: number,
  depth: number,
  intensity = 0.78,
): void {
  const color: [number, number, number] = [b.color[0] * intensity, b.color[1] * intensity, b.color[2] * intensity];
  const z = depth / 2 + 0.025;
  const x = width / 2 + 0.025;
  target.push(
    { ownerId, x: b.position[0], y, z: b.position[2] - z, sx: width * 0.78, sy: 0.075, sz: 0.035, color },
    { ownerId, x: b.position[0], y, z: b.position[2] + z, sx: width * 0.78, sy: 0.075, sz: 0.035, color },
    { ownerId, x: b.position[0] - x, y, z: b.position[2], sx: 0.035, sy: 0.075, sz: depth * 0.78, color },
    { ownerId, x: b.position[0] + x, y, z: b.position[2], sx: 0.035, sy: 0.075, sz: depth * 0.78, color },
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

function constrainToParcel(spec: InstanceSpec, building: Building, geometryWidth: number): void {
  // Match the primary core's parcel footprint and retain enough margin for
  // Float32 instance-matrix precision on extremely narrow parcels. Ordinary
  // cores fill 90%; depots fill more, and their parapet has to be allowed
  // to overhang the core rather than being clamped flush with it.
  const fill = (axis: 0 | 1) => Math.min(0.99, Math.max(0.90, building.scale[axis * 2] / building.parcel[axis]));
  const parcelW = building.parcel[0] * fill(0);
  const parcelD = building.parcel[1] * fill(1);
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

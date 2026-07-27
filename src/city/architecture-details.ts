/**
 * Architectural secondary masses for the city skyline.
 *
 * The primary building mesh stays instanced and shader-driven. These
 * secondary masses create the readable silhouettes that a plain box cannot:
 * podiums, setbacks, crowns, and spires. Each layer is batched into one
 * InstancedMesh, so the detail costs a handful of draw calls rather than one
 * object per building.
 */

import * as THREE from 'three';
import type { Building } from './city';

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
    }
  }

  const bodyMaterial = new THREE.MeshStandardMaterial({
    color: 0x17243b,
    roughness: 0.68,
    metalness: 0.38,
    emissive: 0x020814,
    emissiveIntensity: 0.35,
  });
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

  addBoxes(group, podiums, bodyMaterial, disposables, maskUpdaters);
  addBoxes(group, ledges, bodyMaterial, disposables, maskUpdaters);
  addCrownBoxes(group, crowns, buildings, upperMaterial, disposables, maskUpdaters);
  addSpires(group, spires, spireMaterial, disposables, maskUpdaters);
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
  material: THREE.MeshStandardMaterial,
  disposables: { dispose(): void }[],
  maskUpdaters: ((mask: Uint8Array) => void)[],
): void {
  if (specs.length === 0) return;
  const geometry = new THREE.BoxGeometry(1, 1, 1);
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
  disposables.push(geometry);
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
  const colors = new Float32Array(specs.length * 3);
  const mesh = new THREE.InstancedMesh(geometry, material, specs.length);
  const dummy = new THREE.Object3D();
  for (let i = 0; i < specs.length; i++) {
    const spec = specs[i];
    const color = buildings[spec.ownerId].color;
    ownerIds[i] = spec.ownerId;
    colors[i * 3] = color[0];
    colors[i * 3 + 1] = color[1];
    colors[i * 3 + 2] = color[2];
    dummy.position.set(spec.x, spec.y, spec.z);
    dummy.scale.set(spec.sx, spec.sy, spec.sz);
    dummy.updateMatrix();
    mesh.setMatrixAt(i, dummy.matrix);
  }
  geometry.setAttribute('aOwnerId', new THREE.InstancedBufferAttribute(ownerIds, 1));
  geometry.setAttribute('aCrownColor', new THREE.InstancedBufferAttribute(colors, 3));
  mesh.instanceMatrix.needsUpdate = true;
  mesh.frustumCulled = false;
  group.add(mesh);
  disposables.push(geometry);
  if (!disposables.includes(material)) disposables.push(material);
  maskUpdaters.push((mask) => updateMatrices(mesh, specs, mask));
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
        attribute vec3 aCrownColor;
        varying float vOwnerId;
        varying vec3 vCrownColor;
        varying vec3 vCrownWorld;
        varying vec3 vCrownLocal;
        varying vec3 vCrownNormal;`)
      .replace('#include <fog_vertex>', `
        vOwnerId = aOwnerId;
        vCrownColor = aCrownColor;
        vCrownLocal = position;
        vCrownWorld = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;
        vCrownNormal = normalize(mat3(modelMatrix) * mat3(instanceMatrix) * objectNormal);
        #include <fog_vertex>`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        varying float vOwnerId;
        varying vec3 vCrownColor;
        varying vec3 vCrownWorld;
        varying vec3 vCrownLocal;
        varying vec3 vCrownNormal;
        uniform float uCrownTime;
        uniform float uCrownHover;
        uniform float uCrownSelected;
        float crownHash(float n) { return fract(sin(n) * 43758.5453); }`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        {
          vec3 crownN = normalize(vCrownNormal);
          float sideMask = 1.0 - step(0.5, abs(crownN.y));
          float horizontal = mix(vCrownWorld.x, vCrownWorld.z, abs(crownN.x));
          float yCell = floor(vCrownWorld.y / 0.55);
          float yFrac = fract(vCrownWorld.y / 0.55);
          float hCell = floor(horizontal / 0.66);
          float hFrac = fract(horizontal / 0.66);
          float yShape = smoothstep(0.16, 0.30, yFrac) * (1.0 - smoothstep(0.60, 0.76, yFrac));
          float hShape = smoothstep(0.16, 0.30, hFrac) * (1.0 - smoothstep(0.68, 0.82, hFrac));
          float lit = step(0.44, crownHash(yCell * 7.31 + hCell * 11.13 + vOwnerId * 0.37));
          float windows = yShape * hShape * sideMask * lit;
          float rim = smoothstep(0.435, 0.5, vCrownLocal.y) * sideMask;
          float activeBoost = step(abs(vOwnerId - uCrownHover), 0.5) * 0.25 + step(abs(vOwnerId - uCrownSelected), 0.5) * 0.55;
          float pulse = 0.92 + sin(uCrownTime * 4.0 + vOwnerId * 0.23) * 0.08;
          totalEmissiveRadiance += vCrownColor * (windows * 1.9 + rim * 0.7) * (1.0 + activeBoost) * pulse;
        }`);
  };
  material.customProgramCacheKey = () => 'repocity-crowns-v1';
  return material;
}

function addSpires(
  group: THREE.Group,
  specs: InstanceSpec[],
  material: THREE.MeshStandardMaterial,
  disposables: { dispose(): void }[],
  maskUpdaters: ((mask: Uint8Array) => void)[],
): void {
  if (specs.length === 0) return;
  const geometry = new THREE.CylinderGeometry(0.5, 0.9, 1, 6);
  geometry.translate(0, 0.5, 0);
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
  disposables.push(geometry);
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
): void {
  const color: [number, number, number] = [b.color[0] * 0.78, b.color[1] * 0.78, b.color[2] * 0.78];
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
    vertexColors: true,
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
  disposables.push(geometry, material);
  maskUpdaters.push((mask) => updateMatrices(mesh, specs, mask));
}

function updateMatrices(mesh: THREE.InstancedMesh, specs: InstanceSpec[], mask: Uint8Array): void {
  const dummy = new THREE.Object3D();
  for (let i = 0; i < specs.length; i++) {
    const spec = specs[i];
    dummy.position.set(spec.x, spec.y, spec.z);
    dummy.scale.set(spec.sx, mask[spec.ownerId] === 1 ? spec.sy : 0, spec.sz);
    dummy.updateMatrix();
    mesh.setMatrixAt(i, dummy.matrix);
  }
  mesh.instanceMatrix.needsUpdate = true;
}

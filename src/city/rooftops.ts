/**
 * rooftops.ts — antenna pylons + blinking beacon lights.
 *
 * Pylons: static dark cylinders on tall roofs (silhouette detail).
 * Beacons: small spheres whose color pulses via per-frame JS updates
 * of instanceColor — zero custom shaders, guaranteed to work.
 */

import * as THREE from 'three';
import type { Building } from './city';
import { signHash } from './city';
import { makeRadialGlow } from '../effects/textures';

export interface Rooftops {
  group: THREE.Group;
  setMatchMask(mask: Uint8Array): void;
  update(dt: number): void;
  dispose(): void;
}

interface BeaconSpec {
  ownerId: number;
  x: number; y: number; z: number;
  base: THREE.Color;
  rate: number;
  phase: number;
}

export function buildRooftops(buildings: Building[], _maxHeight: number): Rooftops {
  const group = new THREE.Group();
  const disposables: { dispose(): void }[] = [];

  const specs: BeaconSpec[] = [];
  const pylons: { ownerId: number; x: number; y: number; z: number; h: number; scale: number }[] = [];
  const antennaCount = Math.min(48, Math.max(6, Math.ceil(buildings.length * 0.08)), buildings.length);
  const antennaOwners = [...Array(buildings.length).keys()]
    .sort((a, b) => buildings[b].totalHeight - buildings[a].totalHeight || (buildings[a].path < buildings[b].path ? -1 : 1))
    .slice(0, antennaCount);

  for (const i of antennaOwners) {
    const b = buildings[i];

    const ox = (signHash(i * 41 + 9) - 0.5) * b.scale[0] * 0.4;
    const oz = (signHash(i * 47 + 17) - 0.5) * b.scale[2] * 0.4;
    const roofY = b.position[1] - b.scale[1] / 2 + b.totalHeight;
    const pylonH = 1.2 + signHash(i * 19 + 11) * 3.4;

    const roofScale = Math.min(1, b.parcel[0] * 0.90 / 0.16, b.parcel[1] * 0.90 / 0.16);
    const roofRadius = 0.08 * roofScale;
    const x = Math.max(b.position[0] - b.parcel[0] * 0.49 + roofRadius, Math.min(b.position[0] + b.parcel[0] * 0.49 - roofRadius, b.position[0] + ox));
    const z = Math.max(b.position[2] - b.parcel[1] * 0.49 + roofRadius, Math.min(b.position[2] + b.parcel[1] * 0.49 - roofRadius, b.position[2] + oz));

    pylons.push({ ownerId: i, x, y: roofY, z, h: pylonH, scale: roofScale });

    {
      const c = new THREE.Color().setRGB(b.color[0] * 1.5, b.color[1] * 1.5, b.color[2] * 1.5);
      specs.push({
        ownerId: i,
        x,
        y: roofY + pylonH + 0.15,
        z,
        base: c,
        rate: 0.22 + signHash(i * 37 + 3) * 0.16,
        phase: signHash(i * 53 + 29) * Math.PI * 2,
      });
    }
  }

  /* ---- pylon mesh (static) ---- */
  let pylonMesh: THREE.InstancedMesh | null = null;
  if (pylons.length > 0) {
    const pyGeo = new THREE.CylinderGeometry(0.03, 0.08, 1, 5);
    pyGeo.translate(0, 0.5, 0);
    const pyMat = new THREE.MeshStandardMaterial({
      color: 0x0a0a16, roughness: 0.5, metalness: 0.7,
    });
    pylonMesh = new THREE.InstancedMesh(pyGeo, pyMat, pylons.length);
    pylonMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    const d = new THREE.Object3D();
    for (let i = 0; i < pylons.length; i++) {
      const p = pylons[i];
      d.position.set(p.x, p.y, p.z);
      d.scale.set(p.scale, p.h, p.scale);
      d.updateMatrix();
      pylonMesh.setMatrixAt(i, d.matrix);
    }
    pylonMesh.instanceMatrix.needsUpdate = true;
    pylonMesh.frustumCulled = false;
    group.add(pylonMesh);
    disposables.push(pylonMesh, pyGeo, pyMat);
  }

  /* ---- fixed-screen beacon cores and halos ---- */
  let beaconPosition: THREE.BufferAttribute | null = null;
  let beaconColor: THREE.BufferAttribute | null = null;
  if (specs.length > 0) {
    const positions = new Float32Array(specs.length * 3);
    const colors = new Float32Array(specs.length * 3);
    for (let i = 0; i < specs.length; i++) {
      const spec = specs[i];
      positions[i * 3] = spec.x;
      positions[i * 3 + 1] = spec.y;
      positions[i * 3 + 2] = spec.z;
      colors[i * 3] = spec.base.r * 0.05;
      colors[i * 3 + 1] = spec.base.g * 0.05;
      colors[i * 3 + 2] = spec.base.b * 0.05;
    }
    const geometry = new THREE.BufferGeometry();
    beaconPosition = new THREE.BufferAttribute(positions, 3);
    beaconPosition.setUsage(THREE.DynamicDrawUsage);
    beaconColor = new THREE.BufferAttribute(colors, 3);
    beaconColor.setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute('position', beaconPosition);
    geometry.setAttribute('color', beaconColor);
    const texture = makeRadialGlow(64);
    const coreMaterial = new THREE.PointsMaterial({
      map: texture, size: 8, sizeAttenuation: false, transparent: true, depthWrite: false,
      blending: THREE.AdditiveBlending, fog: true,
      vertexColors: true,
      toneMapped: false,
    });
    const haloMaterial = coreMaterial.clone();
    haloMaterial.size = 20;
    haloMaterial.opacity = 0.24;
    const halo = new THREE.Points(geometry, haloMaterial);
    const core = new THREE.Points(geometry, coreMaterial);
    halo.frustumCulled = false;
    core.frustumCulled = false;
    halo.renderOrder = 2;
    core.renderOrder = 3;
    group.add(halo, core);
    disposables.push(geometry, texture, coreMaterial, haloMaterial);
  }

  /* ---- blink driver ---- */
  let t = 0;
  let colorAccumulator = 0;
  const update = (dt: number) => {
    if (!beaconColor) return;
    t += dt;
    colorAccumulator += dt;
    if (colorAccumulator < 1 / 30) return;
    colorAccumulator %= 1 / 30;
    const colors = beaconColor.array as Float32Array;
    for (let i = 0; i < specs.length; i++) {
      const s = specs[i];
      // A slow eased pulse reads as an aviation beacon without dominating roofs.
      const cyc = (t * s.rate + s.phase) % 1.0;
      const pulse = cyc < 0.18 ? Math.sin(Math.PI * cyc / 0.18) ** 2 : 0;
      const k = 0.05 + pulse * 0.85;
      colors[i * 3] = s.base.r * k;
      colors[i * 3 + 1] = s.base.g * k;
      colors[i * 3 + 2] = s.base.b * k;
    }
    beaconColor.needsUpdate = true;
  };

  return {
    group,
    setMatchMask(mask) {
      const d = new THREE.Object3D();
      if (pylonMesh) {
        for (let i = 0; i < pylons.length; i++) {
          const p = pylons[i];
          const visible = mask[p.ownerId] === 1 ? 1 : 0;
          d.position.set(p.x, p.y, p.z);
          d.scale.set(p.scale * visible, p.h * visible, p.scale * visible);
          d.updateMatrix();
          pylonMesh.setMatrixAt(i, d.matrix);
        }
        pylonMesh.instanceMatrix.needsUpdate = true;
      }
      if (beaconPosition) {
        const positions = beaconPosition.array as Float32Array;
        for (let i = 0; i < specs.length; i++) {
          const s = specs[i];
          const visible = mask[s.ownerId] === 1;
          positions[i * 3] = s.x;
          positions[i * 3 + 1] = visible ? s.y : -10_000;
          positions[i * 3 + 2] = s.z;
        }
        beaconPosition.needsUpdate = true;
      }
    },
    update,
    dispose() { for (const x of disposables) x.dispose(); },
  };
}

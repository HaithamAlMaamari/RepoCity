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

export function buildRooftops(buildings: Building[], maxHeight: number): Rooftops {
  const group = new THREE.Group();
  const disposables: { dispose(): void }[] = [];

  /* ---- pick tall buildings ---- */
  const tallThreshold = maxHeight * 0.30;
  const specs: BeaconSpec[] = [];
  const pylons: { ownerId: number; x: number; y: number; z: number; h: number }[] = [];

  for (let i = 0; i < buildings.length; i++) {
    const b = buildings[i];
    if (b.totalHeight < tallThreshold) continue;
    const roll = signHash(i * 13 + 7);
    if (roll > 0.55) continue; // ~55% of tall buildings

    const ox = (signHash(i * 41 + 9) - 0.5) * b.scale[0] * 0.4;
    const oz = (signHash(i * 47 + 17) - 0.5) * b.scale[2] * 0.4;
    const roofY = b.position[1] - b.scale[1] / 2 + b.totalHeight;
    const pylonH = 1.2 + signHash(i * 19 + 11) * 3.4;

    pylons.push({ ownerId: i, x: b.position[0] + ox, y: roofY, z: b.position[2] + oz, h: pylonH });

    // ~80% of pylons get a blinking beacon
    if (signHash(i * 29 + 5) > 0.2) {
      const c = new THREE.Color();
      const hue = signHash(i * 31 + 23);
      if (hue < 0.45) c.setRGB(1.0, 0.15, 0.45);       // magenta-red
      else if (hue < 0.85) c.setRGB(0.1, 0.85, 1.1);   // cyan
      else c.setRGB(1.0, 0.65, 0.2);                    // amber
      specs.push({
        ownerId: i,
        x: b.position[0] + ox,
        y: roofY + pylonH + 0.15,
        z: b.position[2] + oz,
        base: c,
        rate: 0.5 + signHash(i * 37 + 3) * 1.4,
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
      d.scale.set(1, p.h, 1);
      d.updateMatrix();
      pylonMesh.setMatrixAt(i, d.matrix);
    }
    pylonMesh.instanceMatrix.needsUpdate = true;
    pylonMesh.frustumCulled = false;
    group.add(pylonMesh);
    disposables.push(pyGeo, pyMat);
  }

  /* ---- beacon mesh (blinking) ---- */
  let beaconMesh: THREE.InstancedMesh | null = null;
  if (specs.length > 0) {
    const bGeo = new THREE.SphereGeometry(0.22, 8, 6);
    const bMat = new THREE.MeshBasicMaterial({
      transparent: true, depthWrite: false,
      blending: THREE.AdditiveBlending, fog: true,
      vertexColors: true,
    });
    beaconMesh = new THREE.InstancedMesh(bGeo, bMat, specs.length);
    beaconMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    const d = new THREE.Object3D();
    const c = new THREE.Color();
    for (let i = 0; i < specs.length; i++) {
      const s = specs[i];
      d.position.set(s.x, s.y, s.z);
      d.updateMatrix();
      beaconMesh.setMatrixAt(i, d.matrix);
      beaconMesh.setColorAt(i, c.copy(s.base));
    }
    beaconMesh.instanceMatrix.needsUpdate = true;
    if (beaconMesh.instanceColor) beaconMesh.instanceColor.needsUpdate = true;
    beaconMesh.frustumCulled = false;
    beaconMesh.renderOrder = 2;
    group.add(beaconMesh);
    disposables.push(bGeo, bMat);
  }

  /* ---- blink driver ---- */
  let t = 0;
  const tmp = new THREE.Color();
  const update = (dt: number) => {
    if (!beaconMesh) return;
    t += dt;
    for (let i = 0; i < specs.length; i++) {
      const s = specs[i];
      // double-flash pattern: sharp on, quick off
      const cyc = (t * s.rate + s.phase) % 1.0;
      const flash1 = cyc < 0.08 ? 1 : 0;
      const flash2 = cyc > 0.16 && cyc < 0.22 ? 1 : 0;
      const k = 0.02 + (flash1 + flash2) * 0.85;
      tmp.copy(s.base).multiplyScalar(k);
      beaconMesh.setColorAt(i, tmp);
    }
    if (beaconMesh.instanceColor) beaconMesh.instanceColor.needsUpdate = true;
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
          d.scale.set(visible, p.h * visible, visible);
          d.updateMatrix();
          pylonMesh.setMatrixAt(i, d.matrix);
        }
        pylonMesh.instanceMatrix.needsUpdate = true;
      }
      if (beaconMesh) {
        for (let i = 0; i < specs.length; i++) {
          const s = specs[i];
          d.position.set(s.x, s.y, s.z);
          d.scale.setScalar(mask[s.ownerId] === 1 ? 1 : 0);
          d.updateMatrix();
          beaconMesh.setMatrixAt(i, d.matrix);
        }
        beaconMesh.instanceMatrix.needsUpdate = true;
      }
    },
    update,
    dispose() { for (const x of disposables) x.dispose(); },
  };
}

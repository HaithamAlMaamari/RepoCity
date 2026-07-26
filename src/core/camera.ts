/**
 * camera.ts v3.0
 */

import * as THREE from 'three';

export interface FlythroughOptions {
  duration?: number;
  targetY?: number;
  targetDist?: number;
}

export interface Flythrough {
  update(deltaTime: number): boolean;
  skip(): void;
  getOrbitTarget(): THREE.Vector3;
}

function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

export function createFlythrough(
  camera: THREE.PerspectiveCamera,
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number },
  options?: FlythroughOptions,
): Flythrough {
  const duration = Math.max(0.5, options?.duration ?? 5.0);
  const targetY = Math.max(0, options?.targetY ?? 60);
  const targetDist = options?.targetDist ?? 110;
  const cx = (bounds.minX + bounds.maxX) / 2;
  const cz = (bounds.minZ + bounds.maxZ) / 2;
  const span = Math.max(bounds.maxX - bounds.minX, bounds.maxZ - bounds.minZ);

  const p0 = new THREE.Vector3(cx + span * 1.4, span * 2.2, cz + span * 1.4);
  const p1 = new THREE.Vector3(cx + span * 0.9, span * 0.20, cz - span * 0.9);
  const p2 = new THREE.Vector3(cx + targetDist * 0.55, targetY, cz + targetDist * 0.85);
  const path = new THREE.CatmullRomCurve3([p0, p1, p2], false, 'catmullrom', 0.4);

  const t0 = new THREE.Vector3(cx, 4, cz);
  const t1 = new THREE.Vector3(cx, span * 0.05, cz);
  const orbitTarget = t1.clone();
  const currentTarget = t0.clone();

  camera.position.copy(p0);
  camera.lookAt(currentTarget);

  let elapsed = 0;
  let active = true;

  return {
    update(dt: number): boolean {
      if (!active) return false;
      elapsed += dt;
      const raw = Math.min(elapsed / duration, 1);
      const k = easeInOutCubic(raw);
      path.getPoint(k, camera.position);
      currentTarget.lerpVectors(t0, t1, k);
      camera.lookAt(currentTarget);
      if (raw >= 1) { active = false; return false; }
      return true;
    },
    skip(): void {
      active = false;
      camera.position.copy(p2);
      currentTarget.copy(t1);
      camera.lookAt(currentTarget);
    },
    getOrbitTarget(): THREE.Vector3 {
      return orbitTarget.clone();
    },
  };
}

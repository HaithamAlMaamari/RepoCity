/**
 * camera.ts v3.0
 */

import * as THREE from 'three';

export interface FlythroughOptions {
  duration?: number;
  targetY?: number;
  targetDist?: number;
  targetFocusY?: number;
}

export interface Flythrough {
  update(deltaTime: number): boolean;
  skip(): void;
  getOrbitTarget(): THREE.Vector3;
}

export function repositoryView(span: number, maxHeight: number, aspect = 16 / 9): Pick<FlythroughOptions, 'targetY' | 'targetDist' | 'targetFocusY'> {
  const widthScale = Math.max(1.55, 1.65 / Math.max(0.4, aspect));
  return {
    targetY: Math.max(30, maxHeight * 0.9),
    targetDist: Math.max(52, span * widthScale, maxHeight * 1.75),
    targetFocusY: Math.max(4, maxHeight * 0.58),
  };
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
  const targetFocusY = Math.max(0, options?.targetFocusY ?? 4);
  const cx = (bounds.minX + bounds.maxX) / 2;
  const cz = (bounds.minZ + bounds.maxZ) / 2;
  const orbitTarget = new THREE.Vector3(cx, targetFocusY, cz);
  const p0 = new THREE.Vector3(cx + targetDist * 0.85, targetY * 1.35, cz + targetDist * 1.32);
  const p1 = new THREE.Vector3(cx + targetDist * 0.68, targetY * 1.15, cz + targetDist * 1.05);
  const p2 = new THREE.Vector3(cx + targetDist * 0.55, targetY, cz + targetDist * 0.85);
  const path = new THREE.CatmullRomCurve3([p0, p1, p2], false, 'catmullrom', 0.4);

  camera.position.copy(p0);
  camera.lookAt(orbitTarget);

  let elapsed = 0;
  let active = true;

  return {
    update(dt: number): boolean {
      if (!active) return false;
      elapsed += dt;
      const raw = Math.min(elapsed / duration, 1);
      const k = easeInOutCubic(raw);
      path.getPoint(k, camera.position);
      camera.lookAt(orbitTarget);
      if (raw >= 1) { active = false; return false; }
      return true;
    },
    skip(): void {
      active = false;
      camera.position.copy(p2);
      camera.lookAt(orbitTarget);
    },
    getOrbitTarget(): THREE.Vector3 {
      return orbitTarget.clone();
    },
  };
}

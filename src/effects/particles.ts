/**
 * particles.ts — rising neon embers + drifting motes.
 * Points + glow texture; JS-animated positions.
 */

import * as THREE from 'three';
import { makeRadialGlow } from './textures';

export interface Particles {
  points: THREE.Points;
  update(dt: number): void;
  dispose(): void;
}

export function buildEmbers(citySize: number, count = 250): Particles {
  const range = citySize * 0.7;
  const pos = new Float32Array(count * 3);
  const col = new Float32Array(count * 3);
  const speed = new Float32Array(count);

  for (let i = 0; i < count; i++) {
    pos[i * 3] = (Math.random() - 0.5) * range * 2;
    pos[i * 3 + 1] = Math.random() * 70;
    pos[i * 3 + 2] = (Math.random() - 0.5) * range * 2;
    speed[i] = 0.8 + Math.random() * 2.0;
    const magenta = Math.random() < 0.35;
    if (magenta) { col[i * 3] = 0.9; col[i * 3 + 1] = 0.25; col[i * 3 + 2] = 0.6; }
    else { col[i * 3] = 0.25; col[i * 3 + 1] = 0.65; col[i * 3 + 2] = 0.95; }
  }

  const geo = new THREE.BufferGeometry();
  const positionAttribute = new THREE.BufferAttribute(pos, 3);
  positionAttribute.setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute('position', positionAttribute);
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));

  const tex = makeRadialGlow(32);
  const mat = new THREE.PointsMaterial({
    size: 1.1, map: tex, vertexColors: true,
    transparent: true, opacity: 0.24, depthWrite: false,
    blending: THREE.AdditiveBlending, sizeAttenuation: true, fog: true,
  });

  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false;

  const update = (dt: number) => {
    const arr = geo.attributes.position.array as Float32Array;
    for (let i = 0; i < count; i++) {
      arr[i * 3 + 1] += speed[i] * dt;
      if (arr[i * 3 + 1] > 70) arr[i * 3 + 1] = 0;
    }
    geo.attributes.position.needsUpdate = true;
  };

  return {
    points, update,
    dispose() { geo.dispose(); mat.dispose(); tex.dispose(); },
  };
}

/**
 * District billboards.
 *
 * Signs are attached to a folder block, not scattered around the scene.
 * They sit outside the block perimeter, above its tallest building, and
 * use the block's dominant language as their visual identity.
 */

import * as THREE from 'three';
import type { DistrictRect } from '../types';
import { makeNeonSign } from './textures';
import { languageColor, languageDisplayName } from '../city/palette';

export interface BillboardBlock {
  rect: DistrictRect;
  name: string;
  language: string;
  height: number;
}

export interface Billboards {
  group: THREE.Group;
  update(dt: number): void;
  dispose(): void;
}

function cssColor([r, g, b]: readonly [number, number, number]): string {
  const f = (v: number) => Math.round(Math.min(1, Math.max(0, v)) * 255);
  return `rgb(${f(r)},${f(g)},${f(b)})`;
}

export function buildBillboards(blocks: BillboardBlock[]): Billboards {
  const group = new THREE.Group();
  const disposables: { dispose(): void }[] = [];
  const flickers: { mat: THREE.MeshBasicMaterial; phase: number; rate: number }[] = [];

  const visibleBlocks = blocks.slice(0, 12);
  for (let i = 0; i < visibleBlocks.length; i++) {
    const block = visibleBlocks[i];
    const rect = block.rect;
    const color = languageColor(block.language);
    const label = `${block.name}  ·  ${languageDisplayName(block.language)}`;
    const tex = makeNeonSign(label, cssColor(color));
    const width = Math.min(12, Math.max(5, Math.max(rect.w, rect.d) * 0.55));
    const height = width * 0.3125;
    const geo = new THREE.PlaneGeometry(width, height);
    const mat = new THREE.MeshBasicMaterial({
      map: tex,
      transparent: true,
      opacity: 0.52,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
      fog: true,
    });
    const mesh = new THREE.Mesh(geo, mat);

    // Rotate through perimeter sides. The sign is always outside the block,
    // so it cannot be embedded in one of its buildings.
    const clearance = Math.max(2.5, Math.min(rect.w, rect.d) * 0.14);
    const side = i % 4;
    if (side === 0) {
      mesh.position.set(rect.x + rect.w / 2, Math.max(8, block.height + 4), rect.z - clearance);
      mesh.rotation.y = 0;
    } else if (side === 1) {
      mesh.position.set(rect.x + rect.w / 2, Math.max(8, block.height + 4), rect.z + rect.d + clearance);
      mesh.rotation.y = Math.PI;
    } else if (side === 2) {
      mesh.position.set(rect.x - clearance, Math.max(8, block.height + 4), rect.z + rect.d / 2);
      mesh.rotation.y = Math.PI / 2;
    } else {
      mesh.position.set(rect.x + rect.w + clearance, Math.max(8, block.height + 4), rect.z + rect.d / 2);
      mesh.rotation.y = -Math.PI / 2;
    }
    mesh.frustumCulled = false;
    mesh.renderOrder = 3;
    group.add(mesh);
    disposables.push(tex, geo, mat);

    if (i % 3 === 0) {
      flickers.push({ mat, phase: i * 1.73, rate: 5 + (i % 4) * 1.7 });
    }
  }

  let t = 0;
  const update = (dt: number) => {
    t += dt;
    for (const f of flickers) {
      const pulse = Math.sin(t * f.rate + f.phase) * Math.sin(t * f.rate * 1.7 + f.phase * 2);
      f.mat.opacity = pulse > -0.86 ? 0.52 : 0.14;
    }
  };

  return {
    group,
    update,
    dispose() { for (const item of disposables) item.dispose(); },
  };
}

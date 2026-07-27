/**
 * districts.ts — derive top-level folder rectangles from layout cells.
 */

import type { LayoutCell } from './layout';
import type { DistrictRect } from '../types';

export function buildDistrictRects(cells: LayoutCell[]): DistrictRect[] {
  const bounds = new Map<string, { minX: number; minZ: number; maxX: number; maxZ: number }>();
  for (const c of cells) {
    const seg = c.node.path.split('/')[0];
    if (!seg || c.node.path === seg) continue;
    const r = c.rect;
    const cur = bounds.get(seg);
    if (cur) {
      cur.minX = Math.min(cur.minX, r.x);
      cur.minZ = Math.min(cur.minZ, r.y);
      cur.maxX = Math.max(cur.maxX, r.x + r.w);
      cur.maxZ = Math.max(cur.maxZ, r.y + r.h);
    } else {
      bounds.set(seg, { minX: r.x, minZ: r.y, maxX: r.x + r.w, maxZ: r.y + r.h });
    }
  }
  const rects: DistrictRect[] = [];
  for (const [name, b] of bounds.entries()) {
    rects.push({ x: b.minX, z: b.minZ, w: b.maxX - b.minX, d: b.maxZ - b.minZ, depth: 1, name });
  }
  return rects;
}

export function districtFootprint(
  districts: DistrictRect[],
  fallback: { minX: number; maxX: number; minZ: number; maxZ: number },
): { minX: number; maxX: number; minZ: number; maxZ: number } {
  let { minX, maxX, minZ, maxZ } = fallback;
  for (const d of districts) {
    minX = Math.min(minX, d.x);
    maxX = Math.max(maxX, d.x + d.w);
    minZ = Math.min(minZ, d.z);
    maxZ = Math.max(maxZ, d.z + d.d);
  }
  return { minX: minX - 2, maxX: maxX + 2, minZ: minZ - 2, maxZ: maxZ + 2 };
}

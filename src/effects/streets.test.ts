import { describe, expect, it } from 'vitest';
import type { StreetSegment } from '../types';
import { planStreets } from './streets';
import { buildLayout } from '../city/layout';
import { generateRepoTree } from '../city/testing/repo-tree';
import { allocateTrafficRoutes, routeWeight } from './traffic';

describe('reserved street network', () => {
  /*
   * Streets used to be inferred after the fact, from whatever gaps happened to
   * survive the treemap and a clip against every plot. Measured on generated
   * cities of 13 to 5,000 files, that produced ONE to THREE interior streets —
   * the visible network was the perimeter ring, which is why traffic drove
   * around the city instead of through it. The layout now reserves the road
   * before it allocates the plots, so the network cannot be squeezed out.
   */
  function cityCorridors(files: number) {
    return buildLayout(generateRepoTree({ files, seed: 1 }), {
      width: 236, height: 236,
    });
  }

  it('reserves interior streets at every repository size', () => {
    for (const files of [120, 1000, 5000]) {
      const streets = planStreets(cityCorridors(files).corridors);
      expect(streets.length).toBeGreaterThan(20);
    }
  });

  it('never lets a street cross a plot', () => {
    const { cells, corridors } = cityCorridors(600);
    const streets = planStreets(corridors);
    const worst: string[] = [];
    for (const street of streets) {
      const roadMinX = street.axis === 'x' ? street.x1 : street.x1 - street.width / 2;
      const roadMaxX = street.axis === 'x' ? street.x2 : street.x1 + street.width / 2;
      const roadMinZ = street.axis === 'x' ? street.z1 - street.width / 2 : street.z1;
      const roadMaxZ = street.axis === 'x' ? street.z1 + street.width / 2 : street.z2;
      for (const cell of cells) {
        const overlapX = Math.min(roadMaxX, cell.rect.x + cell.rect.w) - Math.max(roadMinX, cell.rect.x);
        const overlapZ = Math.min(roadMaxZ, cell.rect.y + cell.rect.h) - Math.max(roadMinZ, cell.rect.y);
        // Reserved before allocation, so overlap is impossible by construction.
        // Collected rather than asserted per pair: 600 cells x every street is
        // far too many assertions to run one at a time.
        if (Math.min(overlapX, overlapZ) > 1e-6) worst.push(cell.node.path);
      }
    }
    expect(worst).toEqual([]);
  });

  it('joins the abutting rings of two neighbouring directories into one street', () => {
    // Two rings sharing a line: one continuous road, not two half-roads.
    const streets = planStreets([
      { x: 0, z: 10, w: 20, d: 2, depth: 1, axis: 'x' },
      { x: 20, z: 10, w: 15, d: 2, depth: 1, axis: 'x' },
    ]);
    expect(streets).toHaveLength(1);
    expect(streets[0].x1).toBe(0);
    expect(streets[0].x2).toBe(35);
  });

  it('gives shallower directories the wider roads', () => {
    const { corridors } = cityCorridors(2000);
    const widthAt = (depth: number): number => {
      const at = corridors.filter((c) => c.depth === depth);
      return at.reduce((sum, c) => sum + Math.min(c.w, c.d), 0) / Math.max(1, at.length);
    };
    expect(widthAt(0)).toBeGreaterThan(widthAt(2));
    expect(widthAt(1)).toBeGreaterThan(widthAt(3));
  });
});

describe('street plot clearance', () => {
  it('biases traffic toward internal roads instead of the perimeter ring', () => {
    const base = { x1: 0, z1: 0, x2: 100, z2: 0, width: 2, axis: 'x' as const };
    expect(routeWeight({ ...base, kind: 'internal' })).toBe(76.5);
    expect(routeWeight({ ...base, kind: 'perimeter' })).toBeCloseTo(10);
  });

  it('gives a representative network more aggregate internal than perimeter weight', () => {
    const perimeter: StreetSegment[] = Array.from({ length: 4 }, (_, index) => ({
      x1: 0, z1: index, x2: 100, z2: index, width: 2, axis: 'x', kind: 'perimeter',
    }));
    const internal: StreetSegment[] = [60, 30, 20, 10].map((length, index) => ({
      x1: 0, z1: index + 10, x2: length, z2: index + 10, width: 2, axis: 'x', kind: 'internal',
    }));
    expect(internal.reduce((sum, street) => sum + routeWeight(street), 0))
      .toBeGreaterThan(perimeter.reduce((sum, street) => sum + routeWeight(street), 0));

    const allocated = allocateTrafficRoutes([...perimeter, ...internal], 60);
    const internalAllocations = internal.map((street) => allocated.filter((route) => route === street).length);
    const internalCount = internalAllocations.reduce((sum, cars) => sum + cars, 0);
    const internalCap = Math.max(1, Math.min(Math.floor(internalCount / 2), Math.ceil(2 * internalCount / internal.length)));
    expect(internalAllocations.every((cars) => cars >= 1)).toBe(true);
    expect(Math.max(...internalAllocations)).toBeLessThanOrEqual(internalCap);
  });

});

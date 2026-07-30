import { describe, expect, it } from 'vitest';
import type { DistrictRect, PlotRect, StreetSegment } from '../types';
import { buildDistrictCorridors, clipStreetsToPlots } from './streets';
import { allocateTrafficRoutes, routeWeight } from './traffic';

describe('street plot clearance', () => {
  it('splits roads around occupied file plots on both axes', () => {
    const streets: StreetSegment[] = [
      { x1: 0, z1: 5, x2: 20, z2: 5, width: 2, axis: 'x' },
      { x1: 5, z1: 0, x2: 5, z2: 20, width: 2, axis: 'z' },
    ];
    const plots: PlotRect[] = [
      { x: 4, z: 4, w: 4, d: 4 },
      { x: 12, z: 4, w: 2, d: 4 },
    ];

    expect(clipStreetsToPlots(streets, plots)).toEqual([
      { ...streets[0], x1: 0, x2: 4 },
      { ...streets[0], x1: 8, x2: 12 },
      { ...streets[0], x1: 14, x2: 20 },
      { ...streets[1], z1: 0, z2: 4 },
      { ...streets[1], z1: 8, z2: 20 },
    ]);
  });

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

  it('creates roads in clear gaps between adjacent districts', () => {
    const districts: DistrictRect[] = [
      { x: 0, z: 0, w: 10, d: 10, depth: 1, name: 'a' },
      { x: 0, z: 12, w: 10, d: 10, depth: 1, name: 'b' },
      { x: 13, z: 0, w: 10, d: 10, depth: 1, name: 'c' },
    ];
    expect(buildDistrictCorridors(districts)).toEqual([
      { x1: 11.5, z1: 0, x2: 11.5, z2: 10, width: 3, axis: 'z' },
      { x1: 0, z1: 11, x2: 10, z2: 11, width: 2, axis: 'x' },
    ]);
  });
});

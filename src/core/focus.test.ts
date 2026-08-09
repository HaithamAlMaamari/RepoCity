import { describe, expect, it } from 'vitest';
import { buildLayout, repositoryLandSize } from '../city/layout';
import { buildCity } from '../city/city';
import { generateRepoTree } from '../city/testing/repo-tree';
import { MAX_ELEVATION, focusCameraPosition } from './focus';

/**
 * An independent answer to "is this point inside a building", written out
 * rather than imported. The assertion it backs is that the search never
 * returns a buried viewpoint, and a check that shares the module's own
 * clearance model would agree with it by construction.
 */
function roofUnder(
  x: number, z: number,
  buildings: readonly { position: readonly number[]; scale: readonly number[]; totalHeight: number }[],
  offsetX = 0, offsetZ = 0,
): number {
  let roof = 0;
  for (const b of buildings) {
    if (Math.abs(x - (b.position[0] + offsetX)) > b.scale[0] / 2) continue;
    if (Math.abs(z - (b.position[2] + offsetZ)) > b.scale[2] / 2) continue;
    if (b.totalHeight > roof) roof = b.totalHeight;
  }
  return roof;
}

/**
 * Against a real city, because the defect this module exists to fix is a
 * property of dense packing. A fixture with two buildings in it has nothing
 * for a camera to reverse into, and would have passed the old code too.
 */
function realCity(files = 400, seed = 3) {
  const land = repositoryLandSize(files);
  const { cells } = buildLayout(generateRepoTree({ files, seed }), {
    width: land - 4 + 0.35, height: land - 4 + 0.35,
  });
  return buildCity(cells).buildings;
}

const buildings = realCity();

/** The framing the app asks for, reproduced so the test exercises real numbers. */
function framingFor(b: (typeof buildings)[number]) {
  return {
    target: [b.position[0], b.totalHeight * 0.45, b.position[2]] as [number, number, number],
    distance: Math.max(22, b.totalHeight * 2.4, Math.max(b.scale[0], b.scale[2]) * 5),
  };
}


describe('focusCameraPosition', () => {
  const directions: [number, number, number][] = [
    [1, 0.7, 1], [-1, 0.5, 0.2], [0.2, 0.1, -1], [-0.6, 0.9, -0.6], [1, 0.05, 0],
  ];

  it('never leaves the camera inside a building', () => {
    /*
     * The defect in one line. Before this module, selecting
     * src/city/typology.ts put the camera 1.85 units from an unrelated
     * building's core while correctly 68.5 units from its target — so the
     * screen showed a facade belonging to a file nobody had selected.
     */
    let buried = 0;
    for (const b of buildings) {
      const { target, distance } = framingFor(b);
      for (const dir of directions) {
        const { position: p } = focusCameraPosition(target, dir, distance, buildings);
        if (p[1] < roofUnder(p[0], p[2], buildings)) buried++;
      }
    }
    expect(buried).toBe(0);
  });

  it('finds open air for every building in a real city', () => {
    for (const b of buildings) {
      const { target, distance } = framingFor(b);
      expect(focusCameraPosition(target, [1, 0.7, 1], distance, buildings).clear).toBe(true);
    }
  });

  it('prefers angle over distance, and never over-widens', () => {
    /*
     * Measured on this city: about 16% of viewpoints cannot be cleared by
     * angle alone and have to pull back. That is not a shortfall in the
     * search — it is geometry. The framing distance for a small file is 22
     * units, and no elevation at 22 units clears a 40-unit neighbour, since
     * the highest the camera can get is 22 above the target. Widening is the
     * only remaining move, so the useful guarantees are that it stays a
     * minority and stays bounded.
     */
    const multiples: number[] = [];
    for (const b of buildings) {
      const { target, distance } = framingFor(b);
      for (const dir of directions) {
        const r = focusCameraPosition(target, dir, distance, buildings);
        expect(r.distance).toBeGreaterThanOrEqual(distance - 1e-6);
        multiples.push(r.distance / distance);
      }
    }
    const kept = multiples.filter((m) => m < 1 + 1e-6).length;
    expect(kept / multiples.length).toBeGreaterThan(0.75);
    expect(Math.max(...multiples)).toBeLessThanOrEqual(5);
  });

  it('places the camera exactly at the distance it reports', () => {
    for (const b of buildings.slice(0, 80)) {
      const { target, distance } = framingFor(b);
      for (const dir of directions) {
        const r = focusCameraPosition(target, dir, distance, buildings);
        const actual = Math.hypot(
          r.position[0] - target[0], r.position[1] - target[1], r.position[2] - target[2]);
        expect(actual).toBeCloseTo(r.distance, 6);
      }
    }
  });

  it('leaves an already-clear viewpoint exactly where it was', () => {
    // Open ground: nothing to clear, so the requested pose is returned as-is.
    const target: [number, number, number] = [0, 10, 0];
    const r = focusCameraPosition(target, [0, 0.2, 1], 40, []);
    expect(r.distance).toBe(40);
    expect(r.position[1]).toBeCloseTo(10 + 40 * (0.2 / Math.hypot(0, 0.2, 1)), 6);
  });

  it('keeps the compass bearing it was given', () => {
    const { target, distance } = framingFor(buildings[0]);
    for (const dir of directions) {
      const r = focusCameraPosition(target, dir, distance, buildings);
      const want = Math.atan2(dir[2], dir[0]);
      const got = Math.atan2(r.position[2] - target[2], r.position[0] - target[0]);
      expect(Math.abs(Math.atan2(Math.sin(want - got), Math.cos(want - got)))).toBeLessThan(1e-6);
    }
  });

  it('never tilts a normal shot past the cap', () => {
    // Only the overhead last resort is allowed to exceed it.
    for (const b of buildings.slice(0, 120)) {
      const { target, distance } = framingFor(b);
      for (const dir of directions) {
        const r = focusCameraPosition(target, dir, distance, buildings);
        const overhead = Math.hypot(r.position[0] - target[0], r.position[2] - target[2]) < 1e-9;
        if (overhead) continue;
        expect(Math.asin((r.position[1] - target[1]) / r.distance))
          .toBeLessThanOrEqual(MAX_ELEVATION + 1e-6);
      }
    }
  });

  it('finds a clear view even hemmed in by towers on all four sides', () => {
    /*
     * The target's own building is excluded as the thing being looked at, so
     * there is no arrangement of neighbours that can wall it in completely —
     * the column above it is always open. This pins that down, and with it
     * the guarantee that the search terminates rather than merely usually
     * succeeding.
     */
    const tower = (x: number, z: number) => ({
      position: [x, 0, z] as [number, number, number],
      scale: [10, 1, 10] as [number, number, number],
      totalHeight: 400,
    });
    const city = [
      { position: [0, 0, 0] as [number, number, number], scale: [6, 1, 6] as [number, number, number], totalHeight: 12 },
      tower(11, 0), tower(-11, 0), tower(0, 11), tower(0, -11),
    ];
    const r = focusCameraPosition([0, 5.4, 0], [1, 0.2, 1], 22, city);
    expect(r.clear).toBe(true);
    expect(r.position.every(Number.isFinite)).toBe(true);
  });

  it('survives a camera sitting exactly on its target', () => {
    const { target, distance } = framingFor(buildings[0]);
    const r = focusCameraPosition(target, [0, 0, 0], distance, buildings);
    expect(r.position.every(Number.isFinite)).toBe(true);
  });

  it('is deterministic', () => {
    const { target, distance } = framingFor(buildings[5]);
    expect(focusCameraPosition(target, [1, 0.7, 1], distance, buildings))
      .toEqual(focusCameraPosition(target, [1, 0.7, 1], distance, buildings));
  });

  it('respects the city offset when testing what is underneath', () => {
    const b = buildings[0];
    const { position } = focusCameraPosition(
      [b.position[0] + 100, b.totalHeight * 0.45, b.position[2] + 100],
      [1, 0.2, 1], 40, buildings, { offsetX: 100, offsetZ: 100 },
    );
    expect(position[1]).toBeGreaterThanOrEqual(
      roofUnder(position[0], position[2], buildings, 100, 100) - 1e-6,
    );
  });
});

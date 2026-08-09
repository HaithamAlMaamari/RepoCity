import { describe, expect, it } from 'vitest';
import { buildLayout, repositoryLandSize } from './layout';
import { buildCity } from './city';
import { planCap } from './architecture-details';
import { EDGE_COUNT, edgePositions, markerBox } from './selection-marker';
import { generateRepoTree } from './testing/repo-tree';

/**
 * Driven off real buildings rather than hand-written ones.
 *
 * The marker's whole job is to enclose what the renderer actually draws, and
 * the two ways to get that wrong — reading `scale[1]` instead of `totalHeight`,
 * and forgetting that `planCap` gives every profile a brim wider than its core
 * — are both invisible to a fixture that invents its own numbers.
 */
function realBuildings(files = 400, seed = 3) {
  const land = repositoryLandSize(files);
  const { cells } = buildLayout(generateRepoTree({ files, seed }), {
    width: land - 4 + 0.35, height: land - 4 + 0.35,
  });
  return buildCity(cells).buildings;
}

const buildings = realBuildings();

describe('markerBox', () => {
  it('encloses every piece the building actually renders', () => {
    for (const b of buildings) {
      const box = markerBox(b);
      const top = box.center[1] + box.size[1] / 2;
      // planCap owns the vertical extent; the marker must clear its apex.
      expect(top).toBeGreaterThanOrEqual(planCap(b).apex);
    }
  });

  it('clears the widest brim, which is wider than the core', () => {
    /*
     * The depot's brim is w * 1.06 — a box drawn on scale[0] alone would sit
     * inside the building it is meant to mark. This is the assertion that
     * fails if WIDTH_PAD is ever dropped back to 1.0.
     */
    const widest = 1.06;
    for (const b of buildings) {
      const box = markerBox(b);
      expect(box.size[0]).toBeGreaterThanOrEqual(b.scale[0] * widest);
      expect(box.size[2]).toBeGreaterThanOrEqual(b.scale[2] * widest);
    }
  });

  it('sits on the ground, not half-buried', () => {
    for (const b of buildings) {
      const box = markerBox(b);
      expect(box.center[1] - box.size[1] / 2).toBeCloseTo(0, 6);
    }
  });

  it('is centred on its building in plan', () => {
    for (const b of buildings) {
      const box = markerBox(b);
      expect(box.center[0]).toBeCloseTo(b.position[0], 6);
      expect(box.center[2]).toBeCloseTo(b.position[2], 6);
    }
  });
});

describe('edgePositions', () => {
  const box = markerBox(buildings[0]);
  const positions = edgePositions(box);
  const corner = (i: number): string => [0, 1, 2]
    .map((axis) => Math.round((positions[i + axis] - box.center[axis]) / (box.size[axis] / 2)))
    .join(',');

  it('emits every edge of the box', () => {
    expect(positions.length).toBe(EDGE_COUNT * 2 * 3);
  });

  it('puts every endpoint on a corner of the box', () => {
    /*
     * The failure this guards is an edge that stops short and leaves the
     * outline broken, which is what made the first attempt unreadable.
     */
    for (let i = 0; i < positions.length; i += 3) {
      expect(corner(i).split(',').every((c) => c === '1' || c === '-1')).toBe(true);
    }
  });

  it('visits all eight corners', () => {
    const seen = new Set<string>();
    for (let i = 0; i < positions.length; i += 3) seen.add(corner(i));
    expect(seen.size).toBe(8);
  });

  it('meets each corner exactly three times — one edge per axis', () => {
    const hits = new Map<string, number>();
    for (let i = 0; i < positions.length; i += 3) {
      const key = corner(i);
      hits.set(key, (hits.get(key) ?? 0) + 1);
    }
    for (const count of hits.values()) expect(count).toBe(3);
  });

  it('draws each segment along exactly one axis', () => {
    // A diagonal would mean two corners were paired that do not share an edge.
    for (let i = 0; i < positions.length; i += 6) {
      const differing = [0, 1, 2].filter((axis) =>
        Math.abs(positions[i + axis] - positions[i + 3 + axis]) > 1e-9);
      expect(differing).toHaveLength(1);
    }
  });

  it('is deterministic — the same building always marks the same way', () => {
    expect(Array.from(edgePositions(markerBox(buildings[0]))))
      .toEqual(Array.from(positions));
  });
});

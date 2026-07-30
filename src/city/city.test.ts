import { describe, expect, it } from 'vitest';
import type { LayoutCell } from './layout';
import { buildCity } from './city';

describe('repository-relative skyline', () => {
  it('creates deterministic landmark tiers and bounds wide cores', () => {
    const cells: LayoutCell[] = Array.from({ length: 20 }, (_, index) => ({
      node: {
        name: `${index}.ts`,
        path: `${String(index).padStart(2, '0')}.ts`,
        type: 'file',
        size: index + 1,
        language: 'typescript',
        children: [],
      },
      rect: { x: index * 21, y: 0, w: 20, h: 10, depth: 0 },
    }));

    const city = buildCity(cells);
    const heights = city.buildings.map((building) => building.totalHeight).sort((a, b) => a - b);
    expect(heights.slice(-3)).toEqual([48, 60, 72]);
    expect(city.buildings.filter((building) => building.profile === 'mega')).toHaveLength(3);
    expect(city.buildings.every((building) => Math.max(building.scale[0], building.scale[2]) <= 12)).toBe(true);
    city.dispose();
  });

  it('caps landmark density for large rendered sets', () => {
    const cells: LayoutCell[] = Array.from({ length: 400 }, (_, index) => ({
      node: { name: `${index}.ts`, path: `${index}.ts`, type: 'file', size: index + 1, language: 'typescript', children: [] },
      rect: { x: index, y: 0, w: 1, h: 1, depth: 0 },
    }));
    const city = buildCity(cells);
    expect(city.buildings.filter((building) => building.profile === 'mega')).toHaveLength(16);
    city.dispose();
  });
});

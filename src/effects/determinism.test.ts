import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { createSceneRandom } from '../core/random';
import type { StreetSegment } from '../types';
import { buildCity } from '../city/city';
import type { LayoutCell } from '../city/layout';
import { buildFlyingTraffic } from './flying-traffic';
import { buildEmbers } from './particles';
import { buildSky } from './sky';
import { buildTraffic } from './traffic';

vi.mock('./textures', async () => {
  const THREE = await import('three');
  return {
    makeRadialGlow: () => new THREE.Texture(),
  };
});

const REPOSITORY = 'octocat/Hello-World';
const COMMIT = 'a'.repeat(40);
const STREETS: StreetSegment[] = [
  { x1: -20, z1: 0, x2: 20, z2: 0, width: 3, axis: 'x' },
  { x1: 0, z1: -20, x2: 0, z2: 20, width: 3, axis: 'z' },
];

function random(seed: string, domain: string) {
  return createSceneRandom(REPOSITORY, COMMIT, seed, domain);
}

function attributeArray(points: THREE.Points, name: string): number[] {
  return Array.from((points.geometry.getAttribute(name) as THREE.BufferAttribute).array);
}

describe('seeded scene effects', () => {
  it('reproduces generated geometry and initial instance transforms', () => {
    const skyA = buildSky(random('0', 'sky'));
    const skyB = buildSky(random('0', 'sky'));
    const embersA = buildEmbers(100, random('0', 'embers'), 12);
    const embersB = buildEmbers(100, random('0', 'embers'), 12);
    const trafficA = buildTraffic(STREETS, random('0', 'ground-traffic'), 12);
    const trafficB = buildTraffic(STREETS, random('0', 'ground-traffic'), 12);
    const flyingA = buildFlyingTraffic(STREETS, 40, random('0', 'flying-traffic'), 12);
    const flyingB = buildFlyingTraffic(STREETS, 40, random('0', 'flying-traffic'), 12);

    const starsA = skyA.group.children[1] as THREE.Points;
    const starsB = skyB.group.children[1] as THREE.Points;
    expect(attributeArray(starsA, 'position')).toEqual(attributeArray(starsB, 'position'));
    expect(attributeArray(starsA, 'color')).toEqual(attributeArray(starsB, 'color'));
    expect(attributeArray(embersA.points, 'position')).toEqual(attributeArray(embersB.points, 'position'));
    expect(attributeArray(embersA.points, 'color')).toEqual(attributeArray(embersB.points, 'color'));
    expect(Array.from(trafficA.mesh.instanceMatrix.array)).toEqual(Array.from(trafficB.mesh.instanceMatrix.array));
    expect(Array.from(flyingA.mesh.instanceMatrix.array)).toEqual(Array.from(flyingB.mesh.instanceMatrix.array));

    skyA.dispose(); skyB.dispose();
    embersA.dispose(); embersB.dispose();
    trafficA.dispose(); trafficB.dispose();
    flyingA.dispose(); flyingB.dispose();
  });

  it('changes generated geometry when the presentation seed changes', () => {
    const first = buildSky(random('0', 'sky'));
    const second = buildSky(random('1', 'sky'));
    const firstStars = first.group.children[1] as THREE.Points;
    const secondStars = second.group.children[1] as THREE.Points;

    expect(attributeArray(firstStars, 'position')).not.toEqual(attributeArray(secondStars, 'position'));

    first.dispose();
    second.dispose();
  });

  it('cycles through repository-derived vehicle colors', () => {
    const palette = [[1, 0, 0], [0, 1, 0], [0, 0, 1]] as const;
    const traffic = buildTraffic(STREETS, random('0', 'ground-traffic'), 12, palette);
    const colors = Array.from(traffic.mesh.instanceColor!.array);
    expect(colors.slice(0, 9)).toEqual([1, 0, 0, 0, 1, 0, 0, 0, 1]);
    traffic.dispose();
  });

  it('places identical building instances for identical layouts', () => {
    // buildCity takes no RandomSource on purpose: the skyline is a pure
    // function of the layout, including the source/infrastructure split.
    const cells = (): LayoutCell[] => [
      { node: { name: 'a.ts', path: 'src/a.ts', type: 'file', size: 1_200, language: 'typescript', children: [] }, rect: { x: 0, y: 0, w: 8, h: 8, depth: 0 } },
      { node: { name: 'b.py', path: 'src/b.py', type: 'file', size: 6_400, language: 'python', children: [] }, rect: { x: 9, y: 0, w: 8, h: 8, depth: 0 } },
      { node: { name: 'yarn.lock', path: 'yarn.lock', type: 'file', size: 2_000_000, language: 'lockfile', children: [] }, rect: { x: 0, y: 9, w: 17, h: 17, depth: 0 } },
    ];
    const first = buildCity(cells());
    const second = buildCity(cells());
    expect(Array.from(first.mesh.instanceMatrix.array)).toEqual(Array.from(second.mesh.instanceMatrix.array));
    expect(first.tallestSourceFile?.path).toBe(second.tallestSourceFile?.path);
    expect(first.tallestSourceFile?.path).toBe('src/b.py');
    first.dispose();
    second.dispose();
  });
});

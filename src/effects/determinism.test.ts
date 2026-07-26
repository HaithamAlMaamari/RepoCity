import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { createSceneRandom } from '../core/random';
import type { StreetSegment } from '../types';
import { buildFlyingTraffic } from './flying-traffic';
import { buildEmbers } from './particles';
import { buildSky } from './sky';
import { buildTraffic } from './traffic';

vi.mock('./textures', async () => {
  const THREE = await import('three');
  return {
    makeRadialGlow: () => new THREE.Texture(),
    makeStreak: () => new THREE.Texture(),
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
    const flyingA = buildFlyingTraffic(100, random('0', 'flying-traffic'), 12);
    const flyingB = buildFlyingTraffic(100, random('0', 'flying-traffic'), 12);

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
});

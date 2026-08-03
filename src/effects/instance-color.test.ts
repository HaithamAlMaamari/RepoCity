/**
 * instance-color.test.ts — guards the bug class that made every vehicle black.
 *
 * `vertexColors: true` tells three to emit `#define USE_COLOR`, and it does so
 * from the material alone without checking that the geometry actually has a
 * `color` attribute. `MeshBasicMaterial` has no `defaultAttributeValues`
 * fallback, so nothing is ever bound to that attribute location, an unbound
 * generic vertex attribute reads (0,0,0,1), and `vColor *= color` in
 * `color_vertex.glsl` zeroes the colour. Any `instanceColor` set afterwards is
 * multiplied by zero.
 *
 * The result renders pure black while every CPU-side buffer looks perfect --
 * which is exactly why the existing determinism test, which asserts on
 * `instanceColor.array`, stayed green through the whole regression.
 *
 * So assert on the *material/geometry pairing* instead, which is the thing
 * that was actually wrong.
 */

import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { createSceneRandom } from '../core/random';
import type { DistrictRect, PlotRect, StreetSegment } from '../types';
import { buildFlyingTraffic } from './flying-traffic';
import { buildStreetNetwork } from './streets';
import { buildTraffic } from './traffic';

vi.mock('./textures', async () => {
  const three = await import('three');
  return {
    makeRadialGlow: () => new three.Texture(),
    makeVerticalBand: () => new three.Texture(),
    makeSoftSquare: () => new three.Texture(),
    makeNeonSign: () => new three.Texture(),
  };
});

const STREETS: StreetSegment[] = [
  { x1: -40, z1: 0, x2: 40, z2: 0, width: 3, axis: 'x' },
  { x1: 0, z1: -40, x2: 0, z2: 40, width: 3, axis: 'z' },
];

function random(domain: string) {
  return createSceneRandom('octocat/Hello-World', 'a'.repeat(40), '0', domain);
}

/** Every material in the subtree, paired with the geometry it is drawn with. */
function materialPairs(root: THREE.Object3D): { name: string; mesh: THREE.Mesh }[] {
  const pairs: { name: string; mesh: THREE.Mesh }[] = [];
  root.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh && !(object as THREE.Points).isPoints && !(object as THREE.Line).isLine) return;
    if (!mesh.material || !mesh.geometry) return;
    pairs.push({ name: object.type + (object.name ? `:${object.name}` : ''), mesh });
  });
  return pairs;
}

function assertColorSourcesAgree(root: THREE.Object3D, label: string): void {
  for (const { name, mesh } of materialPairs(root)) {
    for (const material of (Array.isArray(mesh.material) ? mesh.material : [mesh.material])) {
      if (!(material as THREE.Material & { vertexColors?: boolean }).vertexColors) continue;
      expect(
        mesh.geometry.getAttribute('color'),
        `${label}: ${name} sets vertexColors but its geometry has no "color" attribute, ` +
        'so it will render black. Use instanceColor alone, or supply the attribute.',
      ).toBeDefined();
    }
  }
}

describe('instance-coloured materials render their colour', () => {
  it('never sets vertexColors without a color attribute', () => {
    const traffic = buildTraffic(STREETS, random('ground-traffic'), 12, [[1, 0.4, 0.1]]);
    const flying = buildFlyingTraffic(STREETS, 40, random('flying-traffic'), 12, [[0.2, 0.8, 1]]);

    const districts: DistrictRect[] = [
      { x: -40, z: -40, w: 30, d: 30, depth: 1, name: 'src' },
      { x: 6, z: -40, w: 30, d: 30, depth: 1, name: 'test' },
    ];
    const plots: PlotRect[] = [{ x: -38, z: -38, w: 10, d: 10 }];
    const network = buildStreetNetwork(districts, { minX: -40, maxX: 40, minZ: -40, maxZ: 40 }, plots);

    assertColorSourcesAgree(traffic.mesh, 'ground traffic');
    assertColorSourcesAgree(flying.mesh, 'flying traffic');
    assertColorSourcesAgree(network.group, 'street network');

    traffic.dispose();
    flying.dispose();
    network.dispose();
  });

  it('gives vehicles a non-black instance colour', () => {
    const palette: [number, number, number][] = [[1, 0.4, 0.1], [0.2, 0.8, 1]];
    const traffic = buildTraffic(STREETS, random('ground-traffic'), 12, palette);
    const flying = buildFlyingTraffic(STREETS, 40, random('flying-traffic'), 12, palette);

    for (const [label, mesh] of [['ground', traffic.mesh], ['flying', flying.mesh]] as const) {
      expect(mesh.count, `${label}: no vehicles were created`).toBeGreaterThan(0);
      const colors = mesh.instanceColor;
      expect(colors, `${label}: instanceColor was never populated`).not.toBeNull();
      const channels = Array.from(colors!.array.slice(0, mesh.count * 3));
      expect(
        channels.some((value) => value > 0.05),
        `${label}: every instance colour channel is ~0, i.e. the vehicles are black`,
      ).toBe(true);
    }

    traffic.dispose();
    flying.dispose();
  });

  it('still produces aerial lanes when only short corridors exist', () => {
    // Internal streets are clipped into fragments; a high corridor threshold
    // used to leave `instanceColor` null and nothing drawn at all.
    const shortStreets: StreetSegment[] = [
      { x1: -10, z1: 0, x2: 10, z2: 0, width: 3, axis: 'x' },
    ];
    const flying = buildFlyingTraffic(shortStreets, 40, random('flying-traffic'), 12, [[0.2, 0.8, 1]]);

    expect(flying.mesh.count).toBeGreaterThan(0);
    expect(flying.mesh.instanceColor).not.toBeNull();
    flying.dispose();
  });
});

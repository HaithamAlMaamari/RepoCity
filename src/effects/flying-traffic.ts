/**
 * flying-traffic.ts — aerial vehicles in ORGANIZED sky-lane corridors.
 *
 * Each corridor is an axis-aligned band at a fixed altitude with one
 * direction of travel. Seeded variation keeps the traffic reproducible.
 */

import * as THREE from 'three';
import type { RandomSource } from '../core/random';
import type { RGB, StreetSegment } from '../types';

export interface FlyingTraffic {
  mesh: THREE.InstancedMesh;
  update(dt: number): void;
  dispose(): void;
}

interface AirCar {
  axis: 'x' | 'z';
  travel: number; travelMin: number; travelMax: number;
  lane: number; y: number; speed: number;
  len: number;
  color: RGB;
}

const DEFAULT_PALETTE: readonly RGB[] = [[0.38, 0.87, 1]];

/**
 * Shortest street that can serve as a sky lane.
 *
 * Internal streets are clipped into short fragments by the building plots, so
 * a high threshold here quietly restricts aerial traffic to the perimeter
 * ring. Stage 4 reserves proper arterials; until then this stays low enough
 * that any reasonable corridor qualifies.
 */
const MIN_CORRIDOR_LENGTH = 18;

export function buildFlyingTraffic(
  streets: StreetSegment[],
  maxBuildingHeight: number,
  random: RandomSource,
  desiredCount = 48,
  palette: readonly RGB[] = DEFAULT_PALETTE,
): FlyingTraffic {
  const corridors = streets.filter((street) => streetLength(street) >= MIN_CORRIDOR_LENGTH);
  if (corridors.length === 0) {
    // Nothing long enough to fly along. Without this guard `mesh.count` is 0,
    // `setColorAt` is never reached, and `instanceColor` stays null.
    const g = new THREE.BoxGeometry(1, 1, 1);
    const m = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0 });
    const mesh = new THREE.InstancedMesh(g, m, 0);
    return { mesh, update() {}, dispose() { mesh.dispose(); g.dispose(); m.dispose(); } };
  }

  const geo = new THREE.BoxGeometry(1.6, 0.5, 0.8);
  /*
   * Per-vehicle colour arrives through `setColorAt` -> `instanceColor`, which
   * is all three needs: it defines USE_INSTANCING_COLOR and the fragment-side
   * USE_COLOR by itself.
   *
   * Do NOT add `vertexColors: true` here. Three sets USE_COLOR from the
   * material without checking that the geometry actually has a `color`
   * attribute, and MeshBasicMaterial has no `defaultAttributeValues` fallback.
   * A BoxGeometry has no such attribute, so the unbound generic attribute
   * reads (0,0,0,1), `vColor *= color` zeroes it, and every vehicle renders
   * pure black -- with instanceColor then multiplying zero. That was the bug.
   */
  const mat = new THREE.MeshBasicMaterial({
    color: 0xffffff, depthWrite: false, fog: false,
    toneMapped: false,
  });

  const mesh = new THREE.InstancedMesh(geo, mat, desiredCount);
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.frustumCulled = false;
  mesh.renderOrder = 2;

  const totalCorridorLength = corridors.reduce((sum, street) => sum + streetLength(street), 0);
  const cars: AirCar[] = [];
  const count = Math.min(desiredCount, Math.max(6, Math.floor(totalCorridorLength / 14)));
  mesh.count = count;
  const altitudeRange = Math.max(12, Math.min(34, maxBuildingHeight * 0.48));
  for (let i = 0; i < count; i++) {
    let routePick = random() * totalCorridorLength;
    const corridor = corridors.find((street) => (routePick -= streetLength(street)) <= 0) ?? corridors[corridors.length - 1];
    const travelMin = (corridor.axis === 'x' ? corridor.x1 : corridor.z1) + 4;
    const travelMax = (corridor.axis === 'x' ? corridor.x2 : corridor.z2) - 4;
    cars.push({
      axis: corridor.axis,
      travel: travelMin + random() * (travelMax - travelMin),
      travelMin,
      travelMax,
      lane: corridor.axis === 'x' ? corridor.z1 : corridor.x1,
      y: 10 + random() * altitudeRange,
      speed: (random() < 0.5 ? 1 : -1) * (20 + random() * 16),
      len: 0.8 + random() * 0.5,
      color: palette[i % Math.max(1, palette.length)] ?? DEFAULT_PALETTE[0],
    });
  }

  const color = new THREE.Color();
  for (let i = 0; i < cars.length; i++) mesh.setColorAt(i, color.setRGB(...cars[i].color));
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;

  const d = new THREE.Object3D();
  const update = (dt: number) => {
    for (let i = 0; i < cars.length; i++) {
      const car = cars[i];
      car.travel += car.speed * dt;
      if (car.travel > car.travelMax) car.travel = car.travelMin;
      else if (car.travel < car.travelMin) car.travel = car.travelMax;

      let x: number, z: number, rotY: number;
      if (car.axis === 'x') { x = car.travel; z = car.lane; rotY = car.speed > 0 ? 0 : Math.PI; }
      else { x = car.lane; z = car.travel; rotY = car.speed > 0 ? -Math.PI / 2 : Math.PI / 2; }
      d.position.set(x, car.y, z);
      d.rotation.set(0, rotY, 0);
      d.scale.set(car.len, 1, 1);
      d.updateMatrix();
      mesh.setMatrixAt(i, d.matrix);

    }
    mesh.instanceMatrix.needsUpdate = true;
  };

  update(0);

  return {
    mesh, update,
    dispose() {
      mesh.dispose(); geo.dispose(); mat.dispose();
    },
  };
}

function streetLength(street: StreetSegment): number {
  return street.axis === 'x' ? street.x2 - street.x1 : street.z2 - street.z1;
}

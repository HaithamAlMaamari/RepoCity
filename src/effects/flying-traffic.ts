/**
 * flying-traffic.ts — aerial vehicles in ORGANIZED sky-lane corridors.
 *
 * Each corridor is an axis-aligned band at a fixed altitude with one
 * direction of travel. Seeded variation keeps the traffic reproducible.
 */

import * as THREE from 'three';
import type { RandomSource } from '../core/random';
import type { StreetSegment } from '../types';

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
}

export function buildFlyingTraffic(streets: StreetSegment[], maxBuildingHeight: number, random: RandomSource, desiredCount = 48): FlyingTraffic {
  const geo = new THREE.BoxGeometry(1.6, 0.5, 0.8);
  const mat = new THREE.MeshBasicMaterial({
    color: 0x61dfff, depthWrite: false, fog: false,
    toneMapped: false,
  });

  const mesh = new THREE.InstancedMesh(geo, mat, desiredCount);
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.frustumCulled = false;
  mesh.renderOrder = 2;

  const corridors = streets.filter((street) => streetLength(street) >= 25);
  const totalCorridorLength = corridors.reduce((sum, street) => sum + streetLength(street), 0);
  const cars: AirCar[] = [];
  const count = corridors.length === 0 ? 0 : Math.min(desiredCount, Math.max(6, Math.floor(totalCorridorLength / 14)));
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
    });
  }

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

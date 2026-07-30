/**
 * traffic.ts — compact emissive ground vehicles.
 *
 * A single cool-cyan body avoids decorative tails at city scale.
 */

import * as THREE from 'three';
import type { RandomSource } from '../core/random';
import type { StreetSegment } from '../types';

export interface TrafficStreaks {
  mesh: THREE.InstancedMesh;
  update(dt: number): void;
  dispose(): void;
}

interface Car {
  axis: 'x' | 'z';
  travel: number; travelMin: number; travelMax: number;
  lane: number; speed: number;
  len: number; wid: number;
}

export function buildTraffic(streets: StreetSegment[], random: RandomSource, desiredCount = 60): TrafficStreaks {
  const usableStreets = streets.filter((street) => streetLength(street) >= 25 && street.width >= 0.9);
  if (usableStreets.length === 0) {
    const g = new THREE.PlaneGeometry(1, 1);
    const m = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0 });
    const mesh = new THREE.InstancedMesh(g, m, 0);
    return { mesh, update() {}, dispose() { mesh.dispose(); g.dispose(); m.dispose(); } };
  }

  const geo = new THREE.BoxGeometry(1.1, 0.22, 0.5);
  const mat = new THREE.MeshBasicMaterial({
    color: 0x61dfff, depthWrite: false, fog: false,
    toneMapped: false,
  });

  const totalRoadLength = usableStreets.reduce((sum, street) => sum + streetLength(street), 0);
  const count = Math.min(desiredCount, Math.max(12, Math.floor(totalRoadLength / 8)));
  const mesh = new THREE.InstancedMesh(geo, mat, count);
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.frustumCulled = false;
  mesh.renderOrder = 2;

  const cars: Car[] = [];
  for (let i = 0; i < count; i++) {
    let roadPick = random() * totalRoadLength;
    const s = usableStreets.find((street) => (roadPick -= streetLength(street)) <= 0) ?? usableStreets[usableStreets.length - 1];
    let travelMin: number, travelMax: number, laneMin: number, laneMax: number;
    const len = 0.7 + random() * 0.6;
    const wid = Math.min(0.7 + random() * 0.25, (s.width - 0.1) / 2.0);
    const travelInset = 1.8 * len;
    const laneInset = wid;
    if (s.axis === 'x') {
      travelMin = s.x1 + travelInset; travelMax = s.x2 - travelInset;
      laneMin = s.z1 - s.width / 2 + laneInset; laneMax = s.z1 + s.width / 2 - laneInset;
    } else {
      travelMin = s.z1 + travelInset; travelMax = s.z2 - travelInset;
      laneMin = s.x1 - s.width / 2 + laneInset; laneMax = s.x1 + s.width / 2 - laneInset;
    }
    cars.push({
      axis: s.axis,
      travel: travelMin + random() * (travelMax - travelMin),
      travelMin, travelMax,
      lane: laneMin + random() * Math.max(0.01, laneMax - laneMin),
      speed: (random() < 0.5 ? 1 : -1) * (7 + random() * 16),
      len,
      wid,
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
      d.position.set(x, 0.20, z);
      d.rotation.set(0, rotY, 0);
      d.scale.set(car.len, 1, car.wid);
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

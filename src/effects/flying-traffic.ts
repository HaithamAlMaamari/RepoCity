/**
 * flying-traffic.ts — aerial vehicles in ORGANIZED sky-lane corridors.
 *
 * Each corridor is an axis-aligned band at a fixed altitude with one
 * direction of travel. Seeded variation keeps the traffic reproducible.
 */

import * as THREE from 'three';
import type { RandomSource } from '../core/random';
import { makeStreak } from './textures';

export interface FlyingTraffic {
  mesh: THREE.InstancedMesh;
  update(dt: number): void;
  dispose(): void;
}

interface AirCar {
  axis: 'x' | 'z';
  travel: number; reach: number;
  lane: number; y: number; speed: number;
  len: number;
  pulseRate: number; pulseOffset: number;
  color: [number, number, number];
}

const TINTS: [number, number, number][] = [
  [0.28, 0.78, 0.92], [0.22, 0.72, 0.92], [0.38, 0.82, 0.94], [0.18, 0.68, 0.88],
  [0.90, 0.18, 0.48], [0.90, 0.14, 0.42], [0.86, 0.26, 0.58],
  [0.92, 0.52, 0.18],
];

export function buildFlyingTraffic(citySize: number, random: RandomSource, desiredCount = 100): FlyingTraffic {
  const tex = makeStreak();
  const geo = new THREE.PlaneGeometry(12, 0.46);
  geo.rotateX(-Math.PI / 2);
  const mat = new THREE.MeshBasicMaterial({
    map: tex, transparent: true, opacity: 0.68, depthWrite: false,
    blending: THREE.AdditiveBlending, fog: true, vertexColors: true,
  });

  const mesh = new THREE.InstancedMesh(geo, mat, desiredCount);
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.frustumCulled = false;
  mesh.renderOrder = 2;

  const podGeo = new THREE.BoxGeometry(1.35, 0.18, 0.42);
  const podMat = new THREE.MeshBasicMaterial({
    transparent: true,
    opacity: 0.92,
    vertexColors: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    fog: true,
  });
  const podMesh = new THREE.InstancedMesh(podGeo, podMat, desiredCount);
  podMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  podMesh.frustumCulled = false;
  podMesh.renderOrder = 3;
  mesh.add(podMesh);

  // Organized corridors: [axis, perpendicular center, altitude, direction]
  const S = citySize;
  const corridors: { axis: 'x' | 'z'; center: number; lanes: number; y0: number; y1: number; dir: 1 | -1 }[] = [
    { axis: 'x', center: -S * 0.28, lanes: 3, y0: 14, y1: 20, dir: 1 },
    { axis: 'x', center: S * 0.18, lanes: 3, y0: 16, y1: 22, dir: -1 },
    { axis: 'z', center: -S * 0.2, lanes: 3, y0: 15, y1: 21, dir: -1 },
    { axis: 'z', center: S * 0.24, lanes: 3, y0: 17, y1: 23, dir: 1 },
    { axis: 'x', center: -S * 0.05, lanes: 4, y0: 30, y1: 38, dir: 1 },
    { axis: 'z', center: S * 0.05, lanes: 4, y0: 32, y1: 40, dir: -1 },
    { axis: 'x', center: S * 0.38, lanes: 3, y0: 46, y1: 56, dir: -1 },
    { axis: 'z', center: -S * 0.38, lanes: 3, y0: 48, y1: 58, dir: 1 },
  ];

  const reach = S * 1.3;
  const cars: AirCar[] = [];
  for (let i = 0; i < desiredCount; i++) {
    const co = corridors[i % corridors.length];
    const laneIdx = Math.floor(random() * co.lanes);
    const lane = co.center + (laneIdx - (co.lanes - 1) / 2) * 4.5;
    const emergency = random() < 0.02;
    cars.push({
      axis: co.axis,
      travel: -reach + random() * reach * 2,
      reach,
      lane,
      y: co.y0 + random() * (co.y1 - co.y0),
      speed: co.dir * (20 + random() * 16),
      len: 0.8 + random() * 0.5,
      pulseRate: emergency ? 5 + random() * 3 : 0,
      pulseOffset: random() * Math.PI * 2,
      color: emergency
        ? (random() < 0.5 ? [1.0, 0.12, 0.24] : [0.12, 0.62, 1.0])
        : TINTS[Math.floor(random() * TINTS.length)],
    });
  }

  const c = new THREE.Color();
  for (let i = 0; i < cars.length; i++) {
    c.setRGB(...cars[i].color);
    mesh.setColorAt(i, c);
    podMesh.setColorAt(i, c);
  }
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  if (podMesh.instanceColor) podMesh.instanceColor.needsUpdate = true;

  let t = 0;
  const d = new THREE.Object3D();
  const pod = new THREE.Object3D();
  const tmp = new THREE.Color();

  const update = (dt: number) => {
    t += dt;
    for (let i = 0; i < cars.length; i++) {
      const car = cars[i];
      car.travel += car.speed * dt;
      if (car.travel > car.reach) car.travel = -car.reach;
      else if (car.travel < -car.reach) car.travel = car.reach;

      let x: number, z: number, rotY: number;
      if (car.axis === 'x') { x = car.travel; z = car.lane; rotY = car.speed > 0 ? 0 : Math.PI; }
      else { x = car.lane; z = car.travel; rotY = car.speed > 0 ? -Math.PI / 2 : Math.PI / 2; }
      d.position.set(x, car.y, z);
      d.rotation.set(0, rotY, 0);
      d.scale.set(car.len, 1, 1);
      d.updateMatrix();
      mesh.setMatrixAt(i, d.matrix);

      const head = 5.0 * car.len * (car.speed > 0 ? 1 : -1);
      if (car.axis === 'x') pod.position.set(x + head, car.y, z);
      else pod.position.set(x, car.y, z + head);
      pod.rotation.set(0, rotY, 0);
      pod.scale.set(car.len, 1, 1);
      pod.updateMatrix();
      podMesh.setMatrixAt(i, pod.matrix);

      if (car.pulseRate > 0) {
        const k = 0.35 + 0.85 * (0.5 + 0.5 * Math.sin(t * car.pulseRate + car.pulseOffset));
        tmp.setRGB(car.color[0] * k, car.color[1] * k, car.color[2] * k);
        mesh.setColorAt(i, tmp);
        podMesh.setColorAt(i, tmp);
      }
    }
    mesh.instanceMatrix.needsUpdate = true;
    podMesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    if (podMesh.instanceColor) podMesh.instanceColor.needsUpdate = true;
  };

  update(0);

  return {
    mesh, update,
    dispose() { geo.dispose(); mat.dispose(); tex.dispose(); podGeo.dispose(); podMat.dispose(); },
  };
}

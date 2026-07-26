/**
 * traffic.ts — ground vehicles as comet-tail light streaks.
 *
 * Streak texture (CanvasTexture) tinted per-instance. Cyan/white =
 * headlights, magenta/red = taillights, amber = taxis. 4% emergency
 * vehicles flash red/blue via JS color updates.
 */

import * as THREE from 'three';
import type { StreetSegment } from '../types';
import { makeStreak } from './textures';

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
  pulseRate: number; pulseOffset: number;
  color: [number, number, number];
}

const TINTS: [number, number, number][] = [
  [0.72, 0.78, 0.86], [0.72, 0.78, 0.86], [0.58, 0.75, 0.86],
  [0.45, 0.70, 0.82], [0.52, 0.72, 0.82],
  [0.86, 0.18, 0.38], [0.86, 0.18, 0.38], [0.90, 0.16, 0.34], [0.78, 0.18, 0.42],
  [0.86, 0.52, 0.18],
];

export function buildTraffic(streets: StreetSegment[], desiredCount = 240): TrafficStreaks {
  if (streets.length === 0) {
    const g = new THREE.PlaneGeometry(1, 1);
    const m = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0 });
    return { mesh: new THREE.InstancedMesh(g, m, 0), update() {}, dispose() { g.dispose(); m.dispose(); } };
  }

  const tex = makeStreak();
  const geo = new THREE.PlaneGeometry(9, 0.7);
  geo.rotateX(-Math.PI / 2);
  const mat = new THREE.MeshBasicMaterial({
    map: tex, transparent: true, opacity: 0.72, depthWrite: false,
    blending: THREE.AdditiveBlending, fog: true, vertexColors: true,
  });

  const count = Math.min(desiredCount, Math.max(streets.length * 5, 60));
  const mesh = new THREE.InstancedMesh(geo, mat, count);
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.frustumCulled = false;
  mesh.renderOrder = 2;

  // A compact emissive pod makes each streak read as a vehicle rather than
  // an abstract line, especially from the default orbit camera.
  const podGeo = new THREE.BoxGeometry(1.15, 0.16, 0.38);
  const podMat = new THREE.MeshBasicMaterial({
    transparent: true,
    opacity: 0.9,
    vertexColors: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    fog: true,
  });
  const podMesh = new THREE.InstancedMesh(podGeo, podMat, count);
  podMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  podMesh.frustumCulled = false;
  podMesh.renderOrder = 3;
  mesh.add(podMesh);

  const cars: Car[] = [];
  for (let i = 0; i < count; i++) {
    const s = streets[i % streets.length];
    let travelMin: number, travelMax: number, laneMin: number, laneMax: number;
    if (s.axis === 'x') {
      travelMin = s.x1; travelMax = s.x2;
      laneMin = s.z1 - s.width / 2 + 0.25; laneMax = s.z1 + s.width / 2 - 0.25;
    } else {
      travelMin = s.z1; travelMax = s.z2;
      laneMin = s.x1 - s.width / 2 + 0.25; laneMax = s.x1 + s.width / 2 - 0.25;
    }
    const emergency = Math.random() < 0.04;
    cars.push({
      axis: s.axis,
      travel: travelMin + Math.random() * (travelMax - travelMin),
      travelMin, travelMax,
      lane: laneMin + Math.random() * Math.max(0.01, laneMax - laneMin),
      speed: (Math.random() < 0.5 ? 1 : -1) * (7 + Math.random() * 16),
      len: 0.7 + Math.random() * 0.6,
      wid: 0.8 + Math.random() * 0.4,
      pulseRate: emergency ? 5 + Math.random() * 4 : 0,
      pulseOffset: Math.random() * Math.PI * 2,
      color: emergency
        ? (Math.random() < 0.5 ? [1.0, 0.12, 0.24] : [0.12, 0.62, 1.0])
        : TINTS[Math.floor(Math.random() * TINTS.length)],
    });
  }

  const c = new THREE.Color();
  for (let i = 0; i < count; i++) {
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
      if (car.travel > car.travelMax) car.travel = car.travelMin;
      else if (car.travel < car.travelMin) car.travel = car.travelMax;

      let x: number, z: number, rotY: number;
      if (car.axis === 'x') { x = car.travel; z = car.lane; rotY = car.speed > 0 ? 0 : Math.PI; }
      else { x = car.lane; z = car.travel; rotY = car.speed > 0 ? -Math.PI / 2 : Math.PI / 2; }
      d.position.set(x, 0.14, z);
      d.rotation.set(0, rotY, 0);
      d.scale.set(car.len, 1, car.wid);
      d.updateMatrix();
      mesh.setMatrixAt(i, d.matrix);

      const head = 3.5 * car.len * (car.speed > 0 ? 1 : -1);
      if (car.axis === 'x') pod.position.set(x + head, 0.14, z);
      else pod.position.set(x, 0.14, z + head);
      pod.rotation.set(0, rotY, 0);
      pod.scale.set(car.len, 1, car.wid);
      pod.updateMatrix();
      podMesh.setMatrixAt(i, pod.matrix);

      if (car.pulseRate > 0) {
        const k = 0.4 + 0.8 * (0.5 + 0.5 * Math.sin(t * car.pulseRate + car.pulseOffset));
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

  return {
    mesh, update,
    dispose() { geo.dispose(); mat.dispose(); tex.dispose(); podGeo.dispose(); podMat.dispose(); },
  };
}

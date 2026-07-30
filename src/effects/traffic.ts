/**
 * traffic.ts — compact emissive ground vehicles.
 *
 * A single cool-cyan body avoids decorative tails at city scale.
 */

import * as THREE from 'three';
import type { RandomSource } from '../core/random';
import type { RGB, StreetSegment } from '../types';

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
  color: RGB;
}

const DEFAULT_PALETTE: readonly RGB[] = [[0.38, 0.87, 1]];

export function buildTraffic(
  streets: StreetSegment[],
  random: RandomSource,
  desiredCount = 60,
  palette: readonly RGB[] = DEFAULT_PALETTE,
): TrafficStreaks {
  const usableStreets = streets.filter((street) =>
    streetLength(street) >= (street.kind === 'perimeter' ? 25 : 2) && street.width >= 0.9);
  if (usableStreets.length === 0) {
    const g = new THREE.PlaneGeometry(1, 1);
    const m = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0 });
    const mesh = new THREE.InstancedMesh(g, m, 0);
    return { mesh, update() {}, dispose() { mesh.dispose(); g.dispose(); m.dispose(); } };
  }

  const geo = new THREE.BoxGeometry(1.1, 0.22, 0.5);
  const mat = new THREE.MeshBasicMaterial({
    color: 0xffffff, vertexColors: true, depthWrite: false, fog: false,
    toneMapped: false,
  });

  const physicalRoadLength = usableStreets.reduce((sum, street) => sum + streetLength(street), 0);
  const count = Math.min(desiredCount, Math.max(12, Math.floor(physicalRoadLength / 8)));
  const mesh = new THREE.InstancedMesh(geo, mat, count);
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.frustumCulled = false;
  mesh.renderOrder = 2;

  const cars: Car[] = [];
  const routes = allocateTrafficRoutes(usableStreets, count);
  const routeStates = new Map<StreetSegment, { total: number; next: number; speed: number }>();
  for (const route of routes) {
    const state = routeStates.get(route);
    if (state) state.total++;
    else routeStates.set(route, { total: 1, next: 0, speed: (random() < 0.5 ? 1 : -1) * (7 + random() * 16) });
  }
  for (let i = 0; i < count; i++) {
    const s = routes[i];
    const routeState = routeStates.get(s)!;
    let travelMin: number, travelMax: number, laneMin: number, laneMax: number;
    const roadLength = streetLength(s);
    const naturalLengthScale = 0.7 + random() * 0.6;
    const naturalWidthScale = 0.7 + random() * 0.25;
    const fit = Math.min(
      1,
      (roadLength - 0.6) / (1.1 * naturalLengthScale),
      (s.width - 0.2) / (0.5 * naturalWidthScale),
    );
    const len = naturalLengthScale * fit;
    const wid = naturalWidthScale * fit;
    const travelInset = Math.min(0.85, roadLength / 2 - 0.2);
    const laneInset = 0.1 + 0.5 * wid / 2;
    if (s.axis === 'x') {
      travelMin = s.x1 + travelInset; travelMax = s.x2 - travelInset;
      laneMin = s.z1 - s.width / 2 + laneInset; laneMax = s.z1 + s.width / 2 - laneInset;
    } else {
      travelMin = s.z1 + travelInset; travelMax = s.z2 - travelInset;
      laneMin = s.x1 - s.width / 2 + laneInset; laneMax = s.x1 + s.width / 2 - laneInset;
    }
    cars.push({
      axis: s.axis,
      travel: travelMin + (routeState.next + 0.5) / routeState.total * (travelMax - travelMin),
      travelMin, travelMax,
      lane: laneMin + random() * Math.max(0.01, laneMax - laneMin),
      speed: routeState.speed,
      len,
      wid,
      color: palette[i % Math.max(1, palette.length)] ?? DEFAULT_PALETTE[0],
    });
    routeState.next++;
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

export function routeWeight(street: StreetSegment): number {
  return street.kind === 'perimeter' ? streetLength(street) * 0.1 : streetLength(street) * 0.75 + 1.5;
}

export function allocateTrafficRoutes(streets: readonly StreetSegment[], count: number): StreetSegment[] {
  const perimeter = streets.filter((street) => street.kind === 'perimeter');
  const internal = streets.filter((street) => street.kind !== 'perimeter');
  if (perimeter.length === 0) return allocateRouteGroup(internal, count);
  if (internal.length === 0) return allocateRouteGroup(perimeter, count);
  const perimeterWeight = perimeter.reduce((sum, street) => sum + routeWeight(street), 0);
  const internalWeight = internal.reduce((sum, street) => sum + routeWeight(street), 0);
  const internalCount = Math.round(count * internalWeight / (perimeterWeight + internalWeight));
  return [
    ...allocateRouteGroup(internal, internalCount),
    ...allocateRouteGroup(perimeter, count - internalCount),
  ];
}

function allocateRouteGroup(streets: readonly StreetSegment[], count: number): StreetSegment[] {
  if (count <= 0 || streets.length === 0) return [];
  const sorted = [...streets].sort((a, b) => streetKey(a).localeCompare(streetKey(b)));
  const allocations = new Array<number>(sorted.length).fill(0);
  const groupCap = Math.max(1, Math.min(Math.floor(count / 2), Math.ceil(2 * count / sorted.length)));
  const caps = sorted.map((street) => Math.max(1, Math.min(groupCap, Math.floor(streetLength(street) / 1.8))));
  let remaining = count;
  if (count >= sorted.length) {
    allocations.fill(1);
    remaining -= sorted.length;
  }
  while (remaining > 0) {
    let best = -1;
    let bestScore = -Infinity;
    for (let i = 0; i < sorted.length; i++) {
      if (allocations[i] >= caps[i]) continue;
      const score = routeWeight(sorted[i]) / (allocations[i] + 1);
      if (score > bestScore) {
        best = i;
        bestScore = score;
      }
    }
    if (best < 0) {
      for (let i = 0; i < sorted.length && remaining > 0; i++) {
        allocations[i]++;
        remaining--;
      }
      continue;
    }
    allocations[best]++;
    remaining--;
  }
  return sorted.flatMap((street, index) => Array.from({ length: allocations[index] }, () => street));
}

function streetKey(street: StreetSegment): string {
  return `${street.axis}:${street.x1}:${street.z1}:${street.x2}:${street.z2}`;
}

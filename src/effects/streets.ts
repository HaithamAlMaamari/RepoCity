/**
 * streets.ts — road network between districts.
 *
 * Roads: dark quads. Neon curbs: thin additive strips (cyan/magenta).
 * Intersections: radial glow sprites. District outlines: line segments.
 * No custom shaders anywhere.
 */

import * as THREE from 'three';
import type { DistrictRect, StreetSegment } from '../types';
import { makeRadialGlow } from './textures';

export interface StreetNetwork {
  group: THREE.Group;
  streets: StreetSegment[];
  dispose(): void;
}

export function buildStreetNetwork(
  districts: DistrictRect[],
  cityBounds: { minX: number; maxX: number; minZ: number; maxZ: number },
): StreetNetwork {
  const group = new THREE.Group();
  const streets: StreetSegment[] = [];
  const disposables: { dispose(): void }[] = [];

  const { minX, maxX, minZ, maxZ } = cityBounds;

  if (districts.length === 0) {
    // Repositories with only root-level files still need a legible road grid.
    const width = Math.max(3.0, Math.min(maxX - minX, maxZ - minZ) * 0.045);
    const xMid = (minX + maxX) / 2;
    const zMid = (minZ + maxZ) / 2;
    streets.push(
      { x1: minX, z1: zMid - width * 1.5, x2: maxX, z2: zMid - width * 1.5, width, axis: 'x' },
      { x1: minX, z1: zMid + width * 1.5, x2: maxX, z2: zMid + width * 1.5, width, axis: 'x' },
      { x1: xMid - width * 1.5, z1: minZ, x2: xMid - width * 1.5, z2: maxZ, width, axis: 'z' },
      { x1: xMid + width * 1.5, z1: minZ, x2: xMid + width * 1.5, z2: maxZ, width, axis: 'z' },
    );
  } else {
    const zBands = mergeBands(districts.map((d) => [d.z, d.z + d.d] as [number, number]));
    const xBands = mergeBands(districts.map((d) => [d.x, d.x + d.w] as [number, number]));
    for (const [z1, z2] of gaps(zBands, minZ, maxZ)) {
      const width = z2 - z1;
      if (width < 0.15) continue;
      streets.push({ x1: minX, z1: (z1 + z2) / 2, x2: maxX, z2: (z1 + z2) / 2, width, axis: 'x' });
    }
    for (const [x1, x2] of gaps(xBands, minX, maxX)) {
      const width = x2 - x1;
      if (width < 0.15) continue;
      streets.push({ x1: (x1 + x2) / 2, z1: minZ, x2: (x1 + x2) / 2, z2: maxZ, width, axis: 'z' });
    }
  }

  // If district bands completely cover the footprint, their gaps produce no
  // roads. Keep four readable arterials so traffic still has a physical path.
  if (streets.length === 0) {
    const width = Math.max(3.0, Math.min(maxX - minX, maxZ - minZ) * 0.045);
    const xMid = (minX + maxX) / 2;
    const zMid = (minZ + maxZ) / 2;
    streets.push(
      { x1: minX, z1: zMid - width * 1.5, x2: maxX, z2: zMid - width * 1.5, width, axis: 'x' },
      { x1: minX, z1: zMid + width * 1.5, x2: maxX, z2: zMid + width * 1.5, width, axis: 'x' },
      { x1: xMid - width * 1.5, z1: minZ, x2: xMid - width * 1.5, z2: maxZ, width, axis: 'z' },
      { x1: xMid + width * 1.5, z1: minZ, x2: xMid + width * 1.5, z2: maxZ, width, axis: 'z' },
    );
  }

  /* ---- road surface (dark) ---- */
  const roadPos: number[] = [];
  for (const s of streets) {
    let x0: number, z0: number, x1: number, z1: number;
    if (s.axis === 'x') { x0 = s.x1; x1 = s.x2; z0 = s.z1 - s.width / 2; z1 = s.z1 + s.width / 2; }
    else { x0 = s.x1 - s.width / 2; x1 = s.x1 + s.width / 2; z0 = s.z1; z1 = s.z2; }
    const y = 0.05;
    roadPos.push(x0, y, z0, x1, y, z0, x1, y, z1, x0, y, z0, x1, y, z1, x0, y, z1);
  }
  if (roadPos.length > 0) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(roadPos, 3));
    const m = new THREE.MeshBasicMaterial({ color: 0x04040c, fog: true });
    const mesh = new THREE.Mesh(g, m);
    mesh.frustumCulled = false;
    group.add(mesh);
    disposables.push(g, m);
  }

  /* ---- neon curb strips ---- */
  const cyanPos: number[] = [];
  const magPos: number[] = [];
  const curbY = 0.07;
  const strip = 0.10;
  let idx = 0;
  for (const s of streets) {
    const target = (idx++ % 3 === 0) ? magPos : cyanPos;
    if (s.axis === 'x') {
      for (const side of [-1, 1]) {
        const zc = s.z1 + side * (s.width / 2 - 0.08);
        target.push(
          s.x1, curbY, zc - strip / 2, s.x2, curbY, zc - strip / 2, s.x2, curbY, zc + strip / 2,
          s.x1, curbY, zc - strip / 2, s.x2, curbY, zc + strip / 2, s.x1, curbY, zc + strip / 2,
        );
      }
    } else {
      for (const side of [-1, 1]) {
        const xc = s.x1 + side * (s.width / 2 - 0.08);
        target.push(
          xc - strip / 2, curbY, s.z1, xc + strip / 2, curbY, s.z1, xc + strip / 2, curbY, s.z2,
          xc - strip / 2, curbY, s.z1, xc + strip / 2, curbY, s.z2, xc - strip / 2, curbY, s.z2,
        );
      }
    }
  }
  const addCurb = (pos: number[], color: number) => {
    if (pos.length === 0) return;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    const m = new THREE.MeshBasicMaterial({
      color, transparent: true, opacity: 0.42,
      blending: THREE.AdditiveBlending, depthWrite: false, fog: true,
    });
    const mesh = new THREE.Mesh(g, m);
    mesh.frustumCulled = false;
    mesh.renderOrder = 1;
    group.add(mesh);
    disposables.push(g, m);
  };
  addCurb(cyanPos, 0x00c8f0);
  addCurb(magPos, 0xff2d8a);

  /* ---- intersection glow sprites ---- */
  const glowTex = makeRadialGlow(128);
  disposables.push(glowTex);
  const points: { x: number; z: number }[] = [];
  for (const sx of streets) {
    if (sx.axis !== 'x') continue;
    for (const sz of streets) {
      if (sz.axis !== 'z') continue;
      if (points.length >= 80) break;
      points.push({ x: sz.x1, z: sx.z1 });
    }
    if (points.length >= 80) break;
  }
  if (points.length > 0) {
    const gGeo = new THREE.PlaneGeometry(3.2, 3.2);
    gGeo.rotateX(-Math.PI / 2);
    const gMat = new THREE.MeshBasicMaterial({
      map: glowTex, transparent: true, opacity: 0.16,
      blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
      vertexColors: true,
    });
    const gMesh = new THREE.InstancedMesh(gGeo, gMat, points.length);
    const d = new THREE.Object3D();
    const c = new THREE.Color();
    for (let i = 0; i < points.length; i++) {
      d.position.set(points[i].x, 0.09, points[i].z);
      const sc = 0.8 + (i % 4) * 0.25;
      d.scale.set(sc, 1, sc);
      d.updateMatrix();
      gMesh.setMatrixAt(i, d.matrix);
      gMesh.setColorAt(i, i % 3 === 0 ? c.setRGB(1.0, 0.2, 0.55) : c.setRGB(0.0, 0.8, 1.0));
    }
    gMesh.instanceMatrix.needsUpdate = true;
    if (gMesh.instanceColor) gMesh.instanceColor.needsUpdate = true;
    gMesh.frustumCulled = false;
    gMesh.renderOrder = 1;
    group.add(gMesh);
    disposables.push(gGeo, gMat);
  }

  /* ---- district outlines ---- */
  const linePos: number[] = [];
  for (const dd of districts) {
    const y = 0.09;
    const x2 = dd.x + dd.w, z2 = dd.z + dd.d;
    linePos.push(
      dd.x, y, dd.z, x2, y, dd.z,
      x2, y, dd.z, x2, y, z2,
      x2, y, z2, dd.x, y, z2,
      dd.x, y, z2, dd.x, y, dd.z,
    );
  }
  if (linePos.length > 0) {
    const lGeo = new THREE.BufferGeometry();
    lGeo.setAttribute('position', new THREE.Float32BufferAttribute(linePos, 3));
    const lMat = new THREE.LineBasicMaterial({
      color: 0x00c8f0, transparent: true, opacity: 0.16, fog: true,
    });
    const lines = new THREE.LineSegments(lGeo, lMat);
    lines.frustumCulled = false;
    group.add(lines);
    disposables.push(lGeo, lMat);
  }

  return {
    group, streets,
    dispose() { for (const x of disposables) x.dispose(); },
  };
}

/* ---- interval helpers ---- */

function mergeBands(bands: [number, number][]): [number, number][] {
  if (bands.length === 0) return [];
  const sorted = [...bands].sort((a, b) => a[0] - b[0]);
  const merged: [number, number][] = [sorted[0].slice() as [number, number]];
  for (let i = 1; i < sorted.length; i++) {
    const last = merged[merged.length - 1];
    const cur = sorted[i];
    if (cur[0] <= last[1] + 0.001) last[1] = Math.max(last[1], cur[1]);
    else merged.push(cur.slice() as [number, number]);
  }
  return merged;
}

function gaps(merged: [number, number][], lo: number, hi: number): [number, number][] {
  const out: [number, number][] = [];
  if (merged.length === 0) { out.push([lo, hi]); return out; }
  if (merged[0][0] > lo + 0.001) out.push([lo, merged[0][0]]);
  for (let i = 0; i < merged.length - 1; i++) {
    if (merged[i + 1][0] > merged[i][1] + 0.001) out.push([merged[i][1], merged[i + 1][0]]);
  }
  if (merged[merged.length - 1][1] < hi - 0.001) out.push([merged[merged.length - 1][1], hi]);
  return out;
}

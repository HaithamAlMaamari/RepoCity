/**
 * streets.ts — road network between districts.
 *
 * Roads: dark quads. Neon curbs: thin additive strips (cyan/magenta).
 * Intersections: radial glow sprites. District outlines: line segments.
 * No custom shaders anywhere.
 */

import * as THREE from 'three';
import type { DistrictRect, PlotRect, StreetSegment } from '../types';
import type { LayoutCorridor } from '../city/layout';
import { makeRadialGlow } from './textures';
import { FACADE_GLSL, fogFragmentGLSL } from '../city/facade-shader';

export interface StreetNetwork {
  group: THREE.Group;
  streets: StreetSegment[];
  dispose(): void;
}

/**
 * Turn the road strips the treemap reserved into street segments.
 *
 * Pure, and separated from the mesh building so the network can be asserted
 * without a WebGL context or a DOM — the old derivation could not be tested at
 * all, which is part of why nobody noticed it was producing one interior
 * street for a five-thousand-file city.
 *
 * Two strips of the same width that share a line and touch are joined, because
 * adjacent directories each reserve their own ring and the pair is physically
 * one street; leaving them split would double the segment count and give
 * traffic two half-roads to choose between instead of one through route.
 */
export function planStreets(corridors: readonly LayoutCorridor[]): StreetSegment[] {
  const segments = corridors
    .filter((c) => c.w > 0 && c.d > 0)
    .map((c): StreetSegment => (c.axis === 'x'
      ? { x1: c.x, z1: c.z + c.d / 2, x2: c.x + c.w, z2: c.z + c.d / 2, width: c.d, axis: 'x', kind: 'internal' }
      : { x1: c.x + c.w / 2, z1: c.z, x2: c.x + c.w / 2, z2: c.z + c.d, width: c.w, axis: 'z', kind: 'internal' }));

  const byLine = new Map<string, StreetSegment[]>();
  for (const s of segments) {
    // Quantised so two rings that abut are recognised as collinear.
    const line = s.axis === 'x'
      ? `x:${s.z1.toFixed(2)}:${s.width.toFixed(2)}`
      : `z:${s.x1.toFixed(2)}:${s.width.toFixed(2)}`;
    const bucket = byLine.get(line);
    if (bucket) bucket.push(s); else byLine.set(line, [s]);
  }

  const merged: StreetSegment[] = [];
  for (const bucket of byLine.values()) {
    const along = (s: StreetSegment): [number, number] => s.axis === 'x' ? [s.x1, s.x2] : [s.z1, s.z2];
    bucket.sort((a, b) => along(a)[0] - along(b)[0]);
    let [start, end] = along(bucket[0]);
    const flush = (): void => {
      const head = bucket[0];
      merged.push(head.axis === 'x'
        ? { ...head, x1: start, x2: end }
        : { ...head, z1: start, z2: end });
    };
    for (let i = 1; i < bucket.length; i++) {
      const [s1, s2] = along(bucket[i]);
      if (s1 <= end + 0.05) end = Math.max(end, s2);
      else { flush(); start = s1; end = s2; }
    }
    flush();
  }
  return merged;
}

export function buildStreetNetwork(
  districts: DistrictRect[],
  cityBounds: { minX: number; maxX: number; minZ: number; maxZ: number },
  plots: readonly PlotRect[] = [],
  corridors: readonly LayoutCorridor[] = [],
): StreetNetwork {
  const group = new THREE.Group();
  const streets: StreetSegment[] = [];
  const disposables: { dispose(): void }[] = [];

  const { minX, maxX, minZ, maxZ } = cityBounds;
  const plotSpan = medianPlotSpan(plots, cityBounds);

  // Every repository gets a connected transit ring in the two-unit margin
  // around the treemap, so small or tightly packed cities still have roads.
  const ringWidth = 1.9;
  const ringMinX = minX + ringWidth / 2;
  const ringMaxX = maxX - ringWidth / 2;
  const ringMinZ = minZ + ringWidth / 2;
  const ringMaxZ = maxZ - ringWidth / 2;
  const ringStreets: StreetSegment[] = [
    { x1: ringMinX, z1: ringMinZ, x2: ringMaxX, z2: ringMinZ, width: ringWidth, axis: 'x', kind: 'perimeter' },
    { x1: ringMinX, z1: ringMaxZ, x2: ringMaxX, z2: ringMaxZ, width: ringWidth, axis: 'x', kind: 'perimeter' },
    { x1: ringMinX, z1: ringMinZ, x2: ringMinX, z2: ringMaxZ, width: ringWidth, axis: 'z', kind: 'perimeter' },
    { x1: ringMaxX, z1: ringMinZ, x2: ringMaxX, z2: ringMaxZ, width: ringWidth, axis: 'z', kind: 'perimeter' },
  ];

  /* ---- surveyed city plate: the repository has a clear footprint ---- */
  const plateGeo = new THREE.PlaneGeometry(maxX - minX, maxZ - minZ);
  plateGeo.rotateX(-Math.PI / 2);
  // The plate used to be darker than the unfogged far ground around it, and
  // scene fog then took it the rest of the way down, so from an overview the
  // repository read as a black hole punched into a lit plain. It is still
  // the darkest large surface in the scene, just no longer zero, and the
  // capped fog keeps the footprint legible at thumbnail distance.
  const plateMat = new THREE.MeshBasicMaterial({ color: 0x0c1a2c, fog: true });
  applyGroundShading(plateMat, `repocity-city-plate-v2:${plotSpan.toFixed(3)}`, plotSpan);
  const plate = new THREE.Mesh(plateGeo, plateMat);
  plate.position.set((minX + maxX) / 2, -0.04, (minZ + maxZ) / 2);
  plate.frustumCulled = false;
  plate.renderOrder = -1;
  group.add(plate);
  disposables.push(plateGeo, plateMat);

  /* ---- file plot boundaries preserve the treemap allocation on ground ---- */
  if (plots.length > 0) {
    const plotPos: number[] = [];
    for (const plot of plots) {
      // Sub-line-width parcels cannot show a separate boundary without
      // visually cutting through their building at normal camera distances.
      if (plot.w < 0.05 || plot.d < 0.05) continue;
      const x2 = plot.x + plot.w;
      const z2 = plot.z + plot.d;
      const y = 0.065;
      plotPos.push(
        plot.x, y, plot.z, x2, y, plot.z,
        x2, y, plot.z, x2, y, z2,
        x2, y, z2, plot.x, y, z2,
        plot.x, y, z2, plot.x, y, plot.z,
      );
    }
    const plotGeo = new THREE.BufferGeometry();
    plotGeo.setAttribute('position', new THREE.Float32BufferAttribute(plotPos, 3));
    const plotMat = new THREE.LineBasicMaterial({ color: 0x536078, transparent: true, opacity: 0.16, fog: true });
    const plotLines = new THREE.LineSegments(plotGeo, plotMat);
    plotLines.frustumCulled = false;
    group.add(plotLines);
    disposables.push(plotGeo, plotMat);
  }

  /*
   * The network is exactly what the treemap reserved. A repository with no
   * directories reserves nothing, so it still needs a legible grid of its own.
   */
  const internalStreets = planStreets(corridors)
    .filter((street) => streetLength(street) >= 2 && street.width >= 0.4);
  if (internalStreets.length === 0) {
    const width = Math.max(3.0, Math.min(maxX - minX, maxZ - minZ) * 0.045);
    const xMid = (minX + maxX) / 2;
    const zMid = (minZ + maxZ) / 2;
    internalStreets.push(
      { x1: minX, z1: zMid - width * 1.5, x2: maxX, z2: zMid - width * 1.5, width, axis: 'x', kind: 'internal' },
      { x1: minX, z1: zMid + width * 1.5, x2: maxX, z2: zMid + width * 1.5, width, axis: 'x', kind: 'internal' },
      { x1: xMid - width * 1.5, z1: minZ, x2: xMid - width * 1.5, z2: maxZ, width, axis: 'z', kind: 'internal' },
      { x1: xMid + width * 1.5, z1: minZ, x2: xMid + width * 1.5, z2: maxZ, width, axis: 'z', kind: 'internal' },
    );
  }
  streets.push(...ringStreets, ...internalStreets);

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
    const m = new THREE.MeshBasicMaterial({ color: 0x090d1a, fog: true });
    // Roads stay the darkest surface: half the plate's lift keeps the
    // asphalt/plot contrast that makes the grid legible from above.
    applyGroundShading(m, `repocity-road-surface-v2:${plotSpan.toFixed(3)}`, plotSpan, [0.010, 0.021, 0.036]);
    const mesh = new THREE.Mesh(g, m);
    mesh.frustumCulled = false;
    group.add(mesh);
    disposables.push(g, m);
  }

  /* ---- neon curb strips ---- */
  const cyanPos: number[] = [];
  const magPos: number[] = [];
  const curbY = 0.07;
  // A 0.10-wide curb is well under a pixel once the whole repository fits in
  // a thumbnail, so the neon road network used to disappear exactly when it
  // was the only thing left to read. Wider, brighter, and unfogged: the
  // street grid is the shape of the city from above.
  const strip = 0.16;
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
      // Unfogged, so the opacity comes back down: at a small repository's
      // resting distance three's fog only dimmed these by ~29%, and the
      // curbs must not read brighter up close than they did before.
      color, transparent: true, opacity: 0.44,
      blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
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
      if (sz.x1 < sx.x1 || sz.x1 > sx.x2 || sx.z1 < sz.z1 || sx.z1 > sz.z2) continue;
      points.push({ x: sz.x1, z: sx.z1 });
    }
    if (points.length >= 80) break;
  }
  if (points.length > 0) {
    const gGeo = new THREE.PlaneGeometry(4.5, 4.5);
    gGeo.rotateX(-Math.PI / 2);
    const gMat = new THREE.MeshBasicMaterial({
      map: glowTex, transparent: true, opacity: 0.38,
      blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
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
    disposables.push(gMesh, gGeo, gMat);
  }

  /* ---- district survey perimeters and corner extent markers ---- */
  const linePos: number[] = [];
  const lineColor: number[] = [];
  const surveyPosts: { x: number; z: number; color: number }[] = [];
  const surveyColor = new THREE.Color();
  const addSurveySegment = (x1: number, y1: number, z1: number, x2: number, y2: number, z2: number) => {
    linePos.push(x1, y1, z1, x2, y2, z2);
    lineColor.push(surveyColor.r, surveyColor.g, surveyColor.b, surveyColor.r, surveyColor.g, surveyColor.b);
  };
  for (const dd of districts) {
    districtColor(dd.name ?? '', surveyColor);
    const y = 0.11;
    const x2 = dd.x + dd.w, z2 = dd.z + dd.d;
    addSurveySegment(dd.x, y, dd.z, x2, y, dd.z);
    addSurveySegment(x2, y, dd.z, x2, y, z2);
    addSurveySegment(x2, y, z2, dd.x, y, z2);
    addSurveySegment(dd.x, y, z2, dd.x, y, dd.z);
    const tick = Math.max(0.8, Math.min(3.0, Math.min(dd.w, dd.d) * 0.10));
    const corners = [
      [dd.x, dd.z, 1, 1], [x2, dd.z, -1, 1],
      [x2, z2, -1, -1], [dd.x, z2, 1, -1],
    ] as const;
    for (const [x, z, dx, dz] of corners) {
      addSurveySegment(x, y, z, x + dx * tick, y, z);
      addSurveySegment(x, y, z, x, y, z + dz * tick);
      surveyPosts.push({ x, z, color: surveyColor.getHex() });
    }
  }
  if (linePos.length > 0) {
    const lGeo = new THREE.BufferGeometry();
    lGeo.setAttribute('position', new THREE.Float32BufferAttribute(linePos, 3));
    lGeo.setAttribute('color', new THREE.Float32BufferAttribute(lineColor, 3));
    const lMat = new THREE.LineBasicMaterial({
      vertexColors: true, transparent: true, opacity: 0.68, fog: true,
    });
    const lines = new THREE.LineSegments(lGeo, lMat);
    lines.frustumCulled = false;
    group.add(lines);
    disposables.push(lGeo, lMat);
  }
  if (surveyPosts.length > 0) {
    const postGeo = new THREE.CylinderGeometry(0.22, 0.22, 3.6, 6);
    postGeo.translate(0, 1.8, 0);
    const postMat = new THREE.MeshBasicMaterial({ fog: true });
    const posts = new THREE.InstancedMesh(postGeo, postMat, surveyPosts.length);
    const beaconGeo = new THREE.SphereGeometry(0.42, 8, 6);
    const beaconMat = new THREE.MeshBasicMaterial({ fog: false });
    const beacons = new THREE.InstancedMesh(beaconGeo, beaconMat, surveyPosts.length);
    const dummy = new THREE.Object3D();
    const color = new THREE.Color();
    for (let i = 0; i < surveyPosts.length; i++) {
      const post = surveyPosts[i];
      dummy.position.set(post.x, 0.1, post.z);
      dummy.updateMatrix();
      posts.setMatrixAt(i, dummy.matrix);
      posts.setColorAt(i, color.setHex(post.color));
      dummy.position.y = 3.85;
      dummy.updateMatrix();
      beacons.setMatrixAt(i, dummy.matrix);
      beacons.setColorAt(i, color);
    }
    posts.instanceMatrix.needsUpdate = true;
    if (posts.instanceColor) posts.instanceColor.needsUpdate = true;
    beacons.instanceMatrix.needsUpdate = true;
    if (beacons.instanceColor) beacons.instanceColor.needsUpdate = true;
    posts.frustumCulled = false;
    beacons.frustumCulled = false;
    group.add(posts, beacons);
    disposables.push(posts, beacons, postGeo, postMat, beaconGeo, beaconMat);
  }

  return {
    group, streets,
    dispose() { for (const x of disposables) x.dispose(); },
  };
}

/**
 * Capped fog for a ground surface, plus a faint lift so the city footprint
 * keeps a colour at overview range. `MeshBasicMaterial` has no emissive, so
 * the lift goes straight into `diffuseColor`.
 *
 * The gate is the same one the buildings use, fed with the median FILE PLOT
 * size: the ground stops being legible for exactly the reason the buildings
 * do — the parcels it is divided into fall below a handful of pixels. In a
 * small repository the plots are tens of pixels wide, `rcAssist` is 0, and
 * the surface renders exactly as it did before.
 */
function applyGroundShading(
  material: THREE.MeshBasicMaterial,
  cacheKey: string,
  referenceSpan: number,
  lift: readonly [number, number, number] = [0.020, 0.042, 0.070],
): void {
  const liftGlsl = `vec3( ${lift[0]}, ${lift[1]}, ${lift[2]} )`;
  const spanGlsl = referenceSpan.toFixed(4);
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vGroundWorld;')
      .replace('#include <fog_vertex>', `
        vGroundWorld = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;
        #include <fog_vertex>`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec3 vGroundWorld;
        float rcGroundAssist = 0.0;
${FACADE_GLSL}`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        rcGroundAssist = rcAssist( vGroundWorld, ${spanGlsl} );
        diffuseColor.rgb += ${liftGlsl} * rcGroundAssist;`)
      .replace('#include <fog_fragment>', fogFragmentGLSL('vGroundWorld', 'rcGroundAssist', '0.25'));
  };
  material.customProgramCacheKey = () => cacheKey;
}

/** Median plot footprint — the ground's equivalent of a building span. */
function medianPlotSpan(plots: readonly PlotRect[], cityBounds: { minX: number; maxX: number }): number {
  if (plots.length === 0) return Math.max(1, (cityBounds.maxX - cityBounds.minX) / 8);
  const spans = plots.map((plot) => Math.min(plot.w, plot.d)).sort((a, b) => a - b);
  return Math.max(0.25, spans[spans.length >> 1]);
}

function districtColor(name: string, target: THREE.Color): THREE.Color {
  let hash = 2166136261;
  for (let i = 0; i < name.length; i++) hash = Math.imul(hash ^ name.charCodeAt(i), 16777619);
  const palette = [0x00c8f0, 0xff2d8a, 0xffb347, 0x7f7cff];
  return target.setHex(palette[(hash >>> 0) % palette.length]);
}

function streetLength(street: StreetSegment): number {
  return street.axis === 'x' ? street.x2 - street.x1 : street.z2 - street.z1;
}

/* ---- interval helpers ---- */

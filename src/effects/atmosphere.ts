/**
 * atmosphere.ts — everything between the city and the sky:
 *   far ground, city glow pools, horizon haze ring,
 *   low fog bands, sweeping search beams.
 * All MeshBasicMaterial + CanvasTextures. No shaders.
 *
 * A distance-gated glow halo was tried here and removed: camera distance
 * scales with repository size (every repo rests at ~2.6 city radii), so a
 * halo cannot tell a close-up from an overview and simply washed out both.
 * Distance readability belongs on the buildings, where the shader can
 * measure a building's actual on-screen size — see city/facade-shader.ts.
 */

import * as THREE from 'three';
import { makeRadialGlow, makeVerticalBand, makeSoftSquare } from './textures';

export interface Atmosphere {
  group: THREE.Group;
  update(dt: number): void;
  dispose(): void;
}

export function buildAtmosphere(citySize: number, maxBuildingHeight: number): Atmosphere {
  const group = new THREE.Group();
  const disposables: { dispose(): void }[] = [];
  const S = Math.max(citySize, 120);

  /*
   * ---- far ground (dark disc) ----
   *
   * `fog: true` is load-bearing. Unfogged, this disc rendered flat 0x1a2a46
   * all the way to its rim, which met the sky dome in a hard horizon line and
   * surrounded every city with an obviously fake, uniformly lit plain 14-27
   * city-spans wide — the scene fog could not touch it, and the haze ring
   * meant to terminate it sits at S*3.4, *inside* it.
   *
   * Fogged, the rim sits far beyond the distance at which FogExp2 saturates,
   * so the ground fades to exactly the fog colour and no edge exists to see.
   * The radius stays generous for that reason: shrinking it would bring the
   * rim back inside the fog's reach and make the edge visible again.
   */
  const gndGeo = new THREE.CircleGeometry(S * 6, 48);
  const gndMat = new THREE.MeshBasicMaterial({
    color: 0x16243c,
    fog: true,
  });
  const gnd = new THREE.Mesh(gndGeo, gndMat);
  gnd.rotation.x = -Math.PI / 2;
  gnd.position.y = -0.3;
  gnd.frustumCulled = false;
  gnd.renderOrder = -3;
  group.add(gnd);
  disposables.push(gndGeo, gndMat);

  /* ---- structured outer city grid: the world should not end in black ---- */
  const gridRange = S * 4.5;
  const gridStep = 12;
  const gridPos: number[] = [];
  for (let p = -gridRange; p <= gridRange; p += gridStep) {
    gridPos.push(-gridRange, -0.24, p, gridRange, -0.24, p);
    gridPos.push(p, -0.24, -gridRange, p, -0.24, gridRange);
  }
  const gridGeo = new THREE.BufferGeometry();
  gridGeo.setAttribute('position', new THREE.Float32BufferAttribute(gridPos, 3));
  const gridMat = new THREE.LineBasicMaterial({
    color: 0x1a2942,
    transparent: true,
    opacity: 0.22,
    fog: true,
  });
  const grid = new THREE.LineSegments(gridGeo, gridMat);
  grid.frustumCulled = false;
  grid.renderOrder = -1;
  group.add(grid);
  disposables.push(gridGeo, gridMat);

  /* ---- city glow pools on the ground ---- */
  const glowTex = makeRadialGlow(256);
  disposables.push(glowTex);
  const pools: { x: number; z: number; scale: number; color: number; opacity: number }[] = [
    { x: -S * 0.45, z: -S * 0.5, scale: S * 1.6, color: 0x0a3a55, opacity: 0.14 },
    { x: S * 0.55, z: S * 0.35, scale: S * 1.4, color: 0x55103a, opacity: 0.12 },
    { x: 0, z: 0, scale: S * 2.2, color: 0x14103a, opacity: 0.18 },
  ];
  for (const p of pools) {
    const g = new THREE.PlaneGeometry(1, 1);
    const m = new THREE.MeshBasicMaterial({
      map: glowTex, color: p.color, transparent: true, opacity: p.opacity,
      blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
    });
    const mesh = new THREE.Mesh(g, m);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(p.x, -0.2, p.z);
    mesh.scale.set(p.scale, p.scale, 1);
    mesh.frustumCulled = false;
    mesh.renderOrder = -2;
    group.add(mesh);
    disposables.push(g, m);
  }

  /* ---- horizon haze ring ---- */
  const hazeTex = makeVerticalBand(8, 256, 0.3);
  const hazeGeo = new THREE.CylinderGeometry(S * 3.4, S * 3.4, 150, 48, 1, true);
  const hazeMat = new THREE.MeshBasicMaterial({
    map: hazeTex, color: 0x1a1038, transparent: true, opacity: 0.38,
    side: THREE.BackSide, depthWrite: false, fog: false,
  });
  const haze = new THREE.Mesh(hazeGeo, hazeMat);
  haze.position.y = 45;
  haze.frustumCulled = false;
  haze.renderOrder = -1;
  group.add(haze);
  disposables.push(hazeGeo, hazeMat, hazeTex);

  /* ---- low fog bands ---- */
  const fogTex = makeSoftSquare(256);
  disposables.push(fogTex);
  const bands = [
    { y: maxBuildingHeight * 0.24, opacity: 0.07, scale: S * 1.5, color: 0x201040 },
    { y: maxBuildingHeight * 0.45, opacity: 0.045, scale: S * 1.7, color: 0x101c40 },
  ];
  for (const b of bands) {
    const g = new THREE.PlaneGeometry(1, 1);
    const m = new THREE.MeshBasicMaterial({
      map: fogTex, color: b.color, transparent: true, opacity: b.opacity,
      depthWrite: false, fog: false,
    });
    const mesh = new THREE.Mesh(g, m);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.y = b.y;
    mesh.scale.set(b.scale, b.scale, 1);
    mesh.frustumCulled = false;
    mesh.renderOrder = 5;
    group.add(mesh);
    disposables.push(g, m);
  }

  /* ---- search beams (rotating cones) ---- */
  const beamPivots: THREE.Group[] = [];
  const beamColors = [0x0a50a0, 0x701a60, 0x0a48a0, 0x5a1a70, 0x0a50a0, 0x801a50];
  for (let i = 0; i < 4; i++) {
    const h = 130 + (i % 3) * 25;
    const bGeo = new THREE.ConeGeometry(1.35, h, 12, 1, true);
    const bMat = new THREE.MeshBasicMaterial({
      color: beamColors[i], transparent: true, opacity: 0.055,
      blending: THREE.AdditiveBlending, depthWrite: false,
      side: THREE.DoubleSide, fog: true,
    });
    const cone = new THREE.Mesh(bGeo, bMat);
    cone.position.y = h / 2;
    cone.rotation.x = 0.10 + (i % 3) * 0.03;

    const pivot = new THREE.Group();
    const ang = (i / 4) * Math.PI * 2;
    pivot.position.set(Math.cos(ang) * S * 0.32, 0, Math.sin(ang) * S * 0.32);
    pivot.rotation.y = ang;
    pivot.userData.speed = (0.25 + (i % 3) * 0.1) * (i % 2 === 0 ? 1 : -1);
    pivot.add(cone);
    group.add(pivot);
    beamPivots.push(pivot);
    disposables.push(bGeo, bMat);
  }

  const update = (dt: number) => {
    for (const p of beamPivots) {
      p.rotation.y += p.userData.speed * dt;
    }
  };

  return {
    group, update,
    dispose() { for (const x of disposables) x.dispose(); },
  };
}

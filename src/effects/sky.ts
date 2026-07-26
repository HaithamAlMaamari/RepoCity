/**
 * sky.ts — gradient dome (tiny proven shader) + twinkling star points.
 */

import * as THREE from 'three';
import { makeRadialGlow } from './textures';

export interface Sky {
  group: THREE.Group;
  update(dt: number): void;
  dispose(): void;
}

export function buildSky(): Sky {
  const group = new THREE.Group();
  const disposables: { dispose(): void }[] = [];

  /* ---- dome ---- */
  const domeGeo = new THREE.SphereGeometry(1800, 40, 20);
  const domeMat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    vertexShader: /* glsl */ `
      varying float vY;
      void main() {
        vY = normalize( position ).y;
        gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
      }`,
    fragmentShader: /* glsl */ `
      varying float vY;
      void main() {
        float t = clamp( vY * 0.5 + 0.5, 0.0, 1.0 );
        vec3 below  = vec3( 0.008, 0.006, 0.028 );
        vec3 horizon= vec3( 0.058, 0.040, 0.125 );
        vec3 zenith = vec3( 0.016, 0.010, 0.055 );
        vec3 sky = mix( below, horizon, smoothstep( 0.32, 0.5, t ) );
        sky = mix( sky, zenith, smoothstep( 0.54, 0.92, t ) );
        // magenta smog band above horizon
        float smog = smoothstep( 0.5, 0.56, t ) * ( 1.0 - smoothstep( 0.56, 0.78, t ) );
        sky += vec3( 0.065, 0.020, 0.080 ) * smog;
        // cyan spill right at horizon
        float cy = smoothstep( 0.47, 0.53, t ) * ( 1.0 - smoothstep( 0.53, 0.62, t ) );
        sky += vec3( 0.015, 0.050, 0.085 ) * cy;
        gl_FragColor = vec4( sky, 1.0 );
      }`,
  });
  const dome = new THREE.Mesh(domeGeo, domeMat);
  dome.frustumCulled = false;
  dome.renderOrder = -5;
  group.add(dome);
  disposables.push(domeGeo, domeMat);

  /* ---- stars (points, upper hemisphere) ---- */
  const starCount = 700;
  const pos = new Float32Array(starCount * 3);
  const col = new Float32Array(starCount * 3);
  for (let i = 0; i < starCount; i++) {
    // random point on upper hemisphere shell
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(0.25 + Math.random() * 0.75); // bias high
    const r = 1600;
    pos[i * 3] = r * Math.sin(phi) * Math.cos(theta);
    pos[i * 3 + 1] = r * Math.cos(phi);
    pos[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta);
    const w = 0.5 + Math.random() * 0.5;
    const blue = Math.random() < 0.3;
    col[i * 3] = w * (blue ? 0.8 : 1.0);
    col[i * 3 + 1] = w * 0.9;
    col[i * 3 + 2] = w * (blue ? 1.0 : 0.85);
  }
  const starGeo = new THREE.BufferGeometry();
  starGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  starGeo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const starTex = makeRadialGlow(32);
  const starMat = new THREE.PointsMaterial({
    size: 3.5, map: starTex, vertexColors: true,
    transparent: true, opacity: 0.34, depthWrite: false,
    blending: THREE.AdditiveBlending, sizeAttenuation: true, fog: false,
  });
  const stars = new THREE.Points(starGeo, starMat);
  stars.frustumCulled = false;
  stars.renderOrder = -4;
  group.add(stars);
  disposables.push(starGeo, starMat, starTex);

  /* ---- subtle twinkle by modulating material opacity ---- */
  let t = 0;
  const update = (dt: number) => {
    t += dt;
    starMat.opacity = 0.30 + Math.sin(t * 0.8) * 0.04;
  };

  return {
    group, update,
    dispose() { for (const x of disposables) x.dispose(); },
  };
}

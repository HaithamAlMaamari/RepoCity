/**
 * sky.ts — gradient dome (tiny proven shader) + twinkling star points.
 */

import * as THREE from 'three';
import type { RandomSource } from '../core/random';
import { makeRadialGlow } from './textures';

export interface Sky {
  group: THREE.Group;
  update(dt: number): void;
  dispose(): void;
}

/**
 * The colour the night resolves to at infinite distance.
 *
 * One definition, used by the renderer's clear colour, the scene fog, and the
 * dome's below-horizon band. They have to agree: the far ground fades to the
 * fog colour, so if the dome's lower band differs the two meet in a visible
 * horizon line — which is exactly what the city used to sit inside, with a
 * lighter sky above a darker plain.
 */
export const NIGHT_COLOR = 0x0a0818;

export function buildSky(random: RandomSource): Sky {
  const group = new THREE.Group();
  const disposables: { dispose(): void }[] = [];

  /* ---- dome ---- */
  const domeGeo = new THREE.SphereGeometry(1800, 40, 20);
  const domeMat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: {
      // Matched to the scene fog so the fogged ground and the sky below the
      // horizon are the same colour and no seam can appear between them.
      uBelow: { value: new THREE.Color(NIGHT_COLOR) },
    },
    vertexShader: /* glsl */ `
      varying float vY;
      void main() {
        vY = normalize( position ).y;
        gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
      }`,
    fragmentShader: /* glsl */ `
      varying float vY;
      uniform vec3 uBelow;
      void main() {
        float t = clamp( vY * 0.5 + 0.5, 0.0, 1.0 );
        vec3 below  = uBelow;
        vec3 horizon= vec3( 0.058, 0.040, 0.125 );
        vec3 zenith = vec3( 0.016, 0.010, 0.055 );
        /*
         * The glow band starts AT eye level (t = 0.5) and brightens upward,
         * rather than reaching full brightness by the time it gets there.
         * The ground fades to uBelow, so if the sky were already at its
         * bright horizon colour where the two meet, the difference would draw
         * exactly the hard horizon line this gradient exists to avoid.
         */
        vec3 sky = mix( below, horizon, smoothstep( 0.5, 0.66, t ) );
        sky = mix( sky, zenith, smoothstep( 0.68, 0.94, t ) );
        // magenta smog band, lifted clear of the horizon for the same reason
        float smog = smoothstep( 0.58, 0.66, t ) * ( 1.0 - smoothstep( 0.66, 0.84, t ) );
        sky += vec3( 0.065, 0.020, 0.080 ) * smog;
        // cyan spill, fading in just above eye level
        float cy = smoothstep( 0.5, 0.58, t ) * ( 1.0 - smoothstep( 0.58, 0.70, t ) );
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
    const theta = random() * Math.PI * 2;
    const phi = Math.acos(0.25 + random() * 0.75); // bias high
    const r = 1600;
    pos[i * 3] = r * Math.sin(phi) * Math.cos(theta);
    pos[i * 3 + 1] = r * Math.cos(phi);
    pos[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta);
    const w = 0.5 + random() * 0.5;
    const blue = random() < 0.3;
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

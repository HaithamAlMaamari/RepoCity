/**
 * selection-marker.ts — say which building is selected.
 *
 * Selecting a file in the City Index flies the camera to its building, and
 * until now that was the whole answer: the shader multiplied the building's
 * own glow by 1.55 and nothing else changed. That fails in the exact case it
 * is needed. The boost is a MULTIPLIER on emissive the building already has,
 * so a mostly-dark building — which most of them are, by design, since walls
 * are black and only windows carry colour — stays mostly dark. And once the
 * camera has arrived, the building fills the frame with no unselected
 * neighbour beside it to compare against, so even a real brightness
 * difference has nothing to read against.
 *
 * The marker therefore has to be additive geometry rather than a change to
 * the facade. Tinting the wall would break the rule the city is built on —
 * walls stay black, windows carry the colour — and that rule has already been
 * violated once by a highlight that washed whole buildings in a single hue.
 *
 * A full twelve-edge outline, not corner brackets. Brackets were tried first,
 * on the theory that a cage reads as a crate around the building. Rendered
 * against a real city they were unusable: on `main.ts` in this repository —
 * 23.7 x 72 x 18 units — the arms came to about five units, so all that
 * survived was four faint ticks at roof height, with the ground-level ones
 * buried among neighbouring buildings. Four marks floating in the sky is a
 * worse answer to "which building" than no marker at all. In a city already
 * made of bright window grids, a marker has to enclose something to be read
 * as enclosing it.
 *
 * White, because no language in the palette is near-white — see palette.ts,
 * where the closest are pale cyans around [0.55, 0.82, 0.95]. A coloured
 * marker would read as a language, which is the one thing colour already
 * means here.
 */
import * as THREE from 'three';

import type { Building } from './city';

/**
 * Horizontal padding around the core footprint.
 *
 * The core is not the widest part of a building: `planCap` gives every
 * profile a brim above it, and the widest is the depot's at `w * 1.06`. A
 * box drawn on the core alone would sit inside its own building's brim.
 */
const WIDTH_PAD = 1.1;

/** Vertical padding, as a share of height — clears the spire tip. */
const HEIGHT_PAD = 1.02;

export interface MarkerBox {
  /** Centre in world space, y at mid-height. */
  center: [number, number, number];
  /** Full extent on each axis. */
  size: [number, number, number];
}

/**
 * The box a marker should enclose.
 *
 * Built from `totalHeight`, not `scale[1]`: `scale[1]` is the core, and the
 * crown and spire above it are what make a tower recognisable. A marker that
 * stopped at the core would cut the building's most distinctive part out of
 * its own selection.
 */
export function markerBox(b: Building): MarkerBox {
  const w = Math.max(b.scale[0], 0) * WIDTH_PAD;
  const d = Math.max(b.scale[2], 0) * WIDTH_PAD;
  const h = Math.max(b.totalHeight, 0) * HEIGHT_PAD;
  return { center: [b.position[0], h / 2, b.position[2]], size: [w, h, d] };
}

/** Every edge of a box: 4 vertical, 4 along the top, 4 along the base. */
export const EDGE_COUNT = 12;

/**
 * The twelve edges of `box`, as line-segment endpoint pairs in city space.
 *
 * The base rectangle is kept even though neighbouring buildings usually hide
 * most of it. Where it does show it is the most useful part of the marker,
 * because it sits at street level among the parcel lines and says which plot
 * is meant — the roof rectangle alone floats with nothing to relate it to.
 */
export function edgePositions(box: MarkerBox): Float32Array {
  const [cx, cy, cz] = box.center;
  const hx = box.size[0] / 2;
  const hy = box.size[1] / 2;
  const hz = box.size[2] / 2;

  const out = new Float32Array(EDGE_COUNT * 2 * 3);
  let o = 0;
  const line = (
    ax: number, ay: number, az: number,
    bx: number, by: number, bz: number,
  ): void => {
    out[o++] = cx + ax; out[o++] = cy + ay; out[o++] = cz + az;
    out[o++] = cx + bx; out[o++] = cy + by; out[o++] = cz + bz;
  };

  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      // Vertical edge at this corner.
      line(sx * hx, -hy, sz * hz, sx * hx, hy, sz * hz);
    }
  }
  for (const sy of [-1, 1]) {
    // The rectangle at this height, walked as four segments.
    line(-hx, sy * hy, -hz, hx, sy * hy, -hz);
    line(hx, sy * hy, -hz, hx, sy * hy, hz);
    line(hx, sy * hy, hz, -hx, sy * hy, hz);
    line(-hx, sy * hy, hz, -hx, sy * hy, -hz);
  }
  return out;
}

export interface SelectionMarker {
  object: THREE.Object3D;
  /** Show the reticle around `b`; `null` hides it. */
  show(b: Building | null): void;
  update(dt: number): void;
  dispose(): void;
}

/**
 * How far the marker dips and recovers, and how fast.
 *
 * It never fades far. The pulse is there to separate the marker from the
 * city's own static edges, not to make it come and go — a marker that
 * disappears for part of its cycle reintroduces the question it answers.
 */
const PULSE_DEPTH = 0.3;
const PULSE_RATE = 3.2;
const BASE_OPACITY = 1;

/**
 * One reusable reticle.
 *
 * The buffer is allocated once at full size and rewritten on each selection
 * rather than rebuilt, so selecting file after file down the index does not
 * churn geometry.
 *
 * Coordinates are the city's own, not the world's — the marker is added to
 * `cityRoot`, which already carries the centring offset, so `markerBox` can
 * read building positions straight through.
 */
export function createSelectionMarker(): SelectionMarker {
  const geometry = new THREE.BufferGeometry();
  const positions = new THREE.BufferAttribute(new Float32Array(EDGE_COUNT * 2 * 3), 3);
  positions.setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute('position', positions);

  const material = new THREE.LineBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: BASE_OPACITY,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });

  const object = new THREE.LineSegments(geometry, material);
  object.visible = false;
  object.frustumCulled = false;
  // Drawn after the city so the additive blend lands on a finished frame.
  object.renderOrder = 3;

  let time = 0;

  return {
    object,
    show(b) {
      if (!b) { object.visible = false; return; }
      (positions.array as Float32Array).set(edgePositions(markerBox(b)));
      positions.needsUpdate = true;
      geometry.computeBoundingSphere();
      object.visible = true;
      time = 0;
    },
    update(dt) {
      if (!object.visible) return;
      time += dt;
      material.opacity = BASE_OPACITY - PULSE_DEPTH * (0.5 - 0.5 * Math.cos(time * PULSE_RATE));
    },
    dispose() {
      geometry.dispose();
      material.dispose();
    },
  };
}

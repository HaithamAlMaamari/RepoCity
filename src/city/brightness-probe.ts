/**
 * brightness-probe.ts — what the facade shader is *actually* fed.
 *
 * Stage 3 of the visual pass is about brightness consistency, and its first
 * question is which of the four candidate mechanisms still carries real
 * variance now that Stage 2 has reshaped every plot. That question cannot be
 * answered from a synthetic fixture — a uniform grid has given the wrong
 * answer twice — and it cannot be answered by reading the GLSL either,
 * because the inputs come from the solved camera against a real repository.
 *
 * So this module recomputes, on the CPU, exactly the quantities the fragment
 * shader derives per building: `rcAssist` and the window colour. It imports
 * the same constants the GLSL is *generated* from, so the two cannot drift:
 * if `ASSIST_NONE_PX` changes, this changes with it.
 *
 * Two deliberate approximations, both stated rather than hidden:
 *  - `rcPixelWorldScale` is a screen-space derivative of world position. Here
 *    it is the analytic perspective scale at the building's centre distance,
 *    which is exact for a surface facing the camera and slightly optimistic
 *    for one seen edge-on. It is the right quantity for "how big is this
 *    building on screen", which is what the ramp asks.
 *  - Per-floor jitter (`floorShift`) and the animated `rimPulse` are excluded
 *    from {@link BrightnessSample.windowLuma}; they are reported separately
 *    by {@link floorShiftLumaRange} because they vary *within* one building
 *    rather than between buildings.
 */

import {
  ASSIST_FULL_PX,
  ASSIST_NONE_PX,
  DISTANT_GLOW_GAIN,
  FLOOR_SHIFT_RANGE,
  AMBER_KNEE,
  TINT_OFFSET,
  planSpan,
  luminance,
  normalizeLuma,
} from './facade-shader';
import { languageEmissiveBoost } from './palette';
import type { Building } from './city';
import type { BuildingCategory } from './file-class';

/** The three window-colour anchors, verbatim from `FRAG_EMISSIVE`. */
const COOL: Vec3 = [0.06, 0.62, 0.82];
const MAGENTA: Vec3 = [0.82, 0.12, 0.46];
const WARM: Vec3 = [0.82, 0.46, 0.14];

type Vec3 = [number, number, number];

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function mix3(a: Vec3, b: Vec3, t: number): Vec3 {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

export { luminance, normalizeLuma };

/** GLSL `smoothstep`, for an unnormalised input. */
function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp01((x - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

/**
 * `rcAssist` from facade-shader.ts: 0 = comfortably resolved on screen and
 * shaded exactly as designed, 1 = a handful of pixels wide and given
 * everything.
 */
export function assistForSpanPx(spanPx: number): number {
  return 1 - smoothstep(ASSIST_FULL_PX, ASSIST_NONE_PX, spanPx);
}

/**
 * `rcWindowTint`: the language's position on the cool→magenta→amber ramp.
 *
 * The offset is a RESCALE, not a subtraction — see {@link TINT_OFFSET}. A
 * subtraction caps the reachable position at `1 - TINT_OFFSET` = 0.9, and the
 * amber segment starts above 0.9, so the hero languages could never reach it.
 */
export function windowTint(tint: number, floorShift: number): { et: number; tint: Vec3 } {
  const base = clamp01((tint - TINT_OFFSET) / (1 - TINT_OFFSET));
  // Scaled to the room left inside this language's own zone, so the per-floor
  // jitter can never carry a facade across the amber knee. See AMBER_KNEE.
  const headroom = base < AMBER_KNEE ? AMBER_KNEE - base : 1 - base;
  const et = clamp01(base + floorShift * Math.min(1, headroom / FLOOR_SHIFT_RANGE));
  const t1 = clamp01(et / AMBER_KNEE);
  const t2 = clamp01((et - AMBER_KNEE) / (1 - AMBER_KNEE));
  return { et, tint: mix3(mix3(COOL, MAGENTA, t1), WARM, t2) };
}

/**
 * The window colour a building renders, given its language warmth, its base
 * language colour and a per-floor hue shift. Mirrors `FRAG_EMISSIVE` term for
 * term — the ramp, the base-colour lift and the luminance normalisation — so
 * the numbers this reports are the numbers on screen.
 */
export function windowColor(tint: number, base: Vec3, floorShift: number): Vec3 {
  const { tint: winTint } = windowTint(tint, floorShift);
  const lifted: Vec3 = [base[0] + winTint[0] * 0.5, base[1] + winTint[1] * 0.5, base[2] + winTint[2] * 0.5];
  return normalizeLuma(mix3(winTint, lifted, 0.45));
}

/**
 * Luminance range a single building sweeps across its own floors, from the
 * per-floor hue jitter alone. `floorShift` is scaled by `1 - assist`, so a
 * distant building has no jitter at all and this collapses to a point.
 */
export function floorShiftLumaRange(
  tint: number,
  base: Vec3,
  assist: number,
): { min: number; max: number; ratio: number } {
  const reach = FLOOR_SHIFT_RANGE * (1 - assist);
  let min = Infinity;
  let max = -Infinity;
  // The shift is a hash in 0..1 scaled to `reach`; sampling the closed
  // interval finds the extremes of a ramp that is monotonic in segments.
  for (let step = 0; step <= 32; step++) {
    const luma = luminance(windowColor(tint, base, (reach * step) / 32));
    if (luma < min) min = luma;
    if (luma > max) max = luma;
  }
  return { min, max, ratio: min > 0 ? max / min : 1 };
}

export interface BrightnessSample {
  id: number;
  path: string;
  language: string;
  category: BuildingCategory;
  profile: Building['profile'];
  /** `aSpan`: the horizontal size the distance ramp judges this building by. */
  span: number;
  /** Camera to building centre, in world units. */
  distance: number;
  /** `span` in *device* pixels — the unit `dFdx` works in, not CSS pixels. */
  spanPx: number;
  /** `rcAssist` in 0..1. */
  assist: number;
  /** `rcDistantGain(assist)` — the emissive multiplier assistance applies. */
  windowGain: number;
  /** `aTint`, the language warmth 0..1 that drives the window hue. */
  tint: number;
  /** Window luminance ignoring per-floor jitter, at floorShift = 0. */
  windowLuma: number;
  /** Luminance spread across this one building's floors, from jitter alone. */
  floorSpread: number;
}

export interface ProbeView {
  /** Camera world position. */
  cameraPosition: readonly [number, number, number];
  /** Vertical field of view, in degrees. */
  fov: number;
  /** Drawing-buffer height in device pixels — what derivatives measure in. */
  bufferHeight: number;
  /** World offset applied to the city root, so building coords can be lifted to world. */
  offset: readonly [number, number];
}

/** Per-building shader inputs at one camera pose. */
export function probeBrightness(
  buildings: readonly Building[],
  view: ProbeView,
): BrightnessSample[] {
  const halfFov = (view.fov * Math.PI) / 360;
  const [ox, oz] = view.offset;
  const [cx, cy, cz] = view.cameraPosition;

  return buildings.map((b, id) => {
    const wx = b.position[0] + ox;
    const wy = b.position[1];
    const wz = b.position[2] + oz;
    const distance = Math.hypot(wx - cx, wy - cy, wz - cz);
    // World units per device pixel at this distance, for a vertical-FOV
    // perspective camera: the CPU form of `rcPixelWorldScale`.
    const worldPerPixel = (2 * distance * Math.tan(halfFov)) / view.bufferHeight;
    const span = planSpan(b.scale[0], b.scale[2]);
    const spanPx = span / Math.max(worldPerPixel, 1e-5);
    const assist = assistForSpanPx(spanPx);
    const tint = languageEmissiveBoost(b.language);
    const base = b.color;

    return {
      id,
      path: b.path,
      language: b.language,
      category: b.category,
      profile: b.profile,
      span,
      distance,
      spanPx,
      assist,
      windowGain: 1 + assist * DISTANT_GLOW_GAIN,
      tint,
      windowLuma: luminance(windowColor(tint, base, 0)),
      floorSpread: floorShiftLumaRange(tint, base, assist).ratio,
    };
  });
}

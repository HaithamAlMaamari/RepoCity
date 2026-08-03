/**
 * camera.ts v4.1 — free-viewport framing, cinematic entrance, idle showcase drift.
 *
 * Everything here composes the city against the *free viewport*: the slice of
 * the canvas that no overlay panel covers.  Framing solves for a camera distance
 * plus a lateral and vertical offset so the city lands on that free rectangle
 * the way the author's reference poster has it — skyline height fitted with
 * modest headroom, footprint running off both sides rather than floating in bare
 * ground — identical composition for a 13-file repository and a 17,000-file one,
 * on any aspect ratio, with panels open or closed, and *from every azimuth of
 * the showcase orbit*.
 *
 * v4.1 replaces the framing solve.  It used to be a coupled fixed-point
 * iteration over distance and an NDC bias; at the immersive distances this
 * module composes at, that iteration's gain exceeds one and it settles into a
 * two-cycle instead of a fixed point, so the pose it returned depended on which
 * phase the last pass happened to land on.  Around the orbit that read as a
 * camera which framed the city beautifully from some angles and aimed at empty
 * ground from others.  The solve is now two nested *monotone* root finds, which
 * converge from anywhere and vary continuously with the azimuth — see the note
 * above `CornerFrame`.
 *
 * The module is deliberately DOM-light: every calculation runs on plain rects
 * and numbers, and `measureFreeViewport` is the only browser-only entry point.
 */

import * as THREE from 'three';
import type { RandomSource } from './random';

/* ═══ Tunables ══════════════════════════════════════════ */

/**
 * Resting composition, from the author's reference poster: the skyline height
 * fits the free viewport with modest headroom, and the city is allowed — meant,
 * even — to run past the left and right edges so no empty ground shows at the
 * sides.  Distance therefore comes from the *height* fit; width is whatever
 * that yields, bounded only so a very flat city cannot overflow absurdly.
 */
const REST_HEIGHT_FILL = 0.88;
const MAX_WIDTH_FILL = 1.5;
/**
 * …and the other half of "no empty ground at the sides": the height fit alone
 * leaves gaps at the frame edges from the azimuths where a city presents its
 * narrow diagonal, so the composition also refuses to let the city sit *inside*
 * the free width.  Where the two rules disagree the width wins, the extra height
 * spills off the bottom of the frame — near foreground pavement, which is what
 * makes the pose read as immersive — and the skyline keeps its headroom because
 * the vertical placement pins the top rather than centring (see
 * {@link shotAtDistance}).  Without this the drift visibly breathes in and out
 * as it rounds a rectangular city.
 */
const MIN_WIDTH_FILL = 1.06;
/**
 * Below this many buildings a repository has no meaningful outlier tail and no
 * footprint to speak of: the skyline *is* the handful of towers, so the fit
 * keeps all of them and simply fills the frame rather than overflowing it.
 */
const SMALL_CITY_BUILDINGS = 48;
const SMALL_CITY_HEIGHT_FILL = 0.94;
/** Tallest buildings excluded from the sizing box (outlier lockfile towers). */
const DEFAULT_HEIGHT_PERCENTILE = 0.98;
/**
 * How far above the clipped skyline the framed height may reach before the
 * outliers stop counting.  Keeps one freak tower from shrinking the whole city.
 *
 * This is the single strongest lever on how large the city reads, and it only
 * bites on repositories that actually have an outlier — which is most of them,
 * because one landmark tower reaches 72 while the ordinary skyline tops out at
 * 30.  At 2.4 the solver was asked to fit a box 2.4× taller than the real
 * skyline, so the city filled its height budget with empty air above the roofs
 * and landed small in the frame.
 *
 * Measured through the rig on a 5,000-building city with one freak tower.
 * `coverage` is the fraction of the free viewport the *buildings* cover;
 * `worst aim` is the lowest the camera aims over a full orbit, as a fraction
 * of the skyline height (negative = below ground):
 *
 *     headroom    2.4     1.8     1.6     1.5     1.35
 *     coverage    0.75    0.81    ~0.90   0.96    1.03
 *     worst aim  +0.33   -0.11   -0.33   -0.44   -0.50
 *
 * The synthetic fixture saturates near 1.0 coverage well before 1.35, but a
 * real repository does not: react's box carries a lone 72-unit landmark over a
 * ~30-unit skyline, so at 1.6 its buildings still filled only about three
 * quarters of the gap between the side panels.  1.35 was chosen by looking at
 * that live capture, not at the table.
 *
 * The cost is the aim tilting toward the city's base at some azimuths, which
 * shows more foreground — acceptable now that the periphery haze dissolves it,
 * and not before.  Below ~1.3 the skyline starts being cropped outright; the
 * outlier tip is *meant* to be cropped rather than drag the camera back.
 */
const OUTLIER_HEADROOM = 1.35;
/** Hero three-quarter view, in radians: low, so facades dominate. */
const DEFAULT_AZIMUTH = 0.66;
const DEFAULT_ELEVATION = 0.32;
/** Cinematic entrance length, in seconds. */
const DEFAULT_ENTRANCE_DURATION = 6.6;
/** Seconds of stillness before the showcase drift resumes. */
const DEFAULT_IDLE_DELAY = 4;
/**
 * Seconds the drift takes to ease from a standstill back to full speed.
 *
 * Halved along with the delay: the perceived wait after letting go of the
 * camera is delay + ramp, so cutting only one of them barely moves it.
 */
const IDLE_RAMP = 2;
/** Showcase drift: constant radians per second (~3.7 minutes per orbit). */
const DRIFT_SPEED = 0.028;
/** Drone glide: the elevation breathes by this much, this slowly. */
const BOB_ELEVATION = 0.022;
const BOB_SPEED = (Math.PI * 2) / 44;
/** Azimuths solved for the orbit table; sampled smoothly in between. */
const ORBIT_SAMPLES = 128;
/** Breathing room between the framed city and a panel edge, in CSS pixels. */
const EDGE_PADDING = 18;
/** A single panel never eats more than this fraction of an axis. */
const MAX_EDGE_INSET = 0.34;
/** The free viewport never shrinks below this fraction of the canvas. */
const MIN_FREE_FRACTION = 0.34;
/** A panel spanning at least this much of an axis counts as an edge band. */
const BAND_COVERAGE = 0.6;

const WORLD_UP = new THREE.Vector3(0, 1, 0);

/* scratch vectors — this module is single-threaded and never reentrant */
const _dir = new THREE.Vector3();
const _forward = new THREE.Vector3();
const _right = new THREE.Vector3();
const _up = new THREE.Vector3();
const _rel = new THREE.Vector3();
const _focus = new THREE.Vector3();
const _corner = new THREE.Vector3();
const _bias = new THREE.Vector2();

function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

function smoothstep(t: number): number {
  const k = clamp(t, 0, 1);
  return k * k * (3 - 2 * k);
}

/** Quintic smoothstep: zero first *and* second derivative at both ends. */
function smootherstep(t: number): number {
  const k = clamp(t, 0, 1);
  return k * k * k * (k * (k * 6 - 15) + 10);
}

function easeInOutSine(t: number): number {
  return 0.5 - Math.cos(Math.PI * clamp(t, 0, 1)) / 2;
}

/* ═══ Free viewport ═════════════════════════════════════ */

/** A rectangle in CSS pixels, as reported by `getBoundingClientRect`. */
export interface ScreenRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** The canvas region no overlay panel covers, in canvas-local CSS pixels. */
export interface FreeViewport {
  left: number;
  top: number;
  width: number;
  height: number;
  canvasWidth: number;
  canvasHeight: number;
}

/**
 * Reduce a canvas rectangle by the panels overlaying it.
 *
 * Panels are classified by the edge they hug: a panel spanning most of an axis
 * is treated as a top/bottom band, otherwise as a left/right column.  Insets
 * are capped so an aggressive panel can never collapse the framing region.
 */
export function freeViewportFromRects(
  canvas: ScreenRect,
  panels: readonly ScreenRect[],
  padding = EDGE_PADDING,
): FreeViewport {
  const canvasWidth = Math.max(1, canvas.width);
  const canvasHeight = Math.max(1, canvas.height);
  const canvasRight = canvas.left + canvasWidth;
  const canvasBottom = canvas.top + canvasHeight;
  let insetLeft = 0, insetRight = 0, insetTop = 0, insetBottom = 0;

  for (const panel of panels) {
    if (!(panel.width > 0) || !(panel.height > 0)) continue;
    const left = Math.max(panel.left, canvas.left);
    const right = Math.min(panel.left + panel.width, canvasRight);
    const top = Math.max(panel.top, canvas.top);
    const bottom = Math.min(panel.top + panel.height, canvasBottom);
    if (right <= left || bottom <= top) continue;

    const spansWidth = right - left >= canvasWidth * BAND_COVERAGE;
    const spansHeight = bottom - top >= canvasHeight * BAND_COVERAGE;
    const gapLeft = left - canvas.left;
    const gapRight = canvasRight - right;
    const gapTop = top - canvas.top;
    const gapBottom = canvasBottom - bottom;

    let edge: 'left' | 'right' | 'top' | 'bottom';
    if (spansWidth && !spansHeight) edge = gapTop <= gapBottom ? 'top' : 'bottom';
    else if (spansHeight && !spansWidth) edge = gapLeft <= gapRight ? 'left' : 'right';
    else {
      const smallest = Math.min(gapLeft, gapRight, gapTop, gapBottom);
      edge = smallest === gapLeft ? 'left' : smallest === gapRight ? 'right' : smallest === gapTop ? 'top' : 'bottom';
    }

    if (edge === 'left') insetLeft = Math.max(insetLeft, right - canvas.left + padding);
    else if (edge === 'right') insetRight = Math.max(insetRight, canvasRight - left + padding);
    else if (edge === 'top') insetTop = Math.max(insetTop, bottom - canvas.top + padding);
    else insetBottom = Math.max(insetBottom, canvasBottom - top + padding);
  }

  const axis = (size: number, near: number, far: number): [number, number] => {
    let a = clamp(near, 0, size * MAX_EDGE_INSET);
    let b = clamp(far, 0, size * MAX_EDGE_INSET);
    const free = size - a - b;
    const floor = size * MIN_FREE_FRACTION;
    if (free < floor && a + b > 0) {
      const scale = (size - floor) / (a + b);
      a *= scale;
      b *= scale;
    }
    return [a, b];
  };

  const [left, right] = axis(canvasWidth, insetLeft, insetRight);
  const [top, bottom] = axis(canvasHeight, insetTop, insetBottom);
  return {
    left,
    top,
    width: Math.max(1, canvasWidth - left - right),
    height: Math.max(1, canvasHeight - top - bottom),
    canvasWidth,
    canvasHeight,
  };
}

/**
 * Panels are laid out (and therefore reserve space) even mid fade-in, so
 * occupancy is decided by layout, not by opacity: a panel counts unless it is
 * `display: none`, `visibility: hidden`, or has no box at all.
 */
function isRenderedPanel(element: Element): boolean {
  if (element.getClientRects().length === 0) return false;
  const style = window.getComputedStyle(element);
  return style.display !== 'none' && style.visibility !== 'hidden';
}

/**
 * Measure the free viewport from live DOM geometry.  Hidden and collapsed
 * panels are ignored, so toggling a panel reframes the city.
 */
export function measureFreeViewport(
  canvas: Element,
  panels: readonly (Element | null | undefined)[],
  padding = EDGE_PADDING,
): FreeViewport {
  const rect = canvas.getBoundingClientRect();
  const panelRects: ScreenRect[] = [];
  for (const panel of panels) {
    if (!panel || !isRenderedPanel(panel)) continue;
    const panelRect = panel.getBoundingClientRect();
    panelRects.push({ left: panelRect.left, top: panelRect.top, width: panelRect.width, height: panelRect.height });
  }
  return freeViewportFromRects(
    { left: rect.left, top: rect.top, width: rect.width, height: rect.height },
    panelRects,
    padding,
  );
}

/* ═══ City fit box ══════════════════════════════════════ */

/** The subset of a `Building` the camera needs; `Building` satisfies it. */
export interface FitBuilding {
  position: readonly [number, number, number];
  scale: readonly [number, number, number];
  /**
   * Allocated plot.  Streets, parcel lines and district borders are drawn to
   * the plot rather than to the (much smaller) core, so the framed footprint
   * has to use it or the rendered city spills out past the frame.
   */
  parcel?: readonly [number, number];
  totalHeight: number;
}

/** World-space box the framing fits, with outlier towers trimmed off the top. */
export interface CityFitBox {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  minZ: number;
  maxZ: number;
}

export interface FitBoxOptions {
  /** Height quantile kept in the fit (default 0.98 — the top 2% may overshoot). */
  heightPercentile?: number;
  /** World offset applied to every building (the city root translation). */
  offsetX?: number;
  offsetZ?: number;
}

/**
 * Build the box the camera frames: full horizontal footprint, but a height
 * clipped to `heightPercentile` so one lockfile tower cannot push the whole
 * skyline into the distance.
 */
export function cityFitBox(buildings: readonly FitBuilding[], options?: FitBoxOptions): CityFitBox {
  const percentile = clamp(options?.heightPercentile ?? DEFAULT_HEIGHT_PERCENTILE, 0.5, 1);
  const offsetX = options?.offsetX ?? 0;
  const offsetZ = options?.offsetZ ?? 0;
  if (buildings.length === 0) return { minX: -16, maxX: 16, minY: 0, maxY: 12, minZ: -16, maxZ: 16 };

  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  const heights = new Float64Array(buildings.length);
  for (let index = 0; index < buildings.length; index++) {
    const building = buildings[index];
    const halfX = Math.max(Math.abs(building.scale[0]), Math.abs(building.parcel?.[0] ?? 0)) / 2;
    const halfZ = Math.max(Math.abs(building.scale[2]), Math.abs(building.parcel?.[1] ?? 0)) / 2;
    const x = building.position[0] + offsetX;
    const z = building.position[2] + offsetZ;
    if (x - halfX < minX) minX = x - halfX;
    if (x + halfX > maxX) maxX = x + halfX;
    if (z - halfZ < minZ) minZ = z - halfZ;
    if (z + halfZ > maxZ) maxZ = z + halfZ;
    heights[index] = Math.max(building.totalHeight, building.position[1] + building.scale[1] / 2);
  }
  heights.sort();
  const keep = Math.max(1, Math.ceil(heights.length * percentile));
  return { minX, maxX, minY: 0, maxY: Math.max(1, heights[keep - 1]), minZ, maxZ };
}

function boxCorner(box: CityFitBox, index: number, out: THREE.Vector3): THREE.Vector3 {
  return out.set(
    index & 1 ? box.maxX : box.minX,
    index & 2 ? box.maxY : box.minY,
    index & 4 ? box.maxZ : box.minZ,
  );
}

/** Horizontal radius of the fit box — used to keep the camera outside the city. */
export function cityRadius(box: CityFitBox): number {
  return Math.hypot(box.maxX - box.minX, box.maxZ - box.minZ) / 2;
}

/* ═══ Framing ═══════════════════════════════════════════ */

/** The lens parameters framing needs; `THREE.PerspectiveCamera` satisfies it. */
export interface PerspectiveLens {
  /** Vertical field of view, in degrees. */
  fov: number;
  aspect: number;
}

export interface FramingOptions {
  /** Fraction of the free viewport *height* the skyline fills (default 0.86). */
  heightFill?: number;
  /** Hard ceiling on horizontal overflow, as a fraction of the free width. */
  maxWidthFill?: number;
  /**
   * Floor on horizontal coverage, as a fraction of the free width.  Outranks
   * `heightFill`: where the two disagree the camera comes in until the city
   * covers the width and the surplus height leaves through the bottom of the
   * frame.  Defaults to 0 — off — so a plain fit stays a plain fit; the showcase
   * rig turns it on for every city big enough to have a footprint.
   */
  minWidthFill?: number;
  azimuth?: number;
  elevation?: number;
  /** Lower bound on the solved distance. */
  minDistance?: number;
  /**
   * Everything the city renders, including the outlier towers the sizing box
   * clips off.  The composition frames and centres *this* box.  Defaults to
   * the sizing box.
   */
  visualBox?: CityFitBox;
}

/** A fully composed camera pose. */
export interface CityFraming {
  /** Camera position. */
  position: THREE.Vector3;
  /** Point the camera looks at — also the orbit target. */
  aim: THREE.Vector3;
  /** Centre of the framed city box. */
  focus: THREE.Vector3;
  /**
   * NDC offset applied to the focus so the *projected* city, not its centre
   * point, sits in the middle of the free viewport.  Being expressed in NDC
   * makes the composition scale-invariant, so the entrance can reuse it at any
   * distance.
   */
  bias: THREE.Vector2;
  distance: number;
  azimuth: number;
  elevation: number;
  /** Measured: city width as a fraction of the free viewport (>1 = overflow). */
  widthFill: number;
  /** Measured: city height as a fraction of the free viewport (always <1). */
  heightFill: number;
  /** Where the whole rendered city lands on the canvas, in CSS pixels. */
  screen: ScreenRect;
}

interface PoseView {
  viewport: FreeViewport;
  lens: PerspectiveLens;
}

function viewBasis(azimuth: number, elevation: number): void {
  const cosine = Math.cos(elevation);
  _dir.set(Math.sin(azimuth) * cosine, Math.sin(elevation), Math.cos(azimuth) * cosine).normalize();
  _forward.copy(_dir).negate();
  _right.crossVectors(WORLD_UP, _dir).normalize();
  if (_right.lengthSq() < 1e-8) _right.set(1, 0, 0);
  _up.crossVectors(_dir, _right).normalize();
}

/** NDC coordinates of the free viewport centre and its half extents. */
function viewportNdc(viewport: FreeViewport): { cx: number; cy: number; halfX: number; halfY: number } {
  return {
    cx: ((viewport.left + viewport.width / 2) / viewport.canvasWidth) * 2 - 1,
    cy: 1 - ((viewport.top + viewport.height / 2) / viewport.canvasHeight) * 2,
    halfX: viewport.width / viewport.canvasWidth,
    halfY: viewport.height / viewport.canvasHeight,
  };
}

/**
 * Place the camera at `distance` from `focus` along (azimuth, elevation) and
 * slide it sideways so `focus` projects onto the free-viewport centre, shifted
 * by `bias` (in NDC).
 *
 * With a symmetric frustum the only way to off-centre a subject is to move the
 * camera, and the required offset is linear in distance — which is what makes
 * the composition hold at every distance the entrance passes through.
 */
function solvePose(
  focus: THREE.Vector3,
  azimuth: number,
  elevation: number,
  distance: number,
  bias: THREE.Vector2,
  view: PoseView,
  position: THREE.Vector3,
  aim: THREE.Vector3,
): void {
  viewBasis(azimuth, elevation);
  const tangent = Math.tan(THREE.MathUtils.degToRad(Math.max(1, view.lens.fov)) / 2);
  const aspect = Math.max(0.1, view.lens.aspect);
  const ndc = viewportNdc(view.viewport);
  const lateralRight = -(ndc.cx + bias.x) * distance * tangent * aspect;
  const lateralUp = -(ndc.cy + bias.y) * distance * tangent;
  aim.copy(focus).addScaledVector(_right, lateralRight).addScaledVector(_up, lateralUp);
  position.copy(aim).addScaledVector(_dir, distance);
}

/** NDC bounding box of the fit box as seen from `position` along the given basis. */
function projectBoxNdc(
  box: CityFitBox,
  position: THREE.Vector3,
  right: THREE.Vector3,
  up: THREE.Vector3,
  forward: THREE.Vector3,
  tangent: number,
  aspect: number,
): { minX: number; maxX: number; minY: number; maxY: number } {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (let index = 0; index < 8; index++) {
    _rel.copy(boxCorner(box, index, _corner)).sub(position);
    const depth = Math.max(1e-3, _rel.dot(forward));
    const x = _rel.dot(right) / (depth * tangent * aspect);
    const y = _rel.dot(up) / (depth * tangent);
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  return { minX, maxX, minY, maxY };
}

/* ── the composition solve ──────────────────────────────
 *
 * Everything below exists because the obvious approach — nudge the camera,
 * measure the projected rectangle, nudge again — does not converge.  Under
 * perspective, sliding the camera sideways by δ moves a corner in NDC by
 * δ / (depth · tan), and at the immersive distances this module composes at,
 * the near and far corners of a city differ in depth by a factor of three or
 * more.  A correction sized for the rectangle's centre therefore overshoots the
 * near corner threefold, the next pass overshoots back, and the iteration ends
 * in a limit cycle whose phase depends on the azimuth — a camera that frames
 * the city perfectly from one angle and aims at bare ground from another.
 *
 * The fix is to notice that the problem separates.  Write the camera as
 *
 *     position = focus + right·u + up·v + dir·distance
 *
 * and take each corner's coordinates in the view basis relative to the focus
 * (`alongRight`, `alongUp`, `alongForward`).  Because `right` and `up` are both
 * perpendicular to the view direction, sliding along them does not change any
 * corner's depth at all:
 *
 *     depth_i = alongForward_i + distance          (independent of u and v)
 *     ndcX_i  = (alongRight_i - u) · gainX_i       gainX_i = 1/(depth_i·tan·aspect)
 *     ndcY_i  = (alongUp_i    - v) · gainY_i       gainY_i = 1/(depth_i·tan)
 *
 * So at a fixed distance each axis is *exactly* linear in its own offset, the
 * projected centre is strictly monotone in it, and centring is a one-dimensional
 * root find that cannot oscillate.  Distance is then the only thing left to
 * solve, and the projected size shrinks monotonically as the camera pulls back,
 * so that is a second bracketed root find.  Two nested monotone solves replace
 * one coupled fixed point, and the result is a continuous function of azimuth.
 */

/** The eight box corners in the view basis, measured from the focus point. */
interface CornerFrame {
  /** Depth of corner `i` is `alongForward[i] + distance`. */
  alongForward: Float64Array;
  alongRight: Float64Array;
  alongUp: Float64Array;
  /** Largest `-alongForward`, i.e. how far back the camera must be to see all eight. */
  nearReach: number;
}

const _cornerFrame: CornerFrame = {
  alongForward: new Float64Array(8),
  alongRight: new Float64Array(8),
  alongUp: new Float64Array(8),
  nearReach: 0,
};
const _gainX = new Float64Array(8);
const _gainY = new Float64Array(8);
interface AxisExtent {
  min: number;
  max: number;
  /** Which corner reached each end — the pair whose gains give the local slope. */
  lower: number;
  upper: number;
}
const _spanX: AxisExtent = { min: 0, max: 0, lower: 0, upper: 0 };
const _spanY: AxisExtent = { min: 0, max: 0, lower: 0, upper: 0 };
const _spanProbe: AxisExtent = { min: 0, max: 0, lower: 0, upper: 0 };
/** Slope of the last probe with respect to the shift — always negative. */
let _probeSlope = -1;
/** The composed pose at one trial distance — reused so the solve never allocates. */
const _shot = { u: 0, v: 0, minX: 0, maxX: 0, minY: 0, maxY: 0, scale: 0, wide: 0 };

function cornerFrame(
  box: CityFitBox,
  focus: THREE.Vector3,
  right: THREE.Vector3,
  up: THREE.Vector3,
  forward: THREE.Vector3,
): CornerFrame {
  let nearReach = 0;
  for (let index = 0; index < 8; index++) {
    _rel.copy(boxCorner(box, index, _corner)).sub(focus);
    const alongForward = _rel.dot(forward);
    _cornerFrame.alongForward[index] = alongForward;
    _cornerFrame.alongRight[index] = _rel.dot(right);
    _cornerFrame.alongUp[index] = _rel.dot(up);
    if (-alongForward > nearReach) nearReach = -alongForward;
  }
  _cornerFrame.nearReach = nearReach;
  return _cornerFrame;
}

/** NDC extent of the eight corners along one axis for a camera offset of `shift`. */
function axisSpan(
  offset: Float64Array,
  gain: Float64Array,
  shift: number,
  out: AxisExtent,
): void {
  let min = Infinity, max = -Infinity, lower = 0, upper = 0;
  for (let index = 0; index < 8; index++) {
    const value = (offset[index] - shift) * gain[index];
    if (value < min) { min = value; lower = index; }
    if (value > max) { max = value; upper = index; }
  }
  out.min = min;
  out.max = max;
  out.lower = lower;
  out.upper = upper;
}

/**
 * What a shift is being solved against: the projected centre, or its top edge.
 * Each probe also records its exact local slope in `_probeSlope`, which is what
 * lets the root find take Newton steps instead of pure bisection.
 */
type AxisProbe = (offset: Float64Array, gain: Float64Array, shift: number) => number;

const axisCentre: AxisProbe = (offset, gain, shift) => {
  axisSpan(offset, gain, shift, _spanProbe);
  _probeSlope = -(gain[_spanProbe.lower] + gain[_spanProbe.upper]) / 2;
  return (_spanProbe.min + _spanProbe.max) / 2;
};

const axisUpper: AxisProbe = (offset, gain, shift) => {
  axisSpan(offset, gain, shift, _spanProbe);
  _probeSlope = -gain[_spanProbe.upper];
  return _spanProbe.max;
};

/**
 * The one camera offset along an axis that puts `probe` on `target`.
 *
 * Every gain is positive, so each corner's NDC coordinate strictly decreases as
 * the camera slides along the axis; the minimum, the maximum and therefore their
 * midpoint all inherit that.  A strictly decreasing function has exactly one
 * root — no step size, no damping, no chance of the oscillation this replaced.
 *
 * The function is also piecewise *linear*, one piece per pair of extreme
 * corners, so a Newton step from the pair currently in play is exact within its
 * piece and the whole solve lands in a handful of passes.  Every step is still
 * safeguarded by the bracket, so a Newton step that would leave it degrades to a
 * bisection and convergence never depends on the guess.
 */
function solveAxisShift(offset: Float64Array, gain: Float64Array, target: number, probe: AxisProbe): number {
  let lo = offset[0], hi = offset[0];
  for (let index = 1; index < 8; index++) {
    if (offset[index] < lo) lo = offset[index];
    if (offset[index] > hi) hi = offset[index];
  }
  let reach = Math.max(1e-3, hi - lo);
  for (let guard = 0; guard < 64 && probe(offset, gain, lo) < target; guard++) {
    lo -= reach;
    reach *= 2;
  }
  reach = Math.max(1e-3, hi - lo);
  for (let guard = 0; guard < 64 && probe(offset, gain, hi) > target; guard++) {
    hi += reach;
    reach *= 2;
  }
  let shift = (lo + hi) / 2;
  for (let pass = 0; pass < 48; pass++) {
    const value = probe(offset, gain, shift);
    if (value > target) lo = shift;
    else hi = shift;
    if (!(hi - lo > 1e-12 * (1 + Math.abs(shift)))) break;
    const step = shift + (value - target) / -_probeSlope;
    shift = step > lo && step < hi ? step : (lo + hi) / 2;
  }
  return shift;
}

/**
 * Compose at one trial distance and measure what that yields.
 *
 * Horizontally the city is centred.  Vertically it is centred *or* hung from the
 * top of the height budget, whichever sits lower — one `Math.max` of two exact
 * solves.  While the city fits, hanging it from the top would place it higher
 * than centring does, so centring wins and the composition is the balanced one;
 * once the city is taller than the budget the two swap over and the top edge is
 * pinned instead, so the extra height leaves through the bottom of the frame as
 * near foreground and the skyline keeps its headroom.  The two agree exactly
 * when the city is the height of the budget, so the hand-over is seamless.
 *
 * `minUp` is the floor the vertical offset may not go below — it is how a
 * minimum camera height is honoured *inside* the solve, so the aim point moves
 * with the camera instead of being left pointing at bare ground far below.
 */
function shotAtDistance(
  frame: CornerFrame,
  distance: number,
  tangent: number,
  aspect: number,
  centreX: number,
  centreY: number,
  minUp: number,
  budgetX: number,
  budgetY: number,
  budgetMinX: number,
): void {
  for (let index = 0; index < 8; index++) {
    const depth = Math.max(1e-3, frame.alongForward[index] + distance);
    _gainY[index] = 1 / (depth * tangent);
    _gainX[index] = _gainY[index] / aspect;
  }
  const u = solveAxisShift(frame.alongRight, _gainX, centreX, axisCentre);
  const v = Math.max(
    solveAxisShift(frame.alongUp, _gainY, centreY, axisCentre),
    solveAxisShift(frame.alongUp, _gainY, centreY + budgetY, axisUpper),
    minUp,
  );
  axisSpan(frame.alongRight, _gainX, u, _spanX);
  axisSpan(frame.alongUp, _gainY, v, _spanY);
  const width = (_spanX.max - _spanX.min) / 2;
  _shot.u = u;
  _shot.v = v;
  _shot.minX = _spanX.min;
  _shot.maxX = _spanX.max;
  _shot.minY = _spanY.min;
  _shot.maxY = _spanY.max;
  _shot.scale = Math.max(
    /* rule 1 — the skyline height fills the free viewport, with headroom */
    (_spanY.max - _spanY.min) / 2 / budgetY,
    /* rule 2 — width runs free up to its ceiling */
    width / budgetX,
  );
  /* rule 3 — …and never sits inside it, leaving bare ground at the edges */
  _shot.wide = budgetMinX > 0 ? width / budgetMinX : Infinity;
}

/** Where a box lands on the canvas from an explicit pose, in CSS pixels. */
function projectBoxToScreenFrom(
  box: CityFitBox,
  position: THREE.Vector3,
  azimuth: number,
  elevation: number,
  viewport: FreeViewport,
  lens: PerspectiveLens,
): ScreenRect {
  viewBasis(azimuth, elevation);
  const tangent = Math.tan(THREE.MathUtils.degToRad(Math.max(1, lens.fov)) / 2);
  const frame = projectBoxNdc(box, position, _right, _up, _forward, tangent, Math.max(0.1, lens.aspect));
  return {
    left: ((frame.minX + 1) / 2) * viewport.canvasWidth,
    top: ((1 - frame.maxY) / 2) * viewport.canvasHeight,
    width: ((frame.maxX - frame.minX) / 2) * viewport.canvasWidth,
    height: ((frame.maxY - frame.minY) / 2) * viewport.canvasHeight,
  };
}

/**
 * Solve the camera pose that composes the city in the free viewport.
 *
 * The resting composition follows the author's reference frame:
 *  1. the skyline *height* — city base to tallest tower — fills `heightFill`
 *     of the free viewport, so the whole silhouette reads with a little
 *     headroom and never crops under the header;
 *  2. whatever width that yields is kept, even past the free viewport's sides:
 *     a city is supposed to run off-frame rather than float in empty ground.
 *     Only `maxWidthFill` bounds it, so a pancake-flat city cannot overflow so
 *     far that only its middle is visible;
 *  3. and it never sits *inside* the free width either: `minWidthFill` is a
 *     floor that outranks rule 1, because the azimuths where a rectangular city
 *     turns its narrow diagonal to the camera are exactly the ones the height
 *     fit would leave bare ground at both edges of;
 *  4. the rendered city is centred on the free viewport, horizontally and
 *     vertically — centring the *clipped* box instead would push the skyline
 *     into the upper half and leave a dead foreground.  Where rule 3 has pulled
 *     the camera in past the height budget, the top edge is pinned instead of
 *     the centre, so the overflow leaves through the bottom of the frame as near
 *     foreground and the skyline keeps its headroom.
 *
 * The solve is two nested monotone root finds — see the note above
 * {@link CornerFrame} for why anything less falls into a limit cycle.  The inner
 * one slides the camera perpendicular to its own view direction until the
 * projected rectangle is placed, which is exact because that slide leaves every
 * corner's depth alone.  The outer one brackets the distance and closes on the
 * point where the binding size rule is met exactly.  Both are continuous in
 * azimuth, which is what lets the showcase drift re-solve the framing at every
 * angle without the composition jumping.
 */
export function computeCityFraming(
  box: CityFitBox,
  viewport: FreeViewport,
  lens: PerspectiveLens,
  options?: FramingOptions,
): CityFraming {
  const heightFill = clamp(options?.heightFill ?? REST_HEIGHT_FILL, 0.2, 0.98);
  const widthCeiling = Math.max(0.3, options?.maxWidthFill ?? MAX_WIDTH_FILL);
  const widthFloor = clamp(options?.minWidthFill ?? 0, 0, widthCeiling);
  const azimuth = options?.azimuth ?? DEFAULT_AZIMUTH;
  const elevation = clamp(options?.elevation ?? DEFAULT_ELEVATION, 0.06, 1.35);
  const tangent = Math.tan(THREE.MathUtils.degToRad(Math.max(1, lens.fov)) / 2);
  const aspect = Math.max(0.1, lens.aspect);
  const ndc = viewportNdc(viewport);
  const budgetX = Math.max(1e-3, widthCeiling * ndc.halfX);
  const budgetY = Math.max(1e-3, heightFill * ndc.halfY);
  const budgetMinX = widthFloor * ndc.halfX;

  const visual = options?.visualBox ?? box;
  const focus = new THREE.Vector3(
    (visual.minX + visual.maxX) / 2,
    (visual.minY + visual.maxY) / 2,
    (visual.minZ + visual.maxZ) / 2,
  );

  viewBasis(azimuth, elevation);
  const right = _right.clone();
  const up = _up.clone();
  const forward = _forward.clone();

  const frame = cornerFrame(visual, focus, right, up, forward);
  /*
   * Never closer than the caller's floor, and never so close that a corner sits
   * on or behind the near plane — a corner at zero depth projects to infinity
   * and would poison every measurement taken from this pose.
   */
  const floor = Math.max(
    options?.minDistance ?? 0,
    cityRadius(visual) * 1.1,
    frame.nearReach * 1.02 + 1,
    8,
  );
  /*
   * The camera may not sink below the deck.  `right` has no vertical component
   * and `up.y` is cos(elevation), so the camera's height is
   * `focus.y + v·cos(elevation) + distance·sin(elevation)` — invert that for the
   * lowest `v` still allowed.  Applying it as a bound *inside* the solve is what
   * keeps the aim point tied to the camera; the old code shoved the position up
   * afterwards and left the aim pointing at bare ground far below the city.
   */
  const minCameraY = visual.maxY * 0.12 + 2;
  const sine = Math.sin(elevation);
  const cosine = Math.max(1e-3, Math.cos(elevation));

  /*
   * Outer solve: the projected rectangle shrinks as the camera pulls back, so
   * bracket the distance and bisect on `scale`.  `floor` is the closest the
   * camera may sit; if the city already fits from there, that is the answer.
   */
  const measure = (trial: number): void => {
    const minUp = (minCameraY - focus.y - sine * trial) / cosine;
    shotAtDistance(frame, trial, tangent, aspect, ndc.cx, ndc.cy, minUp, budgetX, budgetY, budgetMinX);
  };
  const ceilingRatio = (trial: number): number => {
    measure(trial);
    return _shot.scale;
  };
  const floorRatio = (trial: number): number => {
    measure(trial);
    return _shot.wide;
  };
  /**
   * Find where a ratio that falls monotonically with distance crosses 1.
   * Projected size goes as roughly 1/distance, so `trial · ratio` is a near-exact
   * guess at the crossing and the search converges in a few passes; the bracket
   * still guards every step.  `satisfied` picks which side of the final bracket
   * to return: `'below'` for a ceiling that must not be exceeded, `'above'` for
   * a floor that must be met.
   */
  const solveDistance = (
    lo: number,
    hi: number,
    ratio: (trial: number) => number,
    satisfied: 'below' | 'above',
  ): number => {
    let trial = (lo + hi) / 2;
    for (let pass = 0; pass < 48; pass++) {
      const value = ratio(trial);
      if (value > 1) lo = trial;
      else hi = trial;
      if (!(hi - lo > 1e-12 * hi)) break;
      const step = trial * value;
      trial = step > lo && step < hi ? step : (lo + hi) / 2;
    }
    return satisfied === 'below' ? hi : lo;
  };

  let distance = floor;
  if (ceilingRatio(floor) > 1) {
    let hi = floor * 2;
    for (let guard = 0; guard < 64 && ceilingRatio(hi) > 1; guard++) hi *= 2;
    /* land on the outer end of the bracket: rules 1 and 2 are ceilings */
    distance = solveDistance(Math.max(floor, hi / 2), hi, ceilingRatio, 'below');
  }
  /*
   * Rule 3 is a floor, and it outranks the height fit: if the composition that
   * satisfies the ceilings leaves bare ground at the sides, come back in until
   * the city covers the free width.  Both ratios fall monotonically with
   * distance, so the answer is simply the nearer of the two crossings — which
   * also means the rule only ever engages where it is needed, leaving the hero
   * azimuth of a city that already overflows exactly where it was.
   */
  if (budgetMinX > 0 && floorRatio(distance) < 1 && distance > floor) {
    distance = floorRatio(floor) < 1 ? floor : solveDistance(floor, distance, floorRatio, 'above');
  }
  measure(distance);

  /*
   * Re-express the solved offsets as an NDC bias, so `solvePose` reproduces this
   * exact pose and the entrance can replay the same composition at any distance.
   */
  const bias = new THREE.Vector2(
    -_shot.u / (distance * tangent * aspect) - ndc.cx,
    -_shot.v / (distance * tangent) - ndc.cy,
  );
  const position = new THREE.Vector3();
  const aim = new THREE.Vector3();
  solvePose(focus, azimuth, elevation, distance, bias, { viewport, lens }, position, aim);

  const screen: ScreenRect = {
    left: ((_shot.minX + 1) / 2) * viewport.canvasWidth,
    top: ((1 - _shot.maxY) / 2) * viewport.canvasHeight,
    width: ((_shot.maxX - _shot.minX) / 2) * viewport.canvasWidth,
    height: ((_shot.maxY - _shot.minY) / 2) * viewport.canvasHeight,
  };
  return {
    position, aim, focus, bias, distance, azimuth, elevation, screen,
    widthFill: screen.width / viewport.width,
    heightFill: screen.height / viewport.height,
  };
}

/**
 * Screen-space bounding rectangle of a fit box, in canvas CSS pixels.
 * Used by the framing tests and useful for debugging composition.
 */
export function projectBoxToScreen(
  box: CityFitBox,
  camera: THREE.PerspectiveCamera,
  canvasWidth: number,
  canvasHeight: number,
): ScreenRect {
  camera.updateMatrixWorld();
  camera.updateProjectionMatrix();
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (let index = 0; index < 8; index++) {
    boxCorner(box, index, _corner).project(camera);
    const x = ((_corner.x + 1) / 2) * canvasWidth;
    const y = ((1 - _corner.y) / 2) * canvasHeight;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  return { left: minX, top: minY, width: maxX - minX, height: maxY - minY };
}

/* ═══ Cinematic entrance ════════════════════════════════ */

/**
 * One waypoint of the entrance, expressed relative to the final framing so the
 * move keeps its shape for every city size.  The last key *is* the hero pose.
 */
interface EntranceKey {
  /** Azimuth offset from the hero view, in radians (signed by the sweep direction). */
  azimuth: number;
  /** Elevation as a multiple of the hero elevation. */
  elevation: number;
  /** Distance as a multiple of the hero distance. */
  distance: number;
  /** Focus height as a fraction of the hero focus height. */
  focus: number;
}

/**
 * Four beats: a street-level rush past the skyline, a climb, a high aerial
 * reveal of the whole city, then a descent that settles into the hero view.
 *
 * The shape matters more than any single number. Ending 160° from where it
 * starts, having been both under and well above the hero elevation, is what
 * makes the arrival feel like an arrival rather than a slow pan.
 *
 * Elevation multipliers are relative to the hero's ~18°, so they read lower
 * than they look: 0.6 is barely 10° above the deck. Anything under ~0.8
 * collapses the city into a band on the horizon with two thirds of the frame
 * bare ground, because the distance floor keeps the camera outside the
 * footprint and there is nothing near enough to fill the foreground. The
 * opening therefore starts a little above the hero angle and dips beneath it
 * on the sweep, rather than trying to skim the street.
 *
 * Only `focus` on the FIRST key is used — `applyEntrance` ramps the focus
 * height from it to 1 with its own smoothstep, so the field is inert on the
 * rest and left at its natural progression for readability.
 *
 * Distances stay at or above 1.0 deliberately: anything below is clamped up to
 * `safeRadius`, which would silently flatten the move into a constant-radius
 * pan on large repositories.
 */
const ENTRANCE_KEYS: readonly EntranceKey[] = [
  { azimuth: -2.85, elevation: 1.30, distance: 1.16, focus: 0.62 },
  { azimuth: -2.05, elevation: 0.78, distance: 0.99, focus: 0.34 },
  { azimuth: -1.25, elevation: 1.10, distance: 1.08, focus: 0.66 },
  { azimuth: -0.50, elevation: 2.60, distance: 1.30, focus: 0.94 },
  { azimuth: 0.00, elevation: 1.00, distance: 1.00, focus: 1.00 },
];

/* ═══ Camera rig ════════════════════════════════════════ */

export interface CityCameraOptions {
  camera: THREE.PerspectiveCamera;
  /** Orbit target, mutated in place — pass `OrbitControls.target`. */
  orbitTarget: THREE.Vector3;
  buildings: readonly FitBuilding[];
  /** Measured lazily so panel toggles and resizes reframe the city. */
  viewport: () => FreeViewport;
  /** Seeded source; the same seed always produces the same move. */
  random?: RandomSource;
  offsetX?: number;
  offsetZ?: number;
  /** Skip the entrance and the showcase drift entirely. */
  reducedMotion?: boolean;
  entranceDuration?: number;
  /** Fraction of the free viewport height the skyline fills at rest. */
  heightFill?: number;
  maxWidthFill?: number;
  /** Fraction of the free viewport width the city must at least cover. */
  minWidthFill?: number;
  heightPercentile?: number;
  idleDelay?: number;
}

export interface CityCameraRig {
  /** The composed hero pose the entrance settles into. */
  readonly framing: CityFraming;
  /** Box the coverage fraction sizes against (outlier towers trimmed). */
  readonly box: CityFitBox;
  /** Everything the city renders; centred and kept inside the free viewport. */
  readonly visualBox: CityFitBox;
  /** True while the entrance owns the camera; orbit controls stay disabled. */
  readonly entranceActive: boolean;
  /** Seconds since the last user interaction. */
  readonly idleTime: number;
  /** Farthest composed distance over a full orbit — a sane `maxDistance`. */
  readonly maxOrbitDistance: number;
  /** The composed pose for any azimuth on the showcase orbit. */
  orbitFraming(azimuth: number): CityFraming;
  /** Advance the rig by `dt` seconds; returns `entranceActive` afterwards. */
  update(dt: number): boolean;
  /** Cut straight to the hero framing. */
  skipEntrance(): void;
  /** Register user input: cuts the entrance and pauses the showcase drift. */
  noteInteraction(): void;
  /** Re-solve the framing after a resize or a panel toggle. */
  refresh(): void;
  dispose(): void;
}

/**
 * Create the camera rig for a freshly built city: it applies the entrance
 * start pose immediately, plays the cinematic move, then keeps the city alive
 * with a slow showcase orbit whenever the user is idle.
 */
export function createCityCameraRig(options: CityCameraOptions): CityCameraRig {
  const { camera, orbitTarget } = options;
  const duration = Math.max(0.1, options.entranceDuration ?? DEFAULT_ENTRANCE_DURATION);
  const idleDelay = Math.max(0, options.idleDelay ?? DEFAULT_IDLE_DELAY);
  const reducedMotion = options.reducedMotion === true;
  const random = options.random;
  /* small repositories are framed whole; large ones clip their outlier tail */
  const small = options.buildings.length < SMALL_CITY_BUILDINGS;
  const percentile = options.heightPercentile ?? (small ? 1 : DEFAULT_HEIGHT_PERCENTILE);
  const heightFill = options.heightFill ?? (small ? SMALL_CITY_HEIGHT_FILL : REST_HEIGHT_FILL);
  const maxWidthFill = options.maxWidthFill ?? MAX_WIDTH_FILL;
  /*
   * A handful of towers has no footprint to crop into: filling the width would
   * mean shoving the silhouette off both sides of a repository that is supposed
   * to be readable whole.  Every city with a real skyline gets the width floor.
   */
  const minWidthFill = options.minWidthFill ?? (small ? 0 : MIN_WIDTH_FILL);
  const placement = { offsetX: options.offsetX, offsetZ: options.offsetZ };
  const clippedBox = cityFitBox(options.buildings, { ...placement, heightPercentile: percentile });
  const box = clippedBox;
  /*
   * The whole city is framed — the author wants the complete silhouette — but a
   * single freak tower may not shrink everything else, so the framed height
   * stops at `OUTLIER_HEADROOM` above the clipped skyline.
   */
  const fullBox = percentile >= 1 ? clippedBox : cityFitBox(options.buildings, { ...placement, heightPercentile: 1 });
  const visualBox: CityFitBox = fullBox.maxY <= clippedBox.maxY * OUTLIER_HEADROOM
    ? fullBox
    : { ...fullBox, maxY: clippedBox.maxY * OUTLIER_HEADROOM };
  const safeRadius = cityRadius(visualBox) * 1.15 + 10;

  /* deterministic per-scene variation */
  const sweepSign = random && random() < 0.5 ? -1 : 1;
  const azimuthJitter = random ? (random() - 0.5) * 0.36 : 0;
  /*
   * The glide's *direction* is seeded, not its phase.  A seeded phase meant the
   * drift's very first frame already carried an elevation offset of up to
   * `BOB_ELEVATION` while the settled pose it took over from sat at exactly
   * `DEFAULT_ELEVATION` — several world units of camera pop, right at the
   * entrance hand-off.  Anchoring every glide to its zero crossing makes the two
   * agree exactly, and whether it breathes up first or down first still varies.
   */
  const bobSign = random && random() < 0.5 ? -1 : 1;
  const heroAzimuth = sweepSign * (DEFAULT_AZIMUTH + azimuthJitter);
  /* the drift continues the entrance arc, so the hand-off never reverses */
  const driftSign = sweepSign;

  const entrancePosition = new THREE.Vector3();
  const entranceAim = new THREE.Vector3();
  const driftPosition = new THREE.Vector3();
  const driftAim = new THREE.Vector3();

  /*
   * Linear share of the entrance time warp, sized so the camera arrives at the
   * hero pose already turning at the showcase drift speed.  dθ/dt at the end is
   * (dθ/du · du/dp) / duration, and dθ/du there is the Catmull-Rom slope of the
   * final azimuth segment; solving that for the linear share gives the tail.
   */
  const finalKeys = ENTRANCE_KEYS.slice(-3);
  const terminalKeySlope = Math.abs(catmullRomSlope(
    finalKeys[0].azimuth, finalKeys[1].azimuth, finalKeys[2].azimuth, finalKeys[2].azimuth, 1,
  )) * (ENTRANCE_KEYS.length - 1);
  const entranceTail = clamp(
    terminalKeySlope > 1e-6 ? (DRIFT_SPEED * duration) / terminalKeySlope : 0,
    0,
    0.5,
  );

  /**
   * The composed distance and framing bias for every azimuth of the showcase
   * orbit, solved once and interpolated in between.  A rectangular footprint
   * needs a different distance from its short side than from its long one; a
   * table plus Catmull-Rom sampling keeps that continuous instead of popping.
   */
  const orbitDistance = new Float64Array(ORBIT_SAMPLES);
  const orbitBiasX = new Float64Array(ORBIT_SAMPLES);
  const orbitBiasY = new Float64Array(ORBIT_SAMPLES);
  let orbitMaxDistance = 0;

  buildOrbitTable();
  let framing = orbitFramingAt(heroAzimuth);
  /* canvas size the current framing was solved for, so resizes can re-compose */
  let framedWidth = options.viewport().canvasWidth;
  let framedHeight = options.viewport().canvasHeight;
  let entranceActive = !reducedMotion;
  let entranceElapsed = 0;
  let idleTime = 0;
  let driftRamp = 0;
  let driftAngle = 0;
  let userMoved = false;
  let composed = true;
  let bobPhase = 0;
  let disposed = false;

  function solveFraming(azimuth = heroAzimuth, elevation = DEFAULT_ELEVATION): CityFraming {
    return computeCityFraming(box, options.viewport(), camera, {
      heightFill,
      maxWidthFill,
      minWidthFill,
      visualBox,
      azimuth,
      elevation,
      minDistance: safeRadius,
    });
  }

  function buildOrbitTable(): void {
    orbitMaxDistance = 0;
    for (let index = 0; index < ORBIT_SAMPLES; index++) {
      const solved = solveFraming(heroAzimuth + (index / ORBIT_SAMPLES) * Math.PI * 2);
      orbitDistance[index] = solved.distance;
      orbitBiasX[index] = solved.bias.x;
      orbitBiasY[index] = solved.bias.y;
      orbitMaxDistance = Math.max(orbitMaxDistance, solved.distance);
    }
  }

  /** Periodic Catmull-Rom through the orbit table — C1 continuous all the way round. */
  function sampleOrbit(table: Float64Array, azimuth: number): number {
    const turns = ((azimuth - heroAzimuth) / (Math.PI * 2)) % 1;
    const position = (turns < 0 ? turns + 1 : turns) * ORBIT_SAMPLES;
    const index = Math.floor(position);
    const local = position - index;
    const at = (offset: number): number => table[(((index + offset) % ORBIT_SAMPLES) + ORBIT_SAMPLES) % ORBIT_SAMPLES];
    return catmullRom(at(-1), at(0), at(1), at(2), local);
  }

  /** The composed pose anywhere on the orbit, at the resting elevation. */
  function orbitFramingAt(azimuth: number, elevation = DEFAULT_ELEVATION): CityFraming {
    const distance = sampleOrbit(orbitDistance, azimuth);
    const bias = new THREE.Vector2(sampleOrbit(orbitBiasX, azimuth), sampleOrbit(orbitBiasY, azimuth));
    const focus = new THREE.Vector3(
      (visualBox.minX + visualBox.maxX) / 2,
      (visualBox.minY + visualBox.maxY) / 2,
      (visualBox.minZ + visualBox.maxZ) / 2,
    );
    const position = new THREE.Vector3();
    const aim = new THREE.Vector3();
    const viewport = options.viewport();
    solvePose(focus, azimuth, elevation, distance, bias, { viewport, lens: camera }, position, aim);
    const screen = projectBoxToScreenFrom(visualBox, position, azimuth, elevation, viewport, camera);
    return {
      position, aim, focus, bias, distance, azimuth, elevation, screen,
      widthFill: screen.width / viewport.width,
      heightFill: screen.height / viewport.height,
    };
  }

  /**
   * Re-compose after the canvas itself changed size while the user was driving:
   * their viewing angle is theirs to keep, but a stale distance and lateral
   * offset would leave the city hanging behind a panel, so both are re-solved.
   */
  function recompose(): void {
    _rel.copy(camera.position).sub(orbitTarget);
    const radius = _rel.length();
    if (radius < 1e-3) {
      settle();
      return;
    }
    const composed = solveFraming(Math.atan2(_rel.x, _rel.z), Math.asin(clamp(_rel.y / radius, -1, 1)));
    camera.position.copy(composed.position);
    camera.lookAt(composed.aim);
    orbitTarget.copy(composed.aim);
  }

  /** Put the camera on a composed pose and hand the orbit target with it. */
  function applyComposed(pose: CityFraming): void {
    camera.position.copy(pose.position);
    camera.lookAt(pose.aim);
    orbitTarget.copy(pose.aim);
    composed = true;
  }

  /** The drone glide's current elevation offset — zero from a standstill. */
  function bobOffset(): number {
    return bobSign * BOB_ELEVATION * Math.sin(bobPhase);
  }

  /**
   * Return to the hero pose and reset the showcase orbit to its start — glide
   * included, so the pose this leaves the camera in is exactly the pose the
   * drift's next frame asks for and the hand-off is seamless.
   */
  function settle(): void {
    driftAngle = 0;
    driftRamp = 0;
    idleTime = 0;
    bobPhase = 0;
    framing = orbitFramingAt(heroAzimuth);
    applyComposed(framing);
  }

  /**
   * Entrance time warp.  A pure ease would land at zero speed and the showcase
   * drift would then start from a standstill — a visible stop-start.  Blending
   * a linear tail in gives the move a terminal angular velocity; `entranceTail`
   * is chosen so that velocity equals the drift speed exactly.
   */
  function entranceEase(p: number): number {
    return (1 - entranceTail) * easeInOutSine(p) + entranceTail * clamp(p, 0, 1);
  }

  /** Sample the entrance at normalised progress `p` and drive the camera. */
  function applyEntrance(p: number): void {
    const u = entranceEase(clamp(p, 0, 1)) * (ENTRANCE_KEYS.length - 1);
    const index = Math.min(ENTRANCE_KEYS.length - 2, Math.floor(u));
    const local = u - index;
    const previous = ENTRANCE_KEYS[Math.max(0, index - 1)];
    const from = ENTRANCE_KEYS[index];
    const to = ENTRANCE_KEYS[index + 1];
    const next = ENTRANCE_KEYS[Math.min(ENTRANCE_KEYS.length - 1, index + 2)];
    const azimuth = heroAzimuth + sweepSign * catmullRom(previous.azimuth, from.azimuth, to.azimuth, next.azimuth, local);
    const elevationScale = catmullRom(previous.elevation, from.elevation, to.elevation, next.elevation, local);
    const elevation = clamp(framing.elevation * elevationScale, 0.03, 1.35);
    const distanceScale = catmullRom(previous.distance, from.distance, to.distance, next.distance, local);
    const distance = Math.max(framing.distance * distanceScale, safeRadius);
    const focusFraction = smoothstep(p) * (1 - ENTRANCE_KEYS[0].focus) + ENTRANCE_KEYS[0].focus;
    _focus.set(framing.focus.x, framing.focus.y * focusFraction, framing.focus.z);
    /* the framing bias is an NDC offset, so it composes identically at any distance */
    solvePose(_focus, azimuth, elevation, distance, framing.bias, { viewport: options.viewport(), lens: camera }, entrancePosition, entranceAim);
    camera.position.copy(entrancePosition);
    camera.position.y = Math.max(camera.position.y, visualBox.maxY * 0.06 + 2);
    camera.lookAt(entranceAim);
  }

  /**
   * Showcase drift.  While the rig still owns the camera it flies the composed
   * orbit — same height fit and width overflow from every angle, distance read
   * from the orbit table — so a long city stays full-frame when seen from its
   * short side.  Once the user has moved the camera, it degrades to a plain
   * rotation around their own target so their framing is never yanked.
   */
  function drift(step: number): void {
    if (idleTime < idleDelay) return;
    driftRamp = Math.min(1, driftRamp + step / IDLE_RAMP);
    const speed = DRIFT_SPEED * smootherstep(driftRamp);
    if (speed <= 0) return;
    bobPhase += step * BOB_SPEED;
    if (composed && !userMoved) {
      driftAngle += step * speed * driftSign;
      const azimuth = heroAzimuth + driftAngle;
      const elevation = DEFAULT_ELEVATION + bobOffset();
      const distance = sampleOrbit(orbitDistance, azimuth);
      _bias.set(sampleOrbit(orbitBiasX, azimuth), sampleOrbit(orbitBiasY, azimuth));
      _focus.set(
        (visualBox.minX + visualBox.maxX) / 2,
        (visualBox.minY + visualBox.maxY) / 2,
        (visualBox.minZ + visualBox.maxZ) / 2,
      );
      solvePose(_focus, azimuth, elevation, distance, _bias, { viewport: options.viewport(), lens: camera }, driftPosition, driftAim);
      camera.position.copy(driftPosition);
      orbitTarget.copy(driftAim);
      camera.lookAt(driftAim);
      return;
    }
    const dx = camera.position.x - orbitTarget.x;
    const dz = camera.position.z - orbitTarget.z;
    const angle = step * speed * driftSign;
    const cosine = Math.cos(angle);
    const sine = Math.sin(angle);
    camera.position.x = orbitTarget.x + dx * cosine - dz * sine;
    camera.position.z = orbitTarget.z + dx * sine + dz * cosine;
    const radius = Math.hypot(dx, dz);
    camera.position.y = Math.max(
      visualBox.maxY * 0.12 + 2,
      camera.position.y + radius * bobSign * BOB_ELEVATION * BOB_SPEED * step * Math.cos(bobPhase),
    );
    camera.lookAt(orbitTarget);
  }

  if (entranceActive) applyEntrance(0);
  else settle();

  return {
    get framing(): CityFraming { return framing; },
    get box(): CityFitBox { return box; },
    get visualBox(): CityFitBox { return visualBox; },
    get entranceActive(): boolean { return entranceActive; },
    get idleTime(): number { return idleTime; },
    get maxOrbitDistance(): number { return orbitMaxDistance; },

    orbitFraming(azimuth: number): CityFraming {
      return orbitFramingAt(azimuth);
    },

    update(dt: number): boolean {
      if (disposed) return false;
      const step = clamp(dt, 0, 0.1);
      if (entranceActive) {
        entranceElapsed += step;
        const p = Math.min(1, entranceElapsed / duration);
        applyEntrance(p);
        if (p >= 1) {
          entranceActive = false;
          settle();
          /* hand straight over to the drift at speed: the entrance is already
             turning this fast, so pausing here would read as a stutter */
          if (!reducedMotion) {
            idleTime = idleDelay;
            driftRamp = 1;
          }
        }
        return entranceActive;
      }
      idleTime += step;
      if (!reducedMotion) drift(step);
      return false;
    },

    skipEntrance(): void {
      if (disposed) return;
      entranceActive = false;
      entranceElapsed = duration;
      settle();
    },

    noteInteraction(): void {
      if (disposed) return;
      if (entranceActive) {
        /* skipping the entrance is not the same as taking the camera over:
           the pose is still the composed one, so resizes may keep reframing */
        entranceActive = false;
        entranceElapsed = duration;
        settle();
        return;
      }
      idleTime = 0;
      driftRamp = 0;
      userMoved = true;
      composed = false;
    },

    refresh(): void {
      if (disposed) return;
      const view = options.viewport();
      const resized = view.canvasWidth !== framedWidth || view.canvasHeight !== framedHeight;
      framedWidth = view.canvasWidth;
      framedHeight = view.canvasHeight;
      buildOrbitTable();
      framing = orbitFramingAt(heroAzimuth + driftAngle, DEFAULT_ELEVATION + bobOffset());
      if (entranceActive) return;
      /* an idle city keeps drifting from where it is — no jump back to the start */
      if (!userMoved) applyComposed(framing);
      else if (resized) recompose();
    },

    dispose(): void {
      disposed = true;
      entranceActive = false;
    },
  };
}

/** Derivative of {@link catmullRom} with respect to `t`. */
function catmullRomSlope(p0: number, p1: number, p2: number, p3: number, t: number): number {
  return 0.5 * (
    (-p0 + p2) +
    2 * (2 * p0 - 5 * p1 + 4 * p2 - p3) * t +
    3 * (-p0 + 3 * p1 - 3 * p2 + p3) * t * t
  );
}

/** Uniform Catmull-Rom through four scalar keys, sampled between p1 and p2. */
function catmullRom(p0: number, p1: number, p2: number, p3: number, t: number): number {
  const t2 = t * t;
  const t3 = t2 * t;
  return 0.5 * (
    2 * p1 +
    (-p0 + p2) * t +
    (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 +
    (-p0 + 3 * p1 - 3 * p2 + p3) * t3
  );
}

/**
 * focus.ts — put the camera somewhere it can actually see the building.
 *
 * Focusing a file used to be three lines: take the direction the camera is
 * already looking from, walk back along it by a distance derived from the
 * building's size, and stop. Nothing asked what was in the way. In a city
 * whose whole point is that buildings are packed close together, the answer
 * was frequently "another building".
 *
 * Measured, selecting `src/city/typology.ts` in this repository: the camera
 * landed 68.5 units from its target, which is correct, and 1.85 units from
 * `.github/ISSUE_TEMPLATE/bug_report.yml`, which is not. The screen filled
 * with a facade belonging to a file the user had not selected. That is worth
 * being precise about, because it looks like a highlighting problem and is
 * not one: no marker on the target can help when the target is behind the
 * camera's own viewpoint.
 *
 * The fix searches for a viewpoint with a clear line of sight to the target,
 * preferring the smallest departure from what was asked for: first raise the
 * approach angle, and only if every angle is still blocked, pull further
 * back. Angle is tried first because it costs nothing — the building stays
 * the same size in frame — while pulling back genuinely makes it smaller.
 *
 * Two weaker tests were tried first and both are worth recording, because
 * both looked sufficient and neither was.
 *
 * Testing that the camera is above the roof beneath it left the camera inside
 * a building in 495 of 2,000 cases: lifting a viewpoint drags it inward
 * across the sphere of camera positions, so it lands over a different
 * footprint, which may be taller than the one it just escaped.
 *
 * Testing the camera point alone — even correctly — still reproduced the
 * original screenshot exactly. The camera was in open air by 1.85 units and
 * the frame was filled by `bug_report.yml`, because standing just outside a
 * wall and standing inside it look identical through a lens. What matters is
 * not where the camera is but whether anything sits between it and the
 * building, so the predicate is a segment test against every other building.
 */

/** What this module needs to know about a building; a superset is fine. */
export interface Occluder {
  position: readonly [number, number, number];
  scale: readonly [number, number, number];
  totalHeight: number;
}

/** World-space clearance kept between the camera and any roof or wall. */
export const FOCUS_CLEARANCE = 4;

/**
 * Steepest approach the search will accept, in radians.
 *
 * Short of straight down, which frames a roof rather than a building. A steep
 * view of the right building still beats a level view of the wrong one, so
 * the cap is generous.
 */
export const MAX_ELEVATION = 1.45; // ~83 degrees

/** Elevation angles tried, from the requested one up to {@link MAX_ELEVATION}. */
const ELEVATION_STEPS = 9;

/**
 * Distances tried, as multiples of the one asked for.
 *
 * Only reached when every angle at the previous multiple was blocked. The
 * last is large enough to clear any real skyline, so the search always
 * terminates somewhere in open air.
 */
const DISTANCE_STEPS = [1, 1.4, 2, 3, 5];

/**
 * Footprints are treated as the axis-aligned core plus `clearance`. The crown
 * above a core can overhang it slightly — the widest brim is 1.06x — which
 * the clearance margin absorbs rather than modelling separately.
 */
/** Does `b`, grown by `clearance`, contain this world-space point? */
export function contains(
  b: Occluder, x: number, y: number, z: number,
  offsetX: number, offsetZ: number, clearance: number,
): boolean {
  return Math.abs(x - (b.position[0] + offsetX)) <= b.scale[0] / 2 + clearance
    && Math.abs(z - (b.position[2] + offsetZ)) <= b.scale[2] / 2 + clearance
    && y >= -clearance && y <= b.totalHeight + clearance;
}

/**
 * Does the segment `a`→`c` pass through `b`, grown by `clearance`?
 *
 * Slab method against the axis-aligned box. Buildings are boxes and the city
 * never rotates them, so this is exact rather than an approximation, and it
 * costs one pass over the buildings per candidate viewpoint instead of one
 * pass per sample along the ray.
 */
export function segmentHitsBuilding(
  a: readonly [number, number, number],
  c: readonly [number, number, number],
  b: Occluder,
  offsetX = 0,
  offsetZ = 0,
  clearance = FOCUS_CLEARANCE,
): boolean {
  const lo = [
    b.position[0] + offsetX - b.scale[0] / 2 - clearance,
    -clearance,
    b.position[2] + offsetZ - b.scale[2] / 2 - clearance,
  ];
  const hi = [
    b.position[0] + offsetX + b.scale[0] / 2 + clearance,
    b.totalHeight + clearance,
    b.position[2] + offsetZ + b.scale[2] / 2 + clearance,
  ];

  let enter = 0;
  let exit = 1;
  for (let axis = 0; axis < 3; axis++) {
    const span = c[axis] - a[axis];
    if (Math.abs(span) < 1e-9) {
      // Parallel to this slab: either wholly inside it or it can never enter.
      if (a[axis] < lo[axis] || a[axis] > hi[axis]) return false;
      continue;
    }
    const t1 = (lo[axis] - a[axis]) / span;
    const t2 = (hi[axis] - a[axis]) / span;
    enter = Math.max(enter, Math.min(t1, t2));
    exit = Math.min(exit, Math.max(t1, t2));
    if (enter > exit) return false;
  }
  return true;
}

export interface FocusOptions {
  offsetX?: number;
  offsetZ?: number;
  clearance?: number;
}

/**
 * Where to put the camera to look at `target` from about `distance` away.
 *
 * `direction` points from the target towards the viewer — normally the
 * camera's current one, so focusing does not spin the city around. Its
 * compass bearing is always preserved; only its elevation, and as a last
 * resort the distance, are allowed to change.
 *
 * The returned `distance` is what was actually used, which is the requested
 * one unless every angle at that range was inside a building.
 */
export function focusCameraPosition(
  target: readonly [number, number, number],
  direction: readonly [number, number, number],
  distance: number,
  buildings: readonly Occluder[],
  options: FocusOptions = {},
): { position: [number, number, number]; distance: number; clear: boolean } {
  const offsetX = options.offsetX ?? 0;
  const offsetZ = options.offsetZ ?? 0;
  const clearance = options.clearance ?? FOCUS_CLEARANCE;

  // A camera sitting exactly on its target gives no direction to preserve.
  const dir = normalize(direction) ?? normalize([1, 0.7, 1])!;
  const bearing = Math.hypot(dir[0], dir[2]) > 1e-6
    ? [dir[0] / Math.hypot(dir[0], dir[2]), dir[2] / Math.hypot(dir[0], dir[2])] as const
    : ([Math.SQRT1_2, Math.SQRT1_2] as const);

  const startElevation = Math.min(Math.asin(clamp(dir[1], -1, 1)), MAX_ELEVATION);
  const at = (elevation: number, radius: number): [number, number, number] => [
    target[0] + bearing[0] * Math.cos(elevation) * radius,
    target[1] + Math.sin(elevation) * radius,
    target[2] + bearing[1] * Math.cos(elevation) * radius,
  ];
  /*
   * The target sits inside its own building by construction — it is that
   * building's centre at 45% of its height — so the building being looked at
   * can never be an obstruction.
   *
   * Containment is tested against the true box, with no clearance. Growing it
   * first excused far too much: the margin reaches a narrow building's centre
   * from outside, so every neighbour of a six-unit-wide file counted as "the
   * thing being looked at" and stopped blocking anything, including when the
   * camera was inside it.
   */
  const relevant = buildings.filter(
    (b) => !contains(b, target[0], target[1], target[2], offsetX, offsetZ, 0));

  /*
   * Clearance applies to where the camera stands, not to the whole ray. A
   * margin on every occluder would have the same failure in the other
   * direction: a neighbour two units from a narrow building's centre swallows
   * the target end of every possible ray, so nothing is ever clear and the
   * search always falls through to an overhead shot.
   */
  const isClear = (p: readonly [number, number, number]): boolean => {
    for (const b of relevant) {
      if (contains(b, p[0], p[1], p[2], offsetX, offsetZ, clearance)) return false;
      if (segmentHitsBuilding(p, target, b, offsetX, offsetZ, 0)) return false;
    }
    return true;
  };

  for (const step of DISTANCE_STEPS) {
    const radius = distance * step;
    for (let i = 0; i < ELEVATION_STEPS; i++) {
      const elevation = startElevation
        + (MAX_ELEVATION - startElevation) * (i / (ELEVATION_STEPS - 1));
      const point = at(elevation, radius);
      if (isClear(point)) return { position: point, distance: radius, clear: true };
    }
  }

  /*
   * Last resort: straight down from above the whole skyline.
   *
   * This is what makes the search terminate rather than merely usually
   * succeed. Footprints do not overlap, so the column directly over a
   * building contains only that building — which is excluded as the thing
   * being looked at — and the view down it is clear unless a taller
   * neighbour's clearance margin happens to clip the column. It gives up the
   * approach bearing entirely, which is why it is not tried sooner: an
   * overhead shot of a roof is a poor picture of a building, just a legible
   * one.
   */
  let tallest = 0;
  for (const b of buildings) if (b.totalHeight > tallest) tallest = b.totalHeight;
  const radius = Math.max(distance, tallest - target[1] + clearance * 2);
  const overhead: [number, number, number] = [target[0], target[1] + radius, target[2]];
  return { position: overhead, distance: radius, clear: isClear(overhead) };
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

function normalize(v: readonly [number, number, number]): [number, number, number] | null {
  const length = Math.hypot(v[0], v[1], v[2]);
  if (!(length > 1e-6)) return null;
  return [v[0] / length, v[1] / length, v[2] / length];
}

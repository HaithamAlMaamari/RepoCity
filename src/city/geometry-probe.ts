/**
 * geometry-probe.ts — what shape the city's buildings actually are.
 *
 * Companion to `brightness-probe.ts`, and here for the same reason: a defect
 * that only exists in a distribution cannot be found by reading the code or by
 * looking at one building. The city's buildings became needles — a median
 * height-to-width ratio of 39:1 — and nothing caught it, because every test
 * asserted a *ratio* (`scale[0] / parcel[0] === 0.9`) which holds identically
 * for a 0.02-unit needle and a 40-unit slab, and no test ran `buildLayout` and
 * `buildCity` against each other at all.
 *
 * The measure that matters is **slenderness**: rendered core height divided by
 * the narrower horizontal footprint. It is the number a viewer reads as "these
 * buildings look wrong", and — because building height comes from a fixed
 * 6..72 world-unit range while footprints come from the treemap — it is the
 * number that silently drifted as repositories got larger. A city should look
 * the same at 13 files and at 5,000; slenderness is how that gets asserted.
 */

import type { Building } from './city';
import type { BuildingCategory } from './file-class';

export interface GeometrySample {
  path: string;
  language: string;
  category: BuildingCategory;
  profile: Building['profile'];
  /** Narrow horizontal footprint, world units — what `aSpan` reports. */
  span: number;
  /** Wide horizontal footprint, world units. */
  longSpan: number;
  /** Plan aspect ratio, always >= 1. */
  aspect: number;
  /** Height of the lit core as actually rendered. */
  coreHeight: number;
  /** Declared height, which the cap geometry is supposed to reach. */
  totalHeight: number;
  /** `coreHeight / span` — the needle metric. */
  slenderness: number;
  /** Area the building's own footprint covers. */
  footprintArea: number;
  /** Area of the plot it was allocated. */
  plotArea: number;
  /** Directory nesting depth, from the path. */
  depth: number;
}

export interface GeometryReport {
  samples: GeometrySample[];
  /** Total building footprint area divided by the city's bounding area. */
  coverage: number;
  /** Bounding area of the city, world units squared. */
  landArea: number;
}

export interface CityBounds {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

/** Nearest-rank quantile of an already-sorted ascending array. */
export function quantile(sorted: readonly number[], q: number): number {
  if (sorted.length === 0) return 0;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.round((sorted.length - 1) * q)));
  return sorted[index];
}

/** Ascending sort plus quantiles, for the distribution assertions in tests. */
export function distribution(values: readonly number[]): {
  p01: number; p50: number; p95: number; p99: number; min: number; max: number;
} {
  const sorted = [...values].sort((a, b) => a - b);
  return {
    p01: quantile(sorted, 0.01),
    p50: quantile(sorted, 0.5),
    p95: quantile(sorted, 0.95),
    p99: quantile(sorted, 0.99),
    min: sorted[0] ?? 0,
    max: sorted[sorted.length - 1] ?? 0,
  };
}

export function probeGeometry(
  buildings: readonly Building[],
  bounds: CityBounds,
): GeometryReport {
  const landArea = Math.max(0, bounds.maxX - bounds.minX) * Math.max(0, bounds.maxZ - bounds.minZ);
  let footprintTotal = 0;

  const samples = buildings.map((b): GeometrySample => {
    const span = Math.min(b.scale[0], b.scale[2]);
    const longSpan = Math.max(b.scale[0], b.scale[2]);
    const footprintArea = b.scale[0] * b.scale[2];
    footprintTotal += footprintArea;
    return {
      path: b.path,
      language: b.language,
      category: b.category,
      profile: b.profile,
      span,
      longSpan,
      aspect: span > 0 ? longSpan / span : Infinity,
      coreHeight: b.scale[1],
      totalHeight: b.totalHeight,
      slenderness: span > 0 ? b.scale[1] / span : Infinity,
      footprintArea,
      plotArea: b.parcel[0] * b.parcel[1],
      depth: b.path.split('/').length - 1,
    };
  });

  return { samples, landArea, coverage: landArea > 0 ? footprintTotal / landArea : 0 };
}

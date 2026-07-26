/**
 * Shared type definitions used across multiple modules.
 *
 * Module-local types stay in the module that owns them; this file is
 * only for types passed between module boundaries.
 */

/**
 * Axis-aligned bounds on the XZ plane. Used for the city footprint,
 * street network bounds, and camera framing.
 */
export interface Bounds2D {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

/**
 * RGB color triplet, components in [0, 1].
 */
export type RGB = readonly [number, number, number];

/**
 * A rectangle on the ground plane representing a top-level district.
 * Produced by flattening the treemap layout and passed to effects
 * that decorate the district surface.
 */
export interface DistrictRect {
  x: number;
  z: number;
  w: number;
  d: number;
  /** Nesting depth in the file tree. `1` = top-level folder. */
  depth: number;
  /** Top-level folder represented by this block. */
  name?: string;
}

/**
 * A street segment — a rectangle representing a road between districts.
 * `axis: 'x'` means the street runs along the X axis (so vehicles move
 * along X and lanes span in Z).
 */
export interface StreetSegment {
  x1: number;
  z1: number;
  x2: number;
  z2: number;
  width: number;
  axis: 'x' | 'z';
}

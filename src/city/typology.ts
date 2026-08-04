/**
 * typology.ts — what KIND of building this is, as opposed to how big.
 *
 * ── The problem this solves ───────────────────────────────────────────────
 * Every building in the city was the same object at a different scale. The
 * treemap's `squarify` optimises plots toward an aspect ratio of 1 (measured:
 * p05 1.03, p50 1.29, p95 1.97), and a building fills its plot on both axes,
 * so every footprint was a near-square. On top of that the silhouette came
 * from one fixed recipe per size band, which meant four shapes across five
 * thousand buildings — and a single one of them accounted for 20% of the city.
 * The result read as a server rack rather than a skyline: uniform, evenly
 * spaced, no hierarchy.
 *
 * ── Why the DIRECTORY chooses the shape ──────────────────────────────────
 * The obvious fix is to jitter each building independently, and it is the
 * wrong one: per-building noise removes the monotony but replaces it with
 * visual slop, because neighbours never agree about anything. It also fails
 * this project's central claim — that the city is honest, and that everything
 * a viewer can see corresponds to something real in the repository.
 *
 * So the typology is keyed to a file's immediate parent directory. Files in a
 * folder are built alike; the folder next door is built differently. The
 * treemap already places a folder's files contiguously, so this reads as
 * neighbourhoods with their own character — which is simultaneously the
 * variety the city was missing and the organisation it was missing, because
 * the districts finally become legible instead of being an invisible
 * subdivision rule. Shape means "which part of the repository am I in".
 *
 * Being a pure function of the path, it is deterministic for free: the same
 * repository always produces the same city, and no seeded stream is touched.
 */

import { hashString } from '../core/random';

export interface Typology {
  readonly name: string;
  /**
   * Width each cap step keeps relative to the step below it. Low values give
   * a sharp, tapering silhouette; high values give a broad stepped mass.
   */
  readonly narrowing: number;
  /**
   * Share of its plot's SHORT axis the building occupies. 1 fills the plot and
   * reads as a block; lower values turn it into a slab standing along the long
   * axis, and open a gap beside it that reads as a side street.
   */
  readonly planFill: number;
  /** Which way the building sits in the slack its `planFill` leaves. */
  readonly align: -1 | 0 | 1;
  /** Cap the silhouette with a mast, where the size band allows one. */
  readonly mast: boolean;
  /** How many stacked crowns to divide the cap budget into, at most. */
  readonly steps: number;
}

/**
 * The vocabulary. Deliberately small and strongly differentiated — a dozen
 * near-identical variants would read as noise, which is the failure mode being
 * avoided. Each entry is a recognisably different building.
 */
const TYPOLOGIES: readonly Typology[] = [
  // Sharp and tapered: the classic neon spire.
  { name: 'spire', narrowing: 0.56, planFill: 0.86, align: 0, mast: true, steps: 2 },
  // Broad, gently stepped, no mast — reads as mass rather than height.
  { name: 'ziggurat', narrowing: 0.86, planFill: 1.0, align: 0, mast: false, steps: 3 },
  // A wall standing along its plot's long axis, with a street beside it.
  { name: 'slab', narrowing: 0.93, planFill: 0.52, align: -1, mast: false, steps: 1 },
  // The default high-rise: two setbacks and a mast.
  { name: 'tower', narrowing: 0.68, planFill: 1.0, align: 0, mast: true, steps: 2 },
  // Squat and wide, stepping back hard once.
  { name: 'terrace', narrowing: 0.74, planFill: 0.78, align: 1, mast: false, steps: 2 },
  // Tight footprint, tall stack, mast — the densest downtown reading.
  { name: 'stack', narrowing: 0.71, planFill: 0.68, align: 1, mast: true, steps: 3 },
];

/** The default, used for depots and anything unkeyed. */
export const BLOCK_TYPOLOGY: Typology = {
  name: 'block', narrowing: 0.9, planFill: 1.0, align: 0, mast: false, steps: 1,
};

/**
 * The directory whose character a file inherits — its immediate parent.
 *
 * The parent rather than the top-level folder because a repository's top level
 * is usually only a handful of entries, which would give the whole city three
 * or four looks; and because `src/compiler` and `src/parser` genuinely are
 * different neighbourhoods. Root-level files share the repository's own key.
 */
export function districtKeyOf(path: string): string {
  const slash = path.lastIndexOf('/');
  return slash < 0 ? '' : path.slice(0, slash);
}

/**
 * Pick the typology for a district. Pure, total, and stable across runs.
 */
export function typologyFor(districtKey: string): Typology {
  return TYPOLOGIES[hashString(`typology\0${districtKey}`) % TYPOLOGIES.length];
}

/** Every typology, for tests and for documenting the vocabulary. */
export const ALL_TYPOLOGIES: readonly Typology[] = TYPOLOGIES;

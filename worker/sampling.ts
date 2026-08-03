/**
 * Deterministic, representative file sampling for RepoCity.
 *
 * A repository is split into strata keyed by `(top-level district, language)`.
 * Every stratum receives a number of seats derived from a blended weight, and
 * the files inside a stratum are picked by a seeded, stable priority so that
 * the same `(files, limit, seed)` triple always yields the same selection.
 *
 * Allocation rules (policy `district-language-representative-v2`):
 *
 * 1. **Blended weight.** `weight = 0.75 * countShare + 0.25 * dampedByteShare`.
 *    Byte share is computed from per-file sizes clamped to {@link BYTE_CAP}, so
 *    a handful of multi-megabyte models or textures cannot buy a directory more
 *    seats than the number of files it actually contains would justify.
 * 2. **District floor.** Every top-level district reserves one seat before the
 *    proportional pass (when there are at most `limit` districts), so small but
 *    meaningful folders never disappear. The reservation is per *district*, not
 *    per stratum: a directory that fans out into many asset languages no longer
 *    farms extra seats out of that fan-out.
 * 3. **Source floor.** Strata whose language is source code (see
 *    {@link isSourceLanguage}) collectively receive at least
 *    `max(sourceFileShare, MIN_SOURCE_SHARE)` of the seats, capped by the number
 *    of source files that exist. Those seats are placed before anything else;
 *    afterwards every stratum, source included, competes for what is left.
 * 4. **Non-source allowance.** While the remaining seats are being handed out,
 *    a non-source stratum may not exceed `ceil(limit * itsFileShare)` seats. A
 *    directory of textures therefore can never occupy more of the city than its
 *    file count justifies, no matter how many bytes it holds. The allowance is
 *    lifted only if seats would otherwise go unfilled.
 * 5. **Largest remainder + water filling.** Seats are handed out proportionally,
 *    fractional leftovers go to the largest remainders (ties broken by a seeded
 *    stratum priority), and capacity overflow is redistributed over the strata
 *    that still have room.
 * 6. **Global fill.** Any seat still unassigned after the bounded water-filling
 *    loop is filled from the globally highest-priority unselected files, which
 *    keeps the hard guarantee: exactly `limit` files whenever the repository has
 *    at least `limit` distinct file paths.
 */

import type { RepositoryFile } from '../src/data/github-contract';

/** Weight given to a stratum's share of the repository's file count. */
export const COUNT_WEIGHT = 0.75;

/** Weight given to a stratum's share of the repository's damped byte total. */
export const BYTE_WEIGHT = 1 - COUNT_WEIGHT;

/**
 * Per-file byte cap used when computing byte shares (64 KiB). 64 KiB sits at
 * the upper end of a large hand-written source file, so byte share still
 * separates substantial code from stubs while a 40 MB texture counts the same
 * as a long module instead of buying a whole neighbourhood.
 */
export const BYTE_CAP = 65_536;

/**
 * Minimum share of the selection reserved for source-code strata whenever the
 * repository contains source files. The effective floor is
 * `max(sourceFiles / totalFiles, MIN_SOURCE_SHARE)`, capped by the number of
 * source files available.
 */
export const MIN_SOURCE_SHARE = 0.35;

/** Bound on the water-filling redistribution loop; keeps the worker O(n log n). */
const MAX_ALLOCATION_ROUNDS = 8;

/** District label used for files that live at the repository root. */
const ROOT_DISTRICT = '(root)';

/**
 * Languages counted as source code for the source-representation floor.
 * Documentation, configuration, data and binary buckets are deliberately
 * excluded: they are what drowns out real code in asset-heavy repositories.
 */
const SOURCE_LANGUAGES: ReadonlySet<string> = new Set([
  'javascript', 'typescript', 'python', 'rust', 'go', 'c', 'cpp', 'java', 'csharp',
  'scala', 'kotlin', 'swift', 'dart', 'groovy', 'haskell', 'elm', 'fsharp', 'ocaml',
  'clojure', 'crystal', 'nim', 'zig', 'julia', 'objc', 'objcpp', 'elixir', 'erlang',
  'lua', 'perl', 'r', 'haxe', 'coffeescript', 'elisp', 'tcl', 'fortran', 'cobol',
  'pascal', 'ada', 'verilog', 'systemverilog', 'vhdl', 'scheme', 'racket', 'lisp',
  'reason', 'rescript', 'purescript', 'idris', 'gleam', 'raku', 'nushell', 'starlark',
  'awk', 'mathematica', 'ruby', 'php', 'shell', 'powershell', 'vimscript', 'assembly',
  'sql', 'graphql', 'glsl', 'hlsl', 'wgsl', 'wasm', 'solidity', 'protobuf', 'html',
  'css', 'scss', 'sass', 'less', 'vue', 'svelte', 'handlebars', 'pug', 'liquid',
  'jinja', 'twig', 'mustache', 'ejs', 'cmake', 'makefile', 'dockerfile', 'terraform',
  'nix',
]);

interface RankedFile {
  readonly file: RepositoryFile;
  readonly priority: bigint;
}

interface Stratum {
  readonly key: string;
  readonly district: string;
  readonly language: string;
  readonly entries: RankedFile[];
  readonly priority: bigint;
  readonly source: boolean;
  count: number;
  cappedBytes: number;
  weight: number;
  /** Upper bound on seats for the current allocation phase. */
  allowance: number;
  seats: number;
}

/** Reports whether a detected language counts as source code. */
export function isSourceLanguage(language: string): boolean {
  return SOURCE_LANGUAGES.has(language);
}

/**
 * Select at most `limit` files, deterministically and representatively.
 *
 * @param files - Every file discovered in the repository tree.
 * @param limit - Maximum number of files to return.
 * @param seed - Stable seed (RepoCity passes the commit SHA).
 * @returns The selected files sorted by path. Exactly `limit` entries whenever
 *   `files` holds at least `limit` distinct paths.
 */
export function sampleFiles(
  files: readonly RepositoryFile[],
  limit: number,
  seed: string,
): RepositoryFile[] {
  if (limit <= 0) return [];
  if (files.length <= limit) return [...files].sort(compareFilePath);

  const ranked: RankedFile[] = files.map((file) => ({ file, priority: stablePriority(seed, file.path) }));

  const byKey = new Map<string, Stratum>();
  let totalCount = 0;
  let totalCappedBytes = 0;
  for (const entry of ranked) {
    const path = entry.file.path;
    const slash = path.indexOf('/');
    const district = slash === -1 ? ROOT_DISTRICT : path.slice(0, slash);
    const key = `${district}\0${entry.file.language}`;
    let stratum = byKey.get(key);
    if (!stratum) {
      stratum = {
        key,
        district,
        language: entry.file.language,
        entries: [],
        priority: stablePriority(seed, key),
        source: isSourceLanguage(entry.file.language),
        count: 0,
        cappedBytes: 0,
        weight: 0,
        allowance: 0,
        seats: 0,
      };
      byKey.set(key, stratum);
    }
    stratum.entries.push(entry);
    stratum.count++;
    const size = Number.isFinite(entry.file.size) ? Math.max(0, entry.file.size) : 0;
    const capped = Math.min(size, BYTE_CAP);
    stratum.cappedBytes += capped;
    totalCappedBytes += capped;
    totalCount++;
  }

  const strata = [...byKey.values()].sort((a, b) => compareText(a.key, b.key));
  for (const stratum of strata) {
    stratum.entries.sort(compareRanked);
    const countShare = stratum.count / totalCount;
    const byteShare = totalCappedBytes > 0 ? stratum.cappedBytes / totalCappedBytes : countShare;
    stratum.weight = COUNT_WEIGHT * countShare + BYTE_WEIGHT * byteShare;
    stratum.allowance = stratum.source
      ? stratum.count
      : Math.min(stratum.count, Math.ceil(limit * countShare));
  }

  let remaining = limit - reserveDistrictSeats(strata, limit);

  if (remaining > 0) {
    const sourceStrata = strata.filter((stratum) => stratum.source);
    const sourceCount = sourceStrata.reduce((sum, stratum) => sum + stratum.count, 0);
    if (sourceCount > 0) {
      const desiredShare = Math.min(1, Math.max(sourceCount / totalCount, MIN_SOURCE_SHARE));
      const target = Math.min(sourceCount, Math.ceil(limit * desiredShare));
      const assigned = sourceStrata.reduce((sum, stratum) => sum + stratum.seats, 0);
      const deficit = Math.min(target - assigned, remaining);
      if (deficit > 0) remaining -= deficit - distribute(sourceStrata, deficit);
    }
  }

  if (remaining > 0) remaining = distribute(strata, remaining);

  if (remaining > 0) {
    for (const stratum of strata) stratum.allowance = stratum.count;
    remaining = distribute(strata, remaining);
  }

  const selected = new Map<string, RepositoryFile>();
  for (const stratum of strata) {
    for (let index = 0; index < stratum.seats; index++) {
      const entry = stratum.entries[index];
      selected.set(entry.file.path, entry.file);
    }
  }

  if (selected.size < limit) {
    const fallback = [...ranked].sort(compareRanked);
    for (const entry of fallback) {
      if (selected.size >= limit) break;
      selected.set(entry.file.path, entry.file);
    }
  }

  return [...selected.values()].sort(compareFilePath);
}

/**
 * Give one seat to each top-level district so no folder vanishes entirely.
 * When a repository has more districts than seats, the districts with the
 * largest blended weight win. Returns the number of seats reserved.
 */
function reserveDistrictSeats(strata: readonly Stratum[], limit: number): number {
  const representatives = new Map<string, Stratum>();
  for (const stratum of strata) {
    const current = representatives.get(stratum.district);
    if (!current || stratum.weight > current.weight) representatives.set(stratum.district, stratum);
  }

  const chosen = [...representatives.values()];
  if (chosen.length > limit) {
    chosen.sort((a, b) => b.weight - a.weight || comparePriority(a.priority, b.priority) || compareText(a.key, b.key));
    chosen.length = limit;
  }
  for (const stratum of chosen) {
    stratum.seats = 1;
    stratum.allowance = Math.max(stratum.allowance, 1);
  }
  return chosen.length;
}

/**
 * Hand `seats` out over `pool` proportionally to the blended weights, capped by
 * each stratum's remaining allowance. Fractional seats go to the largest
 * remainders; allowance overflow is redistributed in later rounds. Returns the
 * number of seats that could not be placed.
 */
function distribute(pool: readonly Stratum[], seats: number): number {
  let remaining = seats;
  let active = pool.filter(hasRoom);

  for (let round = 0; remaining > 0 && active.length > 0 && round < MAX_ALLOCATION_ROUNDS; round++) {
    const totalWeight = active.reduce((sum, stratum) => sum + stratum.weight, 0);
    const budget = remaining;
    const pending: { stratum: Stratum; remainder: number }[] = [];

    for (const stratum of active) {
      let remainder = 0;
      if (totalWeight > 0) {
        const exact = budget * stratum.weight / totalWeight;
        const floored = Math.floor(exact);
        const granted = Math.min(stratum.allowance - stratum.seats, floored);
        stratum.seats += granted;
        remaining -= granted;
        remainder = exact - floored;
      }
      pending.push({ stratum, remainder });
    }

    pending.sort((a, b) =>
      b.remainder - a.remainder ||
      comparePriority(a.stratum.priority, b.stratum.priority) ||
      compareText(a.stratum.key, b.stratum.key));

    for (const entry of pending) {
      if (remaining <= 0) break;
      if (hasRoom(entry.stratum)) {
        entry.stratum.seats++;
        remaining--;
      }
    }

    active = active.filter(hasRoom);
  }

  return remaining;
}

function hasRoom(stratum: Stratum): boolean {
  return stratum.seats < Math.min(stratum.allowance, stratum.count);
}

/** FNV-1a over `seed\0path`, used as the stable per-file selection priority. */
export function stablePriority(seed: string, path: string): bigint {
  let hash = 0xcbf29ce484222325n;
  const input = `${seed}\0${path}`;
  for (let index = 0; index < input.length; index++) {
    hash ^= BigInt(input.charCodeAt(index));
    hash = BigInt.asUintN(64, hash * 0x100000001b3n);
  }
  return hash;
}

/** Total order over strings without locale sensitivity. */
export function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function comparePriority(a: bigint, b: bigint): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function compareRanked(a: RankedFile, b: RankedFile): number {
  return comparePriority(a.priority, b.priority) || compareText(a.file.path, b.file.path);
}

function compareFilePath(a: RepositoryFile, b: RepositoryFile): number {
  return compareText(a.path, b.path);
}

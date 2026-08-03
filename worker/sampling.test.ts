import { describe, expect, it } from 'vitest';
import type { RepositoryFile } from '../src/data/github-contract';
import {
  BYTE_CAP,
  COUNT_WEIGHT,
  MIN_SOURCE_SHARE,
  compareText,
  isSourceLanguage,
  sampleFiles,
  stablePriority,
} from './sampling';

const SEED = 'a'.repeat(40);
const OTHER_SEED = 'c'.repeat(40);
const KIB = 1024;
const MIB = 1024 * 1024;

function file(path: string, language: string, size = 1): RepositoryFile {
  return { path, language, size, sha: 'b'.repeat(40), mode: '100644' };
}

/** `count` files under `prefix`, all with the same language and size. */
function group(prefix: string, count: number, language: string, size: number): RepositoryFile[] {
  return Array.from({ length: count }, (_, index) => file(`${prefix}${index}`, language, size));
}

function districtOf(path: string): string {
  return path.includes('/') ? path.slice(0, path.indexOf('/')) : '(root)';
}

function underPrefix(files: readonly RepositoryFile[], prefix: string): number {
  return files.filter((item) => item.path.startsWith(prefix)).length;
}

function sourceCount(files: readonly RepositoryFile[]): number {
  return files.filter((item) => isSourceLanguage(item.language)).length;
}

function districts(files: readonly RepositoryFile[]): Set<string> {
  return new Set(files.map((item) => districtOf(item.path)));
}

function paths(files: readonly RepositoryFile[]): string[] {
  return files.map((item) => item.path);
}

/**
 * Models the shape that broke the real city: a handful of enormous asset files
 * next to thousands of small source files, all under one giant `examples/`
 * district while the actual library lives in a much smaller `src/`.
 */
function assetHeavyRepository(): RepositoryFile[] {
  return [
    ...group('src/core/f', 430, 'javascript', 8 * KIB),
    ...group('examples/page', 1_050, 'html', 6 * KIB),
    ...group('examples/jsm/mod', 700, 'javascript', 12 * KIB),
    ...group('examples/models/model', 700, 'unknown', 2 * MIB),
    ...group('examples/textures/tex', 600, 'image', 800 * KIB),
    ...group('examples/screenshots/shot', 400, 'image', 60 * KIB),
    ...group('examples/sounds/clip', 10, 'audio', 3 * MIB),
    ...group('docs/api/page', 500, 'html', 4 * KIB),
    ...group('manual/figures/fig', 200, 'image', 300 * KIB),
    ...group('editor/js/e', 150, 'javascript', 15 * KIB),
    ...group('test/unit/t', 300, 'javascript', 5 * KIB),
    ...group('build/three', 5, 'javascript', 5 * MIB),
    ...group('.github/workflows/w', 20, 'yaml', 2 * KIB),
    ...group('README', 15, 'markdown', 4 * KIB),
  ];
}

describe('sampleFiles — guarantees', () => {
  const small = [
    file('src/a.ts', 'typescript'),
    file('src/b.ts', 'typescript'),
    file('docs/a.md', 'markdown'),
    file('docs/b.md', 'markdown'),
    file('tests/a.ts', 'typescript'),
    file('README.md', 'markdown'),
  ];

  it('returns every file, path sorted, when the repository fits the limit', () => {
    expect(paths(sampleFiles(small, 6, SEED))).toEqual([
      'README.md', 'docs/a.md', 'docs/b.md', 'src/a.ts', 'src/b.ts', 'tests/a.ts',
    ]);
    expect(sampleFiles(small, 99, SEED)).toHaveLength(6);
  });

  it('returns nothing for a non-positive limit', () => {
    expect(sampleFiles(small, 0, SEED)).toEqual([]);
    expect(sampleFiles(small, -3, SEED)).toEqual([]);
    expect(sampleFiles([], 0, SEED)).toEqual([]);
  });

  it('selects exactly the limit at every size, with unique sorted paths', () => {
    const repository = assetHeavyRepository();
    for (const limit of [1, 2, 3, 7, 13, 64, 199, 512, 1_000, 2_500, 4_079, repository.length - 1]) {
      const selected = sampleFiles(repository, limit, SEED);
      expect(selected).toHaveLength(limit);
      expect(new Set(paths(selected)).size).toBe(limit);
      expect(paths(selected)).toEqual([...paths(selected)].sort(compareText));
    }
    expect(sampleFiles(repository, repository.length, SEED)).toHaveLength(repository.length);
  });

  it('is deterministic for the same input and seed, regardless of source order', () => {
    const repository = assetHeavyRepository();
    const first = paths(sampleFiles(repository, 1_500, SEED));
    const second = paths(sampleFiles(repository, 1_500, SEED));
    const reversed = paths(sampleFiles([...repository].reverse(), 1_500, SEED));
    const shuffled = paths(sampleFiles(
      [...repository].sort((a, b) => compareText(`${a.size}${a.path}`, `${b.size}${b.path}`)),
      1_500,
      SEED,
    ));
    expect(second).toEqual(first);
    expect(reversed).toEqual(first);
    expect(shuffled).toEqual(first);
  });

  it('produces a different selection for a different seed', () => {
    const repository = assetHeavyRepository();
    const withSeed = paths(sampleFiles(repository, 1_500, SEED));
    const withOtherSeed = paths(sampleFiles(repository, 1_500, OTHER_SEED));
    expect(withOtherSeed).toHaveLength(withSeed.length);
    expect(withOtherSeed).not.toEqual(withSeed);
  });

  it('uses a stable seeded priority', () => {
    expect(stablePriority(SEED, 'src/a.ts')).toBe(stablePriority(SEED, 'src/a.ts'));
    expect(stablePriority(SEED, 'src/a.ts')).not.toBe(stablePriority(SEED, 'src/b.ts'));
    expect(stablePriority(SEED, 'src/a.ts')).not.toBe(stablePriority(OTHER_SEED, 'src/a.ts'));
  });
});

describe('sampleFiles — representation', () => {
  it('gives source files real estate in an asset-heavy repository', () => {
    const repository = assetHeavyRepository();
    const limit = 1_500;
    const selected = sampleFiles(repository, limit, SEED);

    const sourceShare = sourceCount(selected) / selected.length;
    const sourceFileShare = sourceCount(repository) / repository.length;
    // The source floor is a floor: never below the source file share, never
    // below MIN_SOURCE_SHARE.
    expect(sourceShare).toBeGreaterThanOrEqual(Math.max(sourceFileShare, MIN_SOURCE_SHARE));

    // src/ is the library. It must be sampled at least as densely as the
    // repository as a whole, and far more densely than the model/texture dumps.
    const srcRate = underPrefix(selected, 'src/') / underPrefix(repository, 'src/');
    const overallRate = limit / repository.length;
    const modelRate = underPrefix(selected, 'examples/models/') / underPrefix(repository, 'examples/models/');
    const textureRate = underPrefix(selected, 'examples/textures/') / underPrefix(repository, 'examples/textures/');
    expect(srcRate).toBeGreaterThan(overallRate);
    expect(srcRate).toBeGreaterThan(2 * modelRate);
    expect(srcRate).toBeGreaterThan(1.5 * textureRate);

    // The old failure mode: examples/ dwarfing src/ by an order of magnitude.
    const examplesPerSrc = underPrefix(selected, 'examples/') / underPrefix(selected, 'src/');
    expect(examplesPerSrc).toBeLessThan(6);
  });

  it('never lets non-source strata exceed their file-count share', () => {
    const repository = assetHeavyRepository();
    for (const limit of [200, 800, 1_500, 3_000]) {
      const selected = sampleFiles(repository, limit, SEED);
      const nonSourceFiles = repository.length - sourceCount(repository);
      const allowed = Math.ceil(limit * nonSourceFiles / repository.length);
      expect(selected.length - sourceCount(selected)).toBeLessThanOrEqual(allowed);
    }
  });

  it('caps a rare-source repository at the number of source files that exist', () => {
    const repository = [
      ...group('docs/page', 3_000, 'markdown', 2 * KIB),
      ...group('assets/img', 300, 'image', 2 * MIB),
      ...group('src/a', 100, 'typescript', 9 * KIB),
    ];
    const limit = 1_000;
    const selected = sampleFiles(repository, limit, SEED);
    const floorSeats = Math.min(100, Math.ceil(limit * MIN_SOURCE_SHARE));

    expect(selected).toHaveLength(limit);
    expect(sourceCount(selected)).toBeGreaterThanOrEqual(floorSeats);
    // Byte-heavy images stay pinned to their file-count share instead of
    // crowding out the markdown they are embedded in.
    expect(underPrefix(selected, 'assets/')).toBeLessThanOrEqual(Math.ceil(limit * 300 / repository.length));
    expect(underPrefix(selected, 'docs/')).toBeGreaterThan(underPrefix(selected, 'assets/') * 5);
  });

  it('damps byte weight so huge files stop buying seats past the cap', () => {
    // Both strata hold ten source files; one is 160x larger per file but every
    // file is already at or above BYTE_CAP, so the byte share is identical.
    const saturated = [
      ...group('big/b', 10, 'javascript', 10 * MIB),
      ...group('small/s', 10, 'javascript', 2 * BYTE_CAP),
    ];
    const evenSplit = sampleFiles(saturated, 10, SEED);
    expect(underPrefix(evenSplit, 'big/')).toBe(5);
    expect(underPrefix(evenSplit, 'small/')).toBe(5);

    // Below the cap, bytes still tilt the allocation — but never beyond the
    // BYTE_WEIGHT share of the total.
    const uneven = [
      ...group('big/b', 10, 'javascript', 10 * MIB),
      ...group('small/s', 10, 'javascript', KIB),
    ];
    const tilted = sampleFiles(uneven, 10, SEED);
    expect(underPrefix(tilted, 'big/')).toBeGreaterThan(underPrefix(tilted, 'small/'));
    expect(underPrefix(tilted, 'big/')).toBeLessThanOrEqual(Math.ceil(10 * (COUNT_WEIGHT / 2 + (1 - COUNT_WEIGHT))));
  });

  it('keeps every district on the map when districts fit the limit', () => {
    const repository = assetHeavyRepository();
    const selected = sampleFiles(repository, 200, SEED);
    expect(districts(selected)).toEqual(districts(repository));
    // A directory that fans out into many asset languages no longer farms
    // extra seats out of that fan-out.
    expect(underPrefix(selected, 'examples/')).toBeLessThan(repository.length / 8);
  });
});

describe('sampleFiles — allocation paths', () => {
  it('ranks districts by weight when there are more districts than seats', () => {
    // Twelve districts (and twelve strata), five seats: every seat is a
    // district reservation and the largest districts win.
    const repository = Array.from({ length: 12 }, (_, index) =>
      group(`d${index}/f`, (index + 1) * 2, 'javascript', KIB)).flat();
    const selected = sampleFiles(repository, 5, SEED);

    expect(selected).toHaveLength(5);
    expect([...districts(selected)].sort(compareText)).toEqual(['d10', 'd11', 'd7', 'd8', 'd9']);
    expect(paths(sampleFiles([...repository].reverse(), 5, SEED))).toEqual(paths(selected));
  });

  it('breaks a perfect tie with the largest-remainder pass', () => {
    // Three identical strata, five seats: three go to district reservations,
    // the two fractional seats are decided by remainder then seeded priority.
    const repository = [
      ...group('a/f', 3, 'javascript', 100),
      ...group('b/f', 3, 'javascript', 100),
      ...group('c/f', 3, 'javascript', 100),
    ];
    const selected = sampleFiles(repository, 5, SEED);
    const perDistrict = ['a', 'b', 'c'].map((name) => underPrefix(selected, `${name}/`));

    expect(selected).toHaveLength(5);
    expect([...perDistrict].sort()).toEqual([1, 2, 2]);
    expect(paths(sampleFiles([...repository].reverse(), 5, SEED))).toEqual(paths(selected));
    // A different seed still yields a valid 2/2/1 split — the tie is broken by
    // the seed, not by array order.
    const reseeded = ['a', 'b', 'c'].map((name) => underPrefix(sampleFiles(repository, 5, OTHER_SEED), `${name}/`));
    expect([...reseeded].sort()).toEqual([1, 2, 2]);
  });

  it('spreads proportionally inside a single stratum', () => {
    const repository = group('src/only', 10, 'typescript', KIB);
    const selected = sampleFiles(repository, 4, SEED);
    expect(selected).toHaveLength(4);
    expect(new Set(paths(selected)).size).toBe(4);
    expect(paths(sampleFiles(repository, 4, SEED))).toEqual(paths(selected));
  });

  it('falls back to a global fill when stratum seats cannot be honoured', () => {
    // Two strata claim the same path (defensive: the tree loader rejects real
    // duplicates), so per-stratum seats over-count and the global fill has to
    // top the selection back up to exactly `limit`.
    const repository = [
      ...group('src/a', 10, 'typescript', 100),
      ...group('assets/i', 9, 'image', 5 * KIB),
      file('src/a0', 'json', 77),
    ];
    expect(new Set(paths(repository)).size).toBe(repository.length - 1);

    const selected = sampleFiles(repository, 18, SEED);
    expect(selected).toHaveLength(18);
    expect(new Set(paths(selected)).size).toBe(18);
    expect(paths(sampleFiles([...repository].reverse(), 18, SEED))).toEqual(paths(selected));
  });

  it('handles a repository with a single oversized file per stratum', () => {
    const repository = [
      file('a/one.bin', 'binary', 40 * MIB),
      file('b/two.png', 'image', 12 * MIB),
      file('c/three.ts', 'typescript', 900),
      file('root.md', 'markdown', 120),
    ];
    const selected = sampleFiles(repository, 2, SEED);
    expect(selected).toHaveLength(2);
    expect(paths(sampleFiles([...repository].reverse(), 2, SEED))).toEqual(paths(selected));
  });
});

describe('language classification', () => {
  it('separates authored code from asset and data buckets', () => {
    for (const language of ['typescript', 'javascript', 'python', 'glsl', 'html', 'css', 'shell']) {
      expect(isSourceLanguage(language)).toBe(true);
    }
    for (const language of ['image', 'font', 'audio', 'video', 'binary', 'data', 'lockfile', 'unknown', 'markdown', 'json']) {
      expect(isSourceLanguage(language)).toBe(false);
    }
  });
});

describe('compareText', () => {
  it('is a total order without locale surprises', () => {
    expect(compareText('a', 'b')).toBe(-1);
    expect(compareText('b', 'a')).toBe(1);
    expect(compareText('a', 'a')).toBe(0);
    expect(compareText('Z', 'a')).toBe(-1);
  });
});

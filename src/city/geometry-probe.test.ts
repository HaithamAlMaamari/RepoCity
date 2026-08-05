import { describe, expect, it } from 'vitest';
import { buildLayout, repositoryLandSize } from './layout';
import { buildCity } from './city';
import { distribution, probeGeometry } from './geometry-probe';
import { generateDepthProbeTree, generateRepoTree } from './testing/repo-tree';

/**
 * The two halves of the city pipeline, run against each other.
 *
 * Nothing did this before: `city.test.ts` feeds hand-built 20x20 rects that
 * never come from `buildLayout`, and `layout.test.ts` never builds a city. The
 * defects this suite guards lived precisely in that seam — every individual
 * assertion passed while the composed result was a bed of nails.
 */
function cityFor(files: number, seed = 1) {
  const land = repositoryLandSize(files);
  const padding = 0.35;
  // The same call main.ts makes.
  const { cells } = buildLayout(generateRepoTree({ files, seed }), {
    width: land - 4 + padding, height: land - 4 + padding,
  });
  const city = buildCity(cells);
  return { cells, city, report: probeGeometry(city.buildings, city.bounds) };
}

const SIZES = [13, 50, 120, 400, 1000, 2500, 5000];

describe('building proportions', () => {
  /*
   * Slenderness — core height over the narrow footprint — used to run 2.8:1 at
   * 13 files and 17.8:1 at 5,000, because height comes from a fixed 6..72
   * world-unit range while footprints shrank as files were added. A large
   * repository rendered as a bed of nails while a small one looked correct.
   *
   * The bound below is 6 rather than the ~1 that a perfectly size-invariant
   * city would give, and that gap is deliberate. Removing the land cap does
   * make proportions exactly constant, and it was built and rendered against
   * real repositories: the city then covers four times the ground with no
   * extra height, the camera pulls back to fit it, and the skyline reads as a
   * distant pancake. Density is what makes the picture a city. What closes
   * most of the gap without costing density is depth-independent plot area and
   * a decaying gutter, which is what the rest of this file guards.
   */
  it('keeps proportions from drifting wildly with repository size', () => {
    const medians = SIZES.map((files) => distribution(
      cityFor(files).report.samples.map((s) => s.slenderness),
    ).p50);
    const drift = Math.max(...medians) / Math.min(...medians);
    expect(drift).toBeLessThan(6);
  });

  it('does not build needles', () => {
    const s = distribution(cityFor(5000).report.samples.map((x) => x.slenderness));
    expect(s.p50).toBeLessThan(10);
    expect(s.p95).toBeLessThan(20);
    expect(s.p99).toBeLessThan(25);
    // Loose: guards the pathological tail without pinning squarify's heuristic.
    expect(s.max).toBeLessThan(60);
  });

  /*
   * Buildings cover less ground than they used to, on purpose: roads are now
   * reserved during layout and claim about a quarter of the city. Before that
   * the street network was inferred from leftovers and produced one to three
   * interior streets, so effectively none of the land was road. This guards
   * against the plots being squeezed out, not against roads existing.
   */
  it('puts buildings on a healthy share of the land', () => {
    expect(cityFor(5000).report.coverage).toBeGreaterThan(0.4);
  });
});

describe('plot area', () => {
  /*
   * `weigh()` used to apply the area exponent at every level including
   * directories. Because x^0.55 is sub-additive, a directory always received
   * less area than its contents would claim if flattened, compounding once per
   * level: two IDENTICAL files six levels apart differed in plot area by
   * 2484x, while the entire byte range only spans ~175x. Tree depth outweighed
   * file size, which is the opposite of what the City Index promises.
   */
  it('gives identical files the same plot wherever they sit in the tree', () => {
    const { root, shallowPath, deepPath } = generateDepthProbeTree();
    const { cells } = buildLayout(root, { width: 236, height: 236});
    const area = (path: string): number => {
      const cell = cells.find((c) => c.node.path === path);
      if (!cell) throw new Error(`missing cell for ${path}`);
      return cell.rect.w * cell.rect.h;
    };
    expect(area(shallowPath) / area(deepPath)).toBeLessThan(1.5);
  });

  it('keeps the range of plot sizes within reason', () => {
    const a = distribution(cityFor(5000).report.samples.map((s) => s.plotArea));
    expect(a.p99 / a.p01).toBeLessThan(100);
  });

  it('still gives a bigger file a bigger plot', () => {
    const { report } = cityFor(1000);
    const source = report.samples.filter((s) => s.category === 'source');
    expect(source.length).toBeGreaterThan(100);
    // Compare the extremes rather than every pair: within one directory the
    // ordering is exact, across the city it is statistical.
    const bySize = [...source].sort((a, b) => a.plotArea - b.plotArea);
    expect(bySize[bySize.length - 1].plotArea).toBeGreaterThan(bySize[0].plotArea);
  });
});

describe('determinism', () => {
  it('rebuilds byte-identically at scale', () => {
    const a = cityFor(2000, 7).report.samples;
    const b = cityFor(2000, 7).report.samples;
    expect(a.length).toBe(b.length);
    for (let i = 0; i < a.length; i++) {
      expect(a[i].path).toBe(b[i].path);
      expect(a[i].span).toBe(b[i].span);
      expect(a[i].coreHeight).toBe(b[i].coreHeight);
      expect(a[i].plotArea).toBe(b[i].plotArea);
    }
  });
});

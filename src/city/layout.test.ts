import { describe, expect, it } from 'vitest';
import { buildLayout, repositoryLandSize, type TreeNode } from './layout';

describe('repository land sizing', () => {
  it('grows deterministically with rendered file count', () => {
    expect(repositoryLandSize(1)).toBe(32);
    expect(repositoryLandSize(10)).toBe(60.5);
    expect(repositoryLandSize(67)).toBe(130.5);
    expect(repositoryLandSize(5000)).toBe(240);
  });

  /*
   * The property the pinned numbers above are standing in for.
   *
   * Land AREA grows in proportion to the file count, so a file's plot — and
   * therefore its building's proportions against a fixed height range — does
   * not depend on how large the repository is. Past the cap it stops, which is
   * a deliberate composition choice documented on `repositoryLandSize`: an
   * uncapped city covers so much ground that the camera must pull back and the
   * skyline flattens. Both were rendered before choosing. So assert the
   * property over the range where proportion is what matters, and assert that
   * the cap really does bind past it.
   */
  it('keeps the ground per file constant until the cap binds', () => {
    const areaPerFile = (files: number): number => repositoryLandSize(files) ** 2 / files;
    const samples = [40, 120, 250].map(areaPerFile);
    expect(Math.max(...samples) / Math.min(...samples)).toBeLessThan(1.3);
    expect(repositoryLandSize(2500)).toBe(240);
    expect(repositoryLandSize(20_000)).toBe(240);
  });

  function twoFileRoot(smaller: number, larger: number): TreeNode {
    return {
      name: 'root', path: '', type: 'dir', size: smaller + larger, language: undefined,
      children: [
        { name: 'a.ts', path: 'a.ts', type: 'file', size: smaller, language: 'typescript', children: [] },
        { name: 'b.ts', path: 'b.ts', type: 'file', size: larger, language: 'typescript', children: [] },
      ],
    };
  }

  /*
   * The gutter used to be an absolute world-unit subtraction that compounded
   * once per depth level, so any cell narrower than the accumulated gutter was
   * silently dropped by the `> 0` guard in squarify. On react that removed
   * roughly 3,800 of the 5,000 selected files from the city while the UI still
   * reported them as selected. Every file that reaches the layout must get a
   * plot.
   */
  it('gives every file a plot, however deep and however small', () => {
    const leaf = (path: string, size: number): TreeNode =>
      ({ name: path.split('/').pop()!, path, type: 'file', size, language: 'typescript', children: [] });

    /* five levels deep, with a big sibling to squeeze the small ones */
    let branch: TreeNode = {
      name: 'l5', path: 'a/b/c/d/l5', type: 'dir', size: 0, language: undefined,
      children: Array.from({ length: 40 }, (_, i) => leaf(`a/b/c/d/l5/f${i}.ts`, 1)),
    };
    for (const [depth, path] of [[4, 'a/b/c/d'], [3, 'a/b/c'], [2, 'a/b'], [1, 'a']] as const) {
      branch = {
        name: `l${depth}`, path, type: 'dir', size: 0, language: undefined,
        children: [branch, leaf(`${path}/big.ts`, 400_000)],
      };
    }
    const root: TreeNode = {
      name: 'root', path: '', type: 'dir', size: 0, language: undefined, children: [branch],
    };

    const expected = 40 + 4;
    const { cells } = buildLayout(root, { width: 200, height: 200});
    expect(cells).toHaveLength(expected);
    for (const cell of cells) {
      expect(cell.rect.w).toBeGreaterThan(0);
      expect(cell.rect.h).toBeGreaterThan(0);
    }
  });

  it('uses the requested land dimensions', () => {
    const { cells } = buildLayout(twoFileRoot(1, 3), { width: 60, height: 60 });
    const right = Math.max(...cells.map((cell) => cell.rect.x + cell.rect.w));
    const bottom = Math.max(...cells.map((cell) => cell.rect.y + cell.rect.h));
    /*
     * Plots reach the requested edge bar their own small gutter. Exact
     * equality held only while that gutter was a configurable amount and this
     * two-file case set it to zero; it is a fixed share of each plot now, and
     * the space between groups of files is reserved as road instead.
     */
    for (const edge of [right, bottom]) {
      expect(edge).toBeLessThanOrEqual(60);
      expect(edge).toBeGreaterThan(60 * 0.97);
    }
  });

  /*
   * Plot area used to be exactly proportional to bytes, which let a single
   * outsized file claim a plot orders of magnitude past the median and squeeze
   * every other building into a sliver. Area is now compressed by a power
   * transform: strictly increasing, so the ordering a reader compares two
   * buildings by is intact, but the extremes are pulled in.
   */
  it('keeps plot area ordered by size while compressing the range', () => {
    const area = (cell: { rect: { w: number; h: number } }) => cell.rect.w * cell.rect.h;

    for (const [smaller, larger] of [[1, 3], [1, 100], [500, 20_000]] as const) {
      const { cells } = buildLayout(twoFileRoot(smaller, larger), {
        width: 60, height: 60,
      });
      const byPath = new Map(cells.map((cell) => [cell.node.path, cell]));
      const ratio = area(byPath.get('b.ts')!) / area(byPath.get('a.ts')!);
      const bytes = larger / smaller;

      /* bigger file, bigger plot … */
      expect(ratio).toBeGreaterThan(1);
      /* … but well short of the raw byte ratio */
      expect(ratio).toBeLessThan(bytes);
      expect(ratio).toBeCloseTo(Math.pow(bytes, 0.55), 1);
    }
  });

  it(`reports the file's true byte size, not its layout weight`, () => {
    const { cells } = buildLayout(twoFileRoot(1, 20_000), { width: 60, height: 60});
    /* the explorer shows this, and buildCity ranks heights by it */
    expect(cells.map((cell) => cell.node.size).sort((a, b) => a - b)).toEqual([1, 20_000]);
  });
});

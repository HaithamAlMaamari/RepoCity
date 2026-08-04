import { describe, expect, it } from 'vitest';
import type { LayoutCell } from './layout';
import { buildCity, tallestSourceBuilding } from './city';
import { classifyBuilding, isCodeLanguage } from './file-class';
import { ALL_TYPOLOGIES } from './typology';

function sourceCells(count: number, rect?: { w: number; h: number }): LayoutCell[] {
  return Array.from({ length: count }, (_, index) => ({
    node: {
      name: `${index}.ts`,
      path: `${String(index).padStart(3, '0')}.ts`,
      type: 'file' as const,
      size: index + 1,
      language: 'typescript',
      children: [],
    },
    rect: { x: index * 21, y: 0, w: rect?.w ?? 20, h: rect?.h ?? 10, depth: 0 },
  }));
}

function cell(path: string, language: string, size: number, index: number): LayoutCell {
  return {
    node: { name: path.split('/').pop() ?? path, path, type: 'file', size, language, children: [] },
    rect: { x: index * 21, y: 0, w: 20, h: 10, depth: 0 },
  };
}

describe('repository-relative skyline', () => {
  it('creates deterministic landmark tiers and bounds wide cores', () => {
    const city = buildCity(sourceCells(20));
    const heights = city.buildings.map((building) => building.totalHeight).sort((a, b) => a - b);

    /* the curve spans the full range … */
    expect(heights[0]).toBeCloseTo(6, 5);
    expect(heights[heights.length - 1]).toBeCloseTo(72, 5);

    /*
     * … strictly increasing, with no cliff in it. Heights used to come from
     * two disjoint ranges (6..30 for ordinary files, 48..72 for landmarks), so
     * adjacent files could differ by 60% with nothing rendered between them.
     */
    for (let i = 1; i < heights.length; i++) {
      expect(heights[i]).toBeGreaterThan(heights[i - 1]);
      expect(heights[i] - heights[i - 1]).toBeLessThan(12);
    }

    /* the tallest handful are still marked as landmarks for their detailing */
    expect(city.buildings.filter((building) => building.profile === 'mega')).toHaveLength(1);
    /*
     * A building fills its plot along the LONG axis, and its typology decides
     * how much of the short axis it takes.
     *
     * This used to require an exact 0.9 on both axes. That was a faithful
     * description of the rule at the time and it was the rule that was wrong:
     * `squarify` drives plots toward an aspect ratio near 1, so filling both
     * axes made every building in the city a near-square box, and the city
     * read as a stamped compound rather than a skyline. A slab now stands
     * along its plot's long axis and leaves the slack beside it as a street.
     * What is still guaranteed is that no building escapes its own plot.
     */
    const minPlanFill = Math.min(...ALL_TYPOLOGIES.map((t) => t.planFill));
    for (const building of city.buildings) {
      const fillX = building.scale[0] / building.parcel[0];
      const fillZ = building.scale[2] / building.parcel[1];
      const long = Math.max(fillX, fillZ);
      const short = Math.min(fillX, fillZ);
      expect(long).toBeCloseTo(0.9, 5);
      expect(short).toBeLessThanOrEqual(0.9 + 1e-9);
      expect(short).toBeGreaterThanOrEqual(0.9 * minPlanFill - 1e-9);
      // Never wider than the ground it was allocated.
      expect(building.scale[0]).toBeLessThanOrEqual(building.parcel[0]);
      expect(building.scale[2]).toBeLessThanOrEqual(building.parcel[1]);
    }
    city.dispose();
  });

  it('caps landmark density for large rendered sets', () => {
    const cells: LayoutCell[] = Array.from({ length: 400 }, (_, index) => ({
      node: { name: `${index}.ts`, path: `${index}.ts`, type: 'file', size: index + 1, language: 'typescript', children: [] },
      rect: { x: index, y: 0, w: 1, h: 1, depth: 0 },
    }));
    const city = buildCity(cells);
    expect(city.buildings.filter((building) => building.profile === 'mega')).toHaveLength(16);
    city.dispose();
  });

  it('does not turn a four-file repository into a city of megatowers', () => {
    /*
     * The landmark count used to have a floor of 3, so a repository with four
     * source files rendered three 48-72 unit towers next to a single stub.
     */
    const city = buildCity(sourceCells(4));
    expect(city.buildings.filter((building) => building.profile === 'mega')).toHaveLength(0);
    city.dispose();
  });

  it('never renders a bigger file as a shorter lit mass', () => {
    /*
     * `coreRatio` used to step down at the 0.4 percentile, so the visible box
     * shrank 23% exactly where rank crossed it even though the file was
     * larger. Core height must rise monotonically with rank.
     */
    const city = buildCity(sourceCells(120));
    const byRank = [...city.buildings].sort((a, b) => a.size - b.size);
    for (let i = 1; i < byRank.length; i++) {
      expect(byRank[i].scale[1]).toBeGreaterThan(byRank[i - 1].scale[1]);
    }
    city.dispose();
  });
});

describe('junk files never own the skyline', () => {
  it('ranks height among source files and caps non-source bulk', () => {
    // The junk is an order of magnitude bigger than every source file, which
    // is exactly the shape of the repositories where it used to win.
    const cells = [
      cell('src/a.ts', 'typescript', 1_000, 0),
      cell('src/b.ts', 'typescript', 4_000, 1),
      cell('src/c.ts', 'typescript', 9_000, 2),
      cell('pnpm-lock.yaml', 'yaml', 900_000, 3),
      cell('assets/test.mp4', 'video', 5_000_000, 4),
    ];
    const city = buildCity(cells);
    const byPath = new Map(city.buildings.map((building) => [building.path, building]));

    const lock = byPath.get('pnpm-lock.yaml')!;
    const video = byPath.get('assets/test.mp4')!;
    const tallestSource = byPath.get('src/c.ts')!;

    expect(lock.category).toBe('infrastructure');
    expect(video.category).toBe('infrastructure');
    expect(tallestSource.category).toBe('source');
    expect(lock.profile).toBe('depot');
    expect(video.profile).toBe('depot');
    expect(city.maxHeight).toBe(tallestSource.totalHeight);
    for (const depot of [lock, video]) {
      expect(depot.totalHeight).toBeLessThan(6);
      expect(depot.totalHeight).toBeLessThan(tallestSource.totalHeight);
    }
    // Plot area stays byte-proportional: only the height is capped.
    expect(video.parcel[0] * video.parcel[1]).toBeGreaterThan(0);
    city.dispose();
  });

  it('prefers code over prose for the tallest-source label', () => {
    // flask's CHANGES.rst is genuinely its largest source file and genuinely
    // uninteresting; the .rst still gets an ordinary building.
    const cells = [
      cell('src/app.py', 'python', 30_000, 0),
      cell('CHANGES.rst', 'rst', 90_000, 1),
      cell('README.md', 'markdown', 60_000, 2),
      cell('uv.lock', 'lockfile', 3_000_000, 3),
    ];
    const city = buildCity(cells);
    const byPath = new Map(city.buildings.map((building) => [building.path, building]));
    expect(city.tallestSourceFile?.path).toBe('src/app.py');
    expect(byPath.get('CHANGES.rst')!.category).toBe('source');
    expect(byPath.get('CHANGES.rst')!.profile).not.toBe('depot');
    // The prose file is still the taller building — only the label changes.
    expect(byPath.get('CHANGES.rst')!.totalHeight)
      .toBeGreaterThan(byPath.get('src/app.py')!.totalHeight);
    city.dispose();
  });

  it('falls back to any source, then any building, when no code exists', () => {
    const docsOnly = buildCity([cell('a.md', 'markdown', 100, 0), cell('b.md', 'markdown', 900, 1)]);
    expect(docsOnly.tallestSourceFile?.path).toBe('b.md');
    docsOnly.dispose();
    const assetsOnly = buildCity([cell('a.png', 'image', 100, 0), cell('b.mp4', 'video', 900, 1)]);
    expect(assetsOnly.tallestSourceFile?.path).toBe('b.mp4');
    assetsOnly.dispose();
  });

  it('reports the tallest source file rather than the biggest file', () => {
    const cells = [
      cell('src/a.ts', 'typescript', 1_000, 0),
      cell('src/big.ts', 'typescript', 9_000, 1),
      cell('uv.lock', 'lockfile', 3_000_000, 2),
    ];
    const city = buildCity(cells);
    expect(city.tallestSourceFile?.path).toBe('src/big.ts');
    expect(tallestSourceBuilding(city.buildings)?.path).toBe('src/big.ts');
    city.dispose();
  });

  it('still builds a skyline for a repository made entirely of assets', () => {
    const cells = [
      cell('a.png', 'image', 10, 0),
      cell('b.png', 'image', 200, 1),
      cell('c.mp4', 'video', 5_000, 2),
    ];
    const city = buildCity(cells);
    expect(city.buildings.every((building) => building.profile === 'depot')).toBe(false);
    expect(city.maxHeight).toBeGreaterThan(6);
    expect(city.tallestSourceFile?.path).toBe('c.mp4');
    city.dispose();
  });

  it('gives depots a wider ground fill than ordinary cores', () => {
    const source = buildCity([cell('a.ts', 'typescript', 10, 0), cell('b.ts', 'typescript', 20, 1)]);
    const depot = buildCity([
      cell('a.ts', 'typescript', 10, 0),
      cell('big.woff2', 'font', 900_000, 1),
    ]);
    const core = source.buildings[0];
    const shed = depot.buildings[1];
    expect(shed.scale[0] / shed.parcel[0]).toBeGreaterThan(core.scale[0] / core.parcel[0]);
    source.dispose();
    depot.dispose();
  });

  it('is byte-identical across rebuilds of the same repository', () => {
    const cells = () => [
      ...sourceCells(6),
      cell('package-lock.json', 'json', 2_000_000, 6),
      cell('docs/demo.mp4', 'video', 8_000_000, 7),
    ];
    const first = buildCity(cells());
    const second = buildCity(cells());
    expect(Array.from(first.mesh.instanceMatrix.array)).toEqual(Array.from(second.mesh.instanceMatrix.array));
    expect(first.buildings.map((building) => building.category))
      .toEqual(second.buildings.map((building) => building.category));
    first.dispose();
    second.dispose();
  });
});

describe('source vs infrastructure classification', () => {
  it('keeps authored code as source', () => {
    expect(classifyBuilding('src/index.ts', 'typescript', 4_200)).toBe('source');
    expect(classifyBuilding('README.md', 'markdown', 12_000)).toBe('source');
    expect(classifyBuilding('config/app.yaml', 'yaml', 3_000)).toBe('source');
    expect(classifyBuilding('shaders/city.glsl', 'glsl', 900)).toBe('source');
  });

  it('demotes the files that used to win the skyline', () => {
    expect(classifyBuilding('__tests__/test.mp4', 'video', 5_000_000)).toBe('infrastructure');
    expect(classifyBuilding('pnpm-lock.yaml', 'yaml', 900_000)).toBe('infrastructure');
    expect(classifyBuilding('uv.lock', 'lockfile', 300_000)).toBe('infrastructure');
    expect(classifyBuilding('src/o200k_base.tiktoken', 'unknown', 1_600_000)).toBe('infrastructure');
    expect(classifyBuilding('yarn.lock', 'lockfile', 400_000)).toBe('infrastructure');
    expect(classifyBuilding('go.sum', 'unknown', 40_000)).toBe('infrastructure');
  });

  it('demotes media, archives, vendored trees and bundler output', () => {
    expect(classifyBuilding('docs/logo.png', 'image', 40_000)).toBe('infrastructure');
    expect(classifyBuilding('fonts/inter.woff2', 'font', 90_000)).toBe('infrastructure');
    expect(classifyBuilding('dist/app.min.js', 'javascript', 500_000)).toBe('infrastructure');
    expect(classifyBuilding('dist/app.js.map', 'unknown', 800_000)).toBe('infrastructure');
    expect(classifyBuilding('node_modules/left-pad/index.js', 'javascript', 500)).toBe('infrastructure');
    expect(classifyBuilding('third_party/zlib/deflate.c', 'c', 50_000)).toBe('infrastructure');
  });

  it('separates code from prose, markup and config for labelling', () => {
    for (const language of ['typescript', 'python', 'rust', 'go', 'css', 'glsl', 'shell']) {
      expect(isCodeLanguage(language)).toBe(true);
    }
    for (const language of ['markdown', 'rst', 'asciidoc', 'text', 'html', 'json', 'yaml', 'image', 'video']) {
      expect(isCodeLanguage(language)).toBe(false);
    }
  });

  it('only demotes text blobs once they stop being editable', () => {
    expect(classifyBuilding('i18n/en.json', 'json', 8_000)).toBe('source');
    expect(classifyBuilding('i18n/generated.json', 'json', 900_000)).toBe('infrastructure');
  });
});

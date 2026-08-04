import { describe, expect, it } from 'vitest';
import type { Building } from '../city/city';
import { BLOCK_TYPOLOGY } from '../city/typology';
import type { FetchResult } from '../data/github';
import { buildExplorerModel, deriveExplorerView, visibleExplorerNodes } from './explorer-model';

function fixture(): FetchResult {
  return {
    coverage: { tree: 'complete', selection: 'complete' },
    selection: { returnedFiles: 3 },
    totals: { files: 3 },
    root: {
      name: 'repo', path: '', type: 'dir', size: 12, children: [
        { name: 'src', path: 'src', type: 'dir', size: 11, children: [
          { name: 'a.ts', path: 'src/a.ts', type: 'file', size: 10, language: 'typescript', children: [] },
          { name: 'hidden.ts', path: 'src/hidden.ts', type: 'file', size: 1, language: 'typescript', children: [] },
        ] },
        { name: 'README.md', path: 'README.md', type: 'file', size: 1, language: 'markdown', children: [] },
      ],
    },
  } as unknown as FetchResult;
}

function building(path: string): Building {
  return {
    path, size: 1, language: 'typescript', position: [0, 0, 0], scale: [1, 1, 1],
    parcel: [1.2, 1.2], color: [1, 1, 1], totalHeight: 1, profile: 'block', category: 'source',
    typology: BLOCK_TYPOLOGY,
  };
}

describe('rendered-file explorer model', () => {
  it('retains ancestors and maps paths to building instance order', () => {
    const model = buildExplorerModel(fixture(), [building('README.md'), building('src/a.ts')]);
    expect(model.roots.map((node) => node.path)).toEqual(['src', 'README.md']);
    expect(model.roots[0].children.map((node) => node.path)).toEqual(['src/a.ts']);
    expect(model.buildingIdByPath.get('README.md')).toBe(0);
    expect(model.buildingIdByPath.get('src/a.ts')).toBe(1);
  });

  it('flattens only expanded branches', () => {
    const model = buildExplorerModel(fixture(), [building('README.md'), building('src/a.ts')]);
    expect(visibleExplorerNodes(model.roots, new Set()).map((node) => node.path)).toEqual(['src', 'README.md']);
    expect(visibleExplorerNodes(model.roots, new Set(['src'])).map((node) => node.path)).toEqual(['src', 'src/a.ts', 'README.md']);
  });

  it('discloses sampled, complete, and layout-culled coverage', () => {
    const complete = fixture();
    expect(buildExplorerModel(complete, [building('README.md'), building('src/a.ts'), building('src/hidden.ts')]).coverageText).toContain('complete repository tree');
    expect(buildExplorerModel(complete, [building('README.md')]).coverageText).toContain('1 rendered file of 3 selected');
    complete.coverage.selection = 'sampled';
    complete.selection.returnedFiles = 3;
    complete.totals.files = 100;
    expect(buildExplorerModel(complete, [building('README.md')]).coverageText).toContain('3 selected from 100');
  });

  it('filters rendered paths while preserving ancestors and canonical building IDs', () => {
    const model = buildExplorerModel(fixture(), [building('README.md'), building('src/a.ts'), building('src/hidden.ts')]);
    const view = deriveExplorerView(model, { query: 'src/a', district: '', language: 'typescript', size: 'tiny', sort: 'name' });

    expect(view.roots.map((node) => node.path)).toEqual(['src']);
    expect(view.roots[0].children.map((node) => node.path)).toEqual(['src/a.ts']);
    expect([...view.matchMask]).toEqual([0, 1, 0]);
    expect(view.matchingFiles).toBe(1);
  });

  it('sorts copied views without changing the canonical model order', () => {
    const model = buildExplorerModel(fixture(), [building('README.md'), building('src/a.ts'), building('src/hidden.ts')]);
    const view = deriveExplorerView(model, { query: '', district: '', language: '', size: 'all', sort: 'size-desc' });

    expect(view.roots.map((node) => node.path)).toEqual(['src', 'README.md']);
    expect(view.roots[0].children.map((node) => node.path)).toEqual(['src/a.ts', 'src/hidden.ts']);
    expect(model.roots.map((node) => node.path)).toEqual(['src', 'README.md']);
  });

  it('uses non-overlapping decimal size boundaries', () => {
    const sizes = [9_999, 10_000, 99_999, 100_000, 999_999, 1_000_000];
    const result = fixture();
    result.root.children = sizes.map((size) => ({ name: `${size}.bin`, path: `${size}.bin`, type: 'file', size, language: 'binary', children: [] }));
    result.selection.returnedFiles = sizes.length;
    result.totals.files = sizes.length;
    const model = buildExplorerModel(result, sizes.map((size) => building(`${size}.bin`)));
    const count = (size: 'tiny' | 'small' | 'medium' | 'large') => deriveExplorerView(model, { query: '', district: '', language: '', size, sort: 'layout' }).matchingFiles;

    expect([count('tiny'), count('small'), count('medium'), count('large')]).toEqual([1, 2, 2, 1]);
  });

  it('isolates top-level directories and repository-root files truthfully', () => {
    const model = buildExplorerModel(fixture(), [building('README.md'), building('src/a.ts')]);
    expect(model.districts).toEqual([
      { value: '/', label: 'repository root', files: 1 },
      { value: 'src', label: 'src', files: 1 },
    ]);

    const root = deriveExplorerView(model, { query: '', district: '/', language: '', size: 'all', sort: 'layout' });
    const src = deriveExplorerView(model, { query: '', district: 'src', language: '', size: 'all', sort: 'layout' });
    expect(root.roots.map((node) => node.path)).toEqual(['README.md']);
    expect([...root.matchMask]).toEqual([1, 0]);
    expect(src.roots.map((node) => node.path)).toEqual(['src']);
    expect([...src.matchMask]).toEqual([0, 1]);
  });
});

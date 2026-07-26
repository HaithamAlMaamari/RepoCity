import { describe, expect, it } from 'vitest';
import type { Building } from '../city/city';
import type { FetchResult } from '../data/github';
import { buildExplorerModel, visibleExplorerNodes } from './explorer-model';

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
  return { path, size: 1, language: 'typescript', position: [0, 0, 0], scale: [1, 1, 1], color: [1, 1, 1], totalHeight: 1, profile: 'block' };
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
});

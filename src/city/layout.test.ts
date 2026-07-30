import { describe, expect, it } from 'vitest';
import { buildLayout, repositoryLandSize, type TreeNode } from './layout';

describe('repository land sizing', () => {
  it('grows deterministically with rendered file count and remains bounded', () => {
    expect(repositoryLandSize(1)).toBe(32);
    expect(repositoryLandSize(10)).toBe(60.5);
    expect(repositoryLandSize(67)).toBe(130.5);
    expect(repositoryLandSize(5000)).toBe(240);
  });

  it('uses the requested land dimensions without changing file-area ratios', () => {
    const root: TreeNode = {
      name: 'root', path: '', type: 'dir', size: 4, language: undefined,
      children: [
        { name: 'a.ts', path: 'a.ts', type: 'file', size: 1, language: 'typescript', children: [] },
        { name: 'b.ts', path: 'b.ts', type: 'file', size: 3, language: 'typescript', children: [] },
      ],
    };
    const cells = buildLayout(root, { width: 60, height: 60, padding: 0, depthScale: 0 });
    expect(Math.max(...cells.map((cell) => cell.rect.x + cell.rect.w))).toBeCloseTo(60);
    expect(Math.max(...cells.map((cell) => cell.rect.y + cell.rect.h))).toBeCloseTo(60);
    expect(cells[0].rect.w * cells[0].rect.h / (cells[1].rect.w * cells[1].rect.h)).toBeCloseTo(3);
  });
});

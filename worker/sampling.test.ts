import { describe, expect, it } from 'vitest';
import type { RepositoryFile } from '../src/data/github-contract';
import { sampleFiles, stablePriority } from './sampling';

const SEED = 'a'.repeat(40);

function file(path: string, language: string): RepositoryFile {
  return { path, language, size: 1, sha: 'b'.repeat(40), mode: '100644' };
}

describe('sampleFiles', () => {
  const files = [
    file('src/a.ts', 'typescript'),
    file('src/b.ts', 'typescript'),
    file('docs/a.md', 'markdown'),
    file('docs/b.md', 'markdown'),
    file('tests/a.ts', 'typescript'),
    file('README.md', 'markdown'),
  ];

  it('is deterministic regardless of source order', () => {
    const forward = sampleFiles(files, 4, SEED).map((item) => item.path);
    const reversed = sampleFiles([...files].reverse(), 4, SEED).map((item) => item.path);
    expect(reversed).toEqual(forward);
    expect(forward).toHaveLength(4);
  });

  it('preserves district and language strata when the limit allows', () => {
    const selected = sampleFiles(files, 4, SEED);
    expect(new Set(selected.map((item) => item.path.split('/')[0]))).toEqual(
      new Set(['README.md', 'docs', 'src', 'tests']),
    );
  });

  it('uses a stable seeded priority', () => {
    expect(stablePriority(SEED, 'src/a.ts')).toBe(stablePriority(SEED, 'src/a.ts'));
    expect(stablePriority(SEED, 'src/a.ts')).not.toBe(stablePriority(SEED, 'src/b.ts'));
  });
});

/**
 * repo-tree.ts — a synthetic repository with a realistic *shape*.
 *
 * The geometry defects this fixture exists to catch are all distributional:
 * they only appear when thousands of files with power-law sizes sit at mixed
 * tree depths. Every existing test feeds either a handful of hand-built cells
 * or a flat list, so `layout.ts` and `city.ts` have never been exercised
 * against each other at scale — which is exactly where the defects lived.
 *
 * Three properties matter, and each is here for a reason:
 *
 *  - **Log-normal sizes.** Real repositories are power-law: a median file of a
 *    few KB alongside a handful of 100 KB+ outliers. A uniform distribution
 *    hides area-allocation bugs, and a uniform grid has twice given this
 *    project the wrong answer.
 *  - **Mixed depth.** The depth-driven area penalty is invisible in a flat
 *    tree, and `layout.test.ts`'s two-file case is precisely the one
 *    configuration where it cannot appear.
 *  - **Production tree semantics.** The tree is assembled by the real
 *    `buildNestedTree`, so directory sizes aggregate and children sort exactly
 *    as they do for a live repository. A hand-rolled tree would be a second
 *    implementation to keep in sync, and its drift would be silent.
 *
 * Determinism is a product rule here, so this uses an explicit LCG and never
 * `Math.random()` — a fixture that shifts between runs cannot support a
 * regression assertion.
 */

import { buildNestedTree } from '../../data/github';
import type { RepositoryFile } from '../../data/github-contract';
import type { TreeNode } from '../layout';

/** Numerical Recipes LCG — small, seeded, and good enough for a fixture. */
function lcg(seed: number): () => number {
  let state = (seed >>> 0) || 1;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x1_0000_0000;
  };
}

/** Box–Muller, so file sizes can be drawn log-normally. */
function normal(random: () => number): number {
  const u = Math.max(random(), 1e-12);
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * random());
}

const DIRECTORY_WORDS = [
  'src', 'lib', 'core', 'utils', 'components', 'services', 'models', 'api',
  'internal', 'pkg', 'test', 'tests', 'docs', 'examples', 'scripts', 'tools',
  'config', 'assets', 'fixtures', 'vendor', 'types', 'hooks', 'store', 'ui',
];
const EXTENSIONS = ['ts', 'tsx', 'js', 'py', 'go', 'rs', 'md', 'json', 'css', 'yml'];

export interface RepoTreeOptions {
  /** How many files the tree should contain. */
  files: number;
  seed?: number;
  /** Deepest directory nesting. Real repositories commonly reach 5–8. */
  maxDepth?: number;
  /**
   * Median file size in bytes, and the spread of ln(size). The defaults are
   * fitted to the repositories the capture script uses.
   */
  medianBytes?: number;
  sigma?: number;
}

/**
 * Build a synthetic repository tree.
 *
 * Paths are unique by construction (a per-directory counter suffixes the
 * name), because `buildNestedTree` throws on duplicates.
 */
export function generateRepoTree(options: RepoTreeOptions): TreeNode {
  const {
    files, seed = 1, maxDepth = 6, medianBytes = 2_800, sigma = 1.4,
  } = options;
  const random = lcg(seed);

  /*
   * Directory skeleton first, so files can be distributed across it. Each
   * level keeps a shrinking share of the branching factor, which produces the
   * broad-at-the-top, narrow-at-the-bottom shape real repositories have.
   */
  const directories: string[] = [''];
  const frontier: string[] = [''];
  for (let depth = 0; depth < maxDepth; depth++) {
    const next: string[] = [];
    for (const parent of frontier) {
      const branches = 2 + Math.floor(random() * 5);
      for (let b = 0; b < branches; b++) {
        const word = DIRECTORY_WORDS[Math.floor(random() * DIRECTORY_WORDS.length)];
        const path = parent ? `${parent}/${word}${depth}${b}` : `${word}${b}`;
        next.push(path);
        directories.push(path);
      }
    }
    // Keep the frontier bounded, or branching explodes exponentially.
    frontier.length = 0;
    frontier.push(...next.slice(0, 24));
  }

  const counters = new Map<string, number>();
  const items: RepositoryFile[] = [];
  for (let i = 0; i < files; i++) {
    const dir = directories[Math.floor(random() * directories.length)];
    const index = (counters.get(dir) ?? 0) + 1;
    counters.set(dir, index);
    const ext = EXTENSIONS[Math.floor(random() * EXTENSIONS.length)];
    const name = `f${index}.${ext}`;
    const path = dir ? `${dir}/${name}` : name;
    const size = Math.max(1, Math.round(medianBytes * Math.exp(sigma * normal(random))));
    items.push({ path, sha: `sha${i}`, mode: '100644', size, language: ext });
  }

  return buildNestedTree(items, 'synthetic/repo');
}

/**
 * A tree of identical files placed at two known depths — the probe that
 * isolates tree position from file size.
 *
 * Both probe files are byte-identical, so any difference in the plot area they
 * receive is attributable to depth alone and nothing else.
 */
export function generateDepthProbeTree(options: {
  bytes?: number; deepDepth?: number; fanout?: number;
} = {}): { root: TreeNode; shallowPath: string; deepPath: string } {
  const { bytes = 3_000, deepDepth = 6, fanout = 20 } = options;
  const items: RepositoryFile[] = [];
  let sha = 0;
  const add = (path: string): void => {
    items.push({ path, sha: `sha${sha++}`, mode: '100644', size: bytes, language: 'ts' });
  };

  const shallowPath = 'shallow.ts';
  add(shallowPath);
  // Siblings at the root, so the shallow probe is not alone in its container.
  for (let i = 0; i < fanout; i++) add(`root${i}.ts`);

  // One chain down to `deepDepth`, each level padded to `fanout` siblings so
  // the nesting penalty compounds the way it does in a real tree.
  let prefix = 'deep';
  for (let depth = 1; depth < deepDepth; depth++) {
    for (let i = 0; i < fanout; i++) add(`${prefix}/pad${i}.ts`);
    prefix = `${prefix}/d${depth}`;
  }
  const deepPath = `${prefix}/probe.ts`;
  add(deepPath);
  for (let i = 0; i < fanout; i++) add(`${prefix}/pad${i}.ts`);

  return { root: buildNestedTree(items, 'synthetic/depth-probe'), shallowPath, deepPath };
}

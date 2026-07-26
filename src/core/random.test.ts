import { afterEach, describe, expect, it, vi } from 'vitest';
import { createSceneRandom } from './random';

const COMMIT = 'a'.repeat(40);
const REPOSITORY = 'octocat/Hello-World';

afterEach(() => vi.restoreAllMocks());

describe('createSceneRandom', () => {
  it('keeps a stable sequence for identical scene identity', () => {
    const first = createSceneRandom(REPOSITORY, COMMIT, 'demo', 'sky');
    const second = createSceneRandom(REPOSITORY, COMMIT, 'demo', 'sky');
    const values = Array.from({ length: 5 }, () => first());

    expect(values).toEqual([
      0.6743440092541277,
      0.5185583438724279,
      0.289006530540064,
      0.4336929575074464,
      0.889509514439851,
    ]);
    expect(Array.from({ length: 5 }, () => second())).toEqual(values);
  });

  it('separates streams by presentation seed and effect domain', () => {
    const baseline = createSceneRandom(REPOSITORY, COMMIT, '0', 'sky');
    const otherSeed = createSceneRandom(REPOSITORY, COMMIT, '1', 'sky');
    const otherDomain = createSceneRandom(REPOSITORY, COMMIT, '0', 'embers');
    const otherRepository = createSceneRandom('octocat/Spoon-Knife', COMMIT, '0', 'sky');

    expect(baseline()).not.toBe(otherSeed());
    expect(createSceneRandom(REPOSITORY, COMMIT, '0', 'sky')()).not.toBe(otherDomain());
    expect(createSceneRandom(REPOSITORY, COMMIT, '0', 'sky')()).not.toBe(otherRepository());
  });

  it('returns values in the unit interval without ambient entropy', () => {
    vi.spyOn(Math, 'random').mockImplementation(() => {
      throw new Error('ambient randomness used');
    });
    const random = createSceneRandom(REPOSITORY, COMMIT, '0', 'ground-traffic');

    for (let index = 0; index < 1_000; index++) {
      const value = random();
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });
});

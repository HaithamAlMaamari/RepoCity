import { describe, expect, it } from 'vitest';
import { DEFAULT_SCENE_SEED, parseSceneHash, serializeSceneHash } from './url-state';

const COMMIT = 'a'.repeat(40);

describe('scene URL state', () => {
  it('supports legacy repository hashes with a deterministic default seed', () => {
    expect(parseSceneHash('#octocat/Hello-World')).toEqual({
      repo: 'octocat/Hello-World',
      seed: DEFAULT_SCENE_SEED,
    });
  });

  it('round-trips repository, immutable commit, and presentation seed', () => {
    const hash = serializeSceneHash({ repo: 'octocat/Hello-World', commit: COMMIT, seed: 'night_2' });

    expect(hash).toBe(`repo=octocat%2FHello-World&commit=${COMMIT}&seed=night_2`);
    expect(parseSceneHash(`#${hash}`)).toEqual({
      repo: 'octocat/Hello-World',
      commit: COMMIT,
      seed: 'night_2',
    });
  });

  it('normalizes uppercase commit hashes', () => {
    expect(parseSceneHash(`#repo=octocat%2Frepo&commit=${COMMIT.toUpperCase()}&seed=0`)?.commit).toBe(COMMIT);
  });

  it('defaults canonical seedless hashes without losing the immutable commit', () => {
    expect(parseSceneHash(`#repo=octocat%2Frepo&commit=${COMMIT}`)).toEqual({
      repo: 'octocat/repo',
      commit: COMMIT,
      seed: DEFAULT_SCENE_SEED,
    });
  });

  it.each([
    '#repo=octocat%2Frepo&commit=&seed=0',
    '#repo=octocat%2Frepo&commit=abc&seed=0',
    '#repo=octocat%2Frepo&seed=',
    '#repo=octocat%2Frepo&seed=not.valid',
    '#repo=octocat%2Frepo&seed=0&seed=1',
    '#repo=octocat%2Frepo&seed=0&mode=explore',
    '#repo=octocat%2F..&seed=0',
    '#repo=invalid_owner%2Frepo&seed=0',
    '#repo=-invalid%2Frepo&seed=0',
    '#repo=invalid-%2Frepo&seed=0',
    '#repo=invalid--owner%2Frepo&seed=0',
    '#repo=octocat%2Frepo%2Fextra&seed=0',
  ])('rejects invalid or ambiguous state: %s', (hash) => {
    expect(parseSceneHash(hash)).toBeNull();
  });
});

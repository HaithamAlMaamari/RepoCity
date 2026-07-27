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

  it('round-trips an encoded selected file path', () => {
    const hash = serializeSceneHash({ repo: 'octocat/repo', commit: COMMIT, seed: '0', file: 'src/a file & notes#.ts' });
    expect(parseSceneHash(hash)?.file).toBe('src/a file & notes#.ts');
  });

  it('keeps parsing and serialization consistent for long repository paths', () => {
    const file = `${'nested/'.repeat(160)}source.ts`;
    const hash = serializeSceneHash({ repo: 'octocat/repo', commit: COMMIT, seed: '0', file });
    expect(parseSceneHash(hash)?.file).toBe(file);
  });

  it('round-trips non-default explorer filters with selection state', () => {
    const hash = serializeSceneHash({
      repo: 'octocat/repo', commit: COMMIT, seed: '0', file: 'src/a.ts',
      q: 'src/a', lang: 'typescript', size: 'small', sort: 'size-desc',
    });
    expect(parseSceneHash(hash)).toMatchObject({
      file: 'src/a.ts', q: 'src/a', lang: 'typescript', size: 'small', sort: 'size-desc',
    });
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
    '#repo=octocat%2Frepo&seed=0&file=',
    '#repo=octocat%2Frepo&seed=0&file=%2Fsecret',
    '#repo=octocat%2Frepo&seed=0&file=src%2F..%2Fsecret',
    '#repo=octocat%2Frepo&seed=0&file=src%5Csecret',
    '#repo=octocat%2Frepo&seed=0&q=',
    '#repo=octocat%2Frepo&seed=0&lang=TypeScript',
    '#repo=octocat%2Frepo&seed=0&size=huge',
    '#repo=octocat%2Frepo&seed=0&sort=random',
  ])('rejects invalid or ambiguous state: %s', (hash) => {
    expect(parseSceneHash(hash)).toBeNull();
  });
});

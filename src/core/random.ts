export type RandomSource = () => number;

const SCENE_RANDOM_VERSION = 'repocity-scene-v1';

/**
 * FNV-1a over a string, as a 32-bit unsigned integer.
 *
 * Exported so that anything needing a stable choice keyed by a name — which
 * district a building belongs to, which typology that district uses — draws it
 * from the same place the seeded scene streams do, instead of growing another
 * ad-hoc hash beside them.
 */
export function hashString(value: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

export function createSceneRandom(repository: string, commitSha: string, sceneSeed: string, domain: string): RandomSource {
  let state = hashString(`${SCENE_RANDOM_VERSION}\0${repository}\0${commitSha}\0${sceneSeed}\0${domain}`);
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 0x100000000;
  };
}

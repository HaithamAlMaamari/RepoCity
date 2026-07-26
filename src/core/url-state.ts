export const DEFAULT_SCENE_SEED = '0';

export interface SceneHashState {
  repo: string;
  commit?: string;
  seed: string;
}

const COMMIT_PATTERN = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/i;
const OWNER_PATTERN = /^[A-Za-z0-9-]{1,39}$/;
const REPOSITORY_PATTERN = /^[A-Za-z0-9._-]{1,100}$/;
const SEED_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

function isRepository(value: string): boolean {
  const [owner, repo, extra] = value.split('/');
  const validOwner = OWNER_PATTERN.test(owner) && !owner.startsWith('-') && !owner.endsWith('-') && !owner.includes('--');
  return extra === undefined && validOwner && REPOSITORY_PATTERN.test(repo) && repo !== '.' && repo !== '..';
}

export function parseSceneHash(hash: string): SceneHashState | null {
  const raw = hash.startsWith('#') ? hash.slice(1) : hash;
  if (!raw) return null;
  if (!raw.includes('=')) {
    return isRepository(raw) ? { repo: raw, seed: DEFAULT_SCENE_SEED } : null;
  }

  const params = new URLSearchParams(raw);
  const allowed = new Set(['repo', 'commit', 'seed']);
  const seen = new Set<string>();
  for (const key of params.keys()) {
    if (!allowed.has(key) || seen.has(key)) return null;
    seen.add(key);
  }

  const repo = params.get('repo');
  const commit = params.get('commit') ?? undefined;
  const seed = params.get('seed') ?? DEFAULT_SCENE_SEED;
  if (!repo || !isRepository(repo)) return null;
  if (commit !== undefined && !COMMIT_PATTERN.test(commit)) return null;
  if (!SEED_PATTERN.test(seed)) return null;
  return { repo, commit: commit?.toLowerCase(), seed };
}

export function serializeSceneHash(state: SceneHashState): string {
  const params = new URLSearchParams({ repo: state.repo });
  if (state.commit) params.set('commit', state.commit);
  params.set('seed', state.seed);
  return params.toString();
}

import type { RepositoryFile } from '../src/data/github-contract';

interface Stratum {
  key: string;
  files: RepositoryFile[];
  remainder: number;
}

export function sampleFiles(
  files: readonly RepositoryFile[],
  limit: number,
  seed: string,
): RepositoryFile[] {
  if (files.length <= limit) return [...files].sort(compareFilePath);

  const byStratum = new Map<string, RepositoryFile[]>();
  for (const file of files) {
    const district = file.path.includes('/') ? file.path.slice(0, file.path.indexOf('/')) : '(root)';
    const key = `${district}\0${file.language}`;
    const group = byStratum.get(key);
    if (group) group.push(file);
    else byStratum.set(key, [file]);
  }

  const strata: Stratum[] = [...byStratum.entries()].map(([key, group]) => ({
    key,
    files: group.sort((a, b) => comparePriority(a, b, seed)),
    remainder: 0,
  }));
  strata.sort((a, b) => compareText(a.key, b.key));

  const selected = new Map<string, RepositoryFile>();
  if (strata.length <= limit) {
    for (const stratum of strata) selected.set(stratum.files[0].path, stratum.files[0]);
  } else {
    const rankedStrata = [...strata].sort((a, b) => {
      const byPriority = comparePriority(a.files[0], b.files[0], seed);
      return byPriority || compareText(a.key, b.key);
    });
    for (const stratum of rankedStrata.slice(0, limit)) {
      selected.set(stratum.files[0].path, stratum.files[0]);
    }
  }

  let remaining = limit - selected.size;
  if (remaining > 0) {
    const available = strata.reduce((sum, stratum) => sum + Math.max(0, stratum.files.length - 1), 0);
    if (available > 0) {
      for (const stratum of strata) {
        const capacity = Math.max(0, stratum.files.length - 1);
        const exact = remaining * capacity / available;
        const seats = Math.min(capacity, Math.floor(exact));
        stratum.remainder = exact - seats;
        for (const file of stratum.files.slice(1, 1 + seats)) selected.set(file.path, file);
      }
    }
  }

  remaining = limit - selected.size;
  if (remaining > 0) {
    const candidates = strata
      .flatMap((stratum) => stratum.files.slice(1).map((file) => ({ file, remainder: stratum.remainder })))
      .filter(({ file }) => !selected.has(file.path))
      .sort((a, b) => b.remainder - a.remainder || comparePriority(a.file, b.file, seed));
    for (const { file } of candidates.slice(0, remaining)) selected.set(file.path, file);
  }

  if (selected.size < limit) {
    const global = [...files]
      .filter((file) => !selected.has(file.path))
      .sort((a, b) => comparePriority(a, b, seed));
    for (const file of global.slice(0, limit - selected.size)) selected.set(file.path, file);
  }

  return [...selected.values()].sort(compareFilePath);
}

export function stablePriority(seed: string, path: string): bigint {
  let hash = 0xcbf29ce484222325n;
  const input = `${seed}\0${path}`;
  for (let index = 0; index < input.length; index++) {
    hash ^= BigInt(input.charCodeAt(index));
    hash = BigInt.asUintN(64, hash * 0x100000001b3n);
  }
  return hash;
}

export function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function comparePriority(a: RepositoryFile, b: RepositoryFile, seed: string): number {
  const priorityA = stablePriority(seed, a.path);
  const priorityB = stablePriority(seed, b.path);
  return priorityA < priorityB ? -1 : priorityA > priorityB ? 1 : compareText(a.path, b.path);
}

function compareFilePath(a: RepositoryFile, b: RepositoryFile): number {
  return compareText(a.path, b.path);
}

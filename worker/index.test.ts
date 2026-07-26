import { describe, expect, it } from 'vitest';
import { parseRepositoryRequest } from './index';

describe('parseRepositoryRequest', () => {
  it('accepts a valid repository request', () => {
    expect(parseRepositoryRequest(new URL('https://repo.city/api/repositories/owner/repo/tree?maxFiles=1200'))).toEqual({
      owner: 'owner', repo: 'repo', commit: undefined, maxFiles: 1200,
    });
  });

  it('rejects invalid paths, duplicate parameters, and abbreviated commits', () => {
    expect(() => parseRepositoryRequest(new URL('https://repo.city/api/repositories/a%2Fb/repo/tree'))).toThrow('valid GitHub');
    expect(() => parseRepositoryRequest(new URL('https://repo.city/api/repositories/owner/repo/tree?maxFiles=1&maxFiles=2'))).toThrow('Invalid query');
    expect(() => parseRepositoryRequest(new URL('https://repo.city/api/repositories/owner/repo/tree?commit=abc'))).toThrow('full Git object SHA');
  });

  it('returns null for unknown API routes', () => {
    expect(parseRepositoryRequest(new URL('https://repo.city/api/unknown'))).toBeNull();
  });
});

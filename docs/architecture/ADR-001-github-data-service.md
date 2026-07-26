# ADR-001: GitHub Data Service

## Status

Accepted on 2026-07-26.

## Context

RepoCity previously called GitHub's recursive tree API directly from the browser. That design exposed any build-time token, used mutable `HEAD`, silently accepted truncated responses, biased the city toward the largest files, and could not complete large repositories within the unauthenticated browser quota.

GitHub truncates recursive trees above 100,000 entries or 7 MB and recommends fetching non-recursive subtrees when truncation occurs.

## Decision

Use a same-origin Cloudflare Worker for public GitHub repository ingestion.

The Worker will:

- Keep the optional `GITHUB_TOKEN` in a Cloudflare secret.
- Reject private repositories even when the server credential can read them.
- Resolve the canonical repository, default branch, immutable commit SHA, and tree SHA.
- Split only truncated subtrees until the complete tree is proven or a bounded traversal fails.
- Count files, directories, submodules, bytes, and languages independently.
- Apply deterministic representative sampling keyed by commit SHA.
- Cache successful immutable results and never cache errors.
- Return a versioned, runtime-validated same-origin response.

The browser will never call GitHub directly or receive a GitHub credential.

## Consequences

- Production-quality large-repository completion requires a Workers Paid plan because Free Workers allow only 10 ms CPU and 50 subrequests.
- The public mutable repository URL still resolves the current default-branch commit before checking immutable cache entries.
- Cache API entries are data-center-local; misses may repeat work in another location.
- A traversal that cannot prove completeness within the configured limits returns an explicit error, never a partial success labeled complete.
- Private repository support is outside the current product scope and would require per-user authorization and a separate threat model.

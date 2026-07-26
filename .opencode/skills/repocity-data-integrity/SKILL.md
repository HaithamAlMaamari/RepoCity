---
name: repocity-data-integrity
description: Use when changing GitHub API ingestion, repository metrics, sampling, tree reconstruction, language detection, URL state, commit identity, or data shown by RepoCity. Enforces complete, reproducible, and honestly labeled results.
license: MIT
---

# RepoCity Data Integrity

## Non-Negotiable Rules

- Never embed shared credentials in browser code or `VITE_*` variables.
- Resolve a branch or tag to an immutable commit SHA before generating a city.
- Treat every API response, path, repository name, URL, and hash value as untrusted.
- Validate response shape at runtime and handle malformed, missing, and unexpected values.
- Count blobs as files, trees as directories, and commits as submodules; do not merge their semantics.
- If GitHub returns `truncated: true`, fetch subtrees non-recursively or present an explicit partial result.
- Distinguish repository totals, fetched totals, eligible totals, sampled totals, and rendered totals.
- Sampling must be deterministic, documented, and representative across districts and languages.
- Percentages use the full declared denominator and include Other when rows are omitted.
- A shared URL must reproduce repository, commit, sampling policy, seed, camera state, and display mode.

## Required Tests

- Explicit and implicit directories, root files, empty files, deep paths, submodules, malformed items, and empty repositories.
- GitHub truncation at the documented 100,000-entry or 7 MB recursive-tree limits.
- Exact total, omitted, directory, byte, and language calculations.
- Deterministic output for repeated identical inputs.
- Rate-limit, timeout, cancellation, retry, 401, 403, 404, 429, and 5xx behavior.
- Property invariants for tree sizes and layout bounds.

No UI may imply completeness or precision that the data pipeline cannot prove.

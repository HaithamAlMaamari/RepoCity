# RepoCity

RepoCity turns a public GitHub repository into an explorable Three.js city. Files become buildings, directories become districts, and language data shapes the visual identity.

The project is currently moving from a polished prototype toward a production-quality repository visualization product. The measurable release plan is maintained in [`docs/QUALITY-ROADMAP.md`](docs/QUALITY-ROADMAP.md).

## Requirements

- Node.js 22.13 or newer
- npm
- A browser with WebGL2 support

## Development

```sh
npm install
npm run worker:types
npm run dev
```

The development command builds the current static assets, starts the Worker API on `http://127.0.0.1:8787`, and starts Vite on `http://127.0.0.1:5173`. Vite proxies `/api` to the local Worker.

The Worker can use GitHub anonymously for small development requests. For realistic large-repository testing, create an ignored `.dev.vars` from `.dev.vars.example` and set a fine-grained public-contents token. The token is available only to the local Worker and must never use a `VITE_*` name.

## Quality Checks

```sh
npm run typecheck
npm test
npm run build
npm run audit
npm run check
npm run deploy:check
```

Browser-audit tooling is project-scoped and restricted to isolated profiles and an explicit network allowlist. Restart OpenCode after changing `opencode.jsonc` or files under `.opencode/`.

## Data And Security

- RepoCity targets public repositories and rejects private repositories even if the Worker credential can read them.
- Never put a GitHub token in a `VITE_*` environment variable or any browser bundle.
- The browser calls only the same-origin RepoCity API; GitHub credentials remain Worker secrets.
- Successful repository results contain a proven complete tree and identify whether files were sampled for rendering.
- GitHub's recursive tree API can truncate responses above 100,000 entries or 7 MB.
- Treat repository names, paths, API responses, and URL state as untrusted data.

Production uses Cloudflare Workers Static Assets plus the same-origin ingestion Worker. Configure the optional encrypted production credential with `npx wrangler secret put GITHUB_TOKEN`; never put it in `wrangler.jsonc`.

## Deployment

```sh
npm run deploy:check
npm run deploy
```

Complete traversal of very large repositories requires a Workers Paid plan because the Free plan's CPU and subrequest limits are not sufficient for the bounded fallback traversal. The architecture decision is recorded in [`docs/architecture/ADR-001-github-data-service.md`](docs/architecture/ADR-001-github-data-service.md).

## Project Structure

- `src/data` - GitHub ingestion and repository modeling
- `worker` - Cloudflare API, GitHub validation, traversal, sampling, and caching
- `src/city` - treemap layout, buildings, districts, and architecture
- `src/effects` - atmosphere, roads, traffic, labels, and particles
- `src/core` - camera behavior
- `docs` - quality and architecture decisions
- `.opencode` - project-specific engineering and audit skills

## Release Status

RepoCity is pre-release. Visual quality is ahead of accessibility, data-completeness, testing, and operational maturity; those gaps are release blockers rather than hidden limitations.

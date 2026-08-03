# Contributing to RepoCity

Thanks for taking an interest. RepoCity turns a GitHub repository into a 3D city, and the thing that makes it worth using is that the city is *honest* — every building corresponds to a real file, and the same repository at the same commit with the same seed always produces the same city. Most of the rules below exist to protect that.

## Getting set up

```sh
npm install
npm run worker:types
npm run dev
```

That starts the Worker API on `http://127.0.0.1:8787` and Vite on `http://127.0.0.1:5173`. Open the Vite URL and enter any `owner/repo`.

**Requirements:** Node.js 22.13+ (22.x line), npm 10+, a WebGL2-capable browser.

The Worker works anonymously against GitHub for small repositories. For large-repository work, copy `.dev.vars.example` to `.dev.vars` and set a fine-grained, public-contents-only token. It is read only by the local Worker. Never put a token in a `VITE_*` variable or anywhere the browser bundle can reach it.

## Before you open a pull request

```sh
npm run ci
```

This is exactly what the GitHub Actions gate runs: lint, unit tests, the Workerd runtime suite, both TypeScript targets, a production build, a high-severity dependency audit, and a Cloudflare deployment dry run. If it passes locally it should pass in CI.

Individual pieces, when you want a faster loop:

```sh
npm run lint
npm run typecheck
npm test
npm run test:watch
```

## The rules that matter

**Determinism is a feature, not an implementation detail.** Anything procedural — traffic, stars, particles, rooftop details — must derive from a seeded stream via `src/core/random.ts`, keyed by `(repository, commit, seed)`. Never call `Math.random()` in scene generation, and never let a change reorder an existing seeded stream without meaning to: it silently changes every previously shared URL. `src/effects/determinism.test.ts` guards this.

**Treat GitHub as hostile input.** Repository names, file paths, API responses and URL state are all untrusted. Validation is hand-written and deliberately duplicated on both sides of the trust boundary (`worker/github.ts` and `src/data/github-contract.ts`). If you add a field, validate it in both places.

**No client-side tokens, ever.** The browser only calls the same-origin RepoCity API. GitHub credentials stay Worker secrets. See [`SECURITY.md`](SECURITY.md) and [`docs/security/THREAT-MODEL.md`](docs/security/THREAT-MODEL.md).

**Don't let generated bulk win the skyline.** Building height ranks among *source* files; lockfiles, media and generated blobs render as low depots. If you touch `src/city/file-class.ts`, keep the classifier a pure function of `(path, language, size)` — it must not perturb any seeded stream.

## Where things live

- `src/data` — GitHub ingestion, contract validation, repository modeling
- `src/city` — treemap layout, districts, buildings, palettes, file classification
- `src/effects` — streets, traffic, billboards, atmosphere, sky, particles
- `src/explore` — the file-explorer model behind Explore mode
- `src/core` — camera, seeded randomness, URL state
- `worker` — Cloudflare Worker: validation, traversal, sampling, caching, rate limiting
- `docs` — architecture decisions, threat model, roadmap

## Style

Match the surrounding code. It favours compact, dense formatting in the geometry paths and explanatory comments that say *why* rather than *what*. Prettier is available (`npm run format`) but is deliberately not enforced across existing files — please don't reformat code you aren't otherwise changing, since it buries the real diff.

Lint is enforced. Where a rule is switched off, the config says why; if you need another exception, add the reason with it.

## Reporting bugs

Open an issue with the repository you were viewing, the full share URL if you have one (it pins commit and seed, so it reproduces the exact city), your browser and GPU, and what you expected. A screenshot helps enormously for anything visual.

For security issues, do **not** open a public issue — use [private vulnerability reporting](https://github.com/HaithamAlMaamari/RepoCity/security/advisories/new).

## Good first contributions

[`docs/ROADMAP.md`](docs/ROADMAP.md) is an honest, evidence-based list of what is still weak, ordered by impact. Anything in Phase 2 or 3 is fair game, and each item says what "done" looks like.

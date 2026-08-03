# RepoCity Roadmap — the path to 10/10

This roadmap turns RepoCity from a strong prototype into a release that holds up as a portfolio centerpiece and a Show HN launch. It is ordered by impact: what a first-time visitor sees, then what they feel, then what a reviewer finds when they read the code. Findings come from a full code audit plus live testing across eight repositories of different sizes and languages (13 files → 17,013 files), including error paths.

**Current state, honestly:** small repositories (< ~50 files) render as genuinely beautiful neon cities — the window shaders, color crowns, and glow are portfolio-grade. Data accuracy is excellent: byte percentages cross-check against GitHub linguist within ~3%, canonical resolution and commit pinning work, and determinism holds across reloads. But mid-size cities settle into a frame where the city occupies under 20% of the screen, large repositories render as near-black silhouettes, one of the app's own preset chips fails, and the tallest building is a lockfile in four of eight tested repos. (An earlier draft also reported a 30-second build freeze; that was an artifact of a GPU-less test browser and is corrected in item 6.)

> **Progress, 2026-08-03.** Phase 1 is done and a visual-quality pass is under way in stages — see [Visual quality pass](#visual-quality-pass-in-progress) at the foot of this document for what has landed, what is measured, and what is next.

---

## Phase 1 — The picture (ship-blockers)

The product is a picture. These five items decide whether anyone shares it.

**1. Fix resting camera framing.**
After the intro settles, a 236-file repo (pallets/flask) occupies ~15% of the viewport, bottom-center, with the stats panel floating over empty space. Cause: the framing fits the full bounding volume, and a single tall outlier (usually a lockfile tower) forces the camera far back. Fit to a high-percentile bounding box instead of the max, raise minimum screen coverage of the city to ~60–70% of the free viewport (excluding panels), and verify against small/mid/large fixtures. Replace the pinned tuning-constant tests in `camera.test.ts` with coverage-ratio assertions so the suite tests the *behavior*, not the numbers.

**2. Make large cities readable.**
microsoft/vscode and mrdoob/three.js render as black slabs on a black ground: emissive windows shrink below one pixel at overview distance and nothing else carries light. Add selective bloom (or distance-scaled emissive boost), lift the ground plane out of pure black, and give buildings a minimum silhouette luminance at distance. Acceptance: a vscode-size city at resting camera reads as a lit skyline in a thumbnail.

**3. Dethrone the lockfiles.**
Tallest building in testing: `test.mp4` (react), `pnpm-lock.yaml` (vue), `uv.lock` (flask), `o200k_base.tiktoken` (vscode). Height is file-size rank, so generated/binary bulk always wins the skyline — the most prominent thing in the city is the least interesting file in the repo. Rank height within *source* files; render lockfiles, media, and generated blobs as distinct low structures (warehouses, tanks, billboards — the metaphor is free). The "TALLEST" stat should name a file a developer cares about.

**4. Make the sample represent the repo.**
three.js: 453 of 1,720 rendered files come from `examples/`, while `src/` — the actual library — gets 32 buildings. vscode renders 798 of 17,013 files (4.7%) with no visible disclosure of the drop from 5,000 selected → 798 rendered. Byte-weighted sampling structurally favors asset directories. Blend count-proportional and byte-proportional allocation per district, guarantee source-directory floors, and state plainly in the UI: "rendered 798 of 17,013 files." Also close the test gap: the largest-remainder allocation path in `worker/sampling.ts` is currently never executed by any test.

**5. Never ship a failing preset.**
The `torvalds/linux` chip — in the app's own header — fails with "GitHub returned more data than RepoCity can process safely," and the reason only appears at the bottom of the page while the status pill truncates mid-sentence. Either make linux-scale repos work (paginated fallback traversal already exists; raise the payload strategy or pre-bake a cached snapshot) or remove the chip. Error UX: full reason in the visible status, don't clobber the user's typed input on failure, and offer a retry.

## Phase 2 — The feel

**6. ~~Kill the build freeze.~~ Corrected — measured, and it is not real.** The original finding ("mid-size builds lock the main thread for 30+ seconds; screenshots time out") came from an automated browser without GPU acceleration and did not reproduce on real hardware. Measured with `PerformanceObserver` longtask entries in Chrome against microsoft/vscode (17,013 files → ~740 rendered): **325 ms** of total main-thread blocking on a desktop GPU, and **1.16 s** at 6× CPU throttling, in one or two tasks. A CPU-side profile of the generation pipeline puts `buildLayout` + `buildCity` + rooftops + streets + traffic at **~65 ms** for 4,725 files, so there is no geometry hot spot to chunk. Moving generation into a Web Worker would add a Three.js buffer-transfer boundary and real complexity to save ~300 ms; it is not worth it. The one real defect was that the synchronous block swallowed its own "building city · N files" status update — fixed by yielding for a paint before construction starts. Revisit only if profiling on low-end hardware shows blocking above ~2 s.

**7. Verify and polish controls.** Synthetic drag registered as click-select and scroll didn't zoom during automated testing — verify orbit/zoom by hand on trackpad, mouse, and touch; if intentional inertia/thresholds are eating small deltas, tune them. Add touch support and an on-canvas zoom affordance; the current hint bar ("drag orbit · scroll zoom · click inspect") is easy to miss.

**8. First-run experience.** A fresh visitor gets an unannounced auto-build of react/react with a long quiet fly-in. Make the intro deliberate: brief hold on the finished skyline, then a short camera move — and show a one-line "what am I looking at" caption. The City Index legend is excellent; surface a compact version of it on first load.

**9. Legend and language hygiene.** The three.js legend reads "Other 59%" at the top and also has a lowercase "other 7%" aggregate — two rows, same word, different meanings. Split assets into real categories (Models, Textures, Audio…), merge or rename the tail bucket, and fix the `detectLanguage` branch where `.npmrc`/`.bashrc`-style rc-files all return `json` (the `properties` branch is unreachable for them).

**10. Poster and share surface.** `capturePoster` draws with webfonts but never awaits `document.fonts.ready` — cold-cache captures fall back to system fonts on the app's one shareable artifact. Fix, then use the poster pipeline to generate the og:image. The page declares `summary_large_image` with no image today, so every shared link renders a blank card — for a visual product, this is the highest-leverage missing asset.

## Phase 3 — The code (reviewer-proof)

**11. Break up `main.ts`.** 1,263 lines, 49 functions, 42 mutable module-level bindings, zero tests, ~23% of the frontend. Extract: scene bootstrap, repo-load orchestration, picking/selection, explorer UI, breadcrumbs/stats, poster capture. Target: no file over ~400 lines, and the extracted modules become testable (they currently can't even be imported under vitest because of module-scope DOM lookups).

**12. Deduplicate the copy-paste debt.** Language detection exists three times (one copy unreachable); the window-grid shader constants are pasted verbatim in `city.ts` and `architecture-details.ts`; `streetLength` exists three times; `streetKey` twice with *different* float semantics; ~80 lines of validators are duplicated across the worker/frontend trust boundary; five ad-hoc hash functions coexist with `core/random.ts`. One shared module each.

**13. Add the missing quality gates.** There is no linter or formatter in the repo. Add ESLint + Prettier (or Biome), a `lint` script, a CI step, and turn on `noUnusedLocals`/`noUnusedParameters` (which will immediately flag the dead exports `getPalette`, `BRAND`, and the `void announce;` stub — implement the screen-reader announcement or remove the plumbing). Add coverage thresholds for `src/core`, `src/data`, `worker`.

**14. Worker efficiency and headers.** Every request — including 100% cache hits — burns two GitHub calls before the cache lookup, capping an unauthenticated deployment at ~30 builds/hour and a token at ~2,500 req/hour. Add a short-TTL ref→SHA cache and negative caching for 404s. Honor `If-None-Match` (an ETag is emitted but 304s are never returned). Stop forwarding the server token's `X-RateLimit-*` quota headers to anonymous clients. Add the CSP and security headers that `SECURITY.md` already promises, then make `SECURITY.md`'s release checklist true.

## Phase 4 — The launch

**15. README with proof.** Hero image (done), then a 15-second GIF: type a repo → skyline assembles → click a tower → explorer syncs. Badges, live demo link, and a "gallery" section of famous repos as cities.

**16. Deploy to repo.city.** Workers Paid plan, `GITHUB_TOKEN` secret, WAF rules per the threat model, custom domain, and the og:image endpoint. The share URL (`#repo=…&commit=…&seed=…`) is already deterministic — every shared link reproduces the exact city, which is the viral loop.

**17. Launch assets.** Show HN post that leads with the picture and the determinism story ("same commit + seed = same city, forever"); a gallery thread; CONTRIBUTING.md and issue templates so the first wave of visitors can land as contributors.

---

### Verified strengths to protect while doing all this

Determinism across reloads (byte-identical layouts, tested); data accuracy (linguist-consistent byte percentages, canonical repo + commit pinning, complete-tree proofs); the small-repo aesthetic — window shaders, crown lighting, palette; the security posture of the worker (validated hostile input on both sides of the trust boundary, no client-side tokens, pseudonymized rate-limit keys); and the City Index legend, which honestly explains what is and isn't data. These are the product's soul — every change above should ship with a screenshot diff against a fixed (repo, commit, seed) to prove the soul is intact.

---

## Visual quality pass (in progress)

A staged pass driven by eight defects found in live testing. Each stage is verified with `npm run capture` against a fixed set of repositories, not against fixtures — a synthetic uniform grid gave the wrong answer twice.

### Landed

**Stage 1 — vehicles, signs, framing, horizon** (`1410f4a`, `2b64cee`)

- Every vehicle rendered black. `vertexColors: true` was set on geometry with no `color` attribute; three defines `USE_COLOR` from the material without checking the geometry, `MeshBasicMaterial` has no `defaultAttributeValues` fallback, so the unbound attribute read `(0,0,0,1)` and zeroed `vColor` before `instanceColor` applied. Six materials had it. Ground traffic was black too — on near-black asphalt, so it read as working. The old test asserted the CPU-side colour buffer, which was correct throughout; the new one asserts the material/geometry pairing.
- District signs were yaw-only billboards, invisible edge-on from above. They now copy the camera's orientation.
- The framing solver sized on a box capped at 2.4× the real skyline, so it fitted mostly empty air. Now 1.35. Measured cost: the worst-azimuth aim sits ~0.5 skyline-heights below ground, versus +0.33 before.
- The bare plain around every city was a ground disc with `fog: false` that scene fog could not touch. Fogging it was necessary but not sufficient — the sky dome reached its bright horizon colour exactly at eye level, so the seam merely moved. One `NIGHT_COLOR` now feeds the clear colour, the fog and the dome's lower band.

**Entrance and idle** (`bf41568`)

- The drift resumed 8s after interaction and took 4s to reach speed — a ~12s wait. Both halved.
- The entrance is now four beats over 6.6s: a three-quarter sweep, a dip, an aerial reveal at 2.6× the hero elevation, then a descent onto the hero pose. Elevation multipliers are relative to the hero's ~18°, so they read far lower than they look; anything under ~0.8 collapses the city to a band on the horizon. Distance multipliers below 1.0 are clamped to `safeRadius` and silently flatten the move.

**Stage 2 — layout and size distribution** (`d4d3786`)

- **The layout was deleting most of the repository.** The gutter between cells was an absolute world-unit subtraction that compounded per depth level (0.35 at the root, 4.75 by depth four), and `squarify` dropped any cell whose padded rect hit zero. react rendered 1,181 of 5,000 selected files while the UI reported all 5,000 as selected. The gutter is now capped per axis at a fraction of that axis. A regression test builds a five-level tree; against the old code 43 of its 44 files disappear.
- Footprint was an isotropic shrink triggered by an anisotropic test, so a 40×10 parcel produced a 12×3 building marooned in its own plot. Buildings now fill their plot on both axes.
- Plot area was exactly proportional to bytes; it is now compressed by a 0.55 power. Ordering is intact, extremes are pulled in. The weight is carried beside the node — `node.size` is the real byte count and both the explorer and the height ranking read it.
- Heights came from two disjoint ranges (6..30, then 48..72) with nothing between, and `coreRatio` stepped at the 0.4 percentile in a way that made the visible mass *drop* 23% as rank rose. Both are continuous now.
- `block` — 40% of source buildings — had no detail geometry at all.

### Next

**Stage 3 — brightness consistency.** Same-language buildings render at very different brightness. Four mechanisms, ranked by impact: `aLit` gives a ~10% index-seeded subset all its windows on plus 1.45× window and 1.86× rim brightness (~2.6× facade emissive); `aSpan` → `rcAssist` multiplies emissive by up to 3× and resists fog by 45%, driven by footprint alone (Stage 2 should have removed most of that variance — re-measure before changing it); `floorShift` jitters hue by up to 0.22, enough to cross the magenta→amber threshold where luminance differs ~2×; `rimPulse` is ±12% animated. Also `languageEmissiveBoost` is a misnomer — it returns hue warmth, not brightness, and magenta-family languages render systematically dimmer.

**Stage 4 — interior roads, traffic, post FX.** Internal streets are carved from leftover gaps *after* the treemap tiles districts edge to edge, then clipped against full plot rects, so almost none survive and only the perimeter ring is left — which is why traffic circles the outside. Road space has to be reserved *before* parcels are allocated. Then migrate to pmndrs `postprocessing` for selective bloom, SMAA and ACES.

**Camera framing against the reference.** The target is an immersive pose with the city overflowing all four edges. It needs the camera inside `safeRadius = cityRadius × 1.15 + 10`; lowering that floor puts the solve in a mixed regime where it binds at some azimuths and not others, and three drift-continuity assertions with 1e-9 tolerances then fail by 4.0, 0.07 and 11.0 — the orbit develops a kink and stops closing smoothly. It also breaks the module's "city fits the free viewport" contract across 12 tests, which is a product decision rather than tuning. Worth retrying now that Stage 2 has filled the voids that made close framing look sparse.

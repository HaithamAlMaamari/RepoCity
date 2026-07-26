# RepoCity 10/10 Quality Roadmap

## Objective

Turn RepoCity from a polished graphics prototype into a trustworthy, accessible, reproducible, performant repository exploration product with a cinematic presentation mode.

Scores are evidence-based. An area reaches 10/10 only when its measurable gates pass and critical manual review finds no unresolved blocker.

## Current Progress

Phase 0 and the security/data core of Phase 1 started on 2026-07-26.

Completed evidence:

- Source control, ignore policy, MIT license, README, security policy, and architecture decision record established.
- Development dependency audit reduced to zero known vulnerabilities.
- Shared client-token support and unsafe HTML insertion removed.
- Cloudflare Worker boundary added with an encrypted server-secret model and private-repository rejection.
- Canonical repository and immutable commit/tree identity implemented.
- GitHub recursive-tree truncation recovery, bounded traversal, exact totals, deterministic representative sampling, and immutable cache keys implemented.
- Browser now consumes a runtime-validated same-origin contract and cancels stale repository loads.
- Exact repository statistics, full-denominator language percentages, selected-versus-rendered disclosure, and commit-aware poster metadata implemented.
- Initial unit suite, Worker deployment dry run, real GitHub cache MISS/HIT smoke test, desktop browser smoke, and mobile visual check pass.
- Least-privilege GitHub Actions gate added for locked install, tests, typechecks, production build, dependency audit, deployment dry run, and tracked-file drift.
- Commit-and-URL-seed scene streams now reproduce stars, ground traffic, aerial traffic, and particles without freezing animation playback.
- Worker transport tests now cover malformed and oversized bodies, bounded redirects, rate limits, retries, cancellation, timeout precedence, traversal budgets, and invalid trees; isolated Workerd tests cover bindings, request signals, streams, and Cache API MISS/HIT behavior.
- The browser contract now rejects inconsistent identities, policies, modes, paths, hierarchies, counts, and language totals; traversal fixtures cover depth and entry boundaries, missing parents, duplicate paths, empty trees, and zero-byte files.
- A formal threat model now records trust boundaries and residual risks; mandatory actor and global Cloudflare rate-limit bindings fail closed and are exercised with real Workerd counters.
- Explore mode now includes a truthful persistent legend, accessible keyboard directory tree, synchronized canvas/file selection, camera focus, immutable GitHub links, path copy, rendered-coverage disclosure, shareable selected-file state, and a responsive mobile sheet.

Still required before Phase 1 exits:

- Cloudflare production account, custom domain, encrypted `GITHUB_TOKEN`, deployed limiter/cache validation, WAF/DDoS policy, alerting, and rollback verification.

## Product Model

RepoCity has two connected experiences:

- Explore mode prioritizes explanation, search, filtering, directory navigation, selection, accessibility, and restrained motion.
- Cinematic mode prioritizes atmosphere, curated camera work, deterministic presentation, poster export, and shareable visual identity.

Both modes use the same validated repository model and immutable commit identity.

## Quality Gates

| Area | Required evidence |
| --- | --- |
| Product value | At least 95% completion of core tasks in moderated tests; users correctly explain the main visual encodings |
| Visual design | Coherent token system, semantic graphics, clear selection, deterministic scenes, reviewed desktop and mobile compositions |
| Data integrity | Exact fixture counts; complete/partial/sampled status always visible; commit SHA and seed reproduce output |
| Accessibility | WCAG 2.2 AA, complete keyboard path, reduced motion, accessible DOM equivalent, no serious automated violations |
| Performance | LCP <= 2.5s, INP <= 200ms, CLS <= 0.1; 60 FPS reference desktop target; stable 30+ FPS low/mobile tier |
| Memory | No material retained growth after ten equivalent repository switches; Three.js resource counts return to baseline |
| Security | No client secrets; runtime validation; threat model; CSP and security headers; zero high/critical dependency findings |
| Reliability | Useful network, rate-limit, malformed-data, empty, unsupported-GPU, context-loss, and capture recovery paths |
| Engineering | Strict typecheck, lint, formatting, tests, CI, reproducible build, core algorithm branch coverage >= 95% |
| Delivery | Documented deployment, browser matrix, privacy-safe observability, versioning, rollback, metadata, and launch checklist |

Core Web Vitals targets follow web.dev guidance and accessibility targets follow WCAG 2.2.

## Phase 0: Baseline And Decisions

- Initialize source control and create ignore, environment, license, contribution, security, and architecture documentation.
- Record benchmark repositories and fixed expected outputs.
- Define supported browsers/devices and reference hardware.
- Create a decision log for backend/authentication, hosting, analytics, and privacy.
- Capture current screenshots, performance traces, bundle size, frame rate, draw calls, and memory.

Exit: clean reproducible baseline, approved product model, and quantified budgets.

## Phase 1: Security And Data Truth

- Remove `VITE_GITHUB_TOKEN` and all shared client-token guidance.
- Choose public unauthenticated access, per-user OAuth, or a constrained server-side proxy.
- Resolve refs to immutable commit SHAs.
- Validate GitHub responses and handle cancellation, timeout, retry, and rate limits.
- Fetch truncated repositories completely by subtree or return a clearly partial result.
- Correct file, directory, byte, language, omission, and sampling metrics.
- Define deterministic stratified sampling and seeded procedural generation.
- Remove unsafe HTML sinks and add a threat model.

Exit: every number and completeness claim is testable, reproducible, and honestly labeled; no browser secret exists.

## Phase 2: Explore Mode

- Add a persistent visualization legend and concise onboarding.
- Build a synchronized accessible directory/file explorer.
- Add search, language/size filters, district isolation, sorting, and breadcrumbs.
- Add strong building selection, camera focus, Open on GitHub, Copy path, and shareable state.
- Synchronize repository, commit, mode, seed, filters, camera, URL history, and poster metadata.
- Implement complete loading, empty, partial, error, retry, and unsupported states.

Exit: core tasks are possible without interpreting the canvas or using a pointer.

## Phase 3: Visual System

- Formalize color, typography, spacing, panel, lighting, motion, camera, and data-encoding tokens.
- Map architecture to meaningful repository attributes instead of decorative size thresholds.
- Reserve visual emphasis for data, orientation, and selection.
- Add selection outline, locator, de-emphasis, focus transition, and district relationship cues.
- Add named camera presets and deterministic cinematic tours.
- Improve label legibility with an atlas or SDF system.
- Freeze seed, animation time, fonts, and camera for reproducible posters and visual tests.

Exit: users can explain each major visual channel and selection remains dominant in every quality tier.

## Phase 4: Accessibility And Responsive UX

- Replace hidden mobile controls with a deliberate header and draggable bottom sheet.
- Meet WCAG 2.2 AA for semantics, labels, focus, contrast, reflow, targets, status messages, and keyboard use.
- Add reduced-motion and static-city modes that remove camera flight, drift, flicker, traffic, particles, and nonessential transitions.
- Provide non-WebGL repository summaries and recovery guidance.
- Test portrait, landscape, dynamic viewport units, safe areas, zoom, text spacing, and screen readers.

Exit: complete keyboard and assistive-technology flows pass manual and automated review on desktop and mobile.

## Phase 5: Rendering And Runtime Performance

- Move fetch aggregation and layout into a worker or backend.
- Add low, balanced, and cinematic quality tiers with adaptive DPR and effects.
- Pause hidden tabs and render on demand in static mode.
- Throttle pointer picking and suppress it while orbiting.
- Avoid unchanged instance-buffer uploads and audit culling.
- Add context loss/restoration and GPU capability handling.
- Profile maximum scenes and repeated repository switches.

Exit: frame, interaction, memory, loading, and Core Web Vitals budgets pass on the browser/device matrix.

## Phase 6: Verification And Maintainability

- Add linting, formatting, unused-code checks, unit tests, property tests, API fixtures, integration tests, and coverage.
- Add Playwright flows for Chromium, Firefox, WebKit, desktop, mobile, keyboard, errors, history, and capture.
- Add deterministic visual regression and accessibility checks.
- Add CI for clean install, typecheck, lint, tests, build, audit, bundle budgets, and deployment smoke tests.
- Consolidate duplicated types and language detection after behavior is protected.

Exit: all merge and release gates run from a clean checkout and prevent known regression classes.

## Phase 7: Production And Launch

- Define root and subpath deployment behavior, caching, CSP, HSTS, referrer, permissions, and content-type headers.
- Add privacy-safe error, performance, WebGL capability, and API-latency observability.
- Add README, architecture, browser support, security, privacy, troubleshooting, and release documentation.
- Add canonical metadata, favicon, manifest, social card, deterministic share preview, versioning, and rollback.
- Run usability, accessibility, security, performance, and visual launch reviews.

Exit: production smoke tests pass, dashboards and rollback are ready, and no P0/P1 findings remain.

## Final Validation Loop

For every area: benchmark, implement, test, inspect, test with users, document evidence, and repeat. Automated scores never replace manual usability, visual, accessibility, or threat review.

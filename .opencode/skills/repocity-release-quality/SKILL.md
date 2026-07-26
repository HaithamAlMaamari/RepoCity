---
name: repocity-release-quality
description: Use when implementing or reviewing RepoCity features, tests, accessibility, security, performance, CI, deployment, or release readiness. Applies the project's measurable 10/10 quality gates.
license: MIT
---

# RepoCity Release Quality

Read `docs/QUALITY-ROADMAP.md` before substantial implementation or release work.

## Definition Of Done

- The feature has user-visible success, loading, empty, error, retry, and unsupported states where applicable.
- Desktop, touch, keyboard, screen-reader, and reduced-motion paths are considered.
- New logic has focused tests; core data/layout behavior has invariant coverage.
- No browser secret, unsafe HTML sink, unvalidated network data, or avoidable privilege is introduced.
- Performance impact is measured on representative small and maximum-size scenes.
- Resources and listeners are released after replacement or teardown.
- Documentation and visible explanations match actual behavior.
- Typecheck, lint, unit, integration, browser, accessibility, build, audit, and deployment checks pass as applicable.

## Release Gates

- WCAG 2.2 AA with no serious automated violations and a complete keyboard flow.
- LCP at most 2.5 seconds, INP at most 200 ms, and CLS at most 0.1 at the 75th percentile after deployment.
- Reference desktop target of 60 FPS; supported low/mobile tier remains usable at 30 FPS or better.
- No material retained-memory growth after ten equivalent repository switches.
- Zero high or critical dependency findings and no public client credentials.
- Every repository visualization identifies whether it is complete, partial, or sampled.
- CI is required and reproducible from a clean install.

Automated scores are evidence, not substitutes for manual accessibility, visual, usability, and security review.

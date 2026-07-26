---
name: repocity-graphics
description: Use when changing RepoCity Three.js scenes, shaders, architecture, effects, camera work, posters, selection, or visual encodings. Enforces semantic graphics, hierarchy, determinism, and measured GPU performance.
license: MIT
---

# RepoCity Graphics

## Intent

Treat the city as an information visualization first and a cinematic world second. Preserve RepoCity's editorial cyber-noir identity. Do not add effects merely to make the scene busier.

## Before Editing

1. State the user insight the graphic will communicate.
2. Define the data-to-visual mapping and its fallback when data is missing.
3. Decide whether the change belongs to Explore mode, Cinematic mode, or both.
4. Establish a measurable visual and performance acceptance condition.

## Encoding Rules

- Footprint represents repository-relative file size.
- Height must not duplicate footprint once richer metrics exist; prefer churn, complexity, or commit frequency.
- Color represents language family but cannot be the only differentiator.
- Facade, roof, window, beacon, and district treatments should encode stable categories or activity.
- Selection must dominate ambient bloom through outline, locator, focus, or de-emphasis.
- Labels must remain legible at their intended camera distances.
- Procedural randomness must use a seed derived from repository plus commit SHA.

## Rendering Rules

- Prefer instancing, batching, texture atlases, and shared materials.
- Avoid per-building objects, per-frame allocations, unnecessary full-buffer uploads, and disabled culling without evidence.
- Pause or reduce animation in hidden tabs, reduced-motion mode, static mode, and low-quality mode.
- Dispose geometries, materials, textures, listeners, render targets, and generated canvases.
- Keep Explore mode quieter than Cinematic mode.

## Validation

- Capture fixed-seed screenshots at desktop, tablet, narrow mobile, top-down, and selected-building views.
- Check normal and reduced motion, low and cinematic quality, empty and 5,000-building repositories.
- Use Chrome traces for frame pacing and long tasks.
- Record `renderer.info`, draw calls, triangles, textures, and memory before and after ten repository switches.
- Reject a visual improvement that materially breaks the agreed frame budget or obscures data.

---
name: frontend-design
description: Guidance for distinctive, intentional visual design when building new UI or reshaping an existing one. Helps with aesthetic direction, typography, and making choices that do not read as templated defaults.
license: Apache-2.0
metadata:
  source: https://github.com/anthropics/skills/tree/main/skills/frontend-design
  reviewed: "2026-07-26"
---

# Frontend Design

Approach design as the lead of a small studio known for giving every product a visual identity that could not be mistaken for another. Make deliberate, opinionated choices about palette, typography, motion, and layout that are specific to the product. Take one real aesthetic risk only when it serves the experience.

## Ground It In The Subject

Name the concrete product, audience, and page job before changing the interface. Derive visual choices from the subject's real materials, instruments, artifacts, and vocabulary. For RepoCity, repository structure, code activity, maps, architecture, navigation, and analysis are stronger sources than generic cyberpunk decoration.

## Design Principles

- The hero is a thesis. Lead with the product's most characteristic interactive moment.
- Typography carries personality. Define deliberate display, body, and utility roles with a coherent scale.
- Structure is information. Labels, dividers, numbering, and layout must encode something true.
- Motion must have a job. Prefer one orchestrated moment over scattered effects.
- Match complexity to the vision. Maximal work needs hierarchy; minimal work needs precision.
- Write from the user's side of the screen. Controls name outcomes, errors explain recovery, and empty states invite action.
- Spend boldness in one place. Remove decoration that competes with content or selection.

## Workflow

1. Define the audience, task, and visual thesis.
2. Create a compact token system for color, typography, spacing, elevation, motion, and data encodings.
3. Compare at least two layout concepts with quick wireframes.
4. Name the single signature element the experience should be remembered by.
5. Critique the direction for generic defaults and revise before coding.
6. Build from the approved tokens and hierarchy.
7. Review desktop, mobile, keyboard, reduced-motion, loading, empty, and error states with screenshots.
8. Remove one effect or decoration that does not improve meaning, orientation, or delight.

## Quality Floor

Responsive behavior, visible keyboard focus, reduced motion, readable copy, adequate contrast, and useful failures are baseline requirements rather than optional polish. Preserve an established visual system unless a redesign is explicitly approved.

Adapted for project use from Anthropic's `frontend-design` Agent Skill under Apache-2.0.

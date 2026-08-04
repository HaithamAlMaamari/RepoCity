/**
 * facade-shader.ts — the GLSL every lit surface in the city shares.
 *
 * The window grid used to be copy-pasted between city.ts (building cores)
 * and architecture-details.ts (crowns). The two copies drifted apart at the
 * first tweak, so the grid — plus the distance-response and fog rules that
 * depend on its exact cell sizes — now lives here and nowhere else.
 *
 * Shader safety rules (same as city.ts, repeated because this file is the
 * one that everybody includes):
 *  - Never reference a Three.js internal varying. The only Three-owned names
 *    used here are documented public uniforms: `cameraPosition`, and the fog
 *    uniforms (`fogColor`, `fogDensity`, `fogNear`, `fogFar`) that
 *    `<fog_pars_fragment>` declares whenever USE_FOG is defined. Every fog
 *    reference is inside the matching `#ifdef`, so a fog-less material still
 *    compiles.
 *  - Derivatives (dFdx/dFdy) are core in WebGL2, which is the only context
 *    three r160+ creates; three's own `lights_physical_fragment` calls dFdx
 *    unconditionally, so MeshStandardMaterial already depends on them.
 *  - Everything is prefixed `rc` so it can never collide with a chunk name.
 *
 * ── The distance problem, and how it is measured ──────────────────────────
 * A 1,700-building repository renders as black slabs at overview distance:
 * each building is ~10 px wide, its 0.55-unit window cells are ~1 px, and
 * the grid degenerates into sampling noise that averages toward the dark
 * facade colour. Nothing else on the building carries light, so the city
 * goes black.
 *
 * The measured quantity is the BUILDING's on-screen width, not the window
 * cell's. Window-cell coverage is nearly constant across the whole distance
 * range — it cannot tell a close-up from an overview, and an earlier version
 * of this file that ramped on it blew the near view out. Building span
 * separates the tiers cleanly, and it is also the physically correct
 * question: "is this building large enough on screen to show what it is made
 * of?"
 *
 * Everything distance-related multiplies through `rcAssist`, so assistance
 * is provably absent — not merely small — up close.
 *
 * ── The ramp is saturated, and these constants are on borrowed time ───────
 * The tuning below was fitted when the treemap was silently discarding most
 * of the repository. Stage 2 fixed that, and the building count went up
 * roughly six-fold in the same land area, so every footprint shrank. Measured
 * with `npm run measure` at the resting camera, 1600x900:
 *
 *     repo             source buildings   median rcAssist   p05..p95 gain
 *     flask                    226             0.082          1.00..3.20
 *     react                  4,913             1.000          2.70..3.20
 *     vscode                 4,854             1.000          2.80..3.20
 *
 * The prose that used to live here claimed ~0.1 for a mid repository and
 * ~0.85 for a huge one. That is no longer true: mid and large cities now sit
 * pinned at the top of the ramp, which means their windows are permanently
 * averaged, their per-floor colour jitter is switched off, and they carry a
 * flat 3.2x emissive. It reads well — this is what made large cities legible
 * — but it is the fallback path, not the designed one, and the near-camera
 * detail those cities never show is the small-repo aesthetic the README sells.
 *
 * Re-fitting the ramp is deliberately NOT part of the brightness pass: it
 * interacts with selective bloom and tone mapping, so it belongs with the
 * post-FX migration. What the brightness pass does rely on is that the ramp
 * is *uniform* within a mid/large city (1.19x and 1.14x spread above), so it
 * is no longer a meaningful source of building-to-building variance there.
 */

/** World height of one window row. */
export const WINDOW_CELL_Y = 0.55;
/** World width of one window column. */
export const WINDOW_CELL_X = 0.66;

/**
 * Analytic mean of `yShape * hShape` over one cell.
 * yShape ≈ 0.45 (ramp 0.16→0.30, flat →0.60, ramp →0.76),
 * hShape ≈ 0.52 (ramp 0.16→0.30, flat →0.68, ramp →0.82).
 */
export const WINDOW_GRID_MEAN = 0.234;
/**
 * Fraction of cells whose lights are on — `1 - 0.44`, the lit threshold.
 *
 * Every building rolls this per window cell, and every building rolls the same
 * way. There used to be an escape hatch: a per-building flag (`aLit`) forced
 * roughly one building in ten to have EVERY window on. It was meant as
 * variety, and it did not read as variety — a fully lit facade has no dark
 * cells left to break it up, so the building flattened into a solid slab of
 * one colour beside neighbours made of dots. The flag is gone; the only
 * difference between two buildings' windows is now which cells the hash
 * happened to light.
 */
export const WINDOW_LIT_MEAN = 0.56;

/**
 * On-screen building width (CSS px) at which assistance is at full strength.
 * Below this a building is a smudge: no window, rim or corner can be
 * represented at all.
 */
export const ASSIST_FULL_PX = 5.0;
/**
 * On-screen building width (px) at which assistance is exactly zero.
 * The *smallest* building in a 13-file repository measures 32 px at the
 * framing solver's resting distance, so this leaves a ~33% margin before a
 * close-up city can pick up any assistance at all.
 */
export const ASSIST_NONE_PX = 24.0;

/**
 * Extra emissive multiplier at full assistance — THE brightness knob.
 * Averaging the window grid conserves its energy, and that energy (mean
 * ≈ 0.13 of the lit colour) does not survive ACES tone mapping plus fog.
 * Deliberately modest: a 10 px building gets ~2.9x, a mid-repository median
 * building ~1.2x, and a close-up exactly 1x.
 */
export const DISTANT_GLOW_GAIN = 2.2;
/** Same idea for rim/corner/roof edges, which are thinner but already bright. */
export const DISTANT_EDGE_GAIN = 0.8;

/**
 * Hard ceiling on how much of a surface the scene fog may dissolve, and how
 * much of the remainder a lit fragment shrugs off. Three applies fog after
 * tone mapping, so past ~0.8 no amount of emissive can climb back out of it;
 * capping the factor is the only in-material fix. Both fade in with
 * `rcAssist`, so a close-up gets three's fog untouched.
 */
export const FOG_CEILING = 0.82;
export const GLOW_FOG_RESIST = 0.45;

/**
 * Warmth below which a language is pinned to the pure cool anchor.
 *
 * The cyan zone runs 0.05..0.30 in the palette's WARMTH table, and without a
 * dead band those languages carry a faint magenta cast that muddies the cool
 * half of the city. This used to be *subtracted* from warmth, which pinned
 * the cool end correctly but silently truncated the warm end: warmth is
 * capped at 1.0, so the ramp position could never exceed 0.9 — and the amber
 * segment begins above 0.9. JavaScript and Java, the palette's two declared
 * amber hero languages, therefore rendered as pure magenta at every camera
 * where the per-floor jitter is faded out, which since Stage 2 is every
 * resting camera in a mid or large city. The offset is now a rescale, so the
 * full warmth range maps onto the full ramp and amber is reachable again.
 */
export const TINT_OFFSET = 0.1;

/**
 * How far the per-floor hash may shift a window's position along the colour
 * ramp. Faded out by `1 - assist`, so it is absent at overview distance.
 *
 * It is a HUE shift only: `rcWindowTint` normalises luminance afterwards, so
 * moving a floor along the ramp no longer changes how bright it reads. It
 * used to swing a single building's floors over a 1.28x luminance range.
 */
export const FLOOR_SHIFT_RANGE = 0.22;

/**
 * Luminance every window colour is normalised toward, and how far the
 * normalisation may push.
 *
 * The three ramp anchors are nowhere near equal in Rec.709 luminance — cool
 * 0.515, magenta 0.293, amber 0.513 — because magenta is starved of the green
 * that carries 71% of luminance. Per-language window luminance therefore
 * spread 1.56x across a real city (measured: html 0.418, yaml 0.747), so the
 * magenta half of the palette read as a systematically dimmer material than
 * the cyan half for identical emissive energy. Hue still separates the
 * languages — the palette's own stated primary differentiator — but value no
 * longer does it accidentally.
 *
 * The clamp keeps the correction from turning a deliberately quiet colour
 * (lockfile steel, `unknown` grey) into a bright one.
 */
/**
 * Emissive multiplier on the window grid.
 *
 * This has to be read against the bloom pass's 0.72 threshold, because bloom
 * is what decides whether a facade reads as windows or as a slab. A lit cell
 * emits `WINDOW_TARGET_LUMA * WINDOW_EMISSIVE`; the further that sits above
 * the threshold, the wider each cell blooms, and on a large building close to
 * the camera the cells bleed into each other until the whole wall is one solid
 * colour with no grid left in it.
 *
 * At 2.0 a lit cell reached 1.2 — 1.7x the threshold — and the biggest source
 * files in the city rendered as featureless slabs while their smaller
 * neighbours showed dots. That was always true of the cyan half of the palette
 * and became true of the rest once luminance normalisation lifted the dimmer
 * languages to the same target. At 1.4 a cell lands just above the threshold,
 * so the brightest cells still bloom and the dark cells between them survive.
 * Distant cities are unaffected: they are carried by `rcDistantGain`, which
 * multiplies on top of this and is 1.0 at close range.
 */
export const WINDOW_EMISSIVE = 1.4;

export const WINDOW_TARGET_LUMA = 0.6;
export const WINDOW_LUMA_MIN_GAIN = 0.8;
export const WINDOW_LUMA_MAX_GAIN = 1.35;

/**
 * Brightness of the neon rim along the top edge of every wall.
 *
 * One value for the whole city. This used to be two — 0.72 and 1.08 — selected
 * by the same per-building flag that forced a building's windows fully on; see
 * {@link WINDOW_LIT_MEAN} for why that flag is gone. The value here is the
 * population mean the old pair produced at a 10% lit fraction, so removing the
 * split did not change how bright the city is overall.
 */
export const RIM_BRIGHT = 0.76;

/**
 * The horizontal size the distance ramp should judge a building by, from its
 * two plan dimensions.
 *
 * The geometric mean — the side of the square with the same footprint area.
 * This used to be `min(width, depth)`, which is the wrong question: `rcAssist`
 * asks "is this building big enough on screen to show what it is made of", and
 * the face you are looking at is usually the WIDE one. A slab 12 units long
 * and 0.6 deep reported itself as 0.6 wide, so the shader treated the most
 * visible wall in the city as sub-pixel and switched it to the fully averaged
 * fallback — which renders a flat, solid colour with no window grid in it at
 * all. Harmless while every building was nearly square; the moment a typology
 * deliberately made slabs, the largest buildings in the city turned into
 * featureless blocks.
 *
 * The mean is still conservative — it under-reports the long face rather than
 * over-reporting the short one — but it can no longer be dragged to nearly
 * zero by one narrow axis.
 */
export function planSpan(width: number, depth: number): number {
  return Math.sqrt(Math.max(width, 0) * Math.max(depth, 0));
}

/** Format a number as a GLSL float literal (`1` would parse as an int). */
export function glslFloat(value: number): string {
  return Number.isInteger(value) ? value.toFixed(1) : String(value);
}

const f = glslFloat;

/**
 * Rec.709 relative luminance — the CPU twin of `rcLuma`.
 *
 * Kept here rather than in a utility module so it sits beside the GLSL it
 * mirrors: if one changes, the other is on the same screen.
 */
export function luminance(color: readonly [number, number, number]): number {
  return 0.2126 * color[0] + 0.7152 * color[1] + 0.0722 * color[2];
}

/** CPU twin of `rcNormalizeLuma`, for colours computed outside a shader. */
export function normalizeLuma(
  color: readonly [number, number, number],
): [number, number, number] {
  const gain = Math.min(
    WINDOW_LUMA_MAX_GAIN,
    Math.max(WINDOW_LUMA_MIN_GAIN, WINDOW_TARGET_LUMA / Math.max(luminance(color), 1e-4)),
  );
  return [color[0] * gain, color[1] * gain, color[2] * gain];
}

/**
 * Shared fragment-shader helpers. Include once per program, after
 * `#include <common>`.
 */
export const FACADE_GLSL = /* glsl */ `
float rcHash( float n ) { return fract( sin( n ) * 43758.5453 ); }

/*
 * World units covered by one screen pixel at this fragment. The MINIMUM of
 * the two derivatives is deliberate: it is the best-resolved screen axis, so
 * a wall seen at a grazing angle is not mistaken for a distant one.
 */
float rcPixelWorldScale( vec3 worldPos ) {
  return max( min( length( dFdx( worldPos ) ), length( dFdy( worldPos ) ) ), 1e-5 );
}

/*
 * 0 = this building is comfortably resolved on screen and gets no help at
 * all, 1 = it is a handful of pixels wide and needs everything.
 */
float rcAssist( vec3 worldPos, float worldSpan ) {
  float spanPx = worldSpan / rcPixelWorldScale( worldPos );
  return 1.0 - smoothstep( ${f(ASSIST_FULL_PX)}, ${f(ASSIST_NONE_PX)}, spanPx );
}

/* emissive multipliers that keep an averaged facade readable at distance */
float rcDistantGain( float assist ) { return 1.0 + assist * ${f(DISTANT_GLOW_GAIN)}; }
float rcDistantEdgeGain( float assist ) { return 1.0 + assist * ${f(DISTANT_EDGE_GAIN)}; }

/*
 * Procedural window grid in world space so floor heights line up between
 * neighbouring buildings. Returns the lit-window mask; yCell and seed come
 * back for per-floor colour shifts and flicker.
 * As assist → 1 both the shape and the on/off roll resolve to their means,
 * which removes the sub-pixel shimmer and leaves a smooth lit facade. At
 * assist = 0 this is exactly the original grid, term for term.
 */
float rcWindowGrid(
  vec3 worldPos, vec3 n, float seedBias, float assist,
  out float yCell, out float seed
) {
  float onX = abs( n.x );
  float horiz = mix( worldPos.x, worldPos.z, onX );

  float yc = floor( worldPos.y / ${f(WINDOW_CELL_Y)} );
  float yFrac = fract( worldPos.y / ${f(WINDOW_CELL_Y)} );
  float yShape = smoothstep( 0.16, 0.30, yFrac ) * ( 1.0 - smoothstep( 0.60, 0.76, yFrac ) );

  float hCell = floor( horiz / ${f(WINDOW_CELL_X)} );
  float hFrac = fract( horiz / ${f(WINDOW_CELL_X)} );
  float hShape = smoothstep( 0.16, 0.30, hFrac ) * ( 1.0 - smoothstep( 0.68, 0.82, hFrac ) );

  yCell = yc;
  seed = yc * 7.31 + hCell * 11.13 + seedBias;

  float lit = step( 0.44, rcHash( seed ) );
  return mix( yShape * hShape, ${f(WINDOW_GRID_MEAN)}, assist )
    * mix( lit, ${f(WINDOW_LIT_MEAN)}, assist );
}

/*
 * A decorative edge band (roof rim, corner strip, roof outline). The band
 * grows inward as the building shrinks on screen so it never falls below a
 * pixel and vanishes; at assist = 0 it is exactly the original band.
 */
float rcEdgeBand( float coord, float inner, float outer, float widen, float assist ) {
  return smoothstep( inner - ( outer - inner ) * widen * assist, outer, coord );
}

/* Rec.709 relative luminance — "how bright does this colour read". */
float rcLuma( vec3 c ) { return dot( c, vec3( 0.2126, 0.7152, 0.0722 ) ); }

/*
 * Scale a colour toward the palette's target luminance without touching its
 * hue. The clamp is what keeps a deliberately dim colour dim; it is applied
 * to the GAIN, not to the result, so a colour already inside the band is
 * returned untouched.
 */
vec3 rcNormalizeLuma( vec3 c ) {
  float gain = clamp(
    ${f(WINDOW_TARGET_LUMA)} / max( rcLuma( c ), 1e-4 ),
    ${f(WINDOW_LUMA_MIN_GAIN)}, ${f(WINDOW_LUMA_MAX_GAIN)} );
  return c * gain;
}

/*
 * The cool -> magenta -> amber window ramp.
 *
 * \`warmth\` is the language's 0..1 position (aTint) and \`shift\` is the
 * per-floor hue jitter, already faded by 1 - assist. TINT_OFFSET is a
 * RESCALE, not a subtraction: warmth 1.0 must land at the far end of the
 * ramp or the amber anchor is unreachable and the hero languages render
 * magenta. \`rampPos\` comes back for the rim, which tracks the same hue.
 */
vec3 rcWindowTint( float warmth, float shift, out float rampPos ) {
  float et = clamp(
    ( warmth - ${f(TINT_OFFSET)} ) / ${f(1 - TINT_OFFSET)} + shift, 0.0, 1.0 );
  vec3 coolC = vec3( 0.06, 0.62, 0.82 );
  vec3 magC  = vec3( 0.82, 0.12, 0.46 );
  vec3 warmC = vec3( 0.82, 0.46, 0.14 );
  float t1 = clamp( et / 0.9, 0.0, 1.0 );
  float t2 = clamp( ( et - 0.9 ) / 0.1, 0.0, 1.0 );
  rampPos = et;
  return mix( mix( coolC, magC, t1 ), warmC, t2 );
}
`;

/**
 * Replacement for `#include <fog_fragment>`.
 *
 * Identical to three's chunk, then blended — by `assistExpr`, so a close-up
 * is bit-for-bit three's own fog — toward a capped factor that lit fragments
 * partly resist. Without this a distant skyline cannot be rescued at all:
 * fog runs after tone mapping, so at factor 0.8 even a fully blown-out
 * fragment lands at 0.2. Depth is recomputed from `cameraPosition` rather
 * than three's `vFogDepth` varying so nothing depends on renderer internals.
 *
 * @param worldVarying GLSL expression for the fragment's world position.
 * @param assistExpr   GLSL expression in 0..1: how small on screen.
 * @param glowKeyExpr  GLSL expression in 0..1: how lit this fragment is.
 */
export function fogFragmentGLSL(
  worldVarying: string,
  assistExpr: string,
  glowKeyExpr: string,
): string {
  return /* glsl */ `
#ifdef USE_FOG
  {
    float rcDepth = distance( ${worldVarying}, cameraPosition );
    #ifdef FOG_EXP2
      float rcFog = 1.0 - exp( - fogDensity * fogDensity * rcDepth * rcDepth );
    #else
      float rcFog = smoothstep( fogNear, fogFar, rcDepth );
    #endif
    float rcEased = min( rcFog, ${f(FOG_CEILING)} )
      * ( 1.0 - ${f(GLOW_FOG_RESIST)} * clamp( ${glowKeyExpr}, 0.0, 1.0 ) );
    rcFog = mix( rcFog, rcEased, clamp( ${assistExpr}, 0.0, 1.0 ) );
    gl_FragColor.rgb = mix( gl_FragColor.rgb, fogColor, rcFog );
  }
#endif
`;
}

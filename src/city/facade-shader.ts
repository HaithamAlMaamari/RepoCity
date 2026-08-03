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
 * cell's. Real numbers, from the actual camera-framing solver at 1568x820:
 *
 *     repo             camera dist   px per window cell   median px/building
 *     slugify  (13)        184              2.75                  50
 *     flask    (191)       356              1.42                  23
 *     vscode   (798)       403              1.26                  15
 *     three.js (1720)      399              1.27                  10
 *
 * Window-cell coverage is nearly constant across that whole range — it
 * cannot tell a close-up from an overview, and an earlier version of this
 * file that ramped on it put slugify at 0.91 assistance and blew the near
 * view out. Building span separates the tiers cleanly, and it is also the
 * physically correct question: "is this building large enough on screen to
 * show what it is made of?" `rcAssist` is 0 for every building in a small
 * repository, ~0.1 for a mid repository's median building, and ~0.85 for a
 * huge one's.
 *
 * Everything distance-related multiplies through `rcAssist`, so assistance
 * is provably absent — not merely small — up close.
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
/** Fraction of cells whose lights are on — `1 - 0.44`, the lit threshold. */
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

function f(value: number): string {
  return Number.isInteger(value) ? value.toFixed(1) : String(value);
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
  vec3 worldPos, vec3 n, float seedBias, float litBias, float assist,
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

  float lit = clamp( step( 0.44, rcHash( seed ) ) + litBias, 0.0, 1.0 );
  float litMean = clamp( ${f(WINDOW_LIT_MEAN)} + litBias, 0.0, 1.0 );
  return mix( yShape * hShape, ${f(WINDOW_GRID_MEAN)}, assist ) * mix( lit, litMean, assist );
}

/*
 * A decorative edge band (roof rim, corner strip, roof outline). The band
 * grows inward as the building shrinks on screen so it never falls below a
 * pixel and vanishes; at assist = 0 it is exactly the original band.
 */
float rcEdgeBand( float coord, float inner, float outer, float widen, float assist ) {
  return smoothstep( inner - ( outer - inner ) * widen * assist, outer, coord );
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

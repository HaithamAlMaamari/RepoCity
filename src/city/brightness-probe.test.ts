import { describe, expect, it } from 'vitest';
import {
  assistForSpanPx,
  floorShiftLumaRange,
  luminance,
  normalizeLuma,
  probeBrightness,
  windowColor,
  windowTint,
} from './brightness-probe';
import type { Building } from './city';
import {
  ASSIST_FULL_PX,
  ASSIST_NONE_PX,
  AMBER_KNEE,
  FLOOR_SHIFT_RANGE,
  WINDOW_LUMA_MAX_GAIN,
  WINDOW_LUMA_MIN_GAIN,
} from './facade-shader';
import { languageEmissiveBoost } from './palette';
import { BLOCK_TYPOLOGY } from './typology';

function building(overrides: Partial<Building> = {}): Building {
  return {
    position: [0, 5, 0],
    scale: [8, 10, 8],
    parcel: [10, 10],
    color: [0.5, 0.5, 0.5],
    path: 'src/index.ts',
    size: 1024,
    language: 'typescript',
    totalHeight: 10,
    profile: 'block',
    category: 'source',
    typology: BLOCK_TYPOLOGY,
    ...overrides,
  };
}

describe('assistForSpanPx', () => {
  it('gives nothing to a building that is comfortably resolved', () => {
    expect(assistForSpanPx(ASSIST_NONE_PX)).toBe(0);
    expect(assistForSpanPx(ASSIST_NONE_PX * 4)).toBe(0);
  });

  it('gives everything to a building that is a few pixels wide', () => {
    expect(assistForSpanPx(ASSIST_FULL_PX)).toBe(1);
    expect(assistForSpanPx(1)).toBe(1);
  });

  it('is monotonically decreasing between the two edges', () => {
    let previous = Infinity;
    for (let px = ASSIST_FULL_PX; px <= ASSIST_NONE_PX; px += 0.5) {
      const assist = assistForSpanPx(px);
      expect(assist).toBeLessThanOrEqual(previous);
      previous = assist;
    }
  });
});

describe('windowTint', () => {
  /*
   * The regression this file exists for. `TINT_OFFSET` used to be subtracted
   * from warmth rather than dividing out of it, which capped the reachable
   * ramp position at 0.9 — and the amber segment only begins ABOVE 0.9. The
   * palette reserves amber for its two hero languages, and both of them were
   * rendering as pure magenta at any camera where the per-floor jitter is
   * faded out, which since Stage 2 is every mid/large resting camera.
   */
  it('lets the hero languages reach amber with no per-floor help', () => {
    for (const hero of ['javascript', 'java']) {
      const { et, tint } = windowTint(languageEmissiveBoost(hero), 0);
      expect(et).toBeCloseTo(1, 6);
      // The amber anchor, verbatim.
      expect(tint[0]).toBeCloseTo(0.82, 6);
      expect(tint[1]).toBeCloseTo(0.46, 6);
      expect(tint[2]).toBeCloseTo(0.14, 6);
    }
  });

  it('still pins the cyan-zone languages to the cool anchor', () => {
    for (const cool of ['typescript', 'go', 'dockerfile', 'fsharp']) {
      const { et } = windowTint(languageEmissiveBoost(cool), 0);
      expect(et).toBe(0);
    }
  });

  /*
   * The per-floor jitter varies a facade's shade; it must not change which
   * language the facade claims to be. It used to: markdown sat at 0.72 on the
   * ramp and the jitter reached 0.94, past the amber knee, so 14% of a real
   * repository's buildings (markdown, rust and html) showed magenta floors and
   * amber floors on the same wall. Amber means JavaScript or Java.
   */
  it('never lets the per-floor jitter carry a facade into amber', () => {
    for (const lang of ['markdown', 'rust', 'html', 'python', 'ruby', 'typescript', 'json']) {
      const warmth = languageEmissiveBoost(lang);
      for (let step = 0; step <= 20; step++) {
        const { et } = windowTint(warmth, (FLOOR_SHIFT_RANGE * step) / 20);
        expect(et).toBeLessThanOrEqual(AMBER_KNEE + 1e-9);
      }
    }
  });

  it('keeps the hero languages in amber whatever the jitter does', () => {
    for (const hero of ['javascript', 'java']) {
      const warmth = languageEmissiveBoost(hero);
      for (let step = 0; step <= 20; step++) {
        const { et } = windowTint(warmth, (FLOOR_SHIFT_RANGE * step) / 20);
        expect(et).toBeGreaterThanOrEqual(AMBER_KNEE - 1e-9);
      }
    }
  });

  it('still varies shade within a language zone', () => {
    // Cyan-zone languages have the most room, and should still get variety.
    const flat = windowTint(languageEmissiveBoost('typescript'), 0).et;
    const shifted = windowTint(languageEmissiveBoost('typescript'), FLOOR_SHIFT_RANGE).et;
    expect(shifted - flat).toBeGreaterThan(0.1);
  });

  it('is monotonic in warmth', () => {
    let previous = -1;
    for (let warmth = 0; warmth <= 1.0001; warmth += 0.05) {
      const { et } = windowTint(warmth, 0);
      expect(et).toBeGreaterThanOrEqual(previous);
      previous = et;
    }
  });
});

describe('normalizeLuma', () => {
  it('leaves hue alone', () => {
    const before: [number, number, number] = [0.82, 0.12, 0.46];
    const after = normalizeLuma(before);
    // A pure scale preserves every channel ratio.
    expect(after[0] / after[1]).toBeCloseTo(before[0] / before[1], 6);
    expect(after[2] / after[1]).toBeCloseTo(before[2] / before[1], 6);
  });

  it('never pushes further than the clamp allows', () => {
    const black = normalizeLuma([0.01, 0.01, 0.01]);
    expect(black[0] / 0.01).toBeCloseTo(WINDOW_LUMA_MAX_GAIN, 6);
    const white = normalizeLuma([1, 1, 1]);
    expect(white[0]).toBeCloseTo(WINDOW_LUMA_MIN_GAIN, 6);
  });
});

describe('window luminance across the palette', () => {
  /*
   * Magenta carries almost none of the green that makes up 71% of Rec.709
   * luminance, so the magenta half of the palette used to render at 0.57x the
   * cyan half's brightness for identical emissive energy — measured as a
   * 1.56x spread across a real city's languages. Hue still separates the
   * languages; value is no longer allowed to do it by accident.
   */
  const LANGUAGES = [
    'typescript', 'javascript', 'python', 'rust', 'go', 'java',
    'html', 'css', 'markdown', 'yaml', 'ruby', 'c',
  ];

  it('holds every language inside a narrow luminance band', () => {
    const lumas = LANGUAGES.map((language) =>
      luminance(windowColor(languageEmissiveBoost(language), [0.5, 0.5, 0.6], 0)),
    );
    const spread = Math.max(...lumas) / Math.min(...lumas);
    expect(spread).toBeLessThan(1.15);
  });
});

describe('floorShiftLumaRange', () => {
  it('collapses to nothing once a building is too small to resolve', () => {
    const range = floorShiftLumaRange(0.85, [0.92, 0.25, 0.78], 1);
    expect(range.ratio).toBeCloseTo(1, 6);
  });

  it('stays a hue shift rather than a brightness shift up close', () => {
    // At assist 0 the jitter is at full reach; normalisation should keep the
    // luminance swing across one building's floors small.
    for (const [warmth, base] of [
      [0.85, [0.92, 0.25, 0.78]],
      [1.0, [1.0, 0.7, 0.2]],
      [0.05, [0.0, 0.83, 1.0]],
    ] as const) {
      expect(floorShiftLumaRange(warmth, base as [number, number, number], 0).ratio)
        .toBeLessThan(1.15);
    }
  });
});

describe('probeBrightness', () => {
  const view = {
    cameraPosition: [0, 0, 100] as const,
    fov: 50,
    bufferHeight: 900,
    offset: [0, 0] as const,
  };

  /*
   * `aSpan` used to be `min(width, depth)`, and a typology that deliberately
   * builds slabs then broke the city: a slab reports its NARROW axis, so the
   * widest, most visible walls were judged sub-pixel and switched to the
   * fully averaged fallback — which draws a flat solid colour with no window
   * grid in it. The largest buildings rendered as featureless blocks.
   */
  it('judges a slab by its footprint, not by its narrow axis', () => {
    const slab = probeBrightness([building({ scale: [12, 10, 1] })], view)[0];
    expect(slab.span).toBeGreaterThan(1);
    expect(slab.span).toBeCloseTo(Math.sqrt(12), 6);
  });

  it('is unchanged for a square building', () => {
    const [square] = probeBrightness([building({ scale: [8, 10, 8] })], view);
    expect(square.span).toBeCloseTo(8, 6);
  });

  it('never lets one narrow axis drag the span toward zero', () => {
    const square = probeBrightness([building({ scale: [6, 10, 6] })], view)[0];
    const slab = probeBrightness([building({ scale: [18, 10, 2] })], view)[0];
    // Same footprint area, so the ramp should treat them alike.
    expect(slab.span).toBeCloseTo(square.span, 6);
  });

  it('halves the on-screen span when the building is twice as far', () => {
    const near = probeBrightness([building({ position: [0, 0, 0] })], view)[0];
    const far = probeBrightness([building({ position: [0, 0, -100] })], view)[0];
    expect(far.spanPx).toBeCloseTo(near.spanPx / 2, 4);
  });

  it('gives every building the same window behaviour', () => {
    /*
     * There used to be a per-building flag that forced roughly one building in
     * ten to have EVERY window lit. It was meant as variety and read as a
     * defect: a fully lit facade has no dark cells left to break it up, so the
     * building flattened into a solid slab of one colour beside neighbours
     * made of dots. Nothing about a building may change how its windows are
     * rolled — the only difference between two facades is which cells the
     * per-cell hash happened to light.
     */
    const many = Array.from({ length: 400 }, (_, i) => building({ path: `src/f${i}.ts` }));
    const samples = probeBrightness(many, view);
    const gains = new Set(samples.map((s) => s.windowGain.toFixed(9)));
    expect(gains.size).toBe(1);
  });
});

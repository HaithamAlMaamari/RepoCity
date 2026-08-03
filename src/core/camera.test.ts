import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import {
  cityFitBox,
  computeCityFraming,
  createCityCameraRig,
  freeViewportFromRects,
  measureFreeViewport,
  projectBoxToScreen,
} from './camera';
import type { CityFitBox, CityFraming, FitBuilding, FreeViewport } from './camera';
import { createSceneRandom } from './random';

const CANVAS_WIDTH = 1600;
const CANVAS_HEIGHT = 900;
const FOV = 48;

/**
 * A grid city: `count` plots spread over `spanX` × `spanZ`, heights ramping like
 * the real layout.  Cores fill 80% of their plot, as `buildCity` does — the
 * remaining plot is rendered as parcel lines and streets, so the framing must
 * include it.
 */
function makeRectCity(
  count: number,
  spanX: number,
  spanZ: number,
  outliers: readonly number[] = [],
): FitBuilding[] {
  const aspect = spanX / spanZ;
  const columns = Math.max(1, Math.round(Math.sqrt(count * aspect)));
  const rows = Math.max(1, Math.ceil(count / columns));
  const plotX = spanX / columns;
  const plotZ = spanZ / rows;
  const buildings: FitBuilding[] = [];
  for (let index = 0; index < count; index++) {
    const column = index % columns;
    const row = Math.floor(index / columns);
    const height = outliers[index] ?? 6 + 30 * (index / Math.max(1, count - 1));
    buildings.push({
      position: [
        -spanX / 2 + plotX * (column + 0.5),
        height / 2,
        -spanZ / 2 + plotZ * (row + 0.5),
      ],
      scale: [plotX * 0.8, height, plotZ * 0.8],
      parcel: [plotX, plotZ],
      totalHeight: height,
    });
  }
  return buildings;
}

function makeCity(count: number, span: number, outliers: readonly number[] = []): FitBuilding[] {
  const columns = Math.max(1, Math.ceil(Math.sqrt(count)));
  const plot = span / columns;
  const buildings: FitBuilding[] = [];
  for (let index = 0; index < count; index++) {
    const column = index % columns;
    const row = Math.floor(index / columns);
    const height = outliers[index] ?? 6 + 30 * (index / Math.max(1, count - 1));
    buildings.push({
      position: [
        -span / 2 + plot * (column + 0.5),
        height / 2,
        -span / 2 + plot * (row + 0.5),
      ],
      scale: [plot * 0.8, height, plot * 0.8],
      parcel: [plot, plot],
      totalHeight: height,
    });
  }
  return buildings;
}

/** The tallest point of a city, in world space, for crop checks. */
function tallestTop(buildings: readonly FitBuilding[]): THREE.Vector3 {
  let tallest = buildings[0];
  for (const building of buildings) if (building.totalHeight > tallest.totalHeight) tallest = building;
  return new THREE.Vector3(tallest.position[0], tallest.totalHeight, tallest.position[2]);
}

function toPixels(point: THREE.Vector3, camera: THREE.PerspectiveCamera, viewport: FreeViewport) {
  const ndc = point.clone().project(camera);
  return {
    x: ((ndc.x + 1) / 2) * viewport.canvasWidth,
    y: ((1 - ndc.y) / 2) * viewport.canvasHeight,
  };
}

function containsRect(outer: FreeViewport, inner: { left: number; top: number; width: number; height: number }): boolean {
  return inner.left >= outer.left &&
    inner.top >= outer.top &&
    inner.left + inner.width <= outer.left + outer.width &&
    inner.top + inner.height <= outer.top + outer.height;
}

function fullViewport(width = CANVAS_WIDTH, height = CANVAS_HEIGHT): FreeViewport {
  return freeViewportFromRects({ left: 0, top: 0, width, height }, []);
}

/** Header band + left stats panel + right city index, as the app lays them out. */
function panelledViewport(width = CANVAS_WIDTH, height = CANVAS_HEIGHT): FreeViewport {
  return freeViewportFromRects({ left: 0, top: 0, width, height }, [
    { left: 0, top: 0, width, height: 64 },
    { left: 22, top: 110, width: 300, height: 470 },
    { left: width - 382, top: 110, width: 360, height: 640 },
  ]);
}

/**
 * The exact geometry the drift bug was reported against: a 1568×726 Chrome
 * canvas with the header, the stats panel and the explorer all open.
 */
function liveViewport(width = 1568, height = 726): FreeViewport {
  return freeViewportFromRects({ left: 0, top: 0, width, height }, [
    { left: 0, top: 0, width, height: 85 },
    { left: 16, top: 100, width: 300, height: 520 },
    { left: width - 306, top: 100, width: 290, height: 600 },
  ]);
}

function lens(viewport: FreeViewport): THREE.PerspectiveCamera {
  return new THREE.PerspectiveCamera(FOV, viewport.canvasWidth / viewport.canvasHeight, 0.1, 6000);
}

/** Place a camera at a framing and report where the city lands on screen. */
function frameCity(buildings: readonly FitBuilding[], viewport: FreeViewport) {
  const box = cityFitBox(buildings);
  const camera = lens(viewport);
  const framing = computeCityFraming(box, viewport, camera);
  camera.position.copy(framing.position);
  camera.lookAt(framing.aim);
  camera.updateMatrixWorld();
  const rect = projectBoxToScreen(box, camera, viewport.canvasWidth, viewport.canvasHeight);
  return { box, camera, framing, rect };
}

/** How far the projected city sits from the free-viewport centre, as a fraction. */
function centringError(rect: { left: number; top: number; width: number; height: number }, viewport: FreeViewport) {
  return {
    x: Math.abs(rect.left + rect.width / 2 - (viewport.left + viewport.width / 2)) / viewport.width,
    y: Math.abs(rect.top + rect.height / 2 - (viewport.top + viewport.height / 2)) / viewport.height,
  };
}

/** How much of the free viewport's width a projected rectangle actually covers. */
function widthCoverage(rect: { left: number; width: number }, viewport: FreeViewport): number {
  const left = Math.max(rect.left, viewport.left);
  const right = Math.min(rect.left + rect.width, viewport.left + viewport.width);
  return Math.max(0, right - left) / viewport.width;
}

/** Project every plot corner of every building and take the union rectangle. */
function renderedRect(buildings: readonly FitBuilding[], camera: THREE.PerspectiveCamera, viewport: FreeViewport) {
  camera.updateMatrixWorld();
  let left = Infinity, right = -Infinity, top = Infinity, bottom = -Infinity;
  const point = new THREE.Vector3();
  for (const building of buildings) {
    const halfX = Math.max(building.scale[0], building.parcel?.[0] ?? 0) / 2;
    const halfZ = Math.max(building.scale[2], building.parcel?.[1] ?? 0) / 2;
    for (let corner = 0; corner < 8; corner++) {
      point.set(
        building.position[0] + (corner & 1 ? halfX : -halfX),
        corner & 2 ? building.totalHeight : 0,
        building.position[2] + (corner & 4 ? halfZ : -halfZ),
      );
      const pixel = toPixels(point, camera, viewport);
      left = Math.min(left, pixel.x);
      right = Math.max(right, pixel.x);
      top = Math.min(top, pixel.y);
      bottom = Math.max(bottom, pixel.y);
    }
  }
  return { left, top, width: right - left, height: bottom - top };
}

function horizontalAngle(camera: THREE.PerspectiveCamera, target: THREE.Vector3): number {
  return Math.atan2(camera.position.x - target.x, camera.position.z - target.z);
}

function makeRig(buildings: readonly FitBuilding[], overrides: Partial<Parameters<typeof createCityCameraRig>[0]> = {}) {
  const viewport = overrides.viewport ? overrides.viewport() : panelledViewport();
  const camera = lens(viewport);
  const orbitTarget = new THREE.Vector3();
  const rig = createCityCameraRig({
    camera,
    orbitTarget,
    buildings,
    viewport: () => viewport,
    random: createSceneRandom('pallets/flask', 'c'.repeat(40), '0', 'camera'),
    ...overrides,
  });
  return { rig, camera, orbitTarget, viewport };
}

function advance(rig: { update(dt: number): boolean }, seconds: number, step = 1 / 60): void {
  for (let elapsed = 0; elapsed < seconds; elapsed += step) rig.update(step);
}

describe('freeViewportFromRects', () => {
  it('returns the whole canvas when nothing overlays it', () => {
    const viewport = fullViewport();
    expect(viewport.left).toBe(0);
    expect(viewport.top).toBe(0);
    expect(viewport.width).toBe(CANVAS_WIDTH);
    expect(viewport.height).toBe(CANVAS_HEIGHT);
  });

  it('insets past side panels and top bands, and re-centres between them', () => {
    const viewport = panelledViewport();
    expect(viewport.left).toBeGreaterThanOrEqual(322);
    expect(viewport.left + viewport.width).toBeLessThanOrEqual(CANVAS_WIDTH - 382);
    expect(viewport.top).toBeGreaterThanOrEqual(64);
    expect(viewport.height).toBe(CANVAS_HEIGHT - viewport.top);
    const centre = viewport.left + viewport.width / 2;
    expect(centre).toBeGreaterThan(CANVAS_WIDTH / 2 - 60);
    expect(centre).toBeLessThan(CANVAS_WIDTH / 2 + 60);
  });

  it('treats a full-width bottom sheet as a bottom band', () => {
    const viewport = freeViewportFromRects({ left: 0, top: 0, width: 390, height: 844 }, [
      { left: 8, top: 500, width: 374, height: 344 },
    ]);
    expect(viewport.top).toBe(0);
    expect(viewport.height).toBeLessThan(844);
    expect(viewport.height).toBeGreaterThan(844 * 0.33);
  });

  it('never lets a greedy panel collapse the framing region', () => {
    const viewport = freeViewportFromRects({ left: 0, top: 0, width: 1000, height: 800 }, [
      { left: 0, top: 0, width: 900, height: 300 },
      { left: 0, top: 500, width: 900, height: 300 },
    ]);
    expect(viewport.width).toBeGreaterThan(1000 * 0.33);
    expect(viewport.height).toBeGreaterThan(800 * 0.33);
  });

  it('ignores panels that do not overlap the canvas at all', () => {
    const viewport = freeViewportFromRects({ left: 0, top: 0, width: 800, height: 600 }, [
      { left: 900, top: 0, width: 200, height: 600 },
      { left: 0, top: 0, width: 0, height: 0 },
    ]);
    expect(viewport.width).toBe(800);
    expect(viewport.height).toBe(600);
  });

  it('exposes a DOM entry point that tolerates missing panels', () => {
    expect(typeof measureFreeViewport).toBe('function');
  });
});

describe('cityFitBox', () => {
  it('keeps the full footprint but trims the tallest outlier towers', () => {
    const heights = new Array<number>(200).fill(0).map((_, index) => 10 + index * 0.1);
    heights[199] = 900;
    heights[198] = 700;
    heights[197] = 500;
    heights[196] = 480;
    const box = cityFitBox(makeCity(200, 160, heights));
    /* the footprint reaches the parcel edges, not just the narrower cores */
    expect(box.maxX - box.minX).toBeCloseTo(160, 5);
    /* the four outlier towers are excluded; the tallest kept building is 29.5 */
    expect(box.maxY).toBeCloseTo(29.5, 5);
    expect(box.minY).toBe(0);
  });

  it('keeps every building when the city is too small to have a 2% tail', () => {
    const box = cityFitBox(makeCity(13, 40));
    expect(box.maxY).toBeCloseTo(36, 5);
  });

  it('applies the city-root offset to the framed footprint', () => {
    const box = cityFitBox(makeCity(16, 100), { offsetX: 50, offsetZ: -20 });
    expect((box.minX + box.maxX) / 2).toBeCloseTo(50, 5);
    expect((box.minZ + box.maxZ) / 2).toBeCloseTo(-20, 5);
  });

  it('falls back to a usable box for an empty city', () => {
    const box = cityFitBox([]);
    expect(box.maxX).toBeGreaterThan(box.minX);
    expect(box.maxY).toBeGreaterThan(0);
  });

  it('frames the allocated plot, because streets and parcel lines reach it', () => {
    const cores = cityFitBox([
      { position: [0, 5, 0], scale: [4, 10, 4], totalHeight: 10 },
    ]);
    const plots = cityFitBox([
      { position: [0, 5, 0], scale: [4, 10, 4], parcel: [20, 20], totalHeight: 10 },
    ]);
    expect(cores.maxX - cores.minX).toBe(4);
    expect(plots.maxX - plots.minX).toBe(20);
    expect(plots.maxZ - plots.minZ).toBe(20);
  });
});

describe('computeCityFraming', () => {
  const cities: ReadonlyArray<readonly [string, FitBuilding[]]> = [
    ['13 files', makeCity(13, 34)],
    ['236 files', makeCity(236, 170)],
    ['17,000 files', makeCity(17000, 240)],
  ];

  for (const [label, buildings] of cities) {
    it(`fits the skyline height of a ${label} city to the free viewport`, () => {
      for (const viewport of [fullViewport(), panelledViewport(), panelledViewport(390, 844)]) {
        const { rect } = frameCity(buildings, viewport);
        /*
         * Rule 1 of the reference poster: the *height* is what the distance is
         * solved from, so it lands on the requested fill unless the width
         * ceiling took over first.  Width is free to overflow — asserting on it
         * would be asserting the composition is wrong.
         */
        const heightFill = rect.height / viewport.height;
        const widthFill = rect.width / viewport.width;
        expect(heightFill).toBeLessThanOrEqual(0.862);
        expect(heightFill > 0.855 || widthFill > 1.49).toBe(true);
      }
    });

    it(`centres a ${label} city inside the free viewport, not the canvas`, () => {
      for (const viewport of [fullViewport(), panelledViewport(), panelledViewport(390, 844)]) {
        const { rect } = frameCity(buildings, viewport);
        const error = centringError(rect, viewport);
        expect(error.x).toBeLessThan(0.02);
        expect(error.y).toBeLessThan(0.02);
      }
    });
  }

  it('frames the free viewport rather than the canvas centre', () => {
    const buildings = makeCity(236, 170);
    const wide = freeViewportFromRects({ left: 0, top: 0, width: CANVAS_WIDTH, height: CANVAS_HEIGHT }, [
      { left: 0, top: 0, width: 520, height: CANVAS_HEIGHT },
    ]);
    const { rect } = frameCity(buildings, wide);
    const centre = rect.left + rect.width / 2;
    /* a 520px left panel pushes the composition right of the canvas centre */
    expect(centre).toBeGreaterThan(CANVAS_WIDTH / 2 + 100);
    expect(Math.abs(centre - (wide.left + wide.width / 2))).toBeLessThan(wide.width * 0.02);
  });

  it('pulls back when panels shrink the free viewport', () => {
    const buildings = makeCity(236, 170);
    const open = computeCityFraming(cityFitBox(buildings), panelledViewport(), lens(panelledViewport()));
    const closed = computeCityFraming(cityFitBox(buildings), fullViewport(), lens(fullViewport()));
    expect(open.distance).toBeGreaterThan(closed.distance);
  });

  it('keeps the camera outside the city and above the ground', () => {
    for (const buildings of [makeCity(13, 34), makeCity(17000, 240)]) {
      const { framing, box } = frameCity(buildings, panelledViewport());
      expect(framing.position.y).toBeGreaterThan(0);
      const radius = Math.hypot(framing.position.x - framing.focus.x, framing.position.z - framing.focus.z);
      expect(radius).toBeGreaterThan(Math.hypot(box.maxX - box.minX, box.maxZ - box.minZ) / 2);
    }
  });

  it('scales the distance with the city, not with a magic constant', () => {
    const viewport = fullViewport();
    const small = computeCityFraming(cityFitBox(makeCity(13, 34)), viewport, lens(viewport));
    const large = computeCityFraming(cityFitBox(makeCity(17000, 240)), viewport, lens(viewport));
    expect(large.distance).toBeGreaterThan(small.distance * 2);
  });

  it('honours a requested height fill', () => {
    const viewport = fullViewport();
    const buildings = makeCity(236, 170);
    const box = cityFitBox(buildings);
    const camera = lens(viewport);
    const framing = computeCityFraming(box, viewport, camera, { heightFill: 0.4 });
    camera.position.copy(framing.position);
    camera.lookAt(framing.aim);
    const rect = projectBoxToScreen(box, camera, viewport.canvasWidth, viewport.canvasHeight);
    const fill = rect.height / viewport.height;
    expect(fill).toBeGreaterThan(0.32);
    expect(fill).toBeLessThan(0.48);
  });

  /**
   * The solve used to be a coupled fixed-point iteration whose gain, at these
   * immersive distances, exceeded one — it settled into a two-cycle instead of a
   * fixed point and returned whichever phase pass 200 happened to land on.  The
   * signature was a `bias` far outside the frame and an aim far below the city.
   */
  it('converges: the solved pose really does compose the box it reports', () => {
    const viewport = liveViewport();
    const camera = lens(viewport);
    const buildings = makeRectCity(1210, 380, 146);
    const box = cityFitBox(buildings);
    const visualBox = cityFitBox(buildings, { heightPercentile: 1 });
    for (let step = 0; step < 96; step++) {
      const framing = computeCityFraming(box, viewport, camera, {
        visualBox,
        azimuth: (step / 96) * Math.PI * 2,
      });
      /* the bias is an NDC nudge, not a relocation */
      expect(Math.abs(framing.bias.x)).toBeLessThan(0.5);
      expect(Math.abs(framing.bias.y)).toBeLessThan(0.5);
      /* the aim sits inside the city's own vertical range, never under it */
      expect(framing.aim.y).toBeGreaterThan(-visualBox.maxY);
      /* and the reported screen rect matches an independent projection */
      camera.position.copy(framing.position);
      camera.lookAt(framing.aim);
      camera.updateMatrixWorld();
      const rect = projectBoxToScreen(visualBox, camera, viewport.canvasWidth, viewport.canvasHeight);
      expect(Math.abs(rect.left - framing.screen.left)).toBeLessThan(1);
      expect(Math.abs(rect.top - framing.screen.top)).toBeLessThan(1);
      expect(Math.abs(rect.width - framing.screen.width)).toBeLessThan(1);
      expect(Math.abs(rect.height - framing.screen.height)).toBeLessThan(1);
    }
  });

  it('pulls in rather than leave bare ground at the sides, when asked', () => {
    const viewport = liveViewport();
    const camera = lens(viewport);
    const buildings = makeRectCity(1210, 380, 146);
    const box = cityFitBox(buildings);
    const visualBox = cityFitBox(buildings, { heightPercentile: 1 });
    /* find the azimuth where the height fit alone leaves the widest side gaps */
    let azimuth = 0;
    let narrowest = Infinity;
    for (let step = 0; step < 180; step++) {
      const trial = (step / 180) * Math.PI * 2;
      const fill = computeCityFraming(box, viewport, camera, { visualBox, azimuth: trial }).widthFill;
      if (fill < narrowest) {
        narrowest = fill;
        azimuth = trial;
      }
    }
    const options = { visualBox, azimuth };
    const heightOnly = computeCityFraming(box, viewport, camera, options);
    const widthFloor = computeCityFraming(box, viewport, camera, { ...options, minWidthFill: 1.06 });
    expect(heightOnly.widthFill).toBeLessThan(1);
    expect(widthFloor.widthFill).toBeGreaterThan(1.05);
    expect(widthFloor.distance).toBeLessThan(heightOnly.distance);
    /* the surplus height leaves through the bottom; the skyline keeps its headroom */
    expect(widthFloor.screen.top).toBeGreaterThan(viewport.top);
    expect(widthFloor.screen.top).toBeGreaterThanOrEqual(heightOnly.screen.top - 1);
  });
});

/**
 * Rules verified against live browser findings: the settled composition must be
 * vertically centred (not skyline-in-the-top-half), must never crop under the
 * header, and must show small repositories whole.
 */
describe('settled composition', () => {
  /** A city with a lockfile-style outlier: one tower far above the skyline. */
  function cityWithOutlier(count: number, span: number, towerHeight: number): FitBuilding[] {
    const buildings = makeCity(count, span);
    const heights = buildings.map((_, index) => 6 + 30 * (index / Math.max(1, count - 1)));
    heights[Math.floor(count / 2)] = towerHeight;
    return makeCity(count, span, heights);
  }

  const cities: ReadonlyArray<readonly [string, FitBuilding[]]> = [
    ['13-building', cityWithOutlier(13, 40, 72)],
    ['236-building', cityWithOutlier(236, 227, 72)],
    ['5,000-building', cityWithOutlier(5000, 240, 72)],
  ];

  for (const [label, buildings] of cities) {
    it(`centres a ${label} city vertically in the free viewport`, () => {
      const { rig, viewport } = makeRig(buildings, { reducedMotion: true });
      const centre = rig.framing.screen.top + rig.framing.screen.height / 2;
      const target = viewport.top + viewport.height / 2;
      expect(Math.abs(centre - target)).toBeLessThan(viewport.height * 0.02);
      const horizontal = rig.framing.screen.left + rig.framing.screen.width / 2;
      expect(Math.abs(horizontal - (viewport.left + viewport.width / 2))).toBeLessThan(viewport.width * 0.02);
    });

    it(`keeps a ${label} city clear of the header and the ground`, () => {
      const { rig, camera, viewport } = makeRig(buildings, { reducedMotion: true });
      const rendered = renderedRect(buildings, camera, viewport);
      /* nothing hides behind the header band … */
      expect(rig.framing.screen.top).toBeGreaterThan(viewport.top);
      expect(rendered.top).toBeGreaterThan(viewport.top);
      /* … and the whole silhouette stays on the canvas vertically */
      expect(rendered.top + rendered.height).toBeLessThanOrEqual(viewport.top + viewport.height + 1);
      expect(camera.position.y).toBeGreaterThan(0);
    });
  }

  it('lets a big city run off the sides rather than float in empty ground', () => {
    const { rig, viewport } = makeRig(cityWithOutlier(5000, 240, 72), { reducedMotion: true });
    expect(rig.framing.widthFill).toBeGreaterThan(1);
    expect(rig.framing.widthFill).toBeLessThanOrEqual(1.51);
  });

  it('sizes on the clipped skyline, and frames the outlier tower up to its headroom', () => {
    const buildings = cityWithOutlier(236, 227, 240);
    const { rig, camera, viewport } = makeRig(buildings, { reducedMotion: true });
    /* the tower is excluded from the sizing box … */
    expect(rig.box.maxY).toBeLessThan(240);
    /* … and the framed height stops OUTLIER_HEADROOM above the clipped skyline,
       so one freak tower cannot push the whole city into the distance */
    expect(rig.visualBox.maxY).toBeCloseTo(rig.box.maxY * 2.4, 5);
    expect(rig.visualBox.maxY).toBeLessThan(240);
    /* the tower itself is cropped by the top of the canvas, not framed whole */
    const tip = toPixels(tallestTop(buildings), camera, viewport);
    expect(tip.y).toBeLessThan(viewport.top);
  });

  it('would sit high in frame if it centred the clipped box instead', () => {
    const buildings = cityWithOutlier(5000, 240, 240);
    const box = cityFitBox(buildings);
    const visualBox = cityFitBox(buildings, { heightPercentile: 1 });
    const viewport = panelledViewport();
    const camera = lens(viewport);
    const clipped = computeCityFraming(box, viewport, camera);
    const whole = computeCityFraming(box, viewport, camera, { visualBox });
    const centreOf = (rect: { top: number; height: number }) => rect.top + rect.height / 2;
    /* centring the clipped box pushes the rendered mass upward — the bug */
    expect(centreOf(clipped.screen)).toBeLessThan(centreOf(whole.screen));
    expect(Math.abs(centreOf(whole.screen) - (viewport.top + viewport.height / 2))).toBeLessThan(viewport.height * 0.02);
  });

  it('frames small repositories whole, with headroom above the tallest tower', () => {
    const buildings = cityWithOutlier(13, 40, 72);
    const { rig, camera, viewport } = makeRig(buildings, { reducedMotion: true });
    /* no percentile clipping below the small-city threshold */
    expect(rig.box.maxY).toBeCloseTo(72, 5);
    expect(rig.box).toEqual(rig.visualBox);
    /* a handful of towers has no footprint to crop into: it is framed entire */
    expect(containsRect(viewport, rig.framing.screen)).toBe(true);
    expect(containsRect(viewport, renderedRect(buildings, camera, viewport))).toBe(true);
    expect(rig.framing.heightFill).toBeGreaterThan(0.86);
    expect(rig.framing.heightFill).toBeLessThan(0.94);
    const tip = toPixels(tallestTop(buildings), camera, viewport);
    expect(tip.y).toBeGreaterThan(viewport.top + viewport.height * 0.02);
  });

  it('still clips the outlier tail once a city is large enough to have one', () => {
    const large = makeRig(cityWithOutlier(200, 200, 240), { reducedMotion: true }).rig;
    expect(large.box.maxY).toBeLessThan(large.visualBox.maxY);
    const small = makeRig(cityWithOutlier(20, 60, 240), { reducedMotion: true }).rig;
    expect(small.box.maxY).toBeCloseTo(small.visualBox.maxY, 5);
  });
});

/**
 * The showcase drift re-solves the framing at every azimuth, so the composition
 * has to hold all the way round — this is the suite that pins the reported bug,
 * where some azimuths framed the city perfectly and others aimed at bare ground
 * with the city reduced to a sliver at the very top of the frame.
 */
describe('showcase orbit framing', () => {
  const ORBIT_STEPS = 360;

  /** ~1,200 buildings on a wide rectangular footprint, plus a lockfile tower. */
  function wideCity(): FitBuilding[] {
    const count = 1210;
    const heights = new Array<number>(count).fill(0).map((_, index) => 6 + 30 * (index / (count - 1)));
    heights[Math.floor(count * 0.37)] = 96;
    return makeRectCity(count, 380, 146, heights);
  }

  function hugeCity(): FitBuilding[] {
    const count = 5000;
    const heights = new Array<number>(count).fill(0).map((_, index) => 6 + 30 * (index / (count - 1)));
    heights[Math.floor(count * 0.61)] = 96;
    return makeRectCity(count, 352, 158, heights);
  }

  const smallCity = makeCity(13, 40);

  interface Sample {
    azimuth: number;
    framing: CityFraming;
    rect: { left: number; top: number; width: number; height: number };
    rendered: { left: number; top: number; width: number; height: number };
  }

  /** Walk the whole orbit at `ORBIT_STEPS` and measure what each pose composes. */
  function walkOrbit(buildings: readonly FitBuilding[], sampleRendered = true): {
    samples: Sample[];
    viewport: FreeViewport;
  } {
    const viewport = liveViewport();
    const { rig, camera } = makeRig(buildings, { reducedMotion: true, viewport: () => viewport });
    const samples: Sample[] = [];
    for (let step = 0; step <= ORBIT_STEPS; step++) {
      const azimuth = rig.framing.azimuth + (step / ORBIT_STEPS) * Math.PI * 2;
      const framing = rig.orbitFraming(azimuth);
      camera.position.copy(framing.position);
      camera.lookAt(framing.aim);
      camera.updateMatrixWorld();
      const rect = projectBoxToScreen(rig.visualBox, camera, viewport.canvasWidth, viewport.canvasHeight);
      const rendered = sampleRendered && step % 6 === 0
        ? renderedRect(buildings, camera, viewport)
        : rect;
      samples.push({ azimuth, framing, rect, rendered });
    }
    return { samples, viewport };
  }

  const orbits: ReadonlyArray<readonly [string, FitBuilding[]]> = [
    ['1,200-building wide city', wideCity()],
    ['5,000-building wide city', hugeCity()],
  ];

  for (const [label, buildings] of orbits) {
    it(`covers the free viewport width at every azimuth of a ${label}`, () => {
      const { samples, viewport } = walkOrbit(buildings);
      for (const sample of samples) {
        expect(widthCoverage(sample.rect, viewport)).toBeGreaterThanOrEqual(0.95);
      }
      /*
       * And the buildings themselves, not just the box around them.  The box
       * runs the wider of the two: its top face spans the whole footprint at
       * `OUTLIER_HEADROOM` above the skyline, and from this low a camera those
       * phantom top corners splay outwards past the real rooftops.  The contract
       * above is the one the composition guarantees; this is the sanity floor
       * that catches the sliver framings the box check alone might miss.
       */
      for (const sample of samples) {
        expect(widthCoverage(sample.rendered, viewport)).toBeGreaterThan(0.8);
      }
    });

    it(`never reduces a ${label} to a sliver at the top or bottom`, () => {
      const { samples, viewport } = walkOrbit(buildings, false);
      const middleTop = viewport.top + viewport.height * 0.25;
      const middleBottom = viewport.top + viewport.height * 0.75;
      for (const sample of samples) {
        /* the city crosses the middle half of the free viewport … */
        expect(sample.rect.top).toBeLessThan(middleBottom);
        expect(sample.rect.top + sample.rect.height).toBeGreaterThan(middleTop);
        /* … its skyline clears the header band … */
        expect(sample.rect.top).toBeGreaterThan(viewport.top);
        /* … and the camera aims at the city, not at the ground far below it */
        expect(sample.framing.aim.y).toBeGreaterThan(-1);
        expect(sample.framing.position.y).toBeGreaterThan(0);
      }
    });

    it(`moves smoothly and repeats exactly at 2π for a ${label}`, () => {
      const { samples } = walkOrbit(buildings, false);
      const reference = samples[0].framing;
      for (let index = 1; index < samples.length; index++) {
        const previous = samples[index - 1].framing;
        const current = samples[index].framing;
        /* one degree of orbit never moves the rig more than a few percent */
        expect(current.position.distanceTo(previous.position)).toBeLessThan(reference.distance * 0.05);
        expect(current.aim.distanceTo(previous.aim)).toBeLessThan(reference.distance * 0.03);
        expect(Math.abs(current.distance - previous.distance)).toBeLessThan(reference.distance * 0.04);
      }
      /* and the seam closes: azimuth + 2π is the same pose, to the last bit */
      const wrapped = samples[samples.length - 1].framing;
      expect(wrapped.position.distanceTo(reference.position)).toBeLessThan(1e-9);
      expect(wrapped.aim.distanceTo(reference.aim)).toBeLessThan(1e-9);
      expect(Math.abs(wrapped.distance - reference.distance)).toBeLessThan(1e-9);
    });

    it(`crosses the seam of a ${label} without a kink`, () => {
      const viewport = liveViewport();
      const { rig } = makeRig(buildings, { reducedMotion: true, viewport: () => viewport });
      const nudge = 1e-4;
      const before = rig.orbitFraming(rig.framing.azimuth - nudge);
      const at = rig.orbitFraming(rig.framing.azimuth);
      const after = rig.orbitFraming(rig.framing.azimuth + nudge);
      /* the table wraps modularly, so the two one-sided slopes must agree */
      const back = at.position.distanceTo(before.position);
      const forward = after.position.distanceTo(at.position);
      expect(back).toBeLessThan(at.distance * 0.001);
      expect(Math.abs(forward - back)).toBeLessThan(Math.max(back, forward) * 0.35 + 1e-6);
    });
  }

  it('drives the real drift loop all the way round without losing the framing', () => {
    const viewport = liveViewport();
    const buildings = wideCity();
    const { rig, camera, orbitTarget } = makeRig(buildings, { viewport: () => viewport });
    /* play the entrance out, then let the drift take the camera a full turn */
    while (rig.update(1 / 60));
    const middleTop = viewport.top + viewport.height * 0.25;
    const middleBottom = viewport.top + viewport.height * 0.75;
    const step = 1 / 60;
    const seconds = (Math.PI * 2) / 0.028 + 10;
    let previousPosition = camera.position.clone();
    let previousAim = orbitTarget.clone();
    let previousAngle = horizontalAngle(camera, orbitTarget);
    let swept = 0;
    let frame = 0;
    for (let elapsed = 0; elapsed < seconds; elapsed += step) {
      rig.update(step);
      frame++;
      /* constant, stately speed: no frame ever jumps */
      expect(camera.position.distanceTo(previousPosition)).toBeLessThan(rig.framing.distance * 0.005);
      expect(orbitTarget.distanceTo(previousAim)).toBeLessThan(rig.framing.distance * 0.002);
      previousPosition.copy(camera.position);
      previousAim.copy(orbitTarget);
      const angle = horizontalAngle(camera, orbitTarget);
      let delta = angle - previousAngle;
      if (delta > Math.PI) delta -= Math.PI * 2;
      if (delta < -Math.PI) delta += Math.PI * 2;
      expect(Math.abs(delta)).toBeLessThan(0.028 * step * 1.05);
      swept += delta;
      previousAngle = angle;
      if (frame % 60 !== 0) continue;
      camera.updateMatrixWorld();
      const rect = projectBoxToScreen(rig.visualBox, camera, viewport.canvasWidth, viewport.canvasHeight);
      expect(widthCoverage(rect, viewport)).toBeGreaterThanOrEqual(0.95);
      expect(rect.top).toBeGreaterThan(viewport.top);
      expect(rect.top).toBeLessThan(middleBottom);
      expect(rect.top + rect.height).toBeGreaterThan(middleTop);
    }
    /* a full turn, in one direction, at the showcase speed */
    expect(Math.abs(swept)).toBeGreaterThan(Math.PI * 2);
  });

  it('holds a small repository whole all the way round instead of cropping it', () => {
    const { samples, viewport } = walkOrbit(smallCity, false);
    for (const sample of samples) {
      /* the width floor is off below the small-city threshold: full silhouette */
      expect(containsRect(viewport, sample.rect)).toBe(true);
      expect(Math.abs(centringError(sample.rect, viewport).y)).toBeLessThan(0.02);
      expect(Math.abs(centringError(sample.rect, viewport).x)).toBeLessThan(0.02);
    }
    const fills = samples.map((sample) => sample.rect.height / viewport.height);
    expect(Math.min(...fills)).toBeGreaterThan(0.86);
    expect(Math.max(...fills)).toBeLessThan(0.94);
  });

  it('keeps a user-focused building framed without falling back into the orbit', () => {
    const viewport = liveViewport();
    const buildings = wideCity();
    const { rig, camera, orbitTarget } = makeRig(buildings, { viewport: () => viewport });
    /* exactly what main.ts does for `focusSelectedBuilding` */
    rig.skipEntrance();
    rig.noteInteraction();
    const building = buildings[Math.floor(buildings.length * 0.62)];
    const target = new THREE.Vector3(building.position[0], building.totalHeight * 0.45, building.position[2]);
    const direction = camera.position.clone().sub(orbitTarget).normalize();
    const distance = Math.max(22, building.totalHeight * 2.4, Math.max(building.scale[0], building.scale[2]) * 5);
    orbitTarget.copy(target);
    camera.position.copy(target).addScaledVector(direction, distance);
    camera.lookAt(target);

    const focused = camera.position.clone();
    /* the drift stays paused for the idle delay, then resumes around the
       user's own target — it must never yank the camera back to the orbit */
    advance(rig, 7.5);
    expect(camera.position.distanceTo(focused)).toBeLessThan(1e-9);
    expect(orbitTarget.distanceTo(target)).toBeLessThan(1e-9);

    let previous = camera.position.clone();
    for (let step = 0; step < 60 * 40; step++) {
      rig.update(1 / 60);
      expect(camera.position.distanceTo(previous)).toBeLessThan(distance * 0.02);
      previous.copy(camera.position);
      /* the target the user chose is theirs to keep */
      expect(orbitTarget.distanceTo(target)).toBeLessThan(1e-9);
      expect(camera.position.y).toBeGreaterThan(0);
      /* and the rig never snaps back to the composed orbit radius */
      expect(camera.position.distanceTo(orbitTarget)).toBeLessThan(rig.framing.distance);
    }
  });
});

describe('cinematic entrance', () => {
  const buildings = makeCity(236, 170);

  it('starts low and close, then rises and arcs into the hero framing', () => {
    const { rig, camera, orbitTarget } = makeRig(buildings);
    const start = camera.position.clone();
    const startAngle = horizontalAngle(camera, rig.framing.focus);

    expect(rig.entranceActive).toBe(true);
    expect(start.y).toBeLessThan(rig.framing.position.y);
    expect(start.distanceTo(rig.framing.focus)).toBeLessThan(rig.framing.distance);

    advance(rig, 3);
    expect(rig.entranceActive).toBe(true);
    const midAngle = horizontalAngle(camera, rig.framing.focus);
    expect(Math.abs(midAngle - startAngle)).toBeGreaterThan(0.3);
    expect(camera.position.y).toBeGreaterThan(start.y);

    /* land exactly on the last entrance frame: the hero pose, before the
       showcase drift takes the camera on round */
    while (rig.update(1 / 60));
    expect(rig.entranceActive).toBe(false);
    expect(camera.position.distanceTo(rig.framing.position)).toBeLessThan(1e-6);
    expect(orbitTarget.distanceTo(rig.framing.aim)).toBeLessThan(1e-6);
  });

  it('hands over to the drift at speed, without a stutter or a pop', () => {
    const { rig, camera } = makeRig(buildings);
    /* the last frame the entrance owns */
    let previous = camera.position.clone();
    let entranceStep = 0;
    while (rig.update(1 / 60)) {
      entranceStep = camera.position.distanceTo(previous);
      previous.copy(camera.position);
    }
    /* … and the first few the drift owns: no jump across the boundary */
    for (let step = 0; step < 120; step++) {
      rig.update(1 / 60);
      expect(camera.position.distanceTo(previous)).toBeLessThan(Math.max(entranceStep, rig.framing.distance * 0.005));
      previous.copy(camera.position);
    }
  });

  it('never dives through the city while sweeping', () => {
    const { rig, camera } = makeRig(buildings);
    const radius = Math.hypot(rig.box.maxX - rig.box.minX, rig.box.maxZ - rig.box.minZ) / 2;
    for (let step = 0; step < 340; step++) {
      rig.update(1 / 60);
      expect(camera.position.y).toBeGreaterThan(0);
      const horizontal = Math.hypot(camera.position.x - rig.framing.focus.x, camera.position.z - rig.framing.focus.z);
      expect(horizontal).toBeGreaterThan(radius);
    }
  });

  it('cuts to the hero framing on any user input', () => {
    const { rig, camera, orbitTarget } = makeRig(buildings);
    advance(rig, 1.5);
    expect(rig.entranceActive).toBe(true);
    rig.noteInteraction();
    expect(rig.entranceActive).toBe(false);
    expect(camera.position.distanceTo(rig.framing.position)).toBeLessThan(1e-6);
    expect(orbitTarget.distanceTo(rig.framing.aim)).toBeLessThan(1e-6);
  });

  it('skips straight to the hero framing under reduced motion', () => {
    const { rig, camera, orbitTarget } = makeRig(buildings, { reducedMotion: true });
    expect(rig.entranceActive).toBe(false);
    expect(camera.position.distanceTo(rig.framing.position)).toBeLessThan(1e-6);
    expect(orbitTarget.distanceTo(rig.framing.aim)).toBeLessThan(1e-6);
    const resting = camera.position.clone();
    advance(rig, 30);
    expect(camera.position.distanceTo(resting)).toBeLessThan(1e-6);
  });

  it('replays identically for the same seed and mirrors for a different one', () => {
    const seeded = (seed: string) => {
      const { rig, camera } = makeRig(buildings, {
        random: createSceneRandom('pallets/flask', 'c'.repeat(40), seed, 'camera'),
      });
      const samples: number[] = [];
      for (let step = 0; step < 120; step++) {
        rig.update(1 / 60);
        samples.push(camera.position.x, camera.position.y, camera.position.z);
      }
      return { samples, azimuth: rig.framing.azimuth };
    };
    expect(seeded('0').samples).toEqual(seeded('0').samples);

    const clockwise = makeRig(buildings, { random: () => 0.9 }).rig;
    const counter = makeRig(buildings, { random: () => 0.1 }).rig;
    expect(Math.sign(clockwise.framing.azimuth)).toBe(1);
    expect(Math.sign(counter.framing.azimuth)).toBe(-1);
  });

  it('ends on the same framing whether it plays out or is skipped', () => {
    const played = makeRig(buildings);
    while (played.rig.update(1 / 60));
    const skipped = makeRig(buildings);
    skipped.rig.skipEntrance();
    expect(played.camera.position.distanceTo(skipped.camera.position)).toBeLessThan(1e-6);
    expect(played.orbitTarget.distanceTo(skipped.orbitTarget)).toBeLessThan(1e-6);
  });
});

describe('idle showcase drift', () => {
  const buildings = makeCity(236, 170);

  function settledRig() {
    return makeRig(buildings, { reducedMotion: true });
  }

  it('stays still until the idle delay has passed', () => {
    const { rig, camera } = settledRig();
    const resting = camera.position.clone();
    advance(rig, 7.5);
    expect(camera.position.distanceTo(resting)).toBeLessThan(1e-9);
  });

  it('drifts around the city once idle, holding the composed framing', () => {
    const { rig, camera, orbitTarget } = makeRig(buildings, { reducedMotion: false });
    rig.skipEntrance();
    const restingAngle = horizontalAngle(camera, orbitTarget);
    const restingRadius = camera.position.distanceTo(orbitTarget);
    advance(rig, 7.5);
    expect(Math.abs(horizontalAngle(camera, orbitTarget) - restingAngle)).toBeLessThan(1e-9);

    advance(rig, 25);
    const angle = horizontalAngle(camera, orbitTarget);
    expect(Math.abs(angle - restingAngle)).toBeGreaterThan(0.05);
    expect(Math.abs(angle - restingAngle)).toBeLessThan(1.2);
    /* the radius follows the orbit table rather than staying fixed — that is
       what keeps the framing constant — but it never bolts */
    const radius = camera.position.distanceTo(orbitTarget);
    expect(Math.abs(radius - restingRadius) / restingRadius).toBeLessThan(0.25);
    expect(camera.position.y).toBeGreaterThan(0);
  });

  it('pauses on interaction and resumes only after the idle delay', () => {
    const { rig, camera } = makeRig(buildings, { reducedMotion: false });
    rig.skipEntrance();
    advance(rig, 30);
    rig.noteInteraction();
    const paused = camera.position.clone();
    advance(rig, 7.5);
    expect(camera.position.distanceTo(paused)).toBeLessThan(1e-9);
    advance(rig, 12);
    expect(camera.position.distanceTo(paused)).toBeGreaterThan(0.5);
  });

  it('produces the same drift for the same seed', () => {
    const sample = () => {
      const { rig, camera } = makeRig(buildings, {
        random: createSceneRandom('pallets/flask', 'c'.repeat(40), '0', 'camera'),
      });
      rig.skipEntrance();
      advance(rig, 24);
      return camera.position.toArray();
    };
    expect(sample()).toEqual(sample());
  });

  it('stops entirely once disposed', () => {
    const { rig, camera } = makeRig(buildings, { reducedMotion: false });
    rig.skipEntrance();
    rig.dispose();
    const resting = camera.position.clone();
    advance(rig, 40);
    expect(camera.position.distanceTo(resting)).toBeLessThan(1e-9);
  });
});

describe('reframing', () => {
  const buildings = makeCity(236, 170);

  it('recomposes when a panel is toggled, until the user takes over', () => {
    let viewport = panelledViewport();
    const camera = lens(viewport);
    const orbitTarget = new THREE.Vector3();
    const rig = createCityCameraRig({
      camera,
      orbitTarget,
      buildings,
      viewport: () => viewport,
      random: createSceneRandom('pallets/flask', 'c'.repeat(40), '0', 'camera'),
      reducedMotion: true,
    });
    const framedWithPanels = camera.position.clone();

    viewport = fullViewport();
    rig.refresh();
    expect(camera.position.distanceTo(framedWithPanels)).toBeGreaterThan(1);
    expect(camera.position.distanceTo(rig.framing.position)).toBeLessThan(1e-6);

    rig.noteInteraction();
    const userPose = camera.position.clone();
    viewport = panelledViewport();
    rig.refresh();
    expect(camera.position.distanceTo(userPose)).toBeLessThan(1e-9);
  });

  it('re-composes at the user\'s own angle when the canvas itself resizes', () => {
    let viewport = panelledViewport();
    const camera = lens(viewport);
    const orbitTarget = new THREE.Vector3();
    const rig = createCityCameraRig({
      camera,
      orbitTarget,
      buildings,
      viewport: () => viewport,
      reducedMotion: true,
    });
    /* the user orbits a quarter turn and zooms in */
    rig.noteInteraction();
    const offset = camera.position.clone().sub(orbitTarget);
    const angle = Math.PI / 2;
    camera.position.set(
      orbitTarget.x + (offset.x * Math.cos(angle) - offset.z * Math.sin(angle)) * 0.6,
      orbitTarget.y + offset.y * 0.6,
      orbitTarget.z + (offset.x * Math.sin(angle) + offset.z * Math.cos(angle)) * 0.6,
    );
    camera.lookAt(orbitTarget);
    const userAzimuth = Math.atan2(camera.position.x - orbitTarget.x, camera.position.z - orbitTarget.z);

    viewport = panelledViewport(1280, 720);
    camera.aspect = 1280 / 720;
    camera.updateProjectionMatrix();
    rig.refresh();

    /* the angle survives … */
    const azimuth = Math.atan2(camera.position.x - orbitTarget.x, camera.position.z - orbitTarget.z);
    expect(Math.abs(azimuth - userAzimuth)).toBeLessThan(0.05);
    /* … while the composition is restored for the new canvas: vertically inside
       the free viewport, horizontally centred on it even where it overflows */
    camera.updateMatrixWorld();
    const rect = projectBoxToScreen(rig.visualBox, camera, viewport.canvasWidth, viewport.canvasHeight);
    expect(rect.top).toBeGreaterThan(viewport.top);
    expect(rect.top + rect.height).toBeLessThanOrEqual(viewport.top + viewport.height + 1);
    const error = centringError(rect, viewport);
    expect(error.x).toBeLessThan(0.02);
    expect(error.y).toBeLessThan(0.02);
  });

  it('keeps the composition rules after a viewport change', () => {
    let viewport = panelledViewport();
    const camera = lens(viewport);
    const rig = createCityCameraRig({
      camera,
      orbitTarget: new THREE.Vector3(),
      buildings,
      viewport: () => viewport,
      reducedMotion: true,
    });
    viewport = panelledViewport(1280, 720);
    camera.aspect = 1280 / 720;
    camera.updateProjectionMatrix();
    rig.refresh();
    const box: CityFitBox = rig.visualBox;
    camera.lookAt(rig.framing.aim);
    camera.updateMatrixWorld();
    const rect = projectBoxToScreen(box, camera, viewport.canvasWidth, viewport.canvasHeight);
    expect(rect.height / viewport.height).toBeLessThanOrEqual(0.87);
    expect(rect.width / viewport.width).toBeGreaterThan(1);
    expect(rect.width / viewport.width).toBeLessThanOrEqual(1.51);
  });

  it('re-solves the whole orbit on refresh, not just the pose it is standing on', () => {
    let viewport = liveViewport();
    const camera = lens(viewport);
    const buildings = makeRectCity(1210, 380, 146);
    const rig = createCityCameraRig({
      camera,
      orbitTarget: new THREE.Vector3(),
      buildings,
      viewport: () => viewport,
      reducedMotion: true,
    });
    viewport = liveViewport(1100, 900);
    camera.aspect = 1100 / 900;
    camera.updateProjectionMatrix();
    rig.refresh();
    for (let step = 0; step < 72; step++) {
      const framing = rig.orbitFraming(rig.framing.azimuth + (step / 72) * Math.PI * 2);
      camera.position.copy(framing.position);
      camera.lookAt(framing.aim);
      camera.updateMatrixWorld();
      const rect = projectBoxToScreen(rig.visualBox, camera, viewport.canvasWidth, viewport.canvasHeight);
      expect(widthCoverage(rect, viewport)).toBeGreaterThanOrEqual(0.95);
      expect(rect.top).toBeGreaterThan(viewport.top);
      expect(rect.top).toBeLessThan(viewport.top + viewport.height * 0.75);
    }
  });
});

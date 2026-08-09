/**
 * capture-media.mjs — regenerate the still images the project shows the
 * outside world: the og:image and the README gallery.
 *
 * The README's lead image is the entrance animation, which capture-gif.mjs
 * records; a second still of the same city underneath it was redundant weight.
 *
 * These were made by hand, and hand-made assets drift. Each of them was
 * generated before a run of visual work and then kept advertising a city the
 * app no longer rendered — building tops floating clear of their bodies, no
 * interior streets, none of the district architecture. A shared link is often
 * the only view of the project somebody ever gets, so it is the one picture
 * that must not be stale.
 *
 * Repositories and the seed are pinned, so re-running after a visual change
 * produces a comparable set rather than a new composition.
 *
 * Usage:
 *   node scripts/capture-media.mjs [--url=…] [--only=og,react]
 *
 * Requires `npm run dev` and a local Chrome, like the other capture tools, and
 * is deliberately outside `npm run ci` for the same reason: it needs a GPU and
 * the network.
 */
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildCityPage, hideInterface, watchErrors } from './lib/city-page.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/*
 * Sizes are the ones already referenced by index.html's meta tags and the
 * README, so each output is a drop-in replacement.
 */
const TARGETS = [
  { key: 'og', repo: 'facebook/react', out: 'public/og.jpg', width: 1200, height: 630, type: 'jpeg' },
  { key: 'react', repo: 'facebook/react', out: 'docs/media/react.jpg', width: 1200, height: 630, type: 'jpeg' },
  { key: 'vue', repo: 'vuejs/vue', out: 'docs/media/vue.jpg', width: 1200, height: 630, type: 'jpeg' },
  { key: 'flask', repo: 'pallets/flask', out: 'docs/media/flask.jpg', width: 1200, height: 630, type: 'jpeg' },
  { key: 'self', repo: 'HaithamAlMaamari/RepoCity', out: 'docs/media/repocity.jpg', width: 1200, height: 630, type: 'jpeg' },
];

const JPEG_QUALITY = 88;

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};
const baseUrl = flag('url', 'http://127.0.0.1:5173');
const only = flag('only', '');
const selected = only ? TARGETS.filter((t) => only.split(',').includes(t.key)) : TARGETS;

/**
 * Screenshot the city, trimming any ground the composition left over.
 *
 * Mostly a safety net now. It was written when hiding the UI did not re-solve
 * the framing, so every capture was composed for a viewport that still had
 * panels in it and the city sat inset with dead black around it — cropping was
 * covering for that. With the refresh wired up the city fills and overflows
 * the frame on its own, and this usually clamps to the whole canvas and does
 * nothing.
 *
 * It still earns its place for output ratios the composition was not solved
 * against, where the fit can leave an apron of empty plate below the city. The
 * crop is expanded to the target ratio and drawn into an offscreen canvas at
 * the exact output size, so the result is always the requested dimensions.
 */
async function renderCropped(page, target) {
  /*
   * The source is Playwright's screenshot, not the live canvas. The renderer
   * does not preserve its drawing buffer, so reading the WebGL canvas after
   * the frame has been composited yields an empty image — `capturePoster` gets
   * away with it only because it re-renders immediately beforehand. Handing
   * the composited PNG back into the page keeps the crop maths in one place
   * without needing a render hook.
   */
  const shot = await page.locator('#stage').screenshot({ type: 'png' });

  const dataUrl = await page.evaluate(async ({ width, height, type, quality, margin, source }) => {
    const canvas = document.getElementById('stage');
    const framing = window.__repocityFraming?.();
    const cw = canvas.clientWidth;
    const ch = canvas.clientHeight;

    const image = new Image();
    await new Promise((resolve, reject) => {
      image.onload = resolve;
      image.onerror = reject;
      image.src = source;
    });

    let sx = 0, sy = 0, sw = cw, sh = ch;
    if (framing && framing.width > 0 && framing.height > 0) {
      /*
       * The top edge is the canvas, never the framing rect.
       *
       * `framing.screen` is the box the camera solver FITTED, which is the
       * city's full extent only while no tower is an outlier. Where one is —
       * react carries a 72-unit landmark over a roughly 30-unit skyline — the
       * box is capped at `OUTLIER_HEADROOM` above the clipped skyline and the
       * tip is deliberately allowed out of frame rather than dragging the
       * whole camera back. Cropping to that rect therefore decapitates the
       * landmarks. Sky above the city costs nothing to keep, so the only
       * things worth trimming are the empty apron below the plate and the
       * dead space either side.
       */
      let x1 = framing.left - framing.width * margin;
      let x2 = framing.left + framing.width * (1 + margin);
      const y1 = 0;
      let y2 = Math.min(ch, framing.top + framing.height * (1 + margin));

      const want = width / height;
      if ((x2 - x1) / (y2 - y1) < want) {
        // Too tall: take the surplus off the bottom, which is ground.
        y2 = Math.max(framing.top + framing.height, y1 + (x2 - x1) / want);
      }
      // Still too tall only if the city itself is taller than the ratio allows,
      // in which case widen instead so nothing is cut.
      const grow = ((y2 - y1) * want - (x2 - x1)) / 2;
      if (grow > 0) { x1 -= grow; x2 += grow; }

      const shiftX = Math.min(0, x1) + Math.max(0, x2 - cw);
      x1 -= shiftX; x2 -= shiftX;
      sx = Math.max(0, x1); sy = y1;
      sw = Math.min(cw - sx, x2 - x1); sh = Math.min(ch - sy, y2 - y1);
    }

    // The screenshot is in device pixels; the framing rect is in CSS pixels.
    const scale = image.naturalWidth / cw;
    const out = document.createElement('canvas');
    out.width = width;
    out.height = height;
    const ctx = out.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(image, sx * scale, sy * scale, sw * scale, sh * scale, 0, 0, width, height);
    return out.toDataURL(type === 'jpeg' ? 'image/jpeg' : 'image/png', quality);
  }, {
    width: target.width, height: target.height, type: target.type,
    quality: JPEG_QUALITY / 100, margin: CROP_MARGIN,
    source: `data:image/png;base64,${shot.toString('base64')}`,
  });

  return Buffer.from(dataUrl.slice(dataUrl.indexOf(',') + 1), 'base64');
}

/** Breathing room around the city, as a share of its own on-screen size. */
const CROP_MARGIN = 0.06;
/** Render this many times the output size, then scale down. */
const SUPERSAMPLE = 2;

const browser = await chromium.launch({ channel: 'chrome', headless: false, args: ['--enable-gpu'] });
let failed = 0;

for (const target of selected) {
  /*
   * Rendered larger than the output and scaled down. The crop keeps only the
   * part of the frame the city occupies — a little over half of it — so
   * shooting at the final size would mean upscaling that region. Supersampling
   * also costs nothing here and cleans up the thin neon curbs and window
   * grids, which alias badly at one sample per pixel.
   */
  const page = await browser.newPage({
    viewport: { width: target.width * SUPERSAMPLE, height: target.height * SUPERSAMPLE },
  });
  const errors = watchErrors(page);
  try {
    // Throws rather than writing a picture of the wrong repository.
    const { canonical } = await buildCityPage(page, baseUrl, target.repo);
    await hideInterface(page);

    const buffer = await renderCropped(page, target);
    const file = join(ROOT, target.out);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, buffer);

    const note = canonical.toLowerCase() !== target.repo.toLowerCase() ? `  (${target.repo} -> ${canonical})` : '';
    console.log(
      `  ${target.key.padEnd(6)} ${target.out.padEnd(22)} ${target.width}x${target.height}` +
      `  ${(buffer.length / 1024).toFixed(0).padStart(4)} KB` +
      `  ${errors.length ? `${errors.length} ERRORS` : 'clean'}${note}`,
    );
    errors.slice(0, 3).forEach((e) => console.log(`      x ${e}`));
  } catch (error) {
    failed++;
    console.log(`  ${target.key.padEnd(6)} FAILED: ${String(error).slice(0, 180)}`);
  } finally {
    await page.close();
  }
}

await browser.close();
console.log(`\nregenerated ${selected.length - failed}/${selected.length} media assets`);
if (failed) process.exit(1);

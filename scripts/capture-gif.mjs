/**
 * capture-gif.mjs — record the entrance and write the README's animation.
 *
 * The one thing a still cannot show is that the city is *built* — the camera
 * sweeps in, dips, and settles onto the hero pose over about six seconds, and
 * that move is most of what makes the project read as a place rather than a
 * chart. The README leads with it.
 *
 * Playwright records the page to webm rather than the frames being screenshot
 * one at a time: screenshots run at whatever rate the harness manages, which
 * produces uneven motion, and the entrance is the one thing that has to look
 * smooth. ffmpeg then does a two-pass palette (generate, then apply) because a
 * single pass quantises to a generic 256 colours and turns a neon city into
 * banded mud.
 *
 * Usage:
 *   node scripts/capture-gif.mjs [--repo=owner/name] [--out=docs/media/tour.gif]
 *                                [--width=720] [--fps=12] [--seconds=8]
 *
 * Requires `npm run dev`, a local Chrome, and ffmpeg on PATH.
 */
import { chromium } from 'playwright';
import { execFile } from 'node:child_process';
import { mkdirSync, rmSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { openCity } from './lib/city-page.mjs';

const run = promisify(execFile);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};

const baseUrl = flag('url', 'http://127.0.0.1:5173');
const repo = flag('repo', 'mrdoob/three.js');
const out = join(ROOT, flag('out', 'docs/media/tour.gif'));
const width = Number(flag('width', '720'));
const fps = Number(flag('fps', '12'));
const seconds = Number(flag('seconds', '8'));
/** Recording canvas. 16:9, and larger than the output so the scale-down cleans up the window grid. */
const VIEWPORT = { width: 1440, height: 810 };
/**
 * Start the clip slightly BEFORE the build completes, so the first frame is
 * the city appearing rather than the camera already moving.
 */
const LEAD_IN = 0.4;

const work = join(ROOT, 'artifacts', 'gif');
rmSync(work, { recursive: true, force: true });
mkdirSync(work, { recursive: true });

const browser = await chromium.launch({ channel: 'chrome', headless: false, args: ['--enable-gpu'] });
const context = await browser.newContext({
  viewport: VIEWPORT,
  recordVideo: { dir: work, size: VIEWPORT },
});
const page = await context.newPage();

const recordingStarted = Date.now();
// Shared with every other capture tool: re-implementing the wait here is what
// made an earlier version start recording after the entrance had finished.
const { status, built } = await openCity(page, baseUrl, repo);
if (!built) {
  await context.close();
  await browser.close();
  throw new Error(`${repo} never built (status ${JSON.stringify(status)})`);
}

// Where the entrance begins, measured against the start of the recording.
const entranceAt = Math.max(0, (Date.now() - recordingStarted) / 1000 - LEAD_IN);
console.log(`  built after ${entranceAt.toFixed(1)}s — recording the entrance`);

await page.waitForTimeout(seconds * 1000);
const video = page.video();
await context.close();
const raw = await video.path();
await browser.close();

const palette = join(work, 'palette.png');
const filters = `fps=${fps},scale=${width}:-1:flags=lanczos`;
await run('ffmpeg', [
  '-y', '-ss', String(entranceAt), '-t', String(seconds), '-i', raw,
  '-vf', `${filters},palettegen=stats_mode=diff`, palette,
]);
mkdirSync(dirname(out), { recursive: true });
await run('ffmpeg', [
  '-y', '-ss', String(entranceAt), '-t', String(seconds), '-i', raw, '-i', palette,
  '-lavfi', `${filters}[x];[x][1:v]paletteuse=dither=bayer:bayer_scale=3`,
  out,
]);

rmSync(work, { recursive: true, force: true });
const kb = statSync(out).size / 1024;
console.log(`  wrote ${out.replace(ROOT, '.')}  ${width}px  ${fps}fps  ${seconds}s  ${(kb / 1024).toFixed(1)} MB`);
if (kb > 10 * 1024) console.log('  NOTE: over 10 MB — drop --width or --fps before committing');

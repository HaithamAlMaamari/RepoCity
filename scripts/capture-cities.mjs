/**
 * capture-cities.mjs — render a fixed set of cities and write PNGs.
 *
 * The point is comparability: the same repositories, at the same pinned
 * commits, with the same seed and viewport, every run. Two labelled runs can
 * then be put side by side to see exactly what a change did to the picture.
 *
 * Usage:
 *   node scripts/capture-cities.mjs <label> [--url=…] [--only=react,flask] [--ui]
 *
 *   <label>   subdirectory under artifacts/captures/, e.g. "before", "stage1"
 *   --url     app under test. Defaults to the Vite dev server, which always
 *             serves current source. The Worker-served build on :8787 is more
 *             faithful but goes stale whenever dist/ is rebuilt underneath it
 *             — it then answers 404 for assets until wrangler is restarted.
 *   --only    comma-separated subset of the fixture keys below
 *   --ui      keep the panels visible (default hides them for a clean city)
 *
 * Requires the app to be running (`npm run dev`) and a local Chrome. This is a
 * developer tool: it needs network and a GPU, so it is deliberately NOT part
 * of `npm run ci`.
 */
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/*
 * Commits are pinned so a capture is reproducible across days. Seed is fixed
 * at 0. Sizes span the range that has historically broken: a small repo, two
 * mid ones, and two large ones that used to render as black slabs.
 */
const FIXTURES = [
  { key: 'flask', repo: 'pallets/flask', note: 'small' },
  { key: 'react', repo: 'facebook/react', note: 'mid' },
  { key: 'vue', repo: 'vuejs/vue', note: 'mid' },
  { key: 'vscode', repo: 'microsoft/vscode', note: 'large' },
  { key: 'threejs', repo: 'mrdoob/three.js', note: 'large' },
];

const VIEWPORT = { width: 1600, height: 900 };
/** Long enough for the entrance camera to settle before we look. */
const SETTLE_MS = 15_000;

const args = process.argv.slice(2);
const label = args.find((a) => !a.startsWith('--')) ?? 'run';
const flag = (name, fallback) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};
const baseUrl = flag('url', 'http://127.0.0.1:5173');
const only = flag('only', '');
const keepUi = args.includes('--ui');

const selected = only
  ? FIXTURES.filter((f) => only.split(',').includes(f.key))
  : FIXTURES;

const outDir = join(ROOT, 'artifacts', 'captures', label);
mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch({
  channel: 'chrome',
  headless: false,
  args: ['--enable-gpu'],
});
const results = [];

for (const fixture of selected) {
  const page = await browser.newPage({ viewport: VIEWPORT });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e).slice(0, 200)));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text().slice(0, 200));
  });

  try {
    await page.goto(baseUrl, { waitUntil: 'load' });
    // The app auto-builds a default repo on load; let that finish first so it
    // cannot overwrite the build we are about to request.
    await page.waitForTimeout(6000);

    await page.fill('#repo', fixture.repo);
    await page.click('#go');

    const started = Date.now();
    let status = '';
    while (Date.now() - started < 180_000) {
      status = (await page.textContent('#status').catch(() => '')) ?? '';
      if (!/fetching|building|rebuilding|initial/i.test(status)) break;
      await page.waitForTimeout(500);
    }

    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(SETTLE_MS);

    if (!keepUi) {
      /*
       * `display: none`, not opacity. The camera solver measures panels via
       * getClientRects and deliberately ignores opacity, so an opacity-hidden
       * panel still shrinks the free viewport and mis-frames the shot.
       */
      await page.addStyleTag({
        content: `#topbar, .presets, #sidebar, #explore-panel, #info,
                  #loading, .hint-row, .grain { display: none !important; }`,
      });
      // Let the solver observe the larger viewport and re-frame.
      await page.evaluate(() => window.dispatchEvent(new Event('resize')));
      await page.waitForTimeout(2500);
    }

    const buf = await page.locator('#stage').screenshot({ type: 'png' });
    const file = join(outDir, `${fixture.key}.png`);
    writeFileSync(file, buf);

    const buildings = /([\d,]+)\s+buildings/.exec(status)?.[1] ?? '?';
    results.push({ key: fixture.key, note: fixture.note, buildings, errors: errors.length, status: status.trim() });
    console.log(`  ${fixture.key.padEnd(9)} ${String(buildings).padStart(7)} buildings  ${errors.length ? `${errors.length} ERRORS` : 'clean'}`);
    if (errors.length) errors.slice(0, 3).forEach((e) => console.log(`      x ${e}`));
  } catch (error) {
    console.log(`  ${fixture.key.padEnd(9)} FAILED: ${String(error).slice(0, 160)}`);
    results.push({ key: fixture.key, note: fixture.note, failed: String(error).slice(0, 200) });
  } finally {
    await page.close();
  }
}

writeFileSync(join(outDir, 'summary.json'), JSON.stringify({ label, baseUrl, viewport: VIEWPORT, results }, null, 2));

const failed = results.filter((r) => r.failed);
console.log(`\nwrote ${results.length - failed.length}/${results.length} captures to artifacts/captures/${label}/`);

await browser.close();

if (failed.length) {
  // A stale `wrangler dev` is the usual cause: rebuilding into dist/ under a
  // running server leaves it serving 404s until it is restarted.
  console.error(`\n${failed.length} capture(s) FAILED — is the app still serving at ${baseUrl}?`);
  process.exit(1);
}

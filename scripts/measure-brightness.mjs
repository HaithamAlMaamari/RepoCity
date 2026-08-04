/**
 * measure-brightness.mjs — attribute the city's brightness variance to a
 * named mechanism, against real repositories.
 *
 * Stage 3 of the visual pass lists four suspects for "same-language buildings
 * render at very different brightness". Three of them can be reasoned about
 * from the GLSL alone; the fourth — distance assistance, keyed off each
 * building's footprint — depends on the solved camera against a real layout,
 * and Stage 2 reshaped every plot in the city. This measures it rather than
 * assuming, because a synthetic uniform grid has given the wrong answer twice.
 *
 * Usage:
 *   node scripts/measure-brightness.mjs [--url=…] [--only=react,flask]
 *
 * Requires `npm run dev` and a local Chrome, same as capture-cities.mjs. The
 * page must be the Vite dev server: the handle it reads is dev-only.
 */
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildCityPage, watchErrors } from './lib/city-page.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const FIXTURES = [
  { key: 'flask', repo: 'pallets/flask', note: 'small' },
  { key: 'react', repo: 'facebook/react', note: 'mid' },
  { key: 'vscode', repo: 'microsoft/vscode', note: 'large' },
];

const VIEWPORT = { width: 1600, height: 900 };

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};
const baseUrl = flag('url', 'http://127.0.0.1:5173');
const only = flag('only', '');
const selected = only ? FIXTURES.filter((f) => only.split(',').includes(f.key)) : FIXTURES;

const quantile = (sorted, q) => {
  if (sorted.length === 0) return 0;
  const i = Math.min(sorted.length - 1, Math.max(0, Math.round((sorted.length - 1) * q)));
  return sorted[i];
};
const num = (v, w = 6, d = 2) => v.toFixed(d).padStart(w);

/** Spread of a set of multipliers, reported as the ratio p95/p05. */
function spread(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const lo = quantile(sorted, 0.05);
  const hi = quantile(sorted, 0.95);
  return {
    p05: lo,
    p50: quantile(sorted, 0.5),
    p95: hi,
    min: sorted[0] ?? 0,
    max: sorted[sorted.length - 1] ?? 0,
    ratio: lo > 1e-6 ? hi / lo : Infinity,
  };
}

const browser = await chromium.launch({ channel: 'chrome', headless: false, args: ['--enable-gpu'] });
const report = [];

for (const fixture of selected) {
  const page = await browser.newPage({ viewport: VIEWPORT });
  const errors = watchErrors(page);
  try {
    // Throws rather than sampling a stale page — the defect that made an
    // earlier run report flask and react as the same 3,883-building city.
    const { status } = await buildCityPage(page, baseUrl, fixture.repo);

    const samples = await page.evaluate(() => window.__repocityProbe?.() ?? null);
    if (!samples) throw new Error('no probe handle — is this the Vite dev server?');

    const source = samples.filter((s) => s.category === 'source');
    const assists = source.map((s) => s.assist);
    const gains = source.map((s) => s.windowGain);

    // Within-language luminance spread is the headline: two files in the same
    // language should not read as different materials.
    const byLanguage = new Map();
    for (const s of source) {
      if (!byLanguage.has(s.language)) byLanguage.set(s.language, []);
      byLanguage.get(s.language).push(s);
    }
    const langRows = [...byLanguage.entries()]
      .filter(([, rows]) => rows.length >= 8)
      .map(([language, rows]) => {
        // Total emissive multiplier each building gets, relative to a plain
        // one of the same language. Distance assistance is now the only
        // per-building term: the all-windows-on flag has been removed.
        const effective = rows.map((r) => r.windowGain);
        return {
          language,
          count: rows.length,
          windowLuma: rows[0].windowLuma,
          gain: spread(effective),
          floorSpread: spread(rows.map((r) => r.floorSpread)),
        };
      })
      .sort((a, b) => b.count - a.count);

    const languageLuma = spread(langRows.map((r) => r.windowLuma));

    console.log(`\n──── ${fixture.repo}  (${fixture.note})  ${source.length} source buildings`);
    console.log(`  status: ${status}${errors.length ? `   ${errors.length} PAGE ERRORS` : ''}`);
    errors.slice(0, 3).forEach((e) => console.log(`      x ${e}`));
    console.log(`  assist       p05 ${num(quantile([...assists].sort((a, b) => a - b), 0.05), 5, 3)}` +
      `  p50 ${num(quantile([...assists].sort((a, b) => a - b), 0.5), 5, 3)}` +
      `  p95 ${num(quantile([...assists].sort((a, b) => a - b), 0.95), 5, 3)}`);
    const g = spread(gains);
    console.log(`  windowGain   p05 ${num(g.p05, 5, 3)}  p50 ${num(g.p50, 5, 3)}  p95 ${num(g.p95, 5, 3)}` +
      `   spread ${num(g.ratio, 5, 2)}x   <- mechanism 2 (aSpan)`);
    console.log(`  language luminance spread ${num(languageLuma.ratio, 5, 2)}x` +
      `  (${num(languageLuma.min, 5, 3)} .. ${num(languageLuma.max, 5, 3)})   <- mechanism 5 (warmth)`);

    console.log(`  per language (>= 8 buildings):`);
    console.log(`    language      n   winLuma   gain p05..p95      spread   floorSpread p50`);
    for (const r of langRows.slice(0, 10)) {
      console.log(
        `    ${r.language.padEnd(12)}${String(r.count).padStart(4)}` +
          `   ${num(r.windowLuma, 6, 3)}   ${num(r.gain.p05, 5, 2)}..${num(r.gain.p95, 5, 2)}` +
          `     ${num(r.gain.ratio, 6, 2)}x        ${num(r.floorSpread.p50, 6, 2)}x`,
      );
    }

    report.push({
      key: fixture.key,
      repo: fixture.repo,
      note: fixture.note,
      status,
      errors: errors.length,
      sourceBuildings: source.length,
      assist: spread(assists),
      windowGain: g,
      languageLuma,
      languages: langRows,
    });
  } catch (error) {
    console.log(`  ${fixture.key.padEnd(9)} FAILED: ${String(error).slice(0, 200)}`);
    report.push({ key: fixture.key, repo: fixture.repo, failed: String(error).slice(0, 200) });
  } finally {
    await page.close();
  }
}

const outDir = join(ROOT, 'artifacts', 'measurements');
mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, 'brightness.json'), JSON.stringify(report, null, 2));
console.log(`\nwrote artifacts/measurements/brightness.json`);

await browser.close();
if (report.some((r) => r.failed)) process.exit(1);

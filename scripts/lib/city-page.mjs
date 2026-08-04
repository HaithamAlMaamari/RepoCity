/**
 * city-page.mjs — drive the app to a settled city, and prove which one it is.
 *
 * Both the capture and the measurement script used to do this inline, and both
 * had the same hole: they typed a repository, then waited for the status pill
 * to stop saying "building", then sampled. Nothing checked that the city on
 * screen was the city that was asked for. When a build silently failed to
 * start — a click landing before the input handler attached, a stale page, a
 * request the app dropped — the script measured whatever was already there and
 * reported it under the new label.
 *
 * That is not a hypothetical: a measurement run reported pallets/flask and
 * facebook/react as both having 3,883 source buildings (flask has ~230), with
 * react's status reading "poster downloaded." Two of three rows were the same
 * stale city, and nothing in the output said so.
 *
 * So the wait now keys on the sidebar's repository link, which `updateStats`
 * writes as "owner/name @ <sha>" only after a build completes. It is the one
 * element that names the city actually rendered.
 */

/** Long enough for the entrance camera to settle onto the resting pose. */
export const SETTLE_MS = 15_000;
/** A cold large repository (vscode, three.js) can legitimately take minutes. */
const BUILD_TIMEOUT_MS = 180_000;

const STILL_WORKING = /fetching|building|rebuilding|initial/i;

/**
 * Load `repo` and return once the city for that repository is built and the
 * camera has settled.
 *
 * The repository is requested through the app's own share hash rather than by
 * typing into the header input. Typing meant racing the auto-build the app
 * kicks off on load: the script had to guess how long to wait for that to
 * finish, and if it guessed short the click landed mid-build and the request
 * was dropped, leaving a completely unrelated city on screen. The hash is
 * declarative — the app reads it during startup — so there is no race to lose.
 * The seed is pinned for the same reason the commit is: a capture has to be
 * reproducible.
 *
 * @throws if the build fails, times out, or completes showing a different
 *         repository — never returns a page in an unverified state.
 */
export async function buildCityPage(page, baseUrl, repo, options = {}) {
  const settleMs = options.settleMs ?? SETTLE_MS;
  const seed = options.seed ?? '0';

  const url = `${baseUrl.replace(/\/$/, '')}/#repo=${encodeURIComponent(repo)}&seed=${seed}`;
  await page.goto(url, { waitUntil: 'load' });

  const started = Date.now();
  let status = '';
  let loaded = '';
  while (Date.now() - started < BUILD_TIMEOUT_MS) {
    status = (await page.textContent('#status').catch(() => '')) ?? '';
    loaded = (await page.textContent('#repo-branch').catch(() => '')) ?? '';
    if (namesRepo(loaded, repo) && !STILL_WORKING.test(status)) break;
    await page.waitForTimeout(500);
  }

  if (!namesRepo(loaded, repo)) {
    throw new Error(
      `page never rendered ${repo} (sidebar reads ${JSON.stringify(loaded.trim() || '<empty>')}, ` +
      `status ${JSON.stringify(status.trim())})`,
    );
  }

  const canonical = loaded.trim().split(' @ ')[0];
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(settleMs);
  return { status: status.trim(), loaded: loaded.trim(), canonical };
}

/**
 * Does the sidebar's "owner/name @ sha" link name this repository?
 *
 * Two allowances, both for things the app does deliberately:
 *
 *  - Case. GitHub canonicalises owner and repository casing, so a fixture
 *    written `pallets/flask` can legitimately return `pallets/Flask`.
 *  - Owner. GitHub redirects transferred repositories, and resolving to the
 *    canonical name is a product feature — `facebook/react` answers as
 *    `react/react` since the transfer. Requiring the requested owner rejected
 *    a correct build. The repository NAME still has to match, so this cannot
 *    accept an unrelated city.
 *
 * The " @ " is what makes this a proof rather than a substring coincidence:
 * the sha only appears once a build has completed.
 */
function namesRepo(sidebarText, repo) {
  const text = sidebarText.toLowerCase().trim();
  if (!text.includes(' @ ')) return false;
  if (text.startsWith(`${repo.toLowerCase()} @`)) return true;
  const loadedName = text.split(' @ ')[0].split('/').pop();
  return loadedName === repo.toLowerCase().split('/').pop();
}

/**
 * Hide the UI so a capture shows only the city.
 *
 * `display: none`, not opacity: the camera solver measures panels via
 * getClientRects and deliberately ignores opacity, so an opacity-hidden panel
 * still shrinks the free viewport and mis-frames the shot.
 */
export async function hideInterface(page) {
  await page.addStyleTag({
    content: `#topbar, .presets, #sidebar, #explore-panel, #info,
              #loading, .hint-row, .grain { display: none !important; }`,
  });
  // Let the solver observe the larger viewport and re-frame.
  await page.evaluate(() => window.dispatchEvent(new Event('resize')));
  await page.waitForTimeout(2500);
}

/** Collect page errors and console errors into one array for reporting. */
export function watchErrors(page) {
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e).slice(0, 200)));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text().slice(0, 200));
  });
  return errors;
}

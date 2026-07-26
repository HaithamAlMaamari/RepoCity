/**
 * repo.city — GitHub repos as neon cyberpunk cities.
 *
 * WebGL2 + EffectComposer(UnrealBloom) pipeline.
 * One custom building shader; every other effect uses
 * guaranteed-safe materials (MeshBasic + CanvasTextures).
 */

import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';

import { fetchRepoTree } from './data/github';
import type { FetchResult } from './data/github';
import { buildLayout } from './city/layout';
import type { LayoutCell } from './city/layout';
import { buildCity } from './city/city';
import type { CityData, Building } from './city/city';
import { buildRooftops } from './city/rooftops';
import type { Rooftops } from './city/rooftops';
import { buildDistrictRects, districtFootprint } from './city/districts';
import { languageColor, languageDisplayName } from './city/palette';
import { createFlythrough } from './core/camera';
import type { Flythrough } from './core/camera';
import { createSceneRandom } from './core/random';
import { DEFAULT_SCENE_SEED, parseSceneHash, serializeSceneHash } from './core/url-state';
import {
  buildSky, buildAtmosphere, buildStreetNetwork,
  buildTraffic, buildFlyingTraffic, buildEmbers, buildBillboards,
} from './effects';
import type {
  Sky, Atmosphere, StreetNetwork, TrafficStreaks,
  FlyingTraffic, Particles, Billboards, BillboardBlock,
} from './effects';

/* ═══ DOM ═══════════════════════════════════════════════ */
const canvas = document.getElementById('stage') as HTMLCanvasElement;
const repoInput = document.getElementById('repo') as HTMLInputElement;
const goBtn = document.getElementById('go') as HTMLButtonElement;
const captureBtn = document.getElementById('capture') as HTMLButtonElement;
const captureHeaderBtn = document.getElementById('capture-header') as HTMLButtonElement;
const statusEl = document.getElementById('status') as HTMLDivElement;
const loadingEl = document.getElementById('loading') as HTMLDivElement;
const noGpuEl = document.getElementById('no-gpu') as HTMLDivElement;

const sidebarEl = document.getElementById('sidebar') as HTMLElement;
const repoNameEl = document.getElementById('repo-name')!;
const repoBranchEl = document.getElementById('repo-branch')!;
const repoCoverageEl = document.getElementById('repo-coverage')!;
const languageLabelEl = document.getElementById('language-label')!;
const statFilesEl = document.getElementById('stat-files')!;
const statSizeEl = document.getElementById('stat-size')!;
const statDirsEl = document.getElementById('stat-dirs')!;
const statTallestEl = document.getElementById('stat-tallest')!;
const langBarsEl = document.getElementById('lang-bars')!;

const infoEl = document.getElementById('info') as HTMLElement;
const infoFilenameEl = document.getElementById('info-filename')!;
const infoPathEl = document.getElementById('info-path')!;
const infoSizeEl = document.getElementById('info-size')!;
const infoLangEl = document.getElementById('info-lang')!;

/* ═══ Renderer state ════════════════════════════════════ */
let renderer: THREE.WebGLRenderer;
let composer: EffectComposer;
let scene: THREE.Scene;
let camera: THREE.PerspectiveCamera;
let controls: OrbitControls;

/* ═══ City state (per repo) ═════════════════════════════ */
let cityData: CityData | null = null;
let rooftops: Rooftops | null = null;
let streetNet: StreetNetwork | null = null;
let traffic: TrafficStreaks | null = null;
let flying: FlyingTraffic | null = null;
let embers: Particles | null = null;
let billboards: Billboards | null = null;
let atmosphere: Atmosphere | null = null;
let sky: Sky | null = null;
let flythrough: Flythrough | null = null;
let activeResult: FetchResult | null = null;
let activeLoadController: AbortController | null = null;
let loadSequence = 0;
let activeSceneSeed = DEFAULT_SCENE_SEED;

/* ═══ Interaction state ═════════════════════════════════ */
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
const clock = new THREE.Clock();
let hoveredId = -1;
let lastInteraction = 0;

/* ═══ Init ══════════════════════════════════════════════ */
async function init(): Promise<void> {
  setStatus('initialising…', false, true);

  renderer = new THREE.WebGLRenderer({
    canvas, antialias: false, alpha: false,
    powerPreference: 'high-performance',
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.25));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setClearColor(0x0a0818);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.88;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  canvas.addEventListener('webglcontextlost', (event) => {
    event.preventDefault();
    noGpuEl.classList.add('visible');
    setStatus('WebGL context lost. Reload to restore the city.', true);
  });

  scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0x0a0818, 0.0032);

  /* lighting — 80% dark, neon accents carry the scene */
  scene.add(new THREE.AmbientLight(0x293052, 0.36));
  const moon = new THREE.DirectionalLight(0xbcc8ff, 0.38);
  moon.position.set(-0.4, 1, 0.25);
  scene.add(moon);
  const magentaRim = new THREE.PointLight(0xff2d8a, 0.28, 600, 1.6);
  magentaRim.position.set(120, 50, -90);
  scene.add(magentaRim);
  const cyanRim = new THREE.PointLight(0x00d4ff, 0.25, 600, 1.6);
  cyanRim.position.set(-120, 60, 90);
  scene.add(cyanRim);

  /* deterministic backdrop while repository identity is unresolved */
  sky = buildSky(createSceneRandom('repocity/loading', 'unresolved', DEFAULT_SCENE_SEED, 'sky'));
  scene.add(sky.group);

  /* camera */
  camera = new THREE.PerspectiveCamera(48, window.innerWidth / window.innerHeight, 0.1, 4000);
  camera.position.set(110, 60, 130);
  camera.lookAt(0, 6, 0);

  controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.minDistance = 6;
  controls.maxDistance = 700;
  controls.maxPolarAngle = Math.PI / 2 - 0.04;
  controls.target.set(0, 5, 0);
  const bump = () => { lastInteraction = clock.elapsedTime; };
  controls.addEventListener('start', bump);
  renderer.domElement.addEventListener('wheel', bump, { passive: true });

  /* post-processing */
  const renderPass = new RenderPass(scene, camera);
  const bloom = new UnrealBloomPass(
    new THREE.Vector2(window.innerWidth, window.innerHeight),
    0.62,  // strength: bloom only the brightest neon
    0.38,  // radius
    0.72,  // threshold: keep bodies and atmosphere out of bloom
  );
  const vignette = new ShaderPass({
    uniforms: { tDiffuse: { value: null } },
    vertexShader: `varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
    fragmentShader: `varying vec2 vUv; uniform sampler2D tDiffuse;
      void main(){
        vec4 c = texture2D(tDiffuse, vUv);
        float d = length(vUv - 0.5);
        float v = smoothstep(0.42, 0.86, d);
        gl_FragColor = mix(c, vec4(0.0,0.0,0.0,1.0), v * 0.42);
      }`,
  });
  const chroma = new ShaderPass({
    uniforms: { tDiffuse: { value: null } },
    vertexShader: `varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
    fragmentShader: `varying vec2 vUv; uniform sampler2D tDiffuse;
      void main(){
        vec2 cdir = vUv - 0.5;
        float d = length(cdir);
        vec2 off = normalize(cdir + 1e-6) * d * 0.012;
        float r = texture2D(tDiffuse, vUv + off).r;
        float g = texture2D(tDiffuse, vUv).g;
        float b = texture2D(tDiffuse, vUv - off).b;
        gl_FragColor = vec4(r, g, b, 1.0);
      }`,
  });
  composer = new EffectComposer(renderer);
  composer.addPass(renderPass);
  composer.addPass(bloom);
  composer.addPass(vignette);
  // Chromatic aberration is intentionally not in the default pipeline: it is
  // a full-screen pass with little scene value and costs performance on iGPUs.
  vignette.renderToScreen = true;

  /* events */
  goBtn.addEventListener('click', handleGo);
  repoInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') handleGo(); });
  captureBtn.addEventListener('click', capturePoster);
  captureHeaderBtn.addEventListener('click', capturePoster);
  window.addEventListener('resize', handleResize);
  window.addEventListener('hashchange', handleHashChange);
  canvas.addEventListener('pointermove', handlePointerMove);
  canvas.addEventListener('click', handleClick);
  canvas.addEventListener('pointerleave', () => setHovered(-1));

  renderer.setAnimationLoop(animate);
  setStatus('ready.');

  const initial = parseSceneHash(window.location.hash) ?? { repo: repoInput.value, seed: DEFAULT_SCENE_SEED };
  repoInput.value = initial.repo;
  await loadRepo(initial.repo, initial.commit, initial.seed, 'replace');
}

/* ═══ Repo loading ══════════════════════════════════════ */
async function handleGo(): Promise<void> {
  const raw = repoInput.value.trim();
  if (!raw) return;
  const repo = raw
    .replace(/^https?:\/\/github\.com\//, '')
    .replace(/\.git$/, '')
    .replace(/^\/+|\/+$/g, '');
  const parts = repo.split('/');
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    setStatus('format: owner/repo', true);
    return;
  }
  await loadRepo(repo, undefined, DEFAULT_SCENE_SEED, 'push');
}

async function loadRepo(
  repo: string,
  commit?: string,
  sceneSeed = DEFAULT_SCENE_SEED,
  historyMode: 'push' | 'replace' | 'none' = 'none',
  resolvedResult?: FetchResult,
): Promise<void> {
  const [owner, repoName] = repo.split('/');
  if (!owner || !repoName) return;
  const sequence = ++loadSequence;
  activeLoadController?.abort();
  const controller = new AbortController();
  activeLoadController = controller;

  goBtn.disabled = true;
  repoInput.disabled = true;
  captureBtn.disabled = true;
  captureHeaderBtn.disabled = true;
  loadingEl.classList.add('visible');

  try {
    setStatus(resolvedResult ? `rebuilding ${repo}…` : `fetching ${repo}…`, false, true);
    const result = resolvedResult ?? await fetchRepoTree({ owner, repo: repoName, commit, maxFiles: 5000, signal: controller.signal });
    if (controller.signal.aborted || sequence !== loadSequence) return;

    setStatus(`building city · ${result.selection.returnedFiles.toLocaleString()} files`, false, true);
    const cells = buildLayout(result.root, {
      width: 200, height: 200, padding: 0.35, depthScale: 0.3,
    }) as LayoutCell[];
    if (controller.signal.aborted || sequence !== loadSequence) return;

    teardown();

    const sceneIdentity = [result.repository.fullName, result.revision.commitSha, sceneSeed] as const;
    sky = buildSky(createSceneRandom(...sceneIdentity, 'sky'));
    scene.add(sky.group);

    /* ── buildings ── */
    cityData = buildCity(cells);
    const b = cityData.bounds;
    const cx = (b.minX + b.maxX) / 2;
    const cz = (b.minZ + b.maxZ) / 2;
    const citySize = Math.max(b.maxX - b.minX, b.maxZ - b.minZ);

    const cityRoot = new THREE.Group();
    cityRoot.name = 'cityRoot';
    cityRoot.position.set(-cx, 0, -cz);
    cityRoot.add(cityData.mesh);
    cityRoot.add(cityData.details.group);

    /* ── rooftop beacons ── */
    rooftops = buildRooftops(cityData.buildings, cityData.maxHeight);
    cityRoot.add(rooftops.group);

    /* ── streets ── */
    const districts = buildDistrictRects(cells);
    const footprint = districtFootprint(districts, b);
    streetNet = buildStreetNetwork(districts, footprint);
    cityRoot.add(streetNet.group);

    /* ── ground traffic ── */
    traffic = buildTraffic(streetNet.streets, createSceneRandom(...sceneIdentity, 'ground-traffic'));
    cityRoot.add(traffic.mesh);

    scene.add(cityRoot);

    /* ── flying traffic (world space, city is centered) ── */
    flying = buildFlyingTraffic(citySize, createSceneRandom(...sceneIdentity, 'flying-traffic'));
    scene.add(flying.mesh);

    /* ── atmosphere + particles + billboards ── */
    atmosphere = buildAtmosphere(citySize, cityData.maxHeight);
    scene.add(atmosphere.group);

    embers = buildEmbers(citySize, createSceneRandom(...sceneIdentity, 'embers'));
    scene.add(embers.points);

    const billboardBlocks: BillboardBlock[] = districts.map((rect) => {
      const languageBytes = new Map<string, number>();
      let height = 0;
      for (const building of cityData!.buildings) {
        const inside = building.position[0] >= rect.x &&
          building.position[0] <= rect.x + rect.w &&
          building.position[2] >= rect.z &&
          building.position[2] <= rect.z + rect.d;
        if (!inside) continue;
        languageBytes.set(building.language, (languageBytes.get(building.language) ?? 0) + building.size);
        height = Math.max(height, building.totalHeight);
      }
      const language = [...languageBytes.entries()].sort((a, z) => z[1] - a[1])[0]?.[0] ?? 'unknown';
      return {
        rect,
        name: rect.name ?? 'district',
        language,
        height,
      };
    });
    if (billboardBlocks.length === 0) {
      billboardBlocks.push({
        rect: { x: b.minX, z: b.minZ, w: b.maxX - b.minX, d: b.maxZ - b.minZ, depth: 0, name: result.repository.name },
        name: result.repository.name,
        language: cityData.buildings[0]?.language ?? 'unknown',
        height: cityData.maxHeight,
      });
    }
    billboards = buildBillboards(billboardBlocks);
    cityRoot.add(billboards.group);

    /* ── camera + UI ── */
    controls.maxDistance = Math.max(citySize * 3, 250);
    controls.target.set(0, 5, 0);
    flythrough = createFlythrough(camera, {
      minX: b.minX - cx, maxX: b.maxX - cx,
      minZ: b.minZ - cz, maxZ: b.maxZ - cz,
    });
    controls.enabled = false;

    activeResult = result;
    activeSceneSeed = sceneSeed;
    repoInput.value = result.repository.fullName;
    updateHash(result, sceneSeed, historyMode);
    updateStats(result, cityData.buildings);
    sidebarEl.classList.add('visible');
    captureBtn.disabled = false;
    captureHeaderBtn.disabled = false;
    const selectionLabel = result.coverage.selection === 'sampled'
      ? `${cells.length.toLocaleString()} buildings from a deterministic sample.`
      : `${cells.length.toLocaleString()} buildings rendered.`;
    setStatus(selectionLabel);
  } catch (err: unknown) {
    if (controller.signal.aborted || sequence !== loadSequence) return;
    console.error(err);
    setStatus((err as Error)?.message ?? 'unknown error', true);
  } finally {
    if (sequence === loadSequence) {
      activeLoadController = null;
      goBtn.disabled = false;
      repoInput.disabled = false;
      captureBtn.disabled = activeResult === null;
      captureHeaderBtn.disabled = activeResult === null;
      loadingEl.classList.remove('visible');
    }
  }
}

function handleHashChange(): void {
  const state = parseSceneHash(window.location.hash);
  if (!state) return;
  const sameRevision = activeResult?.repository.fullName === state.repo && activeResult.revision.commitSha === state.commit;
  if (sameRevision && activeSceneSeed === state.seed) return;
  repoInput.value = state.repo;
  void loadRepo(state.repo, state.commit, state.seed, 'none', sameRevision ? activeResult ?? undefined : undefined);
}

function updateHash(result: FetchResult, sceneSeed: string, mode: 'push' | 'replace' | 'none'): void {
  if (mode === 'none') return;
  const hash = serializeSceneHash({
    repo: result.repository.fullName,
    commit: result.revision.commitSha,
    seed: sceneSeed,
  });
  const url = `${window.location.pathname}${window.location.search}#${hash}`;
  if (mode === 'push') history.pushState(null, '', url);
  else history.replaceState(null, '', url);
}

function teardown(): void {
  const root = scene.getObjectByName('cityRoot');
  if (root) scene.remove(root);

  if (cityData) { cityData.dispose(); cityData = null; }
  if (rooftops) { rooftops.dispose(); rooftops = null; }
  if (streetNet) { streetNet.dispose(); streetNet = null; }
  if (traffic) { traffic.dispose(); traffic = null; }
  if (flying) { scene.remove(flying.mesh); flying.dispose(); flying = null; }
  if (embers) { scene.remove(embers.points); embers.dispose(); embers = null; }
  if (billboards) { scene.remove(billboards.group); billboards.dispose(); billboards = null; }
  if (atmosphere) { scene.remove(atmosphere.group); atmosphere.dispose(); atmosphere = null; }
  if (sky) { scene.remove(sky.group); sky.dispose(); sky = null; }
  setHovered(-1);
  setSelected(-1);
  hideInfo();
}

/* ═══ Render loop ═══════════════════════════════════════ */
function animate(): void {
  const dt = Math.min(clock.getDelta(), 0.1);

  if (flythrough) {
    const active = flythrough.update(dt);
    if (!active) {
      controls.target.copy(flythrough.getOrbitTarget());
      controls.enabled = true;
      lastInteraction = clock.elapsedTime;
      flythrough = null;
    }
  } else if (controls.enabled) {
    controls.update();
    /* idle drift — slow orbit after 3s of no interaction */
    const idle = clock.elapsedTime - lastInteraction;
    const ramp = Math.max(0, Math.min(1, (idle - 3) / 2));
    if (ramp > 0) {
      const ang = dt * 0.05 * ramp;
      const dx = camera.position.x - controls.target.x;
      const dz = camera.position.z - controls.target.z;
      const cos = Math.cos(ang), sin = Math.sin(ang);
      camera.position.x = controls.target.x + dx * cos - dz * sin;
      camera.position.z = controls.target.z + dx * sin + dz * cos;
      camera.lookAt(controls.target);
    }
  }

  cityData?.update(dt);
  rooftops?.update(dt);
  traffic?.update(dt);
  flying?.update(dt);
  embers?.update(dt);
  billboards?.update(dt);
  atmosphere?.update(dt);
  sky?.update(dt);

  composer.render();
}

/* ═══ Picking ═══════════════════════════════════════════ */
function pick(event: { clientX: number; clientY: number }): number {
  if (!cityData) return -1;
  pointer.x = (event.clientX / window.innerWidth) * 2 - 1;
  pointer.y = -(event.clientY / window.innerHeight) * 2 + 1;
  raycaster.setFromCamera(pointer, camera);
  const hits = raycaster.intersectObject(cityData.mesh);
  return hits.length > 0 && hits[0].instanceId !== undefined ? hits[0].instanceId : -1;
}

function handlePointerMove(e: PointerEvent): void {
  const id = pick(e);
  if (id !== hoveredId) {
    setHovered(id);
    canvas.style.cursor = id >= 0 ? 'pointer' : 'default';
  }
}

function handleClick(e: MouseEvent): void {
  if (e.button !== 0) return;
  const id = pick(e);
  if (id >= 0 && cityData) {
    setSelected(id);
    showInfo(cityData.buildings[id]);
  } else {
    setSelected(-1);
    hideInfo();
  }
  lastInteraction = clock.elapsedTime;
}

function setHovered(id: number): void { hoveredId = id; cityData?.setHovered(id); }
function setSelected(id: number): void { cityData?.setSelected(id); }

function showInfo(b: Building): void {
  const filename = b.path.split('/').pop() ?? b.path;
  const dir = b.path.slice(0, b.path.length - filename.length).replace(/\/$/, '');
  infoFilenameEl.textContent = filename;
  infoPathEl.textContent = dir || '/';
  infoSizeEl.textContent = formatSize(b.size);
  const lang = b.language;
  const [r, g, bl] = languageColor(lang);
  const hex = rgbToHex(r, g, bl);
  const swatch = document.createElement('span');
  swatch.className = 'swatch';
  swatch.style.background = hex;
  swatch.style.color = hex;
  infoLangEl.replaceChildren(swatch, document.createTextNode(languageDisplayName(lang)));
  (infoLangEl as HTMLElement).style.color = hex;
  infoEl.classList.add('visible');
}
function hideInfo(): void { infoEl.classList.remove('visible'); }

/* ═══ Sidebar stats ═════════════════════════════════════ */
function updateStats(result: FetchResult, buildings: Building[]): void {
  repoNameEl.textContent = result.repository.name;
  const repoLink = document.createElement('a');
  repoLink.href = `${result.repository.htmlUrl}/tree/${result.revision.commitSha}`;
  repoLink.target = '_blank';
  repoLink.rel = 'noopener';
  repoLink.title = result.revision.commitSha;
  repoLink.textContent = `${result.repository.fullName} @ ${result.revision.commitSha.slice(0, 12)} ↗`;
  repoBranchEl.replaceChildren(repoLink);

  repoCoverageEl.textContent = result.coverage.selection === 'sampled'
    ? `complete tree · ${result.selection.returnedFiles.toLocaleString()} selected of ${result.totals.files.toLocaleString()} files · ${buildings.length.toLocaleString()} rendered`
    : `complete tree · ${result.totals.files.toLocaleString()} files selected · ${buildings.length.toLocaleString()} rendered`;

  let tallest: Building | null = null;
  for (const b of buildings) {
    if (!tallest || b.totalHeight > tallest.totalHeight) tallest = b;
  }
  statFilesEl.textContent = result.totals.files.toLocaleString();
  statSizeEl.textContent = formatSize(result.totals.bytes);
  statDirsEl.textContent = result.totals.directories.toLocaleString();
  statTallestEl.textContent = tallest ? truncate(tallest.path.split('/').pop() ?? '', 20) : '—';

  const useBytes = result.totals.bytes > 0;
  const denominator = useBytes ? result.totals.bytes : Math.max(1, result.totals.files);
  const sorted = result.languages
    .map((item) => ({ ...item, value: useBytes ? item.bytes : item.files }))
    .sort((a, z) => z.value - a.value || a.language.localeCompare(z.language));
  const displayed = sorted.slice(0, 5);
  const omitted = sorted.slice(5);
  if (omitted.length > 0) {
    displayed.push({
      language: 'other',
      files: omitted.reduce((sum, item) => sum + item.files, 0),
      bytes: omitted.reduce((sum, item) => sum + item.bytes, 0),
      value: omitted.reduce((sum, item) => sum + item.value, 0),
    });
  }
  languageLabelEl.textContent = useBytes ? 'languages · repository bytes' : 'languages · file count';
  langBarsEl.replaceChildren();
  for (const item of displayed) {
    const lang = item.language;
    const pct = (item.value / denominator) * 100;
    const [r, g, b] = languageColor(lang);
    const hex = rgbToHex(r, g, b);
    const row = document.createElement('div');
    row.className = 'lang-bar';
    row.style.color = hex;
    const swatch = document.createElement('span');
    swatch.className = 'swatch';
    swatch.style.background = hex;
    const name = document.createElement('span');
    name.className = 'name';
    name.textContent = languageDisplayName(lang);
    const track = document.createElement('span');
    track.className = 'track';
    const fill = document.createElement('span');
    fill.className = 'fill';
    fill.style.width = `${pct.toFixed(1)}%`;
    track.appendChild(fill);
    const percentage = document.createElement('span');
    percentage.className = 'pct';
    percentage.textContent = `${pct.toFixed(0)}%`;
    row.append(swatch, name, track, percentage);
    langBarsEl.appendChild(row);
  }
}

/* ═══ Poster capture ════════════════════════════════════ */
async function capturePoster(): Promise<void> {
  if (!renderer) return;
  const W = 1920, H = 1080;
  const prev = new THREE.Vector2();
  renderer.getSize(prev);
  const prevAspect = camera.aspect;
  try {
    captureBtn.disabled = true;
    captureHeaderBtn.disabled = true;
    setStatus('capturing…', false, true);
    camera.aspect = W / H;
    camera.updateProjectionMatrix();
    renderer.setSize(W, H, false);
    composer.setSize(W, H);
    composer.render();

    const out = document.createElement('canvas');
    out.width = W; out.height = H;
    const ctx = out.getContext('2d')!;
    ctx.drawImage(renderer.domElement, 0, 0, W, H);
    const grad = ctx.createLinearGradient(0, H * 0.55, 0, H);
    grad.addColorStop(0, 'rgba(10,8,24,0)');
    grad.addColorStop(1, 'rgba(10,8,24,0.95)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, H * 0.55, W, H * 0.45);
    ctx.fillStyle = '#ffb347';
    ctx.font = '600 14px "JetBrains Mono", monospace';
    ctx.fillText('REPO.CITY', 80, H - 250);
    ctx.fillStyle = '#ece7dd';
    ctx.font = 'italic 500 72px "Fraunces", serif';
    const posterRepo = activeResult?.repository.fullName ?? 'repo.city';
    ctx.fillText(posterRepo, 80, H - 160);
    ctx.fillStyle = '#b6b1a4';
    ctx.font = '500 18px "JetBrains Mono", monospace';
    const revision = activeResult?.revision.commitSha.slice(0, 12) ?? 'unknown';
    const coverage = activeResult?.coverage.selection === 'sampled' ? 'sampled' : 'complete';
    ctx.fillText(`${cityData?.buildings.length ?? 0} buildings · ${coverage} · ${revision} · seed ${activeSceneSeed}`, 80, H - 110);

    out.toBlob((blob) => {
      if (!blob) {
        setStatus('capture failed.', true);
        return;
      }
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `repo-city-${posterRepo.replace(/\//g, '-')}-${revision}-seed-${activeSceneSeed}.png`;
      a.click();
      URL.revokeObjectURL(url);
      setStatus('poster downloaded.');
    }, 'image/png');
  } catch (err) {
    console.error(err);
    setStatus('capture failed.', true);
  } finally {
    camera.aspect = prevAspect;
    camera.updateProjectionMatrix();
    renderer.setSize(prev.x, prev.y, false);
    composer.setSize(prev.x, prev.y);
    captureBtn.disabled = false;
    captureHeaderBtn.disabled = false;
  }
}

/* ═══ Resize / helpers ══════════════════════════════════ */
function handleResize(): void {
  if (!renderer || !camera) return;
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h);
  composer.setSize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}

function setStatus(msg: string, isErr = false, pulse = false): void {
  statusEl.textContent = msg;
  statusEl.classList.toggle('err', isErr);
  statusEl.classList.toggle('pulse', pulse && !isErr);
}

function formatSize(bytes: number): string {
  if (bytes === 0) return '0 B';
  const u = ['B', 'KB', 'MB', 'GB'];
  const i = Math.min(Math.floor(Math.log10(bytes) / 3), 3);
  return `${(bytes / Math.pow(1000, i)).toFixed(i === 0 ? 0 : 1)} ${u[i]}`;
}
function rgbToHex(r: number, g: number, b: number): string {
  const c = (n: number) => Math.max(0, Math.min(255, Math.round(n * 255))).toString(16).padStart(2, '0');
  return `#${c(r)}${c(g)}${c(b)}`;
}
function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

window.addEventListener('error', (e) => {
  console.error('[error]', e.error ?? e.message);
  try { setStatus(`error: ${e.message}`, true); } catch { /* noop */ }
});
window.addEventListener('unhandledrejection', (e) => {
  console.error('[unhandled]', e.reason);
  try { setStatus(`error: ${(e.reason as Error)?.message ?? String(e.reason)}`, true); } catch { /* noop */ }
});

init().catch((err) => {
  console.error('[init] fatal:', err);
  noGpuEl.classList.add('visible');
  loadingEl.classList.remove('visible');
  try { setStatus(`init failed: ${(err as Error)?.message ?? String(err)}`, true); } catch { /* noop */ }
});

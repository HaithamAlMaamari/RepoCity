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
import { buildLayout, repositoryLandSize } from './city/layout';
import { buildCity, tallestSourceBuilding } from './city/city';
import type { CityData, Building } from './city/city';
import { buildRooftops } from './city/rooftops';
import type { Rooftops } from './city/rooftops';
import { buildDistrictRects, districtFootprint } from './city/districts';
import { probeBrightness } from './city/brightness-probe';
import { languageColor, languageDisplayName } from './city/palette';
import { cityRadius, createCityCameraRig, freeViewportFromRects, measureFreeViewport } from './core/camera';
import type { CityCameraRig, FreeViewport } from './core/camera';
import { createSceneRandom } from './core/random';
import { DEFAULT_SCENE_SEED, parseSceneHash, serializeSceneHash } from './core/url-state';
import type { SceneHashState } from './core/url-state';
import { buildExplorerModel, deriveExplorerView, visibleExplorerNodes } from './explore/explorer-model';
import type { ExplorerFilterState, ExplorerModel, ExplorerNode, ExplorerView } from './explore/explorer-model';
import {
  buildSky, NIGHT_COLOR, buildAtmosphere, buildStreetNetwork,
  buildTraffic, buildFlyingTraffic, buildEmbers, buildBillboards,
} from './effects';
import type {
  Sky, Atmosphere, StreetNetwork, TrafficStreaks,
  FlyingTraffic, Particles, Billboards, BillboardBlock,
} from './effects';

/* ═══ DOM ═══════════════════════════════════════════════ */
const canvas = document.getElementById('stage') as HTMLCanvasElement;
const headerEl = document.getElementById('topbar')!;
const presetChips = document.querySelectorAll<HTMLButtonElement>('.presets .chip');
const repoInput = document.getElementById('repo') as HTMLInputElement;
const goBtn = document.getElementById('go') as HTMLButtonElement;
const captureBtn = document.getElementById('capture') as HTMLButtonElement;
const captureHeaderBtn = document.getElementById('capture-header') as HTMLButtonElement;
const statusEl = document.getElementById('status') as HTMLDivElement;
const loadingEl = document.getElementById('loading') as HTMLDivElement;
const noGpuEl = document.getElementById('no-gpu') as HTMLDivElement;

const sidebarEl = document.getElementById('sidebar')!;
const repoNameEl = document.getElementById('repo-name')!;
const repoBranchEl = document.getElementById('repo-branch')!;
const repoCoverageEl = document.getElementById('repo-coverage')!;
const languageLabelEl = document.getElementById('language-label')!;
const statFilesEl = document.getElementById('stat-files')!;
const statSizeEl = document.getElementById('stat-size')!;
const statDirsEl = document.getElementById('stat-dirs')!;
const statTallestEl = document.getElementById('stat-tallest')!;
const langBarsEl = document.getElementById('lang-bars')!;

const infoEl = document.getElementById('info')!;
const infoFilenameEl = document.getElementById('info-filename')!;
const infoPathEl = document.getElementById('info-path')!;
const infoSizeEl = document.getElementById('info-size')!;
const infoLangEl = document.getElementById('info-lang')!;
const explorerPanelEl = document.getElementById('explore-panel')!;
const explorerToggleEl = document.getElementById('explorer-toggle') as HTMLButtonElement;
const summaryToggleEl = document.getElementById('summary-toggle') as HTMLButtonElement;
const explorerCoverageEl = document.getElementById('explorer-coverage')!;
const repoTreeEl = document.getElementById('repo-tree') as HTMLUListElement;
const treeEmptyEl = document.getElementById('tree-empty') as HTMLParagraphElement;
const selectionStatusEl = document.getElementById('selection-status')!;
const focusBuildingEl = document.getElementById('focus-building') as HTMLButtonElement;
const copyPathEl = document.getElementById('copy-path') as HTMLButtonElement;
const openFileEl = document.getElementById('open-file') as HTMLAnchorElement;
const explorerQueryEl = document.getElementById('explorer-query') as HTMLInputElement;
const explorerDistrictEl = document.getElementById('explorer-district') as HTMLSelectElement;
const explorerLanguageEl = document.getElementById('explorer-language') as HTMLSelectElement;
const explorerSizeEl = document.getElementById('explorer-size') as HTMLSelectElement;
const explorerSortEl = document.getElementById('explorer-sort') as HTMLSelectElement;
const explorerResultsEl = document.getElementById('explorer-results')!;
const explorerBreadcrumbsEl = document.getElementById('explorer-breadcrumbs')!;
const mobileExplorerMedia = window.matchMedia('(max-width: 720px)');
const reducedMotionMedia = window.matchMedia('(prefers-reduced-motion: reduce)');
let explorerUserToggled = false;
let summaryUserToggled = false;
syncExplorerForViewport();
syncSummaryForViewport();

/* ═══ World scale ═══════════════════════════════════════
 *
 * The city's ground now grows with the repository — land area is proportional
 * to file count, which is what keeps a building's proportions the same at 13
 * files and at 5,000. It also means the world is no longer a fixed size, so
 * every constant expressed in absolute world units has to be derived from it
 * rather than written down. Fog density is the one that fails loudest: it is
 * per-unit-distance, so a city four times wider at a fixed density dissolves
 * into a white-out well before its far edge.
 *
 * These are the values for a city of REFERENCE_CITY_SIZE, which is the scale
 * everything downstream — FOG_CEILING in the facade shader, the rim placement,
 * the entrance camera — was originally tuned against.
 */
const REFERENCE_CITY_SIZE = 240;
const FOG_DENSITY_AT_REFERENCE = 0.0032;
const CAMERA_FAR_AT_REFERENCE = 4000;

/* ═══ Renderer state ════════════════════════════════════ */
let renderer: THREE.WebGLRenderer;
let magentaRim: THREE.PointLight;
let cyanRim: THREE.PointLight;
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
let cityCamera: CityCameraRig | null = null;
let framingRefreshTimer = 0;
let activeResult: FetchResult | null = null;
let activeLoadController: AbortController | null = null;
let loadSequence = 0;
let activeSceneSeed = DEFAULT_SCENE_SEED;
let explorerModel: ExplorerModel | null = null;
let explorerView: ExplorerView | null = null;
let explorerState: ExplorerFilterState = { query: '', district: '', language: '', size: 'all', sort: 'layout' };
let explorerQueryTimer = 0;
const expandedPaths = new Set<string>();
let activeTreePath = '';
let selectedBuildingId = -1;
let cityOffsetX = 0;
let cityOffsetZ = 0;

/* ═══ Interaction state ═════════════════════════════════ */
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
const pickHits: THREE.Intersection[] = [];
const clock = new THREE.Clock();
let hoveredId = -1;
let pendingPointerX = 0;
let pendingPointerY = 0;
let pointerPickPending = false;
let pointerInside = false;
let orbiting = false;
let resizePending = false;
let appliedWidth = 0;
let appliedHeight = 0;
let appliedPixelRatio = 0;
let motionAccumulator = 0;
let pixelRatioCheckAccumulator = 0;
/** Last non-error status, restored when a failure notice is dismissed. */
let lastHealthyStatus = 'ready.';
const MAX_RENDER_PIXELS = 3840 * 2160;
const MOTION_STEP = 1 / 120;

/* ═══ Init ══════════════════════════════════════════════ */
async function init(): Promise<void> {
  setStatus('initialising…', false, true);

  renderer = new THREE.WebGLRenderer({
    canvas, antialias: false, alpha: false,
    powerPreference: 'high-performance',
  });
  appliedPixelRatio = calculatePixelRatio(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(appliedPixelRatio);
  renderer.setSize(window.innerWidth, window.innerHeight);
  appliedWidth = window.innerWidth;
  appliedHeight = window.innerHeight;
  renderer.setClearColor(NIGHT_COLOR);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.88;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  canvas.addEventListener('webglcontextlost', (event) => {
    event.preventDefault();
    noGpuEl.classList.add('visible');
    setStatus('WebGL context lost. Reload to restore the city.', true);
  });

  scene = new THREE.Scene();
  /*
   * The far ground now respects this fog (see atmosphere.ts), which is what
   * dissolves the horizon instead of ending the world in a hard line. Density
   * is normalised against city size in `applyWorldScale` — the number here is
   * the value for a REFERENCE_CITY_SIZE city, which is what the facade
   * shader's FOG_CEILING was tuned against.
   */
  scene.fog = new THREE.FogExp2(NIGHT_COLOR, FOG_DENSITY_AT_REFERENCE);

  /* lighting — 80% dark, neon accents carry the scene */
  scene.add(new THREE.AmbientLight(0x293052, 0.36));
  const moon = new THREE.DirectionalLight(0xbcc8ff, 0.38);
  moon.position.set(-0.4, 1, 0.25);
  scene.add(moon);
  magentaRim = new THREE.PointLight(0xff2d8a, 0.28, 600, 1.6);
  magentaRim.position.set(120, 50, -90);
  scene.add(magentaRim);
  cyanRim = new THREE.PointLight(0x00d4ff, 0.25, 600, 1.6);
  cyanRim.position.set(-120, 60, 90);
  scene.add(cyanRim);

  /* deterministic backdrop while repository identity is unresolved */
  sky = buildSky(createSceneRandom('repocity/loading', 'unresolved', DEFAULT_SCENE_SEED, 'sky'));
  scene.add(sky.group);

  /* camera */
  camera = new THREE.PerspectiveCamera(48, window.innerWidth / window.innerHeight, 0.1, CAMERA_FAR_AT_REFERENCE);
  camera.position.set(110, 60, 130);
  camera.lookAt(0, 6, 0);

  controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.minDistance = 6;
  controls.maxDistance = 700;
  controls.maxPolarAngle = Math.PI / 2 - 0.04;
  controls.target.set(0, 5, 0);
  controls.addEventListener('start', () => {
    orbiting = true;
    pointerPickPending = false;
    updateHoveredBuilding(-1);
    noteCameraInteraction();
  });
  controls.addEventListener('end', () => {
    orbiting = false;
    pointerPickPending = pointerInside;
  });
  renderer.domElement.addEventListener('wheel', noteCameraInteraction, { passive: true });
  renderer.domElement.addEventListener('pointerdown', noteCameraInteraction);
  window.addEventListener('keydown', handleGlobalKeydown);

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
  composer = new EffectComposer(renderer);
  composer.addPass(renderPass);
  composer.addPass(bloom);
  composer.addPass(vignette);
  vignette.renderToScreen = true;

  /* events */
  goBtn.addEventListener('click', handleGo);
  repoInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') void handleGo(); });
  captureBtn.addEventListener('click', capturePoster);
  captureHeaderBtn.addEventListener('click', capturePoster);
  window.addEventListener('resize', scheduleResize);
  window.addEventListener('hashchange', handleHashChange);
  document.addEventListener('visibilitychange', () => {
    clock.getDelta();
    motionAccumulator = 0;
  });
  canvas.addEventListener('pointermove', handlePointerMove);
  canvas.addEventListener('click', handleClick);
  canvas.addEventListener('pointerleave', handlePointerLeave);
  explorerToggleEl.addEventListener('click', toggleExplorer);
  mobileExplorerMedia.addEventListener('change', syncExplorerForViewport);
  summaryToggleEl.addEventListener('click', toggleSummary);
  mobileExplorerMedia.addEventListener('change', syncSummaryForViewport);
  mobileExplorerMedia.addEventListener('change', scheduleFramingRefresh);
  repoTreeEl.addEventListener('keydown', handleTreeKeydown);
  repoTreeEl.addEventListener('click', handleTreeClick);
  focusBuildingEl.addEventListener('click', focusSelectedBuilding);
  copyPathEl.addEventListener('click', copySelectedPath);
  explorerQueryEl.addEventListener('input', handleExplorerQueryInput);
  explorerDistrictEl.addEventListener('change', readExplorerControls);
  explorerLanguageEl.addEventListener('change', readExplorerControls);
  explorerSizeEl.addEventListener('change', readExplorerControls);
  explorerSortEl.addEventListener('change', readExplorerControls);
  explorerBreadcrumbsEl.addEventListener('click', handleBreadcrumbClick);
  for (const chip of presetChips) chip.addEventListener('click', () => handlePresetChip(chip));

  renderer.setAnimationLoop(animate);
  setStatus('ready.');

  const initial = parseSceneHash(window.location.hash) ?? { repo: repoInput.value, seed: DEFAULT_SCENE_SEED };
  setExplorerStateFromHash(initial);
  repoInput.value = initial.repo;
  await loadRepo(initial.repo, initial.commit, initial.seed, initial.file, 'replace');
}

/* ═══ Repo loading ══════════════════════════════════════ */
function handlePresetChip(chip: HTMLButtonElement): void {
  const repo = chip.dataset.repo;
  if (!repo) return;
  repoInput.value = repo;
  void handleGo();
}

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
  await loadRepo(repo, undefined, DEFAULT_SCENE_SEED, undefined, 'push', undefined, { repo, seed: DEFAULT_SCENE_SEED });
}

async function loadRepo(
  repo: string,
  commit?: string,
  sceneSeed = DEFAULT_SCENE_SEED,
  requestedFile?: string,
  historyMode: 'push' | 'replace' | 'none' = 'none',
  resolvedResult?: FetchResult,
  requestedExplorerState?: SceneHashState,
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
    // Construction below runs as one synchronous block -- measured at ~325ms on
    // a desktop GPU and ~1.1s on a 6x-throttled CPU for microsoft/vscode. That
    // is short enough not to need chunking, but long enough to swallow the
    // status update above if we do not let the browser paint first.
    await nextPaint();
    if (controller.signal.aborted || sequence !== loadSequence) return;

    const landSize = repositoryLandSize(result.selection.returnedFiles);
    // The four units are the margin the perimeter ring runs in; the treemap
    // gets everything inside it.
    const layoutSize = landSize - 4;
    const { cells, corridors } = buildLayout(result.root, {
      width: layoutSize, height: layoutSize,
    });
    if (controller.signal.aborted || sequence !== loadSequence) return;

    teardown();

    const sceneIdentity = [result.repository.fullName, result.revision.commitSha, sceneSeed] as const;
    const vehiclePalette = [...result.languages]
      .sort((a, b) => b.bytes - a.bytes || (a.language < b.language ? -1 : 1))
      .slice(0, 4)
      .flatMap((entry, index) => Array.from({ length: 4 - index }, () => languageColor(entry.language)));
    sky = buildSky(createSceneRandom(...sceneIdentity, 'sky'));
    scene.add(sky.group);

    /* ── buildings ── */
    cityData = buildCity(cells);
    const b = cityData.bounds;
    const cx = (b.minX + b.maxX) / 2;
    const cz = (b.minZ + b.maxZ) / 2;
    cityOffsetX = -cx;
    cityOffsetZ = -cz;
    const citySize = Math.max(b.maxX - b.minX, b.maxZ - b.minZ);
    applyWorldScale(citySize);

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
    const plots = cells.map((cell) => ({ x: cell.rect.x, z: cell.rect.y, w: cell.rect.w, d: cell.rect.h }));
    streetNet = buildStreetNetwork(districts, footprint, plots, corridors);
    cityRoot.add(streetNet.group);

    /* ── ground traffic ── */
    const groundTrafficCount = Math.min(60, Math.max(4, Math.ceil(cityData.buildings.length * 0.9)));
    traffic = buildTraffic(streetNet.streets, createSceneRandom(...sceneIdentity, 'ground-traffic'), groundTrafficCount, vehiclePalette);
    cityRoot.add(traffic.mesh);

    scene.add(cityRoot);

    /* ── flying traffic follows parcel-cleared street canyons ── */
    const flyingTrafficCount = Math.min(48, Math.max(2, Math.ceil(cityData.buildings.length * 0.65)));
    flying = buildFlyingTraffic(streetNet.streets, cityData.maxHeight, createSceneRandom(...sceneIdentity, 'flying-traffic'), flyingTrafficCount, vehiclePalette);
    cityRoot.add(flying.mesh);

    /* ── atmosphere + particles + billboards ── */
    atmosphere = buildAtmosphere(citySize, cityData.maxHeight);
    scene.add(atmosphere.group);

    embers = buildEmbers(citySize, createSceneRandom(...sceneIdentity, 'embers'));
    scene.add(embers.points);

    const billboardDistricts = [...districts];
    const rootCells = cells.filter((cell) => !cell.node.path.includes('/'));
    if (rootCells.length > 0) {
      const rootBounds = rootCells.reduce((bounds, cell) => ({
        minX: Math.min(bounds.minX, cell.rect.x),
        minZ: Math.min(bounds.minZ, cell.rect.y),
        maxX: Math.max(bounds.maxX, cell.rect.x + cell.rect.w),
        maxZ: Math.max(bounds.maxZ, cell.rect.y + cell.rect.h),
      }), { minX: Infinity, minZ: Infinity, maxX: -Infinity, maxZ: -Infinity });
      billboardDistricts.push({
        x: rootBounds.minX,
        z: rootBounds.minZ,
        w: rootBounds.maxX - rootBounds.minX,
        d: rootBounds.maxZ - rootBounds.minZ,
        depth: 0,
        name: 'repository root',
      });
    }
    const billboardBlocks: BillboardBlock[] = billboardDistricts.map((rect) => {
      const languageBytes = new Map<string, number>();
      let height = 0;
      for (const building of cityData!.buildings) {
        if (rect.depth === 0 && building.path.includes('/')) continue;
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
    cityCamera = createCityCameraRig({
      camera,
      orbitTarget: controls.target,
      buildings: cityData.buildings,
      offsetX: cityOffsetX,
      offsetZ: cityOffsetZ,
      viewport: freeViewport,
      random: createSceneRandom(...sceneIdentity, 'camera'),
      reducedMotion: reducedMotionMedia.matches,
    });
    controls.maxDistance = Math.max(citySize * 3, cityCamera.framing.distance * 1.6, 250);
    controls.enabled = !cityCamera.entranceActive;
    if (import.meta.env.DEV) {
      logFraming(cityCamera);
      exposeMeasurementHandle();
    }
    billboards.update(camera, appliedHeight || window.innerHeight);
    renderer.compile(scene, camera);
    composer.render(0);
    clock.getDelta();
    motionAccumulator = 0;

    activeResult = result;
    activeSceneSeed = sceneSeed;
    if (requestedExplorerState) setExplorerStateFromHash(requestedExplorerState);
    repoInput.value = result.repository.fullName;
    renderExplorer(result, cityData.buildings);
    const candidateId = requestedFile ? explorerModel?.buildingIdByPath.get(requestedFile) : undefined;
    const requestedId = candidateId !== undefined && explorerView?.matchMask[candidateId] === 1 ? candidateId : undefined;
    if (requestedId !== undefined) selectBuilding(requestedId, { focusCamera: true, updateUrl: false, announce: false });
    const resolvedHistoryMode = historyMode === 'none' && requestedFile && requestedId === undefined ? 'replace' : historyMode;
    updateHash(result, sceneSeed, requestedId === undefined ? undefined : requestedFile, resolvedHistoryMode);
    updateStats(result, cityData.buildings);
    sidebarEl.classList.add('visible');
    /* stats reflow the sidebar; recompose once the panel has settled */
    scheduleFramingRefresh();
    captureBtn.disabled = false;
    captureHeaderBtn.disabled = false;
    const buildingLabel = cells.length === 1 ? 'building' : 'buildings';
    const selectionLabel = result.coverage.selection === 'sampled'
      ? `${cells.length.toLocaleString()} ${buildingLabel} from a deterministic sample.`
      : `${cells.length.toLocaleString()} ${buildingLabel} rendered.`;
    setStatus(selectionLabel);
  } catch (err: unknown) {
    if (controller.signal.aborted || sequence !== loadSequence) return;
    console.error(err);
    const message = (err as Error)?.message ?? 'unknown error';
    /* the typed repository stays in the input: the user decides what to fix */
    if (activeResult && cityData) {
      const selectedPath = cityData.buildings[selectedBuildingId]?.path;
      replaceSelectionHash(selectedPath);
      setStatus(`Could not load ${repo}; still showing ${activeResult.repository.fullName}.`, true, false, message);
    } else {
      setStatus(`Could not load ${repo}.`, true, false, message);
    }
    /* the status pill is itself a live region — announcing again would double up */
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
  if (sameRevision && activeSceneSeed === state.seed) {
    if (activeLoadController) {
      activeLoadController.abort();
      activeLoadController = null;
      loadSequence++;
      goBtn.disabled = false;
      repoInput.disabled = false;
      captureBtn.disabled = false;
      captureHeaderBtn.disabled = false;
      loadingEl.classList.remove('visible');
      repoInput.value = activeResult!.repository.fullName;
      const rendered = cityData?.buildings.length ?? 0;
      setStatus(activeResult!.coverage.selection === 'sampled'
        ? `${rendered.toLocaleString()} buildings from a deterministic sample.`
        : `${rendered.toLocaleString()} buildings rendered.`);
    }
    setExplorerStateFromHash(state);
    applyExplorerFilters(false);
    const candidateId = state.file ? explorerModel?.buildingIdByPath.get(state.file) : undefined;
    const id = candidateId !== undefined && explorerView?.matchMask[candidateId] === 1 ? candidateId : undefined;
    if (id === undefined) {
      clearSelection(true);
      if (state.file) selectionStatusEl.textContent = 'The requested file is not rendered in this city.';
    }
    else if (id !== selectedBuildingId) selectBuilding(id, { focusCamera: true, updateUrl: false, announce: false });
    replaceSelectionHash(id === undefined ? undefined : state.file);
    return;
  }
  repoInput.value = state.repo;
  void loadRepo(state.repo, state.commit, state.seed, state.file, state.commit ? 'none' : 'replace', sameRevision ? activeResult ?? undefined : undefined, state);
}

function updateHash(result: FetchResult, sceneSeed: string, file: string | undefined, mode: 'push' | 'replace' | 'none'): void {
  if (mode === 'none') return;
  const hash = serializeSceneHash({
    repo: result.repository.fullName,
    commit: result.revision.commitSha,
    seed: sceneSeed,
    file,
    ...explorerHashState(),
  });
  const url = `${window.location.pathname}${window.location.search}#${hash}`;
  if (mode === 'push') history.pushState(null, '', url);
  else history.replaceState(null, '', url);
}

function teardown(): void {
  const root = scene.getObjectByName('cityRoot');
  if (root) scene.remove(root);

  if (cityCamera) { cityCamera.dispose(); cityCamera = null; }
  window.clearTimeout(framingRefreshTimer);

  if (cityData) { cityData.dispose(); cityData = null; }
  if (rooftops) { rooftops.dispose(); rooftops = null; }
  if (streetNet) { streetNet.dispose(); streetNet = null; }
  if (traffic) { traffic.dispose(); traffic = null; }
  if (flying) { flying.mesh.removeFromParent(); flying.dispose(); flying = null; }
  if (embers) { scene.remove(embers.points); embers.dispose(); embers = null; }
  if (billboards) { scene.remove(billboards.group); billboards.dispose(); billboards = null; }
  if (atmosphere) { scene.remove(atmosphere.group); atmosphere.dispose(); atmosphere = null; }
  if (sky) { scene.remove(sky.group); sky.dispose(); sky = null; }
  setHovered(-1);
  selectedBuildingId = -1;
  explorerModel = null;
  explorerView = null;
  expandedPaths.clear();
  repoTreeEl.replaceChildren();
  explorerCoverageEl.textContent = 'Load a repository to inspect its rendered files.';
  treeEmptyEl.hidden = true;
  hideInfo();
  motionAccumulator = 0;
}

/* ═══ Render loop ═══════════════════════════════════════ */
function animate(): void {
  const dt = Math.min(clock.getDelta(), 0.1);
  if (document.hidden) return;
  pixelRatioCheckAccumulator += dt;
  if (pixelRatioCheckAccumulator >= 1) {
    pixelRatioCheckAccumulator = 0;
    if (calculatePixelRatio(window.innerWidth, window.innerHeight) !== appliedPixelRatio) resizePending = true;
  }
  applyPendingResize();

  if (cityCamera) {
    /* the rig owns the camera during the entrance, and the idle showcase drift after it */
    if (!cityCamera.entranceActive) {
      controls.enabled = true;
      controls.update();
    }
    cityCamera.update(dt);
  } else if (controls.enabled) {
    controls.update();
  }

  if (pointerPickPending && !orbiting) {
    pointerPickPending = false;
    updateHoveredBuilding(pickAt(pendingPointerX, pendingPointerY));
  }

  cityData?.update(dt);
  motionAccumulator += dt;
  if (motionAccumulator >= MOTION_STEP) {
    const motionDt = motionAccumulator;
    motionAccumulator = 0;
    rooftops?.update(motionDt);
    traffic?.update(motionDt);
    flying?.update(motionDt);
    embers?.update(motionDt);
  }
  billboards?.update(camera, appliedHeight || window.innerHeight);
  atmosphere?.update(dt);
  sky?.update(dt);

  composer.render(dt);
}

/* ═══ Picking ═══════════════════════════════════════════ */
function pickAt(clientX: number, clientY: number): number {
  if (!cityData) return -1;
  pointer.x = (clientX / window.innerWidth) * 2 - 1;
  pointer.y = -(clientY / window.innerHeight) * 2 + 1;
  raycaster.setFromCamera(pointer, camera);
  pickHits.length = 0;
  raycaster.intersectObject(cityData.mesh, false, pickHits);
  for (const hit of pickHits) {
    if (hit.instanceId !== undefined && explorerView?.matchMask[hit.instanceId] === 1) return hit.instanceId;
  }
  return -1;
}

function handlePointerMove(e: PointerEvent): void {
  pointerInside = true;
  pendingPointerX = e.clientX;
  pendingPointerY = e.clientY;
  pointerPickPending = true;
}

function updateHoveredBuilding(id: number): void {
  if (id !== hoveredId) {
    setHovered(id);
    canvas.style.cursor = id >= 0 ? 'pointer' : 'default';
  }
}

function handlePointerLeave(): void {
  pointerInside = false;
  pointerPickPending = false;
  updateHoveredBuilding(-1);
}

function handleClick(e: MouseEvent): void {
  if (e.button !== 0) return;
  pointerPickPending = false;
  const id = pickAt(e.clientX, e.clientY);
  if (id >= 0 && cityData) {
    selectBuilding(id, { focusCamera: false, updateUrl: true, announce: true });
  } else {
    clearSelection(true);
  }
  noteCameraInteraction();
}

/* ═══ Camera interaction ════════════════════════════════ */
function noteCameraInteraction(): void {
  cityCamera?.noteInteraction();
}

function handleGlobalKeydown(event: KeyboardEvent): void {
  const tag = (event.target as HTMLElement | null)?.tagName;
  if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
  noteCameraInteraction();
}

/** The canvas region no overlay panel covers, measured live so toggles reframe. */
/**
 * Viewport the framing solves against while the poster is being composed.
 *
 * The rig reads its viewport through this function on every solve, so setting
 * this is how the poster gets composed for its own full-bleed frame instead of
 * for the band left between the app's panels. Null everywhere else.
 */
let posterViewport: FreeViewport | null = null;

function freeViewport(): FreeViewport {
  return posterViewport ?? measureFreeViewport(canvas, [headerEl, sidebarEl, explorerPanelEl]);
}


/**
 * Dev-only measurement handle, read by `scripts/measure-brightness.mjs`.
 *
 * The shader's brightness inputs depend on the solved camera against a real
 * repository, so they can only be sampled from a running app — a synthetic
 * fixture has answered this question wrongly twice. Exposing the live camera
 * rather than a snapshot matters: the entrance is still flying when the page
 * settles, and a value captured at build time would describe the wrong pose.
 *
 * Guarded by `import.meta.env.DEV`, so it is dead code in a production build.
 */
function exposeMeasurementHandle(): void {
  (window as unknown as Record<string, unknown>).__repocityProbe = () => {
    if (!cityData) return null;
    const buffer = new THREE.Vector2();
    renderer.getDrawingBufferSize(buffer);
    return probeBrightness(cityData.buildings, {
      cameraPosition: [camera.position.x, camera.position.y, camera.position.z],
      fov: camera.fov,
      bufferHeight: buffer.y,
      offset: [cityOffsetX, cityOffsetZ],
    });
  };

  /*
   * Where the city actually sits on screen, in CSS pixels.
   *
   * `capture-media.mjs` crops to this. The framing solver deliberately leaves
   * a margin so the city never touches the viewport edge, which is right for
   * the app and wrong for a social card — an og:image that is half empty black
   * is the weakest possible version of the one picture most people ever see.
   * Cropping is the contained fix; re-framing the app itself is a separate
   * product decision.
   */
  /*
   * Re-solve the composition now, rather than after the 450 ms debounce.
   *
   * The capture tools hide the UI by injecting `display: none`, which the app
   * cannot observe: no panel toggle fires, and the synthetic resize event is
   * dropped by `applyPendingResize` because the window itself did not change
   * size. The framing therefore stayed solved for a viewport with panels in
   * it, and every captured city sat inset where the sidebar used to be. A real
   * user opening or closing a panel already gets a refresh.
   */
  (window as unknown as Record<string, unknown>).__repocityRefresh = () => {
    cityCamera?.refresh();
  };

  (window as unknown as Record<string, unknown>).__repocityFraming = () => {
    if (!cityCamera) return null;
    const { left, top, width, height } = cityCamera.framing.screen;
    const view = freeViewport();
    return {
      left, top, width, height,
      // The solver's own measurements. Reported rather than recomputed from
      // the rect, because both are fractions of the FREE viewport, not of the
      // canvas — deriving them from canvas size understates a composition
      // whenever a panel is inset, which is most of the time.
      widthFill: cityCamera.framing.widthFill,
      heightFill: cityCamera.framing.heightFill,
      distance: cityCamera.framing.distance,
      // So a measurement can tell whether the distance floor is what stopped
      // the composition reaching its targets, rather than the height fit.
      cityRadius: cityRadius(cityCamera.visualBox),
      free: { left: view.left, top: view.top, width: view.width, height: view.height },
      canvas: { width: view.canvasWidth, height: view.canvasHeight },
    };
  };
}

/**
 * Re-derive every absolute world-unit constant for a city of this size.
 *
 * Called once per build, before the first frame. Each of these was a literal
 * fitted to a 240-unit city, which was safe only while every city was that
 * size; now that land grows with the repository they have to scale with it.
 */
function applyWorldScale(citySize: number): void {
  const relative = citySize / REFERENCE_CITY_SIZE;

  /*
   * Hold the optical depth ACROSS the city constant rather than the density
   * per unit, so a large city is as legible as a small one. The `min(1, …)` is
   * load-bearing: density must never rise above the reference for a small
   * city, which would dim exactly the repositories that already look best.
   */
  if (scene.fog instanceof THREE.FogExp2) {
    scene.fog.density = FOG_DENSITY_AT_REFERENCE * Math.min(1, 1 / relative);
  }

  // The far corner of a large city sits well beyond the reference far plane.
  const far = Math.max(CAMERA_FAR_AT_REFERENCE, citySize * 5);
  if (camera.far !== far) {
    camera.far = far;
    camera.updateProjectionMatrix();
  }

  // Rim lights are placed in world units, so at a fixed position they light
  // one corner of a large city and nothing else.
  const rimScale = Math.max(1, relative);
  magentaRim.position.set(120 * rimScale, 50 * rimScale, -90 * rimScale);
  magentaRim.distance = 600 * rimScale;
  cyanRim.position.set(-120 * rimScale, 60 * rimScale, 90 * rimScale);
  cyanRim.distance = 600 * rimScale;
}

/** Dev-only composition trace: what was measured, and where the city landed. */
function logFraming(rig: CityCameraRig): void {
  const view = freeViewport();
  const span = (start: number, size: number) => `${Math.round(start)}..${Math.round(start + size)}`;
  console.debug('[framing]', {
    canvas: `${Math.round(view.canvasWidth)}×${Math.round(view.canvasHeight)}`,
    freeX: span(view.left, view.width),
    freeY: span(view.top, view.height),
    cityX: span(rig.framing.screen.left, rig.framing.screen.width),
    cityY: span(rig.framing.screen.top, rig.framing.screen.height),
    distance: Math.round(rig.framing.distance),
  });
}

/** Re-solve the framing once panel open/close transitions have settled. */
function scheduleFramingRefresh(): void {
  window.clearTimeout(framingRefreshTimer);
  framingRefreshTimer = window.setTimeout(() => cityCamera?.refresh(), 450);
}

function setHovered(id: number): void { hoveredId = id; cityData?.setHovered(id); }

function selectBuilding(id: number, options: { focusCamera: boolean; updateUrl: boolean; announce: boolean }): void {
  const building = cityData?.buildings[id];
  if (!building) return;
  selectedBuildingId = id;
  cityData?.setSelected(id);
  showInfo(building);
  revealTreePath(building.path);
  updateTreeSelection();
  if (options.focusCamera) focusSelectedBuilding();
  if (options.updateUrl) replaceSelectionHash(building.path);
  if (options.announce) selectionStatusEl.textContent = `Selected ${building.path}, ${languageDisplayName(building.language)}, ${formatSize(building.size)}.`;
}

function clearSelection(updateUrl: boolean): void {
  selectedBuildingId = -1;
  cityData?.setSelected(-1);
  hideInfo();
  selectionStatusEl.textContent = '';
  updateTreeSelection();
  if (updateUrl) replaceSelectionHash(undefined);
}

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
  infoLangEl.style.color = hex;
  infoEl.classList.add('visible');
  infoEl.hidden = false;
  openFileEl.href = activeResult
    ? `${activeResult.repository.htmlUrl}/blob/${activeResult.revision.commitSha}/${b.path.split('/').map(encodeURIComponent).join('/')}`
    : '#';
}
function hideInfo(): void { infoEl.classList.remove('visible'); infoEl.hidden = true; }

function toggleExplorer(): void {
  explorerUserToggled = true;
  const open = explorerPanelEl.classList.toggle('open');
  explorerToggleEl.setAttribute('aria-expanded', String(open));
  document.body.classList.toggle('explorer-open', open);
  if (open && mobileExplorerMedia.matches) setSummaryOpen(false);
  scheduleFramingRefresh();
}

function syncExplorerForViewport(): void {
  if (explorerUserToggled) return;
  const open = !mobileExplorerMedia.matches;
  explorerPanelEl.classList.toggle('open', open);
  explorerToggleEl.setAttribute('aria-expanded', String(open));
  document.body.classList.toggle('explorer-open', open);
}

function toggleSummary(): void {
  summaryUserToggled = true;
  const open = !document.body.classList.contains('summary-open');
  setSummaryOpen(open);
  if (open && mobileExplorerMedia.matches) {
    explorerUserToggled = true;
    explorerPanelEl.classList.remove('open');
    explorerToggleEl.setAttribute('aria-expanded', 'false');
    document.body.classList.remove('explorer-open');
  }
  scheduleFramingRefresh();
}

function setSummaryOpen(open: boolean): void {
  document.body.classList.toggle('summary-open', open);
  summaryToggleEl.setAttribute('aria-expanded', String(open));
}

function syncSummaryForViewport(): void {
  if (summaryUserToggled) return;
  setSummaryOpen(!mobileExplorerMedia.matches);
}

function renderExplorer(result: FetchResult, buildings: Building[]): void {
  explorerModel = buildExplorerModel(result, buildings);
  explorerDistrictEl.replaceChildren(new Option('all rendered districts', ''), ...explorerModel.districts.map((district) => new Option(`${district.label} (${district.files})`, district.value)));
  if (explorerState.district && !explorerModel.districts.some((district) => district.value === explorerState.district)) {
    explorerDistrictEl.add(new Option(`${explorerState.district === '/' ? 'repository root' : explorerState.district} (0 rendered)`, explorerState.district));
  }
  explorerDistrictEl.value = explorerState.district;
  const languages = [...new Set(buildings.map((building) => building.language))].sort();
  explorerLanguageEl.replaceChildren(new Option('all', ''), ...languages.map((language) => new Option(languageDisplayName(language), language)));
  if (explorerState.language && !languages.includes(explorerState.language)) {
    explorerLanguageEl.add(new Option(`${languageDisplayName(explorerState.language)} (0 rendered)`, explorerState.language));
  }
  explorerLanguageEl.value = explorerState.language;
  expandedPaths.clear();
  activeTreePath = explorerModel.roots[0]?.path ?? '';
  explorerCoverageEl.textContent = explorerModel.coverageText;
  treeEmptyEl.hidden = buildings.length > 0;
  applyExplorerFilters(false);
}

function readExplorerControls(): void {
  explorerState = {
    query: explorerQueryEl.value,
    district: explorerDistrictEl.value,
    language: explorerLanguageEl.value,
    size: explorerSizeEl.value as ExplorerFilterState['size'],
    sort: explorerSortEl.value as ExplorerFilterState['sort'],
  };
  applyExplorerFilters(true);
  replaceSelectionHash(selectedBuildingId >= 0 ? cityData?.buildings[selectedBuildingId]?.path : undefined);
}

function handleExplorerQueryInput(): void {
  window.clearTimeout(explorerQueryTimer);
  explorerQueryTimer = window.setTimeout(readExplorerControls, 120);
}

function setExplorerStateFromHash(state: SceneHashState): void {
  explorerState = { query: state.q ?? '', district: state.district ?? '', language: state.lang ?? '', size: state.size ?? 'all', sort: state.sort ?? 'layout' };
  explorerQueryEl.value = explorerState.query;
  if (explorerState.district && ![...explorerDistrictEl.options].some((option) => option.value === explorerState.district)) {
    explorerDistrictEl.add(new Option(`${explorerState.district === '/' ? 'repository root' : explorerState.district} (0 rendered)`, explorerState.district));
  }
  explorerDistrictEl.value = explorerState.district;
  explorerLanguageEl.value = explorerState.language;
  explorerSizeEl.value = explorerState.size;
  explorerSortEl.value = explorerState.sort;
}

function explorerHashState(): Pick<SceneHashState, 'q' | 'lang' | 'size' | 'sort' | 'district'> {
  return {
    q: explorerState.query.trim() || undefined,
    district: explorerState.district || undefined,
    lang: explorerState.language || undefined,
    size: explorerState.size === 'all' ? undefined : explorerState.size,
    sort: explorerState.sort === 'layout' ? undefined : explorerState.sort,
  };
}

function applyExplorerFilters(announce: boolean): void {
  if (!explorerModel || !cityData) return;
  explorerView = deriveExplorerView(explorerModel, explorerState);
  cityData.setMatchMask(explorerView.matchMask);
  const filtering = explorerView.matchingFiles !== cityData.buildings.length;
  cityData.details.setMatchMask(explorerView.matchMask);
  rooftops?.setMatchMask(explorerView.matchMask);
  if (billboards) billboards.group.visible = !filtering;
  if (selectedBuildingId >= 0 && explorerView.matchMask[selectedBuildingId] !== 1) clearSelection(true);
  setHovered(-1);
  const total = cityData.buildings.length;
  const resultSummary = `${explorerView.matchingFiles.toLocaleString()} matching rendered file${explorerView.matchingFiles === 1 ? '' : 's'} of ${total.toLocaleString()}.`;
  explorerResultsEl.textContent = resultSummary;
  // Only a filter the user just changed is worth interrupting for -- initial
  // and hash-driven renders would otherwise announce a count nobody asked for.
  if (announce) selectionStatusEl.textContent = resultSummary;
  treeEmptyEl.hidden = explorerView.matchingFiles > 0;
  treeEmptyEl.textContent = filtering ? 'No rendered files match these filters.' : 'No files are rendered for this repository.';
  const containsPath = (nodes: readonly ExplorerNode[]): boolean => nodes.some((node) => node.path === activeTreePath || containsPath(node.children));
  activeTreePath = containsPath(explorerView.roots) ? activeTreePath : explorerView.roots[0]?.path ?? '';
  if (explorerState.query.trim()) {
    const expand = (nodes: readonly ExplorerNode[]) => nodes.forEach((node) => { if (node.type === 'directory') { expandedPaths.add(node.path); expand(node.children); } });
    expand(explorerView.roots);
  }
  renderExplorerTree();
  renderBreadcrumbs();
}

function renderExplorerTree(): void {
  repoTreeEl.replaceChildren();
  if (!explorerView) return;
  const appendNodes = (parent: HTMLElement, nodes: readonly ExplorerNode[], level: number) => {
    for (const node of nodes) {
      const item = document.createElement('li');
      item.setAttribute('role', 'none');
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'tree-row';
      row.setAttribute('role', 'treeitem');
      row.setAttribute('aria-level', String(level));
      if (node.type === 'file') row.setAttribute('aria-selected', String(node.buildingId === selectedBuildingId));
      row.tabIndex = node.path === activeTreePath ? 0 : -1;
      row.dataset.path = node.path;
      if (node.buildingId !== undefined) row.dataset.buildingId = String(node.buildingId);
      row.setAttribute('aria-label', node.type === 'file'
        ? `${node.name}, ${languageDisplayName(node.language ?? 'unknown')}, ${formatSize(node.size)}`
        : `${node.name}, folder, ${node.children.length} items`);
      const icon = document.createElement('span');
      icon.className = 'tree-icon';
      icon.setAttribute('aria-hidden', 'true');
      icon.textContent = node.type === 'directory' ? (expandedPaths.has(node.path) ? '−' : '+') : '▪';
      const name = document.createElement('span');
      name.className = 'tree-name';
      name.textContent = node.name;
      const meta = document.createElement('span');
      meta.className = 'tree-meta';
      meta.textContent = node.type === 'file' ? `${languageDisplayName(node.language ?? 'unknown')} · ${formatSize(node.size)}` : `${node.children.length}`;
      row.append(icon, name, meta);
      item.appendChild(row);
      if (node.type === 'directory' && expandedPaths.has(node.path)) {
        const group = document.createElement('ul');
        group.setAttribute('role', 'group');
        group.id = `tree-group-${encodeURIComponent(node.path)}`;
        row.setAttribute('aria-expanded', 'true');
        row.setAttribute('aria-owns', group.id);
        appendNodes(group, node.children, level + 1);
        item.appendChild(group);
      } else if (node.type === 'directory') {
        row.setAttribute('aria-expanded', 'false');
      }
      parent.appendChild(item);
    }
  };
  appendNodes(repoTreeEl, explorerView.roots, 1);
}

function handleTreeKeydown(event: KeyboardEvent): void {
  if (!explorerView) return;
  const visible = visibleExplorerNodes(explorerView.roots, expandedPaths);
  let index = visible.findIndex((node) => node.path === activeTreePath);
  if (index < 0) index = 0;
  const node = visible[index];
  if (!node) return;
  let nextPath: string | undefined;
  if (event.key === 'ArrowDown') nextPath = visible[Math.min(visible.length - 1, index + 1)]?.path;
  else if (event.key === 'ArrowUp') nextPath = visible[Math.max(0, index - 1)]?.path;
  else if (event.key === 'Home') nextPath = visible[0]?.path;
  else if (event.key === 'End') nextPath = visible[visible.length - 1]?.path;
  else if (event.key === 'ArrowRight' && node.type === 'directory') {
    if (!expandedPaths.has(node.path)) { expandedPaths.add(node.path); renderExplorerTree(); focusActiveTreeItem(); }
    else nextPath = node.children[0]?.path;
  } else if (event.key === 'ArrowLeft') {
    if (node.type === 'directory' && expandedPaths.has(node.path)) { expandedPaths.delete(node.path); renderExplorerTree(); focusActiveTreeItem(); }
    else nextPath = node.path.includes('/') ? node.path.slice(0, node.path.lastIndexOf('/')) : undefined;
  } else if (event.key === 'Enter' || event.key === ' ') {
    (event.target as HTMLElement).click();
    event.preventDefault();
    return;
  } else return;
  event.preventDefault();
  if (nextPath !== undefined) {
    moveTreeFocus(nextPath);
    return;
  }
  focusActiveTreeItem();
}

function handleTreeClick(event: MouseEvent): void {
  const row = (event.target as Element).closest<HTMLElement>('[role="treeitem"]');
  if (!row || !explorerView) return;
  activeTreePath = row.dataset.path ?? '';
  const node = visibleExplorerNodes(explorerView.roots, expandedPaths).find((item) => item.path === activeTreePath);
  if (!node) return;
  if (node.type === 'directory') {
    if (expandedPaths.has(node.path)) expandedPaths.delete(node.path); else expandedPaths.add(node.path);
    renderExplorerTree();
    focusActiveTreeItem();
    renderBreadcrumbs();
  } else if (node.buildingId !== undefined) {
    selectBuilding(node.buildingId, { focusCamera: true, updateUrl: true, announce: true });
    focusActiveTreeItem();
  }
}

function moveTreeFocus(path: string): void {
  const rows = [...repoTreeEl.querySelectorAll<HTMLButtonElement>('.tree-row')];
  for (const row of rows) row.tabIndex = row.dataset.path === path ? 0 : -1;
  activeTreePath = path;
  rows.find((row) => row.dataset.path === path)?.focus();
  renderBreadcrumbs();
}

function focusActiveTreeItem(): void {
  const row = [...repoTreeEl.querySelectorAll<HTMLButtonElement>('.tree-row')].find((item) => item.dataset.path === activeTreePath);
  row?.focus();
}

function revealTreePath(path: string): void {
  const segments = path.split('/');
  let changed = false;
  for (let index = 1; index < segments.length; index++) {
    const parent = segments.slice(0, index).join('/');
    if (!expandedPaths.has(parent)) { expandedPaths.add(parent); changed = true; }
  }
  activeTreePath = path;
  if (changed) renderExplorerTree();
  const row = [...repoTreeEl.querySelectorAll<HTMLElement>('.tree-row')].find((item) => item.dataset.path === path);
  row?.scrollIntoView({ block: 'nearest' });
  renderBreadcrumbs();
}

function renderBreadcrumbs(): void {
  explorerBreadcrumbsEl.replaceChildren();
  const segments = activeTreePath.split('/').filter(Boolean);
  let path = '';
  const root = document.createElement('button');
  root.type = 'button';
  root.dataset.path = '';
  root.textContent = 'root';
  explorerBreadcrumbsEl.appendChild(root);
  for (const segment of segments) {
    path = path ? `${path}/${segment}` : segment;
    const crumb = document.createElement('button');
    crumb.type = 'button';
    crumb.dataset.path = path;
    crumb.textContent = segment;
    explorerBreadcrumbsEl.appendChild(crumb);
  }
  explorerBreadcrumbsEl.scrollLeft = explorerBreadcrumbsEl.scrollWidth;
}

function handleBreadcrumbClick(event: MouseEvent): void {
  const button = (event.target as Element).closest<HTMLButtonElement>('button[data-path]');
  if (!button || !explorerView) return;
  const path = button.dataset.path ?? '';
  activeTreePath = path || explorerView.roots[0]?.path || '';
  if (path) {
    const segments = path.split('/');
    for (let index = 1; index <= segments.length; index++) expandedPaths.add(segments.slice(0, index).join('/'));
  }
  renderExplorerTree();
  focusActiveTreeItem();
  renderBreadcrumbs();
}

function updateTreeSelection(): void {
  for (const row of repoTreeEl.querySelectorAll<HTMLElement>('[role="treeitem"]')) {
    if (row.dataset.buildingId === undefined) row.removeAttribute('aria-selected');
    else row.setAttribute('aria-selected', String(Number(row.dataset.buildingId) === selectedBuildingId));
  }
}

function replaceSelectionHash(path: string | undefined): void {
  if (!activeResult) return;
  const hash = serializeSceneHash({
    repo: activeResult.repository.fullName,
    commit: activeResult.revision.commitSha,
    seed: activeSceneSeed,
    file: path,
    ...explorerHashState(),
  });
  history.replaceState(null, '', `${window.location.pathname}${window.location.search}#${hash}`);
}

function focusSelectedBuilding(): void {
  const building = cityData?.buildings[selectedBuildingId];
  if (!building) return;
  cityCamera?.skipEntrance();
  noteCameraInteraction();
  controls.enabled = true;
  const target = new THREE.Vector3(building.position[0] + cityOffsetX, building.totalHeight * 0.45, building.position[2] + cityOffsetZ);
  const direction = camera.position.clone().sub(controls.target).normalize();
  const distance = Math.max(22, building.totalHeight * 2.4, Math.max(building.scale[0], building.scale[2]) * 5);
  controls.target.copy(target);
  camera.position.copy(target).addScaledVector(direction.lengthSq() > 0 ? direction : new THREE.Vector3(1, 0.7, 1).normalize(), distance);
  camera.lookAt(target);
  controls.update();
}

async function copySelectedPath(): Promise<void> {
  const path = cityData?.buildings[selectedBuildingId]?.path;
  if (!path) return;
  try {
    await navigator.clipboard.writeText(path);
    selectionStatusEl.textContent = `Copied ${path}.`;
  } catch {
    selectionStatusEl.textContent = 'Could not copy the selected path.';
  }
}

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

  const tallest: Building | null = tallestSourceBuilding(buildings);
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

/**
 * Exact font specs the poster caption draws with. These must stay in step with
 * the `ctx.font` assignments below -- a spec that is listed but not drawn only
 * costs a redundant load, but one that is drawn without being listed silently
 * falls back to a system font on a cold cache.
 */
const POSTER_FONTS = [
  '600 14px "JetBrains Mono"',
  'italic 500 72px "Fraunces"',
  '500 18px "JetBrains Mono"',
] as const;

/**
 * Point the camera at the composition the poster's own frame wants, and hand
 * back the undo.
 *
 * The pose is read through `orbitFraming` at the azimuth the rig is already
 * showing, so the poster is the same view from the same angle — only the
 * distance and the centring change, because they are the parts that were
 * solved against a viewport with panels in it. The camera is restored exactly,
 * including its orientation, so a capture never leaves the live view moved.
 */
function applyPosterFraming(width: number, height: number): () => void {
  const rig = cityCamera;
  if (!rig) return () => undefined;

  const position = camera.position.clone();
  const quaternion = camera.quaternion.clone();
  const target = controls.target.clone();

  /*
   * The whole frame, with nothing reserved for the caption. Reserving a band
   * at the foot was tried and is wrong: the composition then centres the city
   * in what is left and the poster comes out top-heavy with a dead strip above
   * the type. The caption is designed to sit ON the city, over the gradient
   * that darkens the lower third — so the framing should fill the full bleed
   * and let the type overlay it.
   */
  posterViewport = freeViewportFromRects({ left: 0, top: 0, width, height }, []);
  /*
   * The azimuth comes from where the camera actually is, not from
   * `framing.azimuth`: that is the hero angle, and the showcase drift spends
   * most of its time away from it. Taking the live bearing is what keeps the
   * poster the same view the screen is showing.
   */
  const azimuth = Math.atan2(position.x - target.x, position.z - target.z);
  const shot = rig.orbitFraming(azimuth);
  camera.position.copy(shot.position);
  camera.lookAt(shot.aim);

  return () => {
    posterViewport = null;
    camera.position.copy(position);
    camera.quaternion.copy(quaternion);
    controls.target.copy(target);
  };
}

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
    // Canvas2D silently substitutes a system font instead of waiting, so the
    // one artifact people share would otherwise ship with the wrong
    // typography. `document.fonts.ready` alone is not enough: it settles
    // pending loads but never *requests* a face the page has not used, and
    // nothing on screen uses italic-500 Fraunces. Load the exact specs the
    // caption draws with. Failure here is cosmetic, so never block the capture.
    await Promise.all(POSTER_FONTS.map((spec) => document.fonts.load(spec))).catch(() => undefined);
    camera.aspect = W / H;
    camera.updateProjectionMatrix();
    renderer.setSize(W, H, false);
    composer.setSize(W, H);

    /*
     * Recompose for the poster's own frame — but only while the camera is
     * still where the rig put it.
     *
     * On screen the city is composed for the band between the panels. The
     * poster has no panels, so carrying that pose over leaves the city inset
     * with the sidebar's space empty beside it. Solving against the full
     * bleed, minus the strip the caption occupies, fills the picture.
     *
     * If the user has orbited to a view of their own, none of that applies:
     * the poster should be the shot they are looking at, and recomposing it
     * would quietly move their camera. `composedPose` is exactly that
     * distinction, so the poster follows the rig only while the rig is
     * driving.
     */
    const restore = cityCamera?.composedPose ? applyPosterFraming(W, H) : undefined;
    composer.render();
    restore?.();

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
    const rendered = cityData?.buildings.length ?? 0;
    const visible = explorerView?.matchingFiles ?? rendered;
    const buildingLabel = visible === rendered ? `${rendered} buildings` : `${visible} matching of ${rendered} rendered buildings`;
    ctx.fillText(`${buildingLabel} · ${coverage} · ${revision} · seed ${activeSceneSeed}`, 80, H - 110);

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

/**
 * Resolve once the browser has had a chance to paint.
 *
 * `requestAnimationFrame` fires *before* paint, so the nested task is what
 * actually guarantees the pending DOM update reached the screen.
 */
function nextPaint(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => { setTimeout(resolve, 0); });
  });
}

function scheduleResize(): void {
  resizePending = true;
}

function applyPendingResize(): void {
  if (!resizePending || !renderer || !camera) return;
  resizePending = false;
  const w = window.innerWidth, h = window.innerHeight;
  const pixelRatio = calculatePixelRatio(w, h);
  if (w === appliedWidth && h === appliedHeight && pixelRatio === appliedPixelRatio) return;
  if (pixelRatio !== appliedPixelRatio) {
    renderer.setPixelRatio(pixelRatio);
    composer.setPixelRatio(pixelRatio);
    appliedPixelRatio = pixelRatio;
  }
  renderer.setSize(w, h);
  composer.setSize(w, h);
  appliedWidth = w;
  appliedHeight = h;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  cityCamera?.refresh();
}

function calculatePixelRatio(width: number, height: number): number {
  const preferred = Math.min(window.devicePixelRatio, 1.25);
  const pixelCap = Math.sqrt(MAX_RENDER_PIXELS / Math.max(1, width * height));
  return Math.max(0.5, Math.min(preferred, pixelCap));
}

/**
 * Render the status pill.  Failures expand the pill so the whole reason is
 * readable, and offer a dismiss control that restores the last healthy status.
 */
function setStatus(msg: string, isErr = false, pulse = false, detail?: string): void {
  const text = document.createElement('span');
  text.className = 'status-text';
  text.textContent = msg;
  const children: Node[] = [text];
  if (detail) {
    const detailEl = document.createElement('span');
    detailEl.className = 'status-detail';
    detailEl.textContent = detail;
    text.appendChild(detailEl);
  }
  if (isErr) {
    const dismiss = document.createElement('button');
    dismiss.type = 'button';
    dismiss.className = 'status-dismiss';
    dismiss.title = 'Dismiss';
    dismiss.setAttribute('aria-label', 'Dismiss this status message');
    dismiss.textContent = '×';
    dismiss.addEventListener('click', dismissStatus);
    children.push(dismiss);
  }
  statusEl.replaceChildren(...children);
  statusEl.classList.toggle('err', isErr);
  statusEl.classList.toggle('pulse', pulse && !isErr);
  statusEl.classList.toggle('expanded', isErr || detail !== undefined);
  if (!isErr) lastHealthyStatus = msg;
}

function dismissStatus(): void {
  setStatus(lastHealthyStatus);
}

function formatSize(bytes: number): string {
  if (bytes === 0) return '0 B';
  const u = ['B', 'KB', 'MB', 'GB'];
  const i = Math.min(Math.floor(Math.log10(bytes) / 3), 3);
  return `${(bytes / Math.pow(1000, i)).toFixed(i === 0 ? 0 : 2)} ${u[i]}`;
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

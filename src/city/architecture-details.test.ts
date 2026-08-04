import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { buildArchitectureDetails, planCap } from './architecture-details';
import { buildCity, type Building } from './city';
import type { LayoutCell } from './layout';

/**
 * Cells wide enough that no absolute detail floor binds — this suite is about
 * Y. Spread across several directories so every typology is exercised: shape
 * is inherited from the parent directory, so a single-directory city would
 * only ever test one of them.
 */
const DISTRICTS = ['src', 'lib/core', 'packages/ui', 'tools', 'docs', 'internal/api'];

function sourceCells(count: number): LayoutCell[] {
  return Array.from({ length: count }, (_, i) => ({
    node: {
      name: `f${i}.ts`, path: `${DISTRICTS[i % DISTRICTS.length]}/f${i}.ts`, type: 'file' as const,
      size: 100 + i * 137, children: [], language: 'typescript',
    },
    rect: { x: (i % 20) * 24, y: Math.floor(i / 20) * 24, w: 20, h: 20, depth: 1 },
  }));
}

function infraCells(count: number): LayoutCell[] {
  return Array.from({ length: count }, (_, i) => ({
    node: {
      name: 'pnpm-lock.yaml', path: `vendor${i}/pnpm-lock.yaml`, type: 'file' as const,
      size: 400_000 + i * 1_000, children: [], language: 'lockfile',
    },
    rect: { x: 600 + i * 24, y: 0, w: 20, h: 20, depth: 1 },
  }));
}

/** Every profile appears in this city. */
function wholeCity(): Building[] {
  return buildCity([...sourceCells(200), ...infraCells(12)]).buildings;
}

const EPS = 1e-6;

describe('planCap — the vertical contract', () => {
  it('covers every profile, so the invariants below are not vacuous', () => {
    const seen = new Set(wholeCity().map((b) => b.profile));
    for (const profile of ['block', 'setback', 'tower', 'mega', 'depot']) {
      expect(seen).toContain(profile);
    }
  });

  it('never leaves a gap between the core and the piece above it', () => {
    for (const b of wholeCity()) {
      const plan = planCap(b);
      const cap = plan.pieces.filter((p) => p.kind !== 'podium');
      expect(cap.length).toBeGreaterThan(0);
      // The lowest cap piece must reach down to (or into) the core top.
      expect(cap[0].bottom).toBeLessThanOrEqual(plan.coreTop + EPS);
    }
  });

  it('tiles the cap contiguously', () => {
    for (const b of wholeCity()) {
      const cap = planCap(b).pieces.filter((p) => p.kind !== 'podium');
      for (let i = 1; i < cap.length; i++) {
        expect(cap[i].bottom).toBeLessThanOrEqual(cap[i - 1].top + EPS);
      }
    }
  });

  it('renders to exactly the declared height', () => {
    for (const b of wholeCity()) {
      const plan = planCap(b);
      const top = Math.max(...plan.pieces.map((p) => p.top));
      expect(top).toBeCloseTo(plan.apex, 6);
      expect(plan.apex).toBeCloseTo(plan.baseY + b.totalHeight, 6);
    }
  });

  it('never puts geometry below the ground', () => {
    for (const b of wholeCity()) {
      const plan = planCap(b);
      for (const piece of plan.pieces) expect(piece.bottom).toBeGreaterThanOrEqual(plan.baseY - EPS);
    }
  });

  it('never lets a wide piece protrude from a narrower one beneath it', () => {
    for (const b of wholeCity()) {
      const cap = planCap(b).pieces.filter((p) => p.kind !== 'podium');
      // The brim is the one piece allowed to oversail the core.
      for (let i = 1; i < cap.length; i++) {
        expect(cap[i].widthScale).toBeLessThanOrEqual(cap[i - 1].widthScale + EPS);
      }
    }
  });
});

describe('planCap — the specific defects this replaced', () => {
  const cityOf = (n: number): Building[] => buildCity(sourceCells(n)).buildings;
  const at = (buildings: Building[], profile: Building['profile']): Building => {
    const hit = buildings.find((b) => b.profile === profile);
    if (!hit) throw new Error(`no ${profile} in this city`);
    return hit;
  };

  it('a tower crown sits on its core, not 15-25% of the height above it', () => {
    const tower = at(cityOf(200), 'tower');
    const plan = planCap(tower);
    const lowest = plan.pieces.find((p) => p.kind !== 'podium')!;
    const gap = lowest.bottom - plan.coreTop;
    expect(gap).toBeLessThanOrEqual(EPS);
    // Previously the gap ran 0.153..0.248 of totalHeight — up to 18 world units.
    expect(gap).toBeGreaterThan(-tower.totalHeight * 0.5);
  });

  it('a setback crown is above the core rather than buried inside it', () => {
    const setback = at(cityOf(200), 'setback');
    const plan = planCap(setback);
    const crowns = plan.pieces.filter((p) => p.kind === 'crown');
    expect(crowns.length).toBeGreaterThan(0);
    // Crowns start at or above the brim, never below the core top.
    for (const crown of crowns) expect(crown.top).toBeGreaterThan(plan.coreTop);
  });

  it('a block reaches its declared height instead of stopping 15% short', () => {
    const block = at(cityOf(200), 'block');
    const plan = planCap(block);
    expect(Math.max(...plan.pieces.map((p) => p.top))).toBeCloseTo(plan.apex, 6);
    expect(plan.pieces.some((p) => p.kind === 'crown')).toBe(true);
  });

  it('keeps the depot cap pinned to its core, as it always was', () => {
    const depot = buildCity([...sourceCells(40), ...infraCells(6)]).buildings
      .find((b) => b.profile === 'depot')!;
    const plan = planCap(depot);
    const cap = plan.pieces.filter((p) => p.kind !== 'podium');
    expect(cap).toHaveLength(1);
    expect(cap[0].bottom).toBeLessThanOrEqual(plan.coreTop + EPS);
    expect(cap[0].top).toBeCloseTo(plan.apex, 6);
    // Depots stay unadorned: ground, not architecture.
    expect(plan.pieces.some((p) => p.kind === 'spire')).toBe(false);
    expect(plan.pieces.some((p) => p.kind === 'crown')).toBe(false);
  });

  it('never gives a spire a wider footprint than its own tower', () => {
    for (const b of wholeCity()) {
      for (const piece of planCap(b).pieces) {
        if (piece.kind === 'spire') expect(piece.widthScale).toBeLessThanOrEqual(0.35 + EPS);
      }
    }
  });

  it('puts every light strip on a roof plane, not a crown waist', () => {
    for (const b of wholeCity()) {
      const plan = planCap(b);
      for (const piece of plan.pieces) {
        if (piece.stripIntensity > 0) {
          expect(piece.top).toBeLessThanOrEqual(plan.apex + EPS);
        }
      }
    }
  });
});

describe('the emitted instance matrices match the plan', () => {
  /*
   * The only assertion that can catch a base-origin vs centre-origin mistake:
   * it compares the plan against the matrix the GPU actually receives. Spires
   * used to translate their geometry by half a unit, so a spire placed like a
   * box overshot the declared height by 12%.
   */
  it('places spires centred on their planned span', () => {
    const buildings = wholeCity();
    const details = buildArchitectureDetails(buildings);
    const meshes: THREE.InstancedMesh[] = [];
    details.group.traverse((o) => {
      if ((o as THREE.InstancedMesh).isInstancedMesh) meshes.push(o as THREE.InstancedMesh);
    });
    const spireMesh = meshes.find((m) => m.geometry.type === 'CylinderGeometry');
    expect(spireMesh).toBeDefined();

    const planned = buildings
      .flatMap((b) => planCap(b).pieces.filter((p) => p.kind === 'spire'))
      .map((p) => (p.bottom + p.top) / 2)
      .sort((a, z) => a - z);
    expect(planned.length).toBeGreaterThan(0);

    const matrix = new THREE.Matrix4();
    const position = new THREE.Vector3();
    const emitted: number[] = [];
    for (let i = 0; i < spireMesh!.count; i++) {
      spireMesh!.getMatrixAt(i, matrix);
      position.setFromMatrixPosition(matrix);
      emitted.push(position.y);
    }
    emitted.sort((a, z) => a - z);
    expect(emitted).toHaveLength(planned.length);
    for (let i = 0; i < planned.length; i++) expect(emitted[i]).toBeCloseTo(planned[i], 5);
    details.dispose();
  });
});

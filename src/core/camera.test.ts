import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { createFlythrough, repositoryView } from './camera';

describe('repositoryView', () => {
  it('uses a close framing floor for small repositories', () => {
    const view = repositoryView(20, 48);
    expect(view.targetY).toBeCloseTo(43.2);
    expect(view.targetDist).toBe(84);
    expect(view.targetFocusY).toBeCloseTo(27.84);
  });

  it('scales independently with footprint and skyline height', () => {
    expect(repositoryView(200, 72).targetDist).toBe(310);
    const tallView = repositoryView(80, 100);
    expect(tallView.targetY).toBe(90);
    expect(tallView.targetDist).toBe(175);
    expect(tallView.targetFocusY).toBeCloseTo(58);
    expect(repositoryView(200, 72, 390 / 844).targetDist).toBeCloseTo(714, 0);
  });

  it('keeps the occupied city focus centered throughout the pull-in', () => {
    const camera = new THREE.PerspectiveCamera(48, 16 / 9, 0.1, 2000);
    const flythrough = createFlythrough(camera, { minX: -40, maxX: 60, minZ: -30, maxZ: 50 }, {
      duration: 1,
      targetY: 60,
      targetDist: 180,
      targetFocusY: 32,
    });
    const focus = flythrough.getOrbitTarget();
    for (const dt of [0, 0.25, 0.25, 0.5]) {
      flythrough.update(dt);
      camera.updateMatrixWorld();
      const projected = focus.clone().project(camera);
      expect(projected.x).toBeCloseTo(0, 5);
      expect(projected.y).toBeCloseTo(0, 5);
    }
  });
});

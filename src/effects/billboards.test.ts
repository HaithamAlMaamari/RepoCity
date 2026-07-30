import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { buildBillboards } from './billboards';

vi.mock('./textures', () => ({
  makeNeonSign: () => new THREE.Texture(),
}));

describe('buildBillboards', () => {
  it('keeps signs camera-facing, proportioned, and stable', () => {
    const billboards = buildBillboards([{
      rect: { x: 0, z: 0, w: 20, d: 10, depth: 1, name: 'src' },
      name: 'src',
      language: 'typescript',
      height: 30,
    }]);
    const mesh = billboards.group.children[0] as THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
    const camera = new THREE.PerspectiveCamera(48, 16 / 9, 0.1, 1000);
    camera.position.set(60, 45, 80);
    billboards.group.updateMatrixWorld(true);

    billboards.update(camera, 900);
    const firstScale = mesh.scale.y;
    billboards.update(camera, 900);

    mesh.geometry.computeBoundingBox();
    const box = mesh.geometry.boundingBox!;
    expect((box.max.x - box.min.x) / (box.max.y - box.min.y)).toBeCloseTo(1024 / 180);
    expect(mesh.material.side).toBe(THREE.FrontSide);
    expect(mesh.material.opacity).toBe(0.72);
    expect(mesh.material.depthTest).toBe(true);
    expect(mesh.scale.y).toBeCloseTo(firstScale);
    expect(mesh.rotation.y).toBeCloseTo(Math.atan2(camera.position.x - mesh.position.x, camera.position.z - mesh.position.z));

    billboards.dispose();
  });
});

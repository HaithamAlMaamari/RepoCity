import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { buildBillboards } from './billboards';

vi.mock('./textures', () => ({
  makeNeonSign: () => new THREE.Texture(),
}));

function makeBillboards() {
  return buildBillboards([{
    rect: { x: 0, z: 0, w: 20, d: 10, depth: 1, name: 'src' },
    name: 'src',
    language: 'typescript',
    height: 30,
  }]);
}

/** The direction the sign's face points, in world space. */
function faceNormal(mesh: THREE.Mesh): THREE.Vector3 {
  mesh.updateWorldMatrix(true, false);
  return new THREE.Vector3(0, 0, 1)
    .applyQuaternion(mesh.getWorldQuaternion(new THREE.Quaternion()))
    .normalize();
}

/**
 * Where the camera's own +Z points in world space. A screen-aligned quad is
 * parallel to the image plane, so its normal matches this exactly -- rather
 * than pointing at the camera's position, which would skew the text.
 */
function cameraFacing(camera: THREE.Camera): THREE.Vector3 {
  return new THREE.Vector3(0, 0, 1)
    .applyQuaternion(camera.getWorldQuaternion(new THREE.Quaternion()))
    .normalize();
}

describe('buildBillboards', () => {
  it('keeps signs proportioned and stable across updates', () => {
    const billboards = makeBillboards();
    const mesh = billboards.group.children[0] as THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
    const camera = new THREE.PerspectiveCamera(48, 16 / 9, 0.1, 1000);
    camera.position.set(60, 45, 80);
    camera.lookAt(0, 20, 0);
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

    billboards.dispose();
  });

  /*
   * The signs used to be yaw-only billboards, so they stayed vertical and an
   * overhead camera saw them edge-on. The aerial case is the regression that
   * matters; the oblique one proves the normal case still works.
   */
  it.each([
    ['three-quarter view', new THREE.Vector3(60, 45, 80)],
    ['directly overhead', new THREE.Vector3(0, 160, 0.001)],
    ['low and behind', new THREE.Vector3(-70, 8, -55)],
  ])('faces the camera from %s', (_label, position) => {
    const billboards = makeBillboards();
    const mesh = billboards.group.children[0] as THREE.Mesh;
    const camera = new THREE.PerspectiveCamera(48, 16 / 9, 0.1, 1000);
    camera.position.copy(position);
    camera.lookAt(0, 20, 0);
    camera.updateMatrixWorld(true);
    billboards.group.updateMatrixWorld(true);

    billboards.update(camera, 900);

    // Parallel to the image plane, and the front face -- not the back -- is
    // the one turned toward the viewer.
    expect(faceNormal(mesh).dot(cameraFacing(camera))).toBeGreaterThan(0.999);

    billboards.dispose();
  });

  it('undoes a rotated parent rather than assuming there is none', () => {
    const billboards = makeBillboards();
    const mesh = billboards.group.children[0] as THREE.Mesh;
    // cityRoot is only translated today, but a rotated ancestor must not tilt
    // the signs out of alignment.
    billboards.group.rotation.set(0.3, 0.8, 0.2);
    const camera = new THREE.PerspectiveCamera(48, 16 / 9, 0.1, 1000);
    camera.position.set(40, 60, 40);
    camera.lookAt(0, 20, 0);
    camera.updateMatrixWorld(true);
    billboards.group.updateMatrixWorld(true);

    billboards.update(camera, 900);

    expect(faceNormal(mesh).dot(cameraFacing(camera))).toBeGreaterThan(0.999);

    billboards.dispose();
  });
});

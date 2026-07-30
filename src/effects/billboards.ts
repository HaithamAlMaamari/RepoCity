/**
 * District billboards.
 *
 * Signs are attached to a folder block, not scattered around the scene.
 * They sit outside the block perimeter, above its tallest building, and
 * use the block's dominant language as their visual identity.
 */

import * as THREE from 'three';
import type { DistrictRect } from '../types';
import { makeNeonSign } from './textures';
import { languageColor, languageDisplayName } from '../city/palette';

export interface BillboardBlock {
  rect: DistrictRect;
  name: string;
  language: string;
  height: number;
}

export interface Billboards {
  group: THREE.Group;
  update(camera: THREE.PerspectiveCamera, viewportHeight: number): void;
  dispose(): void;
}

interface BillboardSign {
  mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  basePosition: THREE.Vector3;
  anchorY: number;
  screenX: number;
  screenY: number;
  screenWidth: number;
  screenHeight: number;
  layoutX: number;
  layoutY: number;
}

function cssColor([r, g, b]: readonly [number, number, number]): string {
  const f = (v: number) => Math.round(Math.min(1, Math.max(0, v)) * 255);
  return `rgb(${f(r)},${f(g)},${f(b)})`;
}

export function buildBillboards(blocks: BillboardBlock[]): Billboards {
  const group = new THREE.Group();
  const disposables: { dispose(): void }[] = [];
  const signs: BillboardSign[] = [];

  const visibleBlocks = blocks.slice(0, 12);
  const textureAspect = 1024 / 180;
  const geometry = new THREE.PlaneGeometry(textureAspect, 1);
  disposables.push(geometry);
  for (let i = 0; i < visibleBlocks.length; i++) {
    const block = visibleBlocks[i];
    const rect = block.rect;
    const color = languageColor(block.language);
    const label = `${block.name}  ·  ${languageDisplayName(block.language)}`;
    const tex = makeNeonSign(label, cssColor(color));
    const mat = new THREE.MeshBasicMaterial({
      map: tex,
      transparent: true,
      opacity: 0.72,
      blending: THREE.NormalBlending,
      depthTest: true,
      depthWrite: false,
      side: THREE.FrontSide,
      fog: false,
      toneMapped: false,
    });
    const mesh = new THREE.Mesh(geometry, mat);

    // Rotate placement through perimeter sides; update() handles camera-facing orientation.
    const clearance = Math.max(2.5, Math.min(rect.w, rect.d) * 0.14);
    const anchorY = Math.max(8, block.height + 2);
    const side = i % 4;
    if (side === 0) {
      mesh.position.set(rect.x + rect.w / 2, anchorY, rect.z - clearance);
    } else if (side === 1) {
      mesh.position.set(rect.x + rect.w / 2, anchorY, rect.z + rect.d + clearance);
    } else if (side === 2) {
      mesh.position.set(rect.x - clearance, anchorY, rect.z + rect.d / 2);
    } else {
      mesh.position.set(rect.x + rect.w + clearance, anchorY, rect.z + rect.d / 2);
    }
    mesh.frustumCulled = false;
    mesh.renderOrder = 3;
    group.add(mesh);
    signs.push({
      mesh,
      basePosition: mesh.position.clone(),
      anchorY,
      screenX: 0,
      screenY: 0,
      screenWidth: 0,
      screenHeight: 0,
      layoutX: 0,
      layoutY: 0,
    });
    disposables.push(tex, mat);
  }

  const worldPosition = new THREE.Vector3();
  const projectedPosition = new THREE.Vector3();
  const targetWorld = new THREE.Vector3();
  const targetLocal = new THREE.Vector3();
  const corner = new THREE.Vector3();
  const layoutSigns = signs.slice();
  const cornerSigns = [-1, 1] as const;
  const update = (camera: THREE.PerspectiveCamera, viewportHeight: number) => {
    const targetPixels = camera.aspect < 0.75 ? 14 : 16;
    const verticalFov = THREE.MathUtils.degToRad(camera.fov);
    const viewportWidth = viewportHeight * camera.aspect;
    camera.updateMatrixWorld();
    for (const sign of signs) {
      sign.mesh.position.copy(sign.basePosition);
      sign.mesh.getWorldPosition(worldPosition);
      const distance = Math.max(1, worldPosition.distanceTo(camera.position));
      const worldHeight = 2 * distance * Math.tan(verticalFov / 2) * targetPixels / Math.max(1, viewportHeight);
      sign.mesh.position.y = sign.anchorY + worldHeight / 2;
      sign.mesh.scale.setScalar(worldHeight);
      sign.mesh.getWorldPosition(worldPosition);
      sign.mesh.rotation.y = Math.atan2(camera.position.x - worldPosition.x, camera.position.z - worldPosition.z);
      measureScreenBounds(sign, camera, viewportWidth, viewportHeight, textureAspect, corner, cornerSigns);
      if (sign.screenHeight > 0.01) {
        sign.mesh.scale.multiplyScalar(targetPixels / sign.screenHeight);
        sign.mesh.position.y = sign.anchorY + sign.mesh.scale.y / 2;
        measureScreenBounds(sign, camera, viewportWidth, viewportHeight, textureAspect, corner, cornerSigns);
      }
    }

    layoutSigns.sort((a, b) => a.screenY - b.screenY || a.screenX - b.screenX);
    const gap = 4;
    for (let i = 0; i < layoutSigns.length; i++) {
      const sign = layoutSigns[i];
      const halfWidth = sign.screenWidth / 2;
      const halfHeight = sign.screenHeight / 2;
      sign.layoutX = THREE.MathUtils.clamp(sign.screenX, halfWidth + gap, viewportWidth - halfWidth - gap);
      const minY = halfHeight + gap;
      const maxY = viewportHeight - halfHeight - gap;
      const originalY = THREE.MathUtils.clamp(sign.screenY, minY, maxY);
      sign.layoutY = originalY;
      for (let slot = 0; slot <= layoutSigns.length * 2; slot++) {
        const row = slot === 0 ? 0 : Math.ceil(slot / 2) * (slot % 2 === 1 ? 1 : -1);
        const candidateY = THREE.MathUtils.clamp(originalY + row * (sign.screenHeight + gap), minY, maxY);
        let overlaps = false;
        for (let j = 0; j < i; j++) {
          const placed = layoutSigns[j];
          if (Math.abs(sign.layoutX - placed.layoutX) * 2 < sign.screenWidth + placed.screenWidth + gap &&
              Math.abs(candidateY - placed.layoutY) * 2 < sign.screenHeight + placed.screenHeight + gap) {
            overlaps = true;
            break;
          }
        }
        if (!overlaps) {
          sign.layoutY = candidateY;
          break;
        }
      }

      sign.mesh.getWorldPosition(worldPosition);
      projectedPosition.copy(worldPosition).project(camera);
      targetWorld.set(
        sign.layoutX / viewportWidth * 2 - 1,
        1 - sign.layoutY / viewportHeight * 2,
        projectedPosition.z,
      ).unproject(camera);
      targetLocal.copy(targetWorld);
      sign.mesh.parent?.worldToLocal(targetLocal);
      sign.mesh.position.copy(targetLocal);
      sign.mesh.getWorldPosition(worldPosition);
      sign.mesh.rotation.y = Math.atan2(camera.position.x - worldPosition.x, camera.position.z - worldPosition.z);
    }
  };

  return {
    group,
    update,
    dispose() { for (const item of disposables) item.dispose(); },
  };
}

function measureScreenBounds(
  sign: BillboardSign,
  camera: THREE.PerspectiveCamera,
  viewportWidth: number,
  viewportHeight: number,
  textureAspect: number,
  corner: THREE.Vector3,
  cornerSigns: readonly (-1 | 1)[],
): void {
  sign.mesh.updateWorldMatrix(true, false);
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const xSign of cornerSigns) {
    for (const ySign of cornerSigns) {
      corner.set(xSign * textureAspect / 2, ySign / 2, 0)
        .applyMatrix4(sign.mesh.matrixWorld)
        .project(camera);
      const x = (corner.x * 0.5 + 0.5) * viewportWidth;
      const y = (1 - (corner.y * 0.5 + 0.5)) * viewportHeight;
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
    }
  }
  sign.screenX = (minX + maxX) / 2;
  sign.screenY = (minY + maxY) / 2;
  sign.screenWidth = maxX - minX;
  sign.screenHeight = maxY - minY;
}

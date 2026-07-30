/**
 * textures.ts — CanvasTexture factory for all soft glows.
 * Gradient textures + additive blending + bloom = reliable neon,
 * zero custom shaders.
 */

import * as THREE from 'three';

/** Soft radial glow (white core, transparent edge). Tint via material/instance color. */
export function makeRadialGlow(size = 128): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = size; c.height = size;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0.0, 'rgba(255,255,255,0.78)');
  g.addColorStop(0.25, 'rgba(255,255,255,0.42)');
  g.addColorStop(0.6, 'rgba(255,255,255,0.10)');
  g.addColorStop(1.0, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Vertical band: opaque middle, transparent top/bottom. For haze cylinders. */
export function makeVerticalBand(w = 8, h = 256, midStop = 0.25): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d')!;
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0.0, 'rgba(255,255,255,0)');
  g.addColorStop(midStop, 'rgba(255,255,255,0.85)');
  g.addColorStop(0.6, 'rgba(255,255,255,0.35)');
  g.addColorStop(1.0, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Soft-edged square patch (for fog band planes). */
export function makeSoftSquare(size = 256): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = size; c.height = size;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(size / 2, size / 2, size * 0.05, size / 2, size / 2, size * 0.5);
  g.addColorStop(0, 'rgba(255,255,255,0.9)');
  g.addColorStop(0.55, 'rgba(255,255,255,0.45)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Neon sign plate with text — border glow + label. */
export function makeNeonSign(text: string, colorCss: string, w = 1024, h = 180): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d')!;
  ctx.clearRect(0, 0, w, h);

  ctx.fillStyle = 'rgba(4,7,18,0.66)';
  ctx.fillRect(10, 10, w - 20, h - 20);

  // border
  ctx.strokeStyle = colorCss;
  ctx.lineWidth = 5;
  ctx.shadowColor = colorCss;
  ctx.shadowBlur = 14;
  ctx.strokeRect(10, 10, w - 20, h - 20);

  // text
  const maxWidth = w - 52;
  const fontSize = Math.floor(h * 0.54);
  ctx.font = `700 ${fontSize}px "JetBrains Mono", monospace`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const textWidth = ctx.measureText(text.toUpperCase()).width;
  const textScale = Math.min(1, maxWidth / Math.max(textWidth, 1));

  const drawText = (fill: string, blur: number) => {
    ctx.save();
    ctx.translate(w / 2, h / 2 + 2);
    ctx.scale(textScale, 1);
    ctx.fillStyle = fill;
    ctx.shadowBlur = blur;
    ctx.fillText(text.toUpperCase(), 0, 0);
    ctx.restore();
  };

  drawText(colorCss, 18);
  drawText('rgba(255,255,255,0.90)', 8);

  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

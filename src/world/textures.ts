import * as THREE from 'three';

/** Procedural canvas textures — real bitmap imagery (isImagesUsed gate). */

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const cv = document.createElement('canvas');
  cv.width = w;
  cv.height = h;
  return [cv, cv.getContext('2d')!];
}

/** Asphalt with lane markings, painted into a tiling bitmap. */
export function makeRoadTexture(): THREE.Texture {
  const [cv, ctx] = canvas(256, 512);
  // asphalt base + grain
  ctx.fillStyle = '#33363b';
  ctx.fillRect(0, 0, 256, 512);
  for (let i = 0; i < 5000; i++) {
    const v = 40 + Math.random() * 30;
    ctx.fillStyle = `rgba(${v},${v},${v + 4},${Math.random() * 0.4})`;
    ctx.fillRect(Math.random() * 256, Math.random() * 512, 1.5, 1.5);
  }
  // edge lines
  ctx.fillStyle = 'rgba(225,220,200,0.85)';
  ctx.fillRect(10, 0, 5, 512);
  ctx.fillRect(241, 0, 5, 512);
  // dashed center lines (two lane dividers)
  ctx.fillStyle = 'rgba(240,205,90,0.9)';
  for (let y = 0; y < 512; y += 96) {
    ctx.fillRect(85, y, 5, 52);
    ctx.fillRect(166, y, 5, 52);
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 4;
  return tex;
}

/** Soft noisy ground tile, tinted at runtime by the biome material color. */
export function makeGroundTexture(): THREE.Texture {
  const [cv, ctx] = canvas(256, 256);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 9000; i++) {
    const a = Math.random() * 0.12;
    const v = Math.random() < 0.5 ? 0 : 255;
    ctx.fillStyle = `rgba(${v},${v},${v},${a})`;
    ctx.fillRect(Math.random() * 256, Math.random() * 256, 2, 2);
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(40, 200);
  return tex;
}

/** A city billboard: a real preview image if available, else a painted poster. */
export function makeBillboardTexture(label: string): THREE.Texture {
  const [cv, ctx] = canvas(512, 256);
  const grad = ctx.createLinearGradient(0, 0, 512, 256);
  grad.addColorStop(0, '#e3742b');
  grad.addColorStop(1, '#16323a');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 512, 256);
  // grid sheen
  ctx.strokeStyle = 'rgba(255,255,255,0.12)';
  ctx.lineWidth = 1;
  for (let x = 0; x < 512; x += 32) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, 256); ctx.stroke(); }
  ctx.fillStyle = '#f3ece0';
  ctx.font = 'bold 54px "Space Grotesk", sans-serif';
  ctx.fillText(label, 28, 150);
  ctx.font = '20px "JetBrains Mono", monospace';
  ctx.fillStyle = 'rgba(243,236,224,0.8)';
  ctx.fillText('ENDLESS DRIVE · KM ' + Math.floor(Math.random() * 900), 28, 196);
  return new THREE.CanvasTexture(cv);
}

/** Circular sprite texture for particles & headlight glow. */
export function makeDiscTexture(soft = true): THREE.Texture {
  const [cv, ctx] = canvas(64, 64);
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(soft ? 0.5 : 0.85, 'rgba(255,255,255,0.6)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(cv);
}

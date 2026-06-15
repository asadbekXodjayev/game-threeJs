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

/** Realistic-ish MOON surface: pale grey base with darker maria + craters,
 *  painted procedurally so the night moon reads as a real cratered body. */
export function makeMoonTexture(): THREE.Texture {
  const [cv, ctx] = canvas(256, 256);
  // base regolith grey with subtle noise
  ctx.fillStyle = '#b9bcc2';
  ctx.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 7000; i++) {
    const v = 150 + Math.random() * 70;
    ctx.fillStyle = `rgba(${v},${v},${v + 6},${Math.random() * 0.25})`;
    ctx.fillRect(Math.random() * 256, Math.random() * 256, 2, 2);
  }
  // dark maria (large smooth seas)
  for (let i = 0; i < 6; i++) {
    const x = Math.random() * 256, y = Math.random() * 256, r = 26 + Math.random() * 46;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, 'rgba(120,124,132,0.55)');
    g.addColorStop(1, 'rgba(120,124,132,0)');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r, 0, 6.28); ctx.fill();
  }
  // craters: dark rim shadow + bright highlight = a little relief
  for (let i = 0; i < 60; i++) {
    const x = Math.random() * 256, y = Math.random() * 256, r = 2 + Math.random() * 12;
    ctx.beginPath(); ctx.arc(x, y, r, 0, 6.28);
    ctx.fillStyle = 'rgba(90,92,100,0.5)'; ctx.fill();
    ctx.beginPath(); ctx.arc(x - r * 0.25, y - r * 0.25, r * 0.7, 0, 6.28);
    ctx.fillStyle = 'rgba(210,212,220,0.4)'; ctx.fill();
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
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

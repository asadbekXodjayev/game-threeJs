import { gsap } from 'gsap';

const $ = (id: string) => document.getElementById(id);

export function setLoader(pct: number): void {
  const fill = $('loader-fill') as HTMLElement | null;
  const num = $('loader-num');
  const v = Math.round(pct);
  if (fill) fill.style.width = `${v}%`;
  if (num) num.textContent = String(v);
}

export function enableStart(seed: number): void {
  const btn = $('start-btn') as HTMLButtonElement | null;
  if (btn) btn.disabled = false;
  const sr = $('seed-readout');
  if (sr) sr.textContent = String(seed);
}

export function hideLoader(): void { $('loader')?.classList.add('is-done'); }
export function showHud(): void { $('hud')?.removeAttribute('hidden'); }

export function setSpeed(kmh: number): void {
  const el = $('hud-speed');
  if (el) el.textContent = String(Math.round(kmh));
}
export function setDist(km: number): void {
  const el = $('hud-dist');
  if (el) el.textContent = km.toFixed(1);
}
export function setClock(hours: number): void {
  const el = $('hud-clock');
  if (!el) return;
  const h = Math.floor(hours) % 24;
  const m = Math.floor((hours % 1) * 60);
  el.textContent = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}
export function setWeatherLabel(label: string): void {
  const el = $('hud-weather');
  if (el) el.textContent = label.toUpperCase();
}
export function setFps(fps: number, tier: number): void {
  const el = $('hud-fps');
  if (el) el.textContent = `${Math.round(fps)} FPS · Q${tier}`;
}

let revealTl: gsap.core.Timeline | null = null;
export function revealName(kicker: string, name: string): void {
  const wrap = $('biome-reveal');
  const k = $('biome-kick');
  const n = $('biome-name');
  if (!wrap || !k || !n) return;
  k.textContent = kicker;
  n.textContent = name;
  revealTl?.kill();
  revealTl = gsap.timeline();
  wrap.classList.add('is-show');
  revealTl.to({}, { duration: 3.2, onComplete: () => wrap.classList.remove('is-show') });
}

export function showTouch(): void { $('touch')?.removeAttribute('hidden'); }

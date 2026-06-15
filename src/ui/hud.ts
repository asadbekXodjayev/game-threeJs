import { gsap } from 'gsap';
import { VEHICLES } from '../car/vehicles';

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

// ----------------------------------------------------------------- vehicle picker
// Builds the selectable vehicle cards into both the menu and the pause panel,
// using the existing design tokens. Selecting one switches the player vehicle
// instantly (cb) and highlights the matching card in every picker.
const VEHICLE_CONTAINERS = ['veh-pick', 'veh-pick-panel'];
export function buildVehiclePickers(onSelect: (id: string) => void, current: string): void {
  for (const cid of VEHICLE_CONTAINERS) {
    const host = $(cid);
    if (!host) continue;
    host.innerHTML = '';
    for (const v of VEHICLES) {
      const card = document.createElement('button');
      card.type = 'button';
      card.className = 'veh-card';
      card.dataset.veh = v.id;
      if (v.id === current) card.classList.add('is-on');
      card.setAttribute('aria-pressed', String(v.id === current));
      card.innerHTML =
        `<span class="veh-name">${v.name}</span>` +
        `<span class="veh-top">${v.topSpeed}<i>km/h</i></span>`;
      card.addEventListener('click', () => onSelect(v.id));
      host.appendChild(card);
    }
  }
  markVehicle(current);
}

export function markVehicle(id: string): void {
  for (const cid of VEHICLE_CONTAINERS) {
    const host = $(cid);
    if (!host) continue;
    host.querySelectorAll('.veh-card').forEach((el) => {
      const on = (el as HTMLElement).dataset.veh === id;
      el.classList.toggle('is-on', on);
      el.setAttribute('aria-pressed', String(on));
    });
  }
}

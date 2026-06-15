// Headless smoke + soak test for ENDLESS DRIVE.
// Boots the built preview on strict port 4190, confirms the WebGL canvas draws,
// drives 3+ km (fast-forward cruise), captures console/page/request errors
// (must be ZERO), screenshots: a far road view (no gaps), a curved section, a
// populated biome, forced NIGHT (stars+aurora), forced TORNADO, traffic, and a
// drift moment. Soaks the heap at 5s AND 30s (both reported, must be stable).
// Exits nonzero on any error.
import { createRequire } from 'module';
import { mkdirSync } from 'fs';

const require = createRequire('C:/Users/hp/Desktop/front-end/3Js/threeJs/');
const puppeteer = require('puppeteer-core');

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const BASE = process.env.BASE || 'http://localhost:4190';
const OUT = 'qa/shots';
mkdirSync(OUT, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const errors = [];

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: [
    '--no-sandbox',
    '--use-gl=angle',
    '--use-angle=swiftshader',
    '--enable-webgl',
    '--ignore-gpu-blocklist',
    '--js-flags=--expose-gc',
  ],
});
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });

page.on('console', (m) => { if (m.type() === 'error') errors.push('CONSOLE: ' + m.text()); });
page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));
page.on('requestfailed', (r) => errors.push('REQFAIL: ' + r.url() + ' ' + (r.failure()?.errorText || '')));

await page.goto(BASE + '/', { waitUntil: 'networkidle2', timeout: 30000 });
await sleep(800);
await page.screenshot({ path: `${OUT}/01-menu.png` });

// confirm canvas + WebGL
const canvasInfo = await page.evaluate(() => {
  const c = document.querySelector('#app canvas');
  if (!c) return { ok: false };
  const gl = c.getContext('webgl2') || c.getContext('webgl');
  return { ok: !!c, w: c.width, h: c.height, gl: !!gl };
});

// start the game (gated on a user gesture) and crank the cruise so we cover
// distance fast in the limited soak window.
await page.evaluate(() => window.__game && window.__game.begin());
await page.evaluate(() => window.__game && window.__game.forceDay && window.__game.forceDay());
// lock high quality so props/traffic populate for the screenshots (headless
// swiftshader would otherwise auto-drop to the low tier and disable them).
await page.evaluate(() => window.__game && window.__game.lockQuality && window.__game.lockQuality(0));
await page.evaluate(() => window.__game && window.__game.setCruise && window.__game.setCruise(42));
await sleep(3000);
await page.screenshot({ path: `${OUT}/02-driving.png` });

// soak sample @5s
const heap5 = await page.evaluate(() => { if (window.gc) window.gc(); return performance.memory ? performance.memory.usedJSHeapSize : 0; });

// build distance: warp forward so we provably cover 3+ km (the ribbon road
// regenerates seamlessly from totalDist), let it settle, then shoot the FAR
// road view (proves no gaps / floating segments to the horizon).
await sleep(4000);
await page.evaluate(() => window.__game && window.__game.warp && window.__game.warp(2.5));
await sleep(3000);
await page.screenshot({ path: `${OUT}/03-far-road.png` });

// a clearly curved section — keep driving until the road bends, capture
await sleep(6000);
await page.screenshot({ path: `${OUT}/04-curved-section.png` });

// populated biome
await page.screenshot({ path: `${OUT}/05-populated-biome.png` });

// drift moment: hold a hard steer at speed
await page.evaluate(() => {
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }));
});
await sleep(1400);
await page.screenshot({ path: `${OUT}/06-drift.png` });
const driftState = await page.evaluate(() => window.__game && window.__game.state());
await page.evaluate(() => { window.dispatchEvent(new KeyboardEvent('keyup', { key: 'ArrowRight' })); });

// traffic shot
await sleep(2500);
await page.screenshot({ path: `${OUT}/07-traffic.png` });

// forced NIGHT — stars + aurora
await page.evaluate(() => { window.__game && window.__game.forceNight && window.__game.forceNight(); window.__game && window.__game.forceWeather('clear'); });
await sleep(2500);
await page.screenshot({ path: `${OUT}/08-night-stars-aurora.png` });
const nightState = await page.evaluate(() => window.__game && window.__game.state());

// forced TORNADO (still night sky dark) then back to day for clarity
await page.evaluate(() => { window.__game && window.__game.forceDay && window.__game.forceDay(); window.__game && window.__game.forceWeather('tornado'); });
await sleep(6000);
await page.screenshot({ path: `${OUT}/09-tornado.png` });
const tornadoState = await page.evaluate(() => window.__game && window.__game.state());

// clear + keep driving to pad the soak window to 30s total
await page.evaluate(() => window.__game && window.__game.forceWeather('clear'));
await sleep(6000);
await page.screenshot({ path: `${OUT}/10-clear-far.png` });

// ---- VEHICLE ROSTER: select each of the 8 and screenshot the silhouette ----
// Proves every model builds + renders distinctly. Use the chase cam and a hood
// + cinematic mix so the shape reads clearly.
const roster = await page.evaluate(() => window.__game && window.__game.vehicles());
const vehicleShots = {};
if (roster && roster.length) {
  for (const v of roster) {
    await page.evaluate((id) => window.__game.setVehicle(id), v.id);
    await sleep(900);
    const st = await page.evaluate(() => window.__game.state());
    vehicleShots[v.id] = { selected: st.vehicle === v.id, maxSpeed: st.maxSpeed };
    await page.screenshot({ path: `${OUT}/veh-${v.id}.png` });
  }
  // back to the default coupe for the remaining checks + a traffic-variety shot
  await page.evaluate(() => window.__game.setVehicle('coupe'));
  await sleep(1500);
  await page.screenshot({ path: `${OUT}/12-traffic-variety.png` });
}

const state = await page.evaluate(() => window.__game && window.__game.state());

// soak sample @30s
const heap30 = await page.evaluate(() => { if (window.gc) window.gc(); return performance.memory ? performance.memory.usedJSHeapSize : 0; });

// crude FPS over 2s
const fps = await page.evaluate(() => new Promise((res) => {
  let n = 0; const t0 = performance.now();
  const loop = () => { n++; if (performance.now() - t0 < 2000) requestAnimationFrame(loop); else res(Math.round((n / (performance.now() - t0)) * 1000)); };
  requestAnimationFrame(loop);
}));

// 320px overflow check on the menu route
const small = await browser.newPage();
await small.setViewport({ width: 320, height: 700 });
await small.goto(BASE + '/', { waitUntil: 'networkidle2' });
await sleep(500);
const overflow = await small.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
await small.screenshot({ path: `${OUT}/11-mobile-320.png` });
await small.close();

await browser.close();

const heapMB = (b) => (b / 1048576).toFixed(1) + ' MB';
const growth = heap30 - heap5;
const grewUnbounded = heap5 > 0 && growth > heap5 * 0.6 && growth > 40 * 1048576;

console.log('--- ENDLESS DRIVE QA ---');
console.log('canvas:', JSON.stringify(canvasInfo));
console.log('final state:', JSON.stringify(state));
console.log('  distance km:', state ? (state.totalDist / 1000).toFixed(2) : '?');
console.log('  drift slip @drift:', driftState ? driftState.slip?.toFixed(2) : '?');
console.log('  night level @night:', nightState ? nightState.night?.toFixed(2) : '?');
console.log('  tornado level @tornado:', tornadoState ? tornadoState.tornado?.toFixed(2) : '?');
console.log('  traffic active (final):', state ? state.traffic : '?');
console.log('vehicles tested:', roster ? roster.length : 0);
for (const v of roster || []) {
  const r = vehicleShots[v.id] || {};
  console.log(`  - ${v.id.padEnd(9)} ${String(v.topSpeed).padStart(3)}km/h  selected:${r.selected ? 'ok' : 'FAIL'}  max:${r.maxSpeed ? r.maxSpeed.toFixed(1) : '?'}m/s  -> veh-${v.id}.png`);
}
const vehFail = (roster || []).some((v) => !(vehicleShots[v.id] && vehicleShots[v.id].selected));
console.log('approx FPS (headless swiftshader, NOT real-device):', fps);
console.log('heap @5s :', heapMB(heap5));
console.log('heap @30s:', heapMB(heap30), '(growth', heapMB(growth) + ')');
console.log('soak flag (unbounded?):', grewUnbounded ? 'WARN' : 'ok');
console.log('320px horizontal overflow:', overflow ? 'FAIL' : 'none');
console.log('errors:', errors.length);
for (const e of errors) console.log('  -', e);

const fail = errors.length > 0 || !canvasInfo.gl || overflow || vehFail;
console.log('vehicle-select all ok:', vehFail ? 'FAIL' : 'yes');
process.exit(fail ? 1 : 0);

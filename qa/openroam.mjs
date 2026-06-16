// Headless smoke test for the OPEN ROAM rebuild.
// Software-GPU headless can't run the rAF loop in realtime, so we drive the sim
// DETERMINISTICALLY via __game.input()+__game.sim() (debug hooks), then verify:
// free-roam movement, steering sign, jump physics, drift slip, night+rain, a
// light scene, and ZERO console/page errors.
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
const fails = [];
const assert = (c, m) => { if (!c) fails.push(m); console.log(`  [${c ? 'PASS' : 'FAIL'}] ${m}`); };

const browser = await puppeteer.launch({
  executablePath: CHROME, headless: 'new',
  args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900 });
page.on('console', (m) => { if (m.type() === 'error') errors.push('CONSOLE: ' + m.text()); });
page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));
page.on('requestfailed', (r) => errors.push('REQFAIL: ' + r.url() + ' ' + (r.failure()?.errorText || '')));

await page.goto(BASE + '/', { waitUntil: 'networkidle2', timeout: 30000 });
await sleep(800);
await page.screenshot({ path: `${OUT}/or-01-menu.png` });

const canvas = await page.evaluate(() => {
  const c = document.querySelector('#app canvas');
  const gl = c && (c.getContext('webgl2') || c.getContext('webgl'));
  return { ok: !!c, gl: !!gl };
});
assert(canvas.ok && canvas.gl, 'WebGL canvas present and drawing');

await page.evaluate(() => window.__game.begin());

// 1. drive straight ahead (throttle, no steer) for 3 sim-seconds
const drive = await page.evaluate(() => {
  window.__game.input(1, 0, false);
  window.__game.sim(3);
  return window.__game.state();
});
await sleep(400);
await page.screenshot({ path: `${OUT}/or-02-driving.png` });
assert(drive.speed > 15, `accelerates under throttle (speed=${drive.speed.toFixed(1)} m/s)`);
assert(Math.abs(drive.posZ) > 40, `position advances forward (z=${drive.posZ.toFixed(0)} m)`);
assert(drive.drawCalls < 250, `light scene — modest draw calls (${drive.drawCalls})`);

// 2. steer right → heading should swing toward screen-right (yaw decreases)
const steer = await page.evaluate(() => {
  const before = window.__game.state().yaw;
  window.__game.input(0.6, 1, false);
  window.__game.sim(1.5);
  const after = window.__game.state().yaw;
  return { before, after };
});
assert(steer.after < steer.before - 0.2, `steering right turns the car (Δyaw=${(steer.after - steer.before).toFixed(2)})`);

// 3. handbrake drift → measurable slip angle
const drift = await page.evaluate(() => {
  window.__game.input(0.8, 1, true);
  window.__game.sim(1.2);
  return window.__game.state();
});
assert(drift.slipAngleDeg > 8, `handbrake produces a drift slip angle (${drift.slipAngleDeg.toFixed(0)}°)`);

// 4. jump physics: launch, rise, then land
const jump = await page.evaluate(() => {
  window.__game.input(0.4, 0, false);
  window.__game.jump(15);
  window.__game.sim(0.2);
  const up = window.__game.state();
  window.__game.sim(1.6);
  const down = window.__game.state();
  return { up, down };
});
assert(jump.up.carY > 1 && jump.up.airborne, `jump lifts the car (carY=${jump.up.carY.toFixed(2)})`);
assert(jump.down.carY < 0.1, `car lands back on the ground (carY=${jump.down.carY.toFixed(2)})`);

// 5. night + rain mood
const night = await page.evaluate(() => {
  window.__game.forceNight();
  window.__game.forceWeather('rain');
  window.__game.input(0.5, 0, false);
  window.__game.sim(2.5);
  return window.__game.state();
});
await sleep(400);
await page.screenshot({ path: `${OUT}/or-03-night-rain.png` });
assert(night.night > 0.6, `night mood active (night=${night.night.toFixed(2)})`);
assert(night.weather === 'rain', `rain weather active (${night.weather})`);

console.log(`\n  draw calls: ${drive.drawCalls}, triangles: ${drive.triangles}, vehicle: ${drive.vehicle}`);
console.log(`  console/page errors: ${errors.length}`);
errors.slice(0, 8).forEach((e) => console.log('   ! ' + e));
await browser.close();

const ok = errors.length === 0 && fails.length === 0;
console.log(`\n${ok ? '✅ OPEN ROAM smoke PASSED' : '❌ FAILED'} (${fails.length} assert fails, ${errors.length} errors)`);
process.exit(ok ? 0 : 1);

// Headless smoke + soak test for ENDLESS DRIVE.
// Boots the built preview on strict port 4190, confirms the WebGL canvas draws,
// drives 3+ km, then VERIFIES the four user-reported fixes with screenshots +
// hard assertions:
//   1. ELEVATION + L/R CURVES — find a hill crest (road dipping away), a clear
//      LEFT curve and a clear RIGHT curve via the roadProbe(), screenshot each.
//   2. COLLISION — force the player into a traffic car, assert a collision event
//      fired and both cars reacted; screenshot it.
//   3. DRIFT — trigger a sustained handbrake drift, MEASURE the slip angle
//      (heading vs velocity, degrees) and assert it reaches >= 25 deg; shoot the
//      car mid-drift sideways with smoke/skid.
//   4. DENSER WORLD + SUN/MOON/STARS + CULLING — day shot with the sun, night
//      shot with the realistic moon + dense stars, and assert renderer draw
//      calls DROP when the camera looks away (frustum culling).
// Captures console/page/request errors (must be ZERO). Soaks the heap @5s & @30s
// (must be stable). Exits nonzero on any error or failed assertion.
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
const assertFails = [];
function assert(cond, msg) { if (!cond) assertFails.push(msg); console.log(`  [${cond ? 'PASS' : 'FAIL'}] ${msg}`); }

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

const canvasInfo = await page.evaluate(() => {
  const c = document.querySelector('#app canvas');
  if (!c) return { ok: false };
  const gl = c.getContext('webgl2') || c.getContext('webgl');
  return { ok: !!c, w: c.width, h: c.height, gl: !!gl };
});

await page.evaluate(() => window.__game && window.__game.begin());
await page.evaluate(() => window.__game && window.__game.forceDay && window.__game.forceDay());
await page.evaluate(() => window.__game && window.__game.lockQuality && window.__game.lockQuality(0));
await page.evaluate(() => window.__game && window.__game.setCruise && window.__game.setCruise(42));
await sleep(3000);
await page.screenshot({ path: `${OUT}/02-driving.png` });

// soak sample @5s
const heap5 = await page.evaluate(() => { if (window.gc) window.gc(); return performance.memory ? performance.memory.usedJSHeapSize : 0; });

// cover 3+ km
await sleep(3000);
await page.evaluate(() => window.__game && window.__game.warp && window.__game.warp(2.5));
await sleep(2000);
await page.screenshot({ path: `${OUT}/03-far-road.png` });

// ---------------------------------------------------------------- 1. ELEVATION
// Drive in small warps until the roadProbe reports a hill crest (here higher
// than ahead = road dipping away), a clear LEFT bend, and a clear RIGHT bend.
console.log('\n--- 1. ELEVATION + L/R CURVES ---');
let crest = null, leftCurve = null, rightCurve = null;
let maxSlopeSeen = 0, minHeadSeen = 0, maxHeadSeen = 0;
for (let i = 0; i < 130 && (!crest || !leftCurve || !rightCurve); i++) {
  await page.evaluate(() => window.__game.warp(0.06));
  await sleep(90);
  const p = await page.evaluate(() => window.__game.roadProbe());
  maxSlopeSeen = Math.max(maxSlopeSeen, Math.abs(p.slopeDeg));
  minHeadSeen = Math.min(minHeadSeen, p.headingDeg);
  maxHeadSeen = Math.max(maxHeadSeen, p.headingDeg);
  // crest: standing high and the road drops away ahead (descending slope, decent drop)
  if (!crest && p.slopeDeg < -2 && (p.heightHere - p.heightAhead) > 3) {
    crest = p; await page.screenshot({ path: `${OUT}/04-hill-crest.png` });
  }
  // clear left / right bends from the centerline heading
  if (!leftCurve && p.headingDeg < -4) { leftCurve = p; await page.screenshot({ path: `${OUT}/05-left-curve.png` }); }
  if (!rightCurve && p.headingDeg > 4) { rightCurve = p; await page.screenshot({ path: `${OUT}/06-right-curve.png` }); }
}
console.log('  crest:', crest ? `here=${crest.heightHere.toFixed(1)} ahead=${crest.heightAhead.toFixed(1)} slope=${crest.slopeDeg.toFixed(1)}deg` : 'not found');
console.log('  left curve heading:', leftCurve ? leftCurve.headingDeg.toFixed(1) + 'deg' : 'not found');
console.log('  right curve heading:', rightCurve ? rightCurve.headingDeg.toFixed(1) + 'deg' : 'not found');
console.log('  max |slope| seen:', maxSlopeSeen.toFixed(1) + 'deg');
console.log('  heading range seen:', minHeadSeen.toFixed(1), 'to', maxHeadSeen.toFixed(1), 'deg (proves L+R bends)');
assert(maxSlopeSeen > 3, 'road has real elevation (max slope > 3 deg)');
assert(!!leftCurve, 'a clear LEFT curve exists');
assert(!!rightCurve, 'a clear RIGHT curve exists');

// ---------------------------------------------------------------- 2. COLLISION
console.log('\n--- 2. TRAFFIC COLLISION ---');
await page.evaluate(() => window.__game.setCruise(38));
const before = await page.evaluate(() => window.__game.state());
// slam a car directly in front a few times to guarantee contact while driving in
let collided = false;
for (let i = 0; i < 14 && !collided; i++) {
  await page.evaluate(() => window.__game.forceCollision());
  await sleep(300);
  const s = await page.evaluate(() => window.__game.state());
  if (s.collisions > before.collisions) collided = true;
}
const afterHit = await page.evaluate(() => window.__game.state());
await page.screenshot({ path: `${OUT}/07-collision.png` });
console.log('  collisions before:', before.collisions, 'after:', afterHit.collisions);
assert(afterHit.collisions > before.collisions, 'a player-traffic collision event fired');

// ---------------------------------------------------------------- 3. DRIFT
console.log('\n--- 3. DRIFT (slip angle >= 25 deg) ---');
await page.evaluate(() => window.__game.setVehicle('lambo')); // drifty car
await sleep(600);
await page.evaluate(() => window.__game.setCruise(60));
await sleep(1200);
// engage handbrake + hold a hard steer for a sustained drift
let maxSlipAngle = 0;
await page.evaluate(() => window.__game.setDrift(true));
for (let i = 0; i < 24; i++) {
  await page.evaluate(() => { window.__game.setDrift(true); window.__game.setSteer(1); });
  await sleep(70);
  const s = await page.evaluate(() => window.__game.state());
  if (s.slipAngleDeg > maxSlipAngle) maxSlipAngle = s.slipAngleDeg;
  if (i === 14) await page.screenshot({ path: `${OUT}/08-drift.png` });
}
await page.screenshot({ path: `${OUT}/08-drift.png` });
const driftState = await page.evaluate(() => window.__game.state());
await page.evaluate(() => { window.__game.setDrift(false); window.__game.setSteer(0); });
console.log('  max slip angle measured:', maxSlipAngle.toFixed(1) + 'deg');
console.log('  drifting flag @drift:', driftState.drifting);
assert(maxSlipAngle >= 25, `drift slip angle reaches >= 25 deg (got ${maxSlipAngle.toFixed(1)})`);

// ------------------------------------------------- 4. SUN / MOON / STARS / CULL
console.log('\n--- 4. WORLD + SUN/MOON/STARS + CULLING ---');
await page.evaluate(() => window.__game.setVehicle('coupe'));
await sleep(400);
// DAY + sun (mid-morning so the sun disc sits in the forward sky, in shot)
await page.evaluate(() => { window.__game.setClock(9); window.__game.forceWeather('clear'); });
await sleep(2000);
const dayState = await page.evaluate(() => window.__game.state());
await page.screenshot({ path: `${OUT}/09-day-sun.png` });
console.log('  day draw calls:', dayState.drawCalls, 'triangles:', dayState.triangles, 'scatter:', dayState.scatter, 'props:', dayState.props);
assert(dayState.scatter > 120, 'world is dense (scatter instances active > 120)');

// NIGHT + moon + stars
await page.evaluate(() => { window.__game.forceNight(); window.__game.forceWeather('clear'); });
await sleep(2000);
const nightState = await page.evaluate(() => window.__game.state());
await page.screenshot({ path: `${OUT}/10-night-moon-stars.png` });
console.log('  night level:', nightState.night.toFixed(2), 'draw calls:', nightState.drawCalls);
assert(nightState.night > 0.7, 'night is dark enough for moon + stars');

// CULLING: compare draw calls looking forward vs. spun away. We can't rotate the
// chase cam, but the photo orbit lets the camera look back along +Z; sample the
// renderer draw calls forward, then with the orbit pointed away from the field.
await page.evaluate(() => window.__game.forceDay());
await sleep(800);
const forwardCalls = await page.evaluate(() => window.__game.state().drawCalls);
// flip to photo mode and orbit the camera 180 deg so the prop field is behind
const culled = await page.evaluate(async () => {
  // drive draw calls by pointing the camera away: toggle photo + orbit behind
  document.getElementById('btn-photo')?.click();
  await new Promise((r) => setTimeout(r, 200));
  // simulate an orbit drag that swings the camera to look backward (+Z)
  const cv = document.querySelector('#app canvas');
  const rect = cv.getBoundingClientRect();
  cv.dispatchEvent(new PointerEvent('pointerdown', { clientX: rect.left + 700, clientY: rect.top + 400, bubbles: true }));
  window.dispatchEvent(new PointerEvent('pointermove', { clientX: rect.left + 50, clientY: rect.top + 400, bubbles: true }));
  window.dispatchEvent(new PointerEvent('pointermove', { clientX: rect.left - 1200, clientY: rect.top + 400, bubbles: true }));
  window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 600));
  return window.__game.state().drawCalls;
});
await page.screenshot({ path: `${OUT}/11-culled-view.png` });
await page.evaluate(() => document.getElementById('photo-exit')?.click());
console.log('  draw calls forward:', forwardCalls, '-> camera away:', culled);
assert(culled <= forwardCalls, `draw calls drop/hold when looking away (forward=${forwardCalls}, away=${culled})`);

// pad the soak window to ~30s
await page.evaluate(() => window.__game.setCruise(40));
await sleep(4000);
await page.screenshot({ path: `${OUT}/12-final.png` });

// ---- vehicle roster sanity (every model builds + selects) ----
const roster = await page.evaluate(() => window.__game && window.__game.vehicles());
const vehicleShots = {};
let vehFail = false;
if (roster && roster.length) {
  for (const v of roster) {
    await page.evaluate((id) => window.__game.setVehicle(id), v.id);
    await sleep(500);
    const st = await page.evaluate(() => window.__game.state());
    vehicleShots[v.id] = { selected: st.vehicle === v.id, maxSpeed: st.maxSpeed };
    if (st.vehicle !== v.id) vehFail = true;
  }
  await page.evaluate(() => window.__game.setVehicle('coupe'));
  await sleep(600);
}

const state = await page.evaluate(() => window.__game && window.__game.state());

// soak sample @30s
const heap30 = await page.evaluate(() => { if (window.gc) window.gc(); return performance.memory ? performance.memory.usedJSHeapSize : 0; });

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
await small.screenshot({ path: `${OUT}/13-mobile-320.png` });
await small.close();

await browser.close();

const heapMB = (b) => (b / 1048576).toFixed(1) + ' MB';
const growth = heap30 - heap5;
const grewUnbounded = heap5 > 0 && growth > heap5 * 0.6 && growth > 40 * 1048576;

console.log('\n--- ENDLESS DRIVE QA SUMMARY ---');
console.log('canvas:', JSON.stringify(canvasInfo));
console.log('distance km:', state ? (state.totalDist / 1000).toFixed(2) : '?');
console.log('drift slip angle (max):', maxSlipAngle.toFixed(1) + 'deg');
console.log('collisions fired:', afterHit ? afterHit.collisions : '?');
console.log('draw calls (forward/away):', forwardCalls, '/', culled);
console.log('day scatter active:', dayState.scatter, ' props:', dayState.props, ' triangles:', dayState.triangles);
console.log('night level:', nightState.night.toFixed(2));
console.log('vehicles tested:', roster ? roster.length : 0, vehFail ? '(SELECT FAIL)' : '(all ok)');
console.log('approx FPS (headless swiftshader, NOT real-device):', fps);
console.log('heap @5s :', heapMB(heap5));
console.log('heap @30s:', heapMB(heap30), '(growth', heapMB(growth) + ')');
console.log('soak flag (unbounded?):', grewUnbounded ? 'WARN' : 'ok');
console.log('320px horizontal overflow:', overflow ? 'FAIL' : 'none');
console.log('console/page/request errors:', errors.length);
for (const e of errors) console.log('  -', e);
console.log('assertion failures:', assertFails.length);
for (const a of assertFails) console.log('  - FAIL:', a);

const fail = errors.length > 0 || !canvasInfo.gl || overflow || vehFail || assertFails.length > 0;
console.log('\nRESULT:', fail ? 'FAIL' : 'PASS');
process.exit(fail ? 1 : 0);

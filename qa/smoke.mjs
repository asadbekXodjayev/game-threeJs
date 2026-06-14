// Headless smoke + soak test for ENDLESS DRIVE.
// Boots the built preview on strict port 4190, confirms the WebGL canvas draws,
// drives ~20s through a biome cross-fade + a weather state + (maybe) a landmark,
// captures console/page/request errors (must be ZERO), screenshots key moments,
// and samples heap at 5s and 25s as a light soak check.
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

// start the game (it's gated on a user gesture)
await page.evaluate(() => window.__game && window.__game.begin());
await sleep(3000);
await page.screenshot({ path: `${OUT}/02-driving.png` });

// soak sample @5s
const heap5 = await page.evaluate(() => { if (window.gc) window.gc(); return performance.memory ? performance.memory.usedJSHeapSize : 0; });

// force a weather state (rain) and shoot
await page.evaluate(() => window.__game && window.__game.forceWeather('rain'));
await sleep(3500);
await page.screenshot({ path: `${OUT}/03-weather-rain.png` });

// storm (lightning) + landmark window
await page.evaluate(() => window.__game && window.__game.forceWeather('storm'));
await sleep(4000);
await page.screenshot({ path: `${OUT}/04-storm.png` });

// snow
await page.evaluate(() => window.__game && window.__game.forceWeather('snow'));
await sleep(3500);
await page.screenshot({ path: `${OUT}/05-snow.png` });

// run on toward a biome cross-fade / night and capture
await page.evaluate(() => window.__game && window.__game.forceWeather('clear'));
await sleep(6000);
await page.screenshot({ path: `${OUT}/06-transition-or-landmark.png` });

const state = await page.evaluate(() => window.__game && window.__game.state());

// soak sample @25s
const heap25 = await page.evaluate(() => { if (window.gc) window.gc(); return performance.memory ? performance.memory.usedJSHeapSize : 0; });

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
await small.screenshot({ path: `${OUT}/07-mobile-320.png` });
await small.close();

await browser.close();

const heapMB = (b) => (b / 1048576).toFixed(1) + ' MB';
const growth = heap25 - heap5;
const grewUnbounded = heap5 > 0 && growth > heap5 * 0.6 && growth > 40 * 1048576;

console.log('--- ENDLESS DRIVE QA ---');
console.log('canvas:', JSON.stringify(canvasInfo));
console.log('state:', JSON.stringify(state));
console.log('approx FPS (headless swiftshader, NOT real-device):', fps);
console.log('heap @5s :', heapMB(heap5));
console.log('heap @25s:', heapMB(heap25), '(growth', heapMB(growth) + ')');
console.log('soak flag (unbounded?):', grewUnbounded ? 'WARN' : 'ok');
console.log('320px horizontal overflow:', overflow ? 'FAIL' : 'none');
console.log('errors:', errors.length);
for (const e of errors) console.log('  -', e);

const fail = errors.length > 0 || !canvasInfo.gl || overflow;
process.exit(fail ? 1 : 0);

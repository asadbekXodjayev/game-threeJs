import './style.css';
import * as THREE from 'three';
import { gsap } from 'gsap';
import { RNG, resolveSeed } from './core/rng';
import { PerfManager, type QualityTier } from './core/perf';
import { Input } from './core/input';
import { GameAudio } from './audio/audio';
import { Director } from './world/director';
import { Sky } from './world/sky';
import { Road, LANE_OFFSET } from './world/road';
import { Car } from './world/car';
import { Scatter } from './world/scatter';
import { Life } from './world/life';
import { Weather } from './world/weather';
import { Landmarks } from './world/landmarks';
import { Props } from './world/props';
import { WEATHERS, type WeatherId } from './data/weather';
import * as HUD from './ui/hud';

// ----------------------------------------------------------------- setup
const seed = resolveSeed();
const rng = new RNG(seed);
HUD.enableStart(seed);

const app = document.getElementById('app')!;
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
app.appendChild(renderer.domElement);

const perf = new PerfManager(renderer);

const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(0x9fc4d6, 0.018);

const camera = new THREE.PerspectiveCamera(62, innerWidth / innerHeight, 0.5, 1200);
camera.position.set(0, 5, 11);

// lights
const sun = new THREE.DirectionalLight(0xffffff, 1.1);
sun.castShadow = true;
sun.shadow.mapSize.set(1024, 1024);
sun.shadow.camera.near = 1; sun.shadow.camera.far = 120;
const sc = sun.shadow.camera as THREE.OrthographicCamera;
sc.left = -40; sc.right = 40; sc.top = 40; sc.bottom = -40;
scene.add(sun);
scene.add(sun.target);
const ambient = new THREE.HemisphereLight(0xbcd6ff, 0x3a3320, 0.6);
scene.add(ambient);

// world systems
const sky = new Sky();
scene.add(sky.mesh);
const director = new Director(rng);
const road = new Road(rng.range(0, 100));
scene.add(road.group);
const car = new Car();
scene.add(car.root);
const scatter = new Scatter(rng, road, director.currentBiome);
scene.add(scatter.group);
const life = new Life(rng, road, director.currentBiome);
scene.add(life.group);
const weather = new Weather(6000);
scene.add(weather.group);
const landmarks = new Landmarks(rng, road);
scene.add(landmarks.group);
const props = new Props(rng, road);
scene.add(props.group);

const audio = new GameAudio();
const input = new Input();

// fullscreen lightning flash overlay (no geometry)
const flash = document.createElement('div');
flash.style.cssText = 'position:fixed;inset:0;z-index:25;pointer-events:none;background:#eaf2ff;opacity:0;mix-blend-mode:screen';
document.body.appendChild(flash);

// ----------------------------------------------------------------- state
const MAX_SPEED = 42; // m/s (~150 km/h)
let speed = 16; // m/s, auto-cruise default
let cruise = 16;
let laneX = 0; // smoothed lateral car position relative to road center
let laneVel = 0;
let steerSmooth = 0;
let roll = 0, pitch = 0, squash = 0;
let totalDist = 0;
let running = false;
let paused = false;
let photo = false;
let reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
type CamMode = 'chase' | 'cinematic' | 'hood';
let camMode: CamMode = 'chase';
let lastFlash = 0;
let thunderArmed = false;

director.onBiomeEnter = (b) => {
  scatter.setBiome(b);
  life.setBiome(b);
  HUD.revealName('NOW ENTERING', b.name);
};
director.onWeatherChange = (id, label) => {
  HUD.setWeatherLabel(label);
  weather.setWeather(id);
  if (id === 'storm') thunderArmed = true;
};
landmarks.onReveal = (name, location) => {
  HUD.revealName(location.toUpperCase(), name);
};
weather.onFlash = (v) => {
  flash.style.opacity = String(v * 0.85);
  if (v > 0.5 && lastFlash < 0.5 && thunderArmed) {
    setTimeout(() => audio.thunder(), 400 + Math.random() * 600);
  }
  lastFlash = v;
};

perf.onTierChange = (tier: QualityTier) => applyQuality(tier);
function applyQuality(tier: QualityTier): void {
  const densities = [1, 0.6, 0.32];
  const d = densities[tier];
  scatter.setDensity(d);
  life.setDensity(d);
  weather.setQuality(tier === 0 ? 1 : tier === 1 ? 0.5 : 0.25);
  props.setEnabled(tier < 2);
  renderer.shadowMap.enabled = tier === 0;
}

// ----------------------------------------------------------------- loop
const cameraTarget = new THREE.Vector3();
let last = performance.now();
let acc = 0;
const FIXED = 1 / 60;

function frame(): void {
  requestAnimationFrame(frame);
  const now = performance.now();
  let dt = (now - last) / 1000;
  last = now;
  if (dt > 0.1) dt = 0.1; // clamp big gaps (tab refocus)
  perf.tick();

  if (!running) { renderer.render(scene, camera); return; }
  if (paused) { renderer.render(scene, camera); return; }

  acc += dt;
  while (acc >= FIXED) { step(FIXED); acc -= FIXED; }
  render(dt, now / 1000);
}

function step(dt: number): void {
  input.poll();

  // throttle -> cruise speed (auto-cruise by default; player overrides)
  if (input.throttle > 0.05) cruise = Math.min(MAX_SPEED, cruise + input.throttle * 22 * dt);
  else if (input.throttle < -0.05) cruise = Math.max(6, cruise + input.throttle * 30 * dt);
  speed += (cruise - speed) * Math.min(1, 2.2 * dt);

  const speed01 = speed / MAX_SPEED;

  // speed-sensitive, eased steering with soft auto-center
  const steerAuthority = 1 - speed01 * 0.45; // lighter at high speed
  const targetSteer = input.steer * steerAuthority;
  const ease = reduced ? 4 : 6;
  steerSmooth += (targetSteer - steerSmooth) * Math.min(1, ease * dt);

  // lateral target with soft auto-center toward road center when no input
  const laneTarget = steerSmooth * (LANE_OFFSET + 2.2);
  const k = input.steer === 0 ? 2.0 : 3.2; // auto-return softer
  const desired = laneTarget;
  const force = (desired - laneX) * k - laneVel * 1.4;
  laneVel += force * dt;
  laneX += laneVel * dt;
  laneX = THREE.MathUtils.clamp(laneX, -7.5, 7.5);

  // body feel
  const targetRoll = -steerSmooth * 0.12 - laneVel * 0.02;
  roll += (targetRoll - roll) * Math.min(1, 8 * dt);
  const accel = (cruise - speed);
  pitch += ((-accel * 0.004) - pitch) * Math.min(1, 6 * dt);
  const targetSquash = Math.min(0.05, Math.abs(laneVel) * 0.006);
  squash += (targetSquash - squash) * Math.min(1, 7 * dt);

  // advance world
  totalDist += speed * dt;
  const scroll = speed * dt;
  road.update(scroll, totalDist);
  scatter.update(scroll, totalDist);
  life.update(scroll, dt, totalDist, totalDist * 0.05);
  props.update(dt, scroll, totalDist, road.curveX(totalDist) + laneX, speed);
  landmarks.update(dt, scroll, totalDist, director.currentBiomeId);
  director.update(dt);
  weather.update(dt, car.root.position);

  // audio mapping
  audio.updateEngine(speed01, Math.max(0, input.throttle));
  const w = WEATHERS[director.activeWeather];
  audio.updateAmbience(speed01, w.particle === 'rain' ? weather.ramp : 0);
}

function render(dt: number, t: number): void {
  // place car at road center + lane offset
  const baseX = road.curveX(totalDist);
  car.root.position.set(baseX + laneX, 0, 0);
  // face slightly into the curve + steer
  const ahead = road.curveX(totalDist + 8);
  const heading = Math.atan2(ahead - baseX, 8) + steerSmooth * 0.08;
  car.root.rotation.y = -heading;
  car.setFeel(roll, pitch, squash);
  car.steerWheels(steerSmooth * 0.4);
  car.spin(speed, dt);

  // apply blended biome/day-night/weather state
  const s = director.state;
  const fog = scene.fog as THREE.FogExp2;
  fog.color.copy(s.fog);
  fog.density = s.fogDensity;
  scene.background = null;
  sky.set(s.skyTop, s.skyLow, s.sunDir, s.sun, s.night);
  sun.color.copy(s.sun);
  sun.intensity = s.sunIntensity;
  sun.position.copy(s.sunDir).multiplyScalar(60).add(car.root.position);
  sun.target.position.copy(car.root.position);
  ambient.intensity = s.ambient;
  road.setColors(s.road, s.ground);

  // headlights on at dusk/night/storm
  const hl = THREE.MathUtils.clamp(s.night * 1.4 + (director.activeWeather === 'storm' ? 0.4 : 0), 0, 1);
  car.setHeadlights(hl);

  // camera rig per mode with damping + lag
  const cx = car.root.position.x;
  if (photo) {
    // free orbit handled by pointer below; keep target on car
    cameraTarget.set(cx, 2.2, -2);
    camera.lookAt(cameraTarget);
  } else {
    let cam: THREE.Vector3;
    if (camMode === 'chase') cam = new THREE.Vector3(cx - steerSmooth * 1.5, 5.2, 11.5);
    else if (camMode === 'cinematic') cam = new THREE.Vector3(cx + 7, 2.4, 9);
    else cam = new THREE.Vector3(cx, 2.0, 1.2); // hood
    const lag = reduced ? 4 : 2.6;
    camera.position.lerp(cam, Math.min(1, lag * dt));
    cameraTarget.lerp(new THREE.Vector3(cx + steerSmooth * 2, 1.6, -18), Math.min(1, 3 * dt));
    camera.lookAt(cameraTarget);
  }

  // HUD
  HUD.setSpeed(speed * 3.6);
  HUD.setDist(totalDist / 1000);
  HUD.setClock(director.clockHours);
  HUD.setFps(perf.fps, perf.tier);

  renderer.render(scene, camera);
  void t;
}

requestAnimationFrame(frame);

// ----------------------------------------------------------------- photo orbit
let orbiting = false, orbX = 0, orbY = 0, orbAz = 0, orbEl = 0.3, orbR = 14;
renderer.domElement.addEventListener('pointerdown', (e) => {
  if (!photo) return; orbiting = true; orbX = e.clientX; orbY = e.clientY;
});
addEventListener('pointermove', (e) => {
  if (!orbiting) return;
  orbAz -= (e.clientX - orbX) * 0.005; orbEl = THREE.MathUtils.clamp(orbEl + (e.clientY - orbY) * 0.003, 0.05, 1.2);
  orbX = e.clientX; orbY = e.clientY;
});
addEventListener('pointerup', () => (orbiting = false));
function photoCam(): void {
  if (!photo) return;
  const cx = car.root.position.x;
  camera.position.set(cx + Math.sin(orbAz) * orbR, 2 + orbEl * orbR, Math.cos(orbAz) * orbR);
}
setInterval(() => { if (photo && !orbiting) photoCam(); }, 16);

// ----------------------------------------------------------------- UI wiring
const startBtn = document.getElementById('start-btn') as HTMLButtonElement;
function begin(): void {
  if (running) return;
  running = true;
  audio.start();
  applyQuality(perf.tier);
  HUD.hideLoader();
  HUD.showHud();
  if (matchMedia('(pointer: coarse)').matches) HUD.showTouch();
  director.begin();
  // intro camera sweep
  gsap.fromTo(camera.position, { y: 30, z: 40 }, { y: 5.2, z: 11.5, duration: 2.4, ease: 'power2.out' });
}
startBtn.addEventListener('click', begin);

input.onHonk = () => { audio.honk(); life.scareBirds(); };
input.onPhoto = () => togglePhoto();
input.onPause = () => togglePause();

document.getElementById('btn-photo')?.addEventListener('click', togglePhoto);
document.getElementById('btn-pause')?.addEventListener('click', togglePause);
document.getElementById('photo-exit')?.addEventListener('click', togglePhoto);
document.getElementById('panel-close')?.addEventListener('click', togglePause);
document.getElementById('panel-resume')?.addEventListener('click', togglePause);

function togglePause(): void {
  if (photo) return;
  paused = !paused;
  document.getElementById('panel')?.toggleAttribute('hidden', !paused);
  if (paused) audio.setChannel('engine', false);
  else syncSound();
}
function togglePhoto(): void {
  if (!running) return;
  photo = !photo;
  document.getElementById('photobar')?.toggleAttribute('hidden', !photo);
  if (photo) { paused = false; photoCam(); }
}

// sound toggles
function syncSound(): void {
  audio.setChannel('music', (document.getElementById('snd-music') as HTMLInputElement).checked);
  audio.setChannel('engine', (document.getElementById('snd-engine') as HTMLInputElement).checked);
  audio.setChannel('ambience', (document.getElementById('snd-ambience') as HTMLInputElement).checked);
}
['snd-music', 'snd-engine', 'snd-ambience'].forEach((id) =>
  document.getElementById(id)?.addEventListener('change', syncSound)
);

// camera segment
document.querySelectorAll('#cam-seg button').forEach((b) =>
  b.addEventListener('click', () => {
    document.querySelectorAll('#cam-seg button').forEach((x) => x.classList.remove('is-on'));
    b.classList.add('is-on');
    camMode = (b as HTMLElement).dataset.cam as CamMode;
  })
);
// quality segment
document.querySelectorAll('#q-seg button').forEach((b) =>
  b.addEventListener('click', () => {
    document.querySelectorAll('#q-seg button').forEach((x) => x.classList.remove('is-on'));
    b.classList.add('is-on');
    const q = (b as HTMLElement).dataset.q;
    if (q === 'auto') perf.lock(null);
    else perf.lock(q === 'high' ? 0 : 2);
  })
);
document.getElementById('opt-reduced')?.addEventListener('change', (e) => {
  reduced = (e.target as HTMLInputElement).checked;
  weather.setReduced(reduced);
});
if (reduced) {
  const cb = document.getElementById('opt-reduced') as HTMLInputElement;
  if (cb) cb.checked = true;
  weather.setReduced(true);
}

// ----------------------------------------------------------------- resize + visibility
addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});
document.addEventListener('visibilitychange', () => {
  // pause rendering work when hidden (isFast)
  if (document.hidden) { last = performance.now(); }
});

// fake-progressive loader (assets are procedural; warm-up + font load)
let p = 0;
const li = setInterval(() => {
  p = Math.min(100, p + 8 + Math.random() * 14);
  HUD.setLoader(p);
  if (p >= 100) clearInterval(li);
}, 90);

// expose a couple of hooks for the QA harness
(window as unknown as Record<string, unknown>).__game = {
  begin,
  forceWeather: (id: WeatherId) => { weather.setWeather(id); HUD.setWeatherLabel(WEATHERS[id].label); if (id === 'storm') thunderArmed = true; },
  state: () => ({ speed, totalDist, biome: director.currentBiomeId, weather: weather.current, tier: perf.tier, fps: perf.fps, props: props.activeCount }),
};

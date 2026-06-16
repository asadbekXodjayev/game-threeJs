import './style.css';
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { gsap } from 'gsap';
import { RNG, resolveSeed } from './core/rng';
import { PerfManager, type QualityTier } from './core/perf';
import { Input } from './core/input';
import { GameAudio } from './audio/audio';
import { Director } from './world/director';
import { Sky } from './world/sky';
import { Ground } from './world/ground';
import { Obstacles, OB } from './world/obstacles';
import { Clouds } from './world/clouds';
import { Car } from './world/car';
import { Weather } from './world/weather';
import { Skids } from './world/skids';
import { WEATHERS, type WeatherId } from './data/weather';
import { VEHICLES } from './car/vehicles';
import { preloadFerrari, ferrariReady, setFerrariEnv } from './car/ferrari';
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
scene.fog = new THREE.FogExp2(0x9fc4d6, 0.012);

const camera = new THREE.PerspectiveCamera(62, innerWidth / innerHeight, 0.5, 2000);
camera.position.set(0, 6, -12);

// lights
const sun = new THREE.DirectionalLight(0xffffff, 1.1);
sun.castShadow = true;
sun.shadow.mapSize.set(1024, 1024);
sun.shadow.camera.near = 1; sun.shadow.camera.far = 140;
const sc = sun.shadow.camera as THREE.OrthographicCamera;
sc.left = -50; sc.right = 50; sc.top = 50; sc.bottom = -50;
scene.add(sun);
scene.add(sun.target);
const ambient = new THREE.HemisphereLight(0xbcd6ff, 0x3a3320, 0.6);
scene.add(ambient);

// Image-based environment (RoomEnvironment via PMREM) so the Ferrari's metallic
// clear-coat paint reads as paint; kept modest so it doesn't wash out the mood.
const pmrem = new THREE.PMREMGenerator(renderer);
const envTex = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
scene.environment = envTex;
scene.environmentIntensity = 0.45;
pmrem.dispose();
setFerrariEnv(envTex);

// world systems — open world: real sky + canvas ground + bounce obstacles.
const sky = new Sky();
scene.add(sky.group);
const director = new Director(rng);
const ground = new Ground();
scene.add(ground.group);
const obstacles = new Obstacles(rng);
scene.add(obstacles.group);
const clouds = new Clouds();
scene.add(clouds.group);
const car = new Car();
scene.add(car.root);
const weather = new Weather(6000);
scene.add(weather.group);
const skid = new Skids();
scene.add(skid.group);

const audio = new GameAudio();
const input = new Input();

// fullscreen lightning flash overlay
const flash = document.createElement('div');
flash.style.cssText = 'position:fixed;inset:0;z-index:25;pointer-events:none;background:#eaf2ff;opacity:0;mix-blend-mode:screen';
document.body.appendChild(flash);

// ----------------------------------------------------------------- state
const SPEED_FACTOR = 1.0;
function maxSpeedFor(topKmh: number): number { return (topKmh / 3.6) * SPEED_FACTOR; }
let MAX_SPEED = maxSpeedFor(car.stats.topSpeed); // m/s, per-vehicle

// free 2D drive: position + heading on the XZ plane, plus a vertical (jump) axis.
let posX = 0, posZ = 0;      // world position of the car
let yaw = 0;                 // heading; forward = (sin yaw, cos yaw)
let velX = 0, velZ = 0;      // world-space velocity (XZ)
let carY = 0, velY = 0;      // height above ground + vertical velocity (jumps)
let steerSmooth = 0;
let roll = 0, pitch = 0, squash = 0, cornerLean = 0;
let slipAngle = 0;           // rad, |heading − travel| (drift amount)
let speed = 0;               // |velocity| m/s
let totalDist = 0;
let airborne = false;
let shake = 0;
let running = false;
let paused = false;
let photo = false;
let reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
type CamMode = 'chase' | 'cinematic' | 'hood';
let camMode: CamMode = 'chase';
let lastFlash = 0;
let thunderArmed = false;
let bounces = 0;

const GRAVITY = 26;          // m/s²

director.onWeatherChange = (id, label) => {
  HUD.setWeatherLabel(label);
  weather.setWeather(id);
  if (id === 'storm') thunderArmed = true;
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
  obstacles.setDensity(tier === 0 ? 1 : tier === 1 ? 0.7 : 0.45);
  weather.setQuality(tier === 0 ? 1 : tier === 1 ? 0.5 : 0.25);
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
  if (dt > 0.1) dt = 0.1;
  perf.tick();

  if (!running || paused) { renderer.render(scene, camera); return; }

  acc += dt;
  while (acc >= FIXED) { step(FIXED); acc -= FIXED; }
  render(dt, now / 1000);
}

function step(dt: number): void {
  input.poll();
  const st = car.stats;

  // heading vectors on the XZ plane
  const fx = Math.sin(yaw), fz = Math.cos(yaw);   // forward
  const rx = Math.cos(yaw), rz = -Math.sin(yaw);  // right

  // smoothed steering
  const ease = (reduced ? 5 : 8) * (0.5 + st.steerEase);
  steerSmooth += (input.steer - steerSmooth) * Math.min(1, ease * dt);

  // longitudinal force: throttle accelerates, brake/reverse pulls back
  const ACCEL = 8 + st.accel * 26;
  const force = input.throttle >= 0 ? input.throttle * ACCEL : input.throttle * 26;
  velX += fx * force * dt;
  velZ += fz * force * dt;

  // rolling drag (lets the car coast down; top speed capped below)
  const drag = 1 - Math.min(1, 0.55 * dt);
  velX *= drag; velZ *= drag;

  speed = Math.hypot(velX, velZ);
  const speed01 = MAX_SPEED > 0 ? speed / MAX_SPEED : 0;

  // steering turns the heading; quicker at mid speed, lighter at the top.
  // (screen-right needs −yaw given forward=(sin,cos) and a chase camera)
  const handbrake = input.drift;
  const turn = (1.7 + (handbrake ? 0.9 : 0)) * (0.35 + Math.min(1, speed / 7) * 0.65) * (1 - speed01 * 0.3);
  if (speed > 0.4) yaw -= steerSmooth * turn * dt;

  // grip model: split velocity into forward + lateral, bleed the lateral part.
  // High grip kills the slide fast; the handbrake (or over-driving a corner)
  // drops grip so the rear steps out — a real, visible drift.
  let fwdComp = velX * fx + velZ * fz;
  let latComp = velX * rx + velZ * rz;
  const grip = handbrake ? 1.4 : (3.5 + st.grip * 6);
  latComp *= Math.max(0, 1 - grip * dt);
  velX = fx * fwdComp + rx * latComp;
  velZ = fz * fwdComp + rz * latComp;

  // cap to the vehicle's top speed
  speed = Math.hypot(velX, velZ);
  if (speed > MAX_SPEED) { const k = MAX_SPEED / speed; velX *= k; velZ *= k; speed = MAX_SPEED; }

  // slip angle = how far travel diverges from heading (drift proof / fx trigger)
  slipAngle = speed > 1 ? Math.abs(Math.atan2(latComp, Math.max(0.01, fwdComp))) : 0;

  // advance position
  posX += velX * dt;
  posZ += velZ * dt;
  totalDist += speed * dt;

  // --- obstacle interactions (jump / bounce / boost) ------------------------
  obstacles.update(posX, posZ, dt);
  const onGround = carY <= 0.02;
  const hit = obstacles.sample(posX, posZ);
  if (hit && onGround) {
    const ob = hit.ob;
    if (ob.type === OB.TRAMPOLINE) {
      velY = 15.5; ob.pulse = 1; bounces++; audio.bump(0.5);
    } else if (ob.type === OB.DOME) {
      velY = Math.max(velY, 7.5); ob.pulse = 1;
    } else if (ob.type === OB.RAMP) {
      velY = Math.max(velY, 5 + speed * 0.38); bounces++;
    } else if (ob.type === OB.BOOST) {
      // surge forward, allow a temporary overspeed
      const boost = 60 * dt;
      velX += fx * boost; velZ += fz * boost;
      const cap = MAX_SPEED * 1.3, sp = Math.hypot(velX, velZ);
      if (sp > cap) { const k = cap / sp; velX *= k; velZ *= k; }
    }
  }

  // vertical (jump) integration
  if (carY > 0 || velY > 0) {
    velY -= GRAVITY * dt;
    carY += velY * dt;
    if (carY <= 0) {
      if (velY < -7) { // landing thump
        squash = Math.min(0.12, -velY * 0.012);
        shake = Math.min(1, shake + 0.2);
        if (slipAngle > 0.05 || speed > 6) { car.emitSmoke(-1); car.emitSmoke(1); }
      }
      carY = 0; velY = 0;
    }
  }
  airborne = carY > 0.05;

  // --- body feel ------------------------------------------------------------
  const slipDir = Math.sign(latComp || -steerSmooth) || 1;
  const drifting = slipAngle > 0.22 && speed > 7;
  const targetRoll = (-steerSmooth * 0.12 - slipDir * slipAngle * 0.14) * (1 - st.mass * 0.3);
  roll += (targetRoll - roll) * Math.min(1, 8 * dt);
  pitch += ((airborne ? -velY * 0.01 : (fwdComp - speed) * 0.004) - pitch) * Math.min(1, 6 * dt);
  squash += (0 - squash) * Math.min(1, 5 * dt);
  cornerLean += (THREE.MathUtils.clamp(-steerSmooth - slipDir * slipAngle * 0.4, -1, 1) - cornerLean) * Math.min(1, 7 * dt);
  shake -= shake * Math.min(1, 4 * dt);

  // skid marks + tyre smoke while sliding on the ground
  skid.update(dt);
  if (!airborne && drifting) {
    const bx = posX, bz = posZ;
    skid.emit(bx - rx * 1.0, bz - rz * 1.0, yaw);
    skid.emit(bx + rx * 1.0, bz + rz * 1.0, yaw);
    if (slipAngle > 0.32) { car.emitSmoke(-1); car.emitSmoke(1); }
  }

  // world subsystems
  ground.update(posX, posZ);
  weather.update(dt, car.root.position);
  director.update(dt);

  // audio
  audio.updateEngine(speed01, Math.max(0, input.throttle));
  audio.updateSkid(drifting ? THREE.MathUtils.clamp(slipAngle * 2, 0, 1) * speed01 : 0);
  audio.updateTornado(weather.tornadoLevel);
  const w = WEATHERS[director.activeWeather];
  audio.updateAmbience(speed01, w.particle === 'rain' ? weather.ramp : 0);
}

function render(dt: number, t: number): void {
  // place + orient the car
  car.root.position.set(posX, carY, posZ);
  car.root.rotation.set(0, yaw, 0);
  car.body.position.y = car.stats.rideHeight;
  car.setFeel(roll, pitch, squash, cornerLean);
  car.steerWheels(steerSmooth * 0.4 + (slipAngle > 0.2 ? -Math.sign(steerSmooth) * 0.3 : 0));
  car.spin(speed, dt);
  car.updateSmoke(dt);

  // apply blended day/night/weather mood
  const s = director.state;
  const fog = scene.fog as THREE.FogExp2;
  fog.color.copy(s.fog);
  fog.density = s.fogDensity * 0.7;
  scene.background = null;
  sky.set(s.skyTop, s.skyLow, s.sunDir, s.sun, s.night);
  const wDef = WEATHERS[director.activeWeather];
  const storm = director.activeWeather !== 'clear' ? wDef.dark * weather.ramp : 0;
  const clearSky = THREE.MathUtils.clamp(1 - storm, 0, 1);
  sky.update(t, camera.position, clearSky);
  sun.color.copy(s.sun);
  sun.intensity = s.sunIntensity;
  sun.position.copy(s.sunDir).multiplyScalar(70).add(car.root.position);
  sun.target.position.copy(car.root.position);
  ambient.intensity = s.ambient;
  ground.setBrightness(THREE.MathUtils.lerp(0.5, 1.05, 1 - s.night));
  obstacles.setNight(s.night);
  clouds.update(dt, posX, posZ, s.night, storm);

  // headlights at night / storm
  const hl = THREE.MathUtils.clamp(s.night * 1.4 + (director.activeWeather === 'storm' ? 0.4 : 0), 0, 1);
  car.setHeadlights(hl);

  // camera rig
  const fx = Math.sin(yaw), fz = Math.cos(yaw);
  const rx = Math.cos(yaw), rz = -Math.sin(yaw);
  const cd = car.stats.camDist, rh = car.stats.rideHeight;
  if (photo) {
    cameraTarget.set(posX, carY + 1.6, posZ);
    camera.lookAt(cameraTarget);
  } else {
    let cam: THREE.Vector3;
    if (camMode === 'chase') {
      const back = 11.5 + cd;
      cam = new THREE.Vector3(posX - fx * back + rx * steerSmooth * 1.5, 5.2 + rh + cd * 0.45 + carY * 0.3, posZ - fz * back);
    } else if (camMode === 'cinematic') {
      cam = new THREE.Vector3(posX + rx * (8 + cd) - fx * 4, 3 + rh + cd * 0.3 + carY * 0.3, posZ + rz * (8 + cd) - fz * 4);
    } else { // hood
      cam = new THREE.Vector3(posX + fx * 0.6, 1.9 + rh + carY, posZ + fz * 0.6);
    }
    const lag = reduced ? 5 : 3;
    camera.position.lerp(cam, Math.min(1, lag * dt));
    cameraTarget.lerp(new THREE.Vector3(posX + fx * 16, carY + 1.8, posZ + fz * 16), Math.min(1, 3.5 * dt));
    if (shake > 0.001 && !reduced) {
      camera.position.x += (Math.random() - 0.5) * shake;
      camera.position.y += (Math.random() - 0.5) * shake * 0.6;
    }
    camera.lookAt(cameraTarget);
  }

  // HUD
  HUD.setSpeed(speed * 3.6);
  HUD.setDist(totalDist / 1000);
  HUD.setClock(director.clockHours);
  HUD.setFps(perf.fps, perf.tier);

  renderer.render(scene, camera);
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
  camera.position.set(posX + Math.sin(orbAz) * orbR, 2 + orbEl * orbR, posZ + Math.cos(orbAz) * orbR);
}
setInterval(() => { if (photo && !orbiting) photoCam(); }, 16);

// ----------------------------------------------------------------- UI wiring
const startBtn = document.getElementById('start-btn') as HTMLButtonElement;
function begin(): void {
  if (running) return;
  running = true;
  // a gentle roll forward so the world is alive the moment you start
  velX = Math.sin(yaw) * MAX_SPEED * 0.22;
  velZ = Math.cos(yaw) * MAX_SPEED * 0.22;
  audio.start();
  applyQuality(perf.tier);
  HUD.hideLoader();
  HUD.showHud();
  if (matchMedia('(pointer: coarse)').matches) HUD.showTouch();
  director.begin();
  HUD.revealName('OPEN WORLD', 'ROAM FREELY');
  gsap.fromTo(camera.position, { y: 34, z: -46 }, { y: 5.2, z: -12, duration: 2.4, ease: 'power2.out' });
}
startBtn.addEventListener('click', begin);

// ----- vehicle selection (menu + pause panel) -----
function setVehicle(id: string): void {
  if (id === 'ferrari' && !ferrariReady()) return;
  const frac = MAX_SPEED > 0 ? speed / MAX_SPEED : 0.5;
  car.setVehicle(id);
  MAX_SPEED = maxSpeedFor(car.stats.topSpeed);
  const sp = Math.hypot(velX, velZ);
  if (sp > 0.01) { const k = (MAX_SPEED * frac) / sp; velX *= k; velZ *= k; }
  HUD.markVehicle(id);
}
let userPickedVehicle = false;
HUD.buildVehiclePickers((id) => { userPickedVehicle = true; setVehicle(id); }, car.stats.id);

preloadFerrari()
  .then(() => {
    if (!userPickedVehicle && !running) setVehicle('ferrari');
    else HUD.markVehicle(car.stats.id);
  })
  .catch((err) => console.warn('[ferrari] model load failed — using procedural roster:', err));

input.onHonk = () => { audio.honk(); };
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
  sky.setReduced(reduced);
});
// weather effects on/off
document.getElementById('opt-weather')?.addEventListener('change', (e) => {
  if (!(e.target as HTMLInputElement).checked) { weather.clear(); HUD.setWeatherLabel('Clear'); }
});
if (reduced) {
  const cb = document.getElementById('opt-reduced') as HTMLInputElement;
  if (cb) cb.checked = true;
  weather.setReduced(true);
  sky.setReduced(true);
}

// ----------------------------------------------------------------- resize + visibility
addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { last = performance.now(); }
});

// fake-progressive loader (assets are procedural; warm-up + font load)
let p = 0;
const li = setInterval(() => {
  p = Math.min(100, p + 8 + Math.random() * 14);
  HUD.setLoader(p);
  if (p >= 100) clearInterval(li);
}, 90);

// QA / debug hooks
(window as unknown as Record<string, unknown>).__game = {
  begin,
  forceWeather: (id: WeatherId) => { weather.setWeather(id); HUD.setWeatherLabel(WEATHERS[id].label); if (id === 'storm') thunderArmed = true; },
  forceNight: () => director.setClock(0),
  forceDay: () => director.setClock(12),
  setClock: (h: number) => director.setClock(h),
  warp: (m: number) => { posX += Math.sin(yaw) * m; posZ += Math.cos(yaw) * m; },
  lockQuality: (tier: 0 | 1 | 2 | null) => perf.lock(tier),
  setVehicle: (id: string) => setVehicle(id),
  vehicles: () => VEHICLES.map((v) => ({ id: v.id, name: v.name, topSpeed: v.topSpeed })),
  setSteer: (v: number) => { input.steer = THREE.MathUtils.clamp(v, -1, 1); },
  jump: (v = 14) => { if (carY <= 0.02) velY = v; },
  // deterministic drive for headless QA (software GPU can't run the loop in
  // realtime): force inputs, then advance fixed sim steps directly.
  input: (throttle = 0, steer = 0, drift = false) => { input.forced = { throttle, steer, drift }; },
  sim: (seconds: number) => { const n = Math.round(seconds / FIXED); for (let i = 0; i < n; i++) step(FIXED); },
  state: () => ({
    speed, totalDist, posX, posZ, yaw, carY, airborne, bounces,
    weather: weather.current, tier: perf.tier, fps: perf.fps,
    slipAngleDeg: slipAngle * 57.2958, drifting: slipAngle > 0.22 && speed > 7,
    night: director.state.night, tornado: weather.tornadoLevel, vehicle: car.stats.id,
    maxSpeed: MAX_SPEED, drawCalls: renderer.info.render.calls, triangles: renderer.info.render.triangles,
  }),
};

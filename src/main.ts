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
import { Traffic } from './world/traffic';
import { SkidMarks } from './world/skidmarks';
import { WEATHERS, type WeatherId } from './data/weather';
import { VEHICLES } from './car/vehicles';
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
scene.add(sky.group);
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
const traffic = new Traffic(rng, road);
scene.add(traffic.group);
const skid = new SkidMarks();
scene.add(skid.group);

const audio = new GameAudio();
const input = new Input();

// fullscreen lightning flash overlay (no geometry)
const flash = document.createElement('div');
flash.style.cssText = 'position:fixed;inset:0;z-index:25;pointer-events:none;background:#eaf2ff;opacity:0;mix-blend-mode:screen';
document.body.appendChild(flash);

// ----------------------------------------------------------------- state
// Speed envelope derives from the ACTIVE vehicle's real top speed: faster cars
// genuinely reach higher m/s. A presentation factor keeps the on-road feel calm
// (we don't actually do 370 km/h of world scroll). CRUISE is the auto-cruise
// target as a fraction of that vehicle's max.
const SPEED_FACTOR = 0.42; // km/h -> m/s presentation scale
function maxSpeedFor(topKmh: number): number { return (topKmh / 3.6) * SPEED_FACTOR; }
let MAX_SPEED = maxSpeedFor(car.stats.topSpeed); // m/s, per-vehicle
let speed = MAX_SPEED * 0.5; // m/s, auto-cruise default
let cruise = MAX_SPEED * 0.5;
let laneX = 0; // smoothed lateral car position relative to road center
let laneVel = 0;
let steerSmooth = 0;
let roll = 0, pitch = 0, squash = 0, cornerLean = 0;
let slipVel = 0; // lateral slip velocity (drift) — grip vs slip
let slip = 0; // 0..1 how much the rear is stepping out (for skid fx)
let yawDrift = 0; // extra heading from the slide (car points into the slide)
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
  traffic.setDensity(tier === 0 ? 1 : tier === 1 ? 0.6 : 0.3);
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

  // per-vehicle feel: accel responsiveness, grip/drift, mass, steer quickness
  const st = car.stats;
  const accelGain = 12 + st.accel * 22; // light cars surge, heavy rigs lag
  const minCruise = Math.max(5, MAX_SPEED * 0.18);

  // throttle -> cruise speed (auto-cruise by default; player overrides)
  if (input.throttle > 0.05) cruise = Math.min(MAX_SPEED, cruise + input.throttle * accelGain * dt);
  else if (input.throttle < -0.05) cruise = Math.max(minCruise, cruise + input.throttle * (accelGain * 1.2) * dt);
  // heavier vehicles approach the target speed more slowly
  speed += (cruise - speed) * Math.min(1, (3.0 - st.mass * 1.4) * dt);

  const speed01 = speed / MAX_SPEED;

  // speed-sensitive, eased steering with soft auto-center; steerEase = quickness
  const steerAuthority = 1 - speed01 * 0.45; // lighter at high speed
  const targetSteer = input.steer * steerAuthority;
  const ease = (reduced ? 4 : 6) * (0.5 + st.steerEase);
  steerSmooth += (targetSteer - steerSmooth) * Math.min(1, ease * dt);

  // lateral target with soft auto-center toward road center when no input
  const laneTarget = steerSmooth * (LANE_OFFSET + 2.2);
  const k = input.steer === 0 ? 2.0 : 3.2; // auto-return softer
  const desired = laneTarget;
  const force = (desired - laneX) * k - laneVel * 1.4;
  laneVel += force * dt;

  // --- DRIFT: grip vs slip ---------------------------------------------------
  // Hard steering at speed exceeds available grip and the rear steps out: a
  // lateral slip velocity builds, the car slides, then grip recovers and it
  // auto-settles. Forgiving by design — capped, always self-corrects, never
  // spins. Tuned gentle for touch/phone via reduced authority at high steer.
  // grip threshold scales with the vehicle's grip stat (F1 huge grip = very
  // late, tiny slide; coupe/SUV let go sooner). reduced-motion raises it.
  const gripThreshold = (reduced ? 0.7 : 0.34) + (st.grip - 0.6) * 0.5;
  // cornering demand scales with how hard we're steering and how fast we go.
  // raw input is used (not the speed-attenuated steerSmooth) so the slide can
  // actually be provoked at the top of the speed range.
  const demand = Math.abs(input.steer) * (0.35 + speed01 * 0.9);
  const slipForce = Math.max(0, demand - gripThreshold);
  // push slip in the direction of the turn; driftiness sets how eagerly
  const slipDir = Math.sign(input.steer || steerSmooth) || 1;
  const slipAuthority = (reduced ? 14 : 30) * (0.4 + st.driftiness);
  slipVel += slipDir * slipForce * slipAuthority * dt;
  // grip recovery: more grip = faster auto-settle back to zero
  slipVel -= slipVel * Math.min(1, (reduced ? 3.2 : 2.4) * (0.6 + st.grip) * dt);
  slipVel = THREE.MathUtils.clamp(slipVel, -7, 7); // never wild
  laneVel += slipVel * dt * 2.2;

  laneX += laneVel * dt;
  laneX = THREE.MathUtils.clamp(laneX, -8.5, 8.5);

  // slip amount 0..1 for skid fx + car yaw into the slide
  const targetSlip = THREE.MathUtils.clamp(Math.abs(slipVel) / 3.5, 0, 1);
  slip += (targetSlip - slip) * Math.min(1, 6 * dt);
  const targetYaw = -slipVel * 0.045; // point nose into the slide
  yawDrift += (targetYaw - yawDrift) * Math.min(1, 5 * dt);

  // body feel — extra roll while drifting sells the slide. Heavier bodies roll
  // a touch less and settle slower; bounce (suspension softness) scales squash.
  const rollScale = 1 - st.mass * 0.3;
  const targetRoll = (-steerSmooth * 0.12 - laneVel * 0.02 - slip * slipDir * 0.06) * rollScale;
  roll += (targetRoll - roll) * Math.min(1, (8 - st.mass * 3) * dt);
  const accel = (cruise - speed);
  pitch += ((-accel * 0.004) - pitch) * Math.min(1, 6 * dt);
  const targetSquash = Math.min(0.06 + st.bounce * 0.06, (Math.abs(laneVel) * 0.006 + slip * 0.02) * (0.6 + st.bounce));
  squash += (targetSquash - squash) * Math.min(1, (7 - st.bounce * 3) * dt);
  // cornering lean signal (-1..1) for the model (motorcycle tips into curves)
  cornerLean += (THREE.MathUtils.clamp(steerSmooth + slipVel * 0.04, -1, 1) - cornerLean) * Math.min(1, 7 * dt);

  // advance world
  totalDist += speed * dt;
  const scroll = speed * dt;
  road.update(scroll, totalDist);
  scatter.update(scroll, totalDist);
  life.update(scroll, dt, totalDist, totalDist * 0.05);
  props.update(dt, scroll, totalDist, road.curveX(totalDist) + laneX, speed);
  traffic.update(dt, scroll, totalDist, speed);
  landmarks.update(dt, scroll, totalDist, director.currentBiomeId);
  director.update(dt);
  weather.update(dt, car.root.position);

  // skid marks: drop dabs at the rear wheels while sliding
  skid.update(dt, scroll);
  if (slip > 0.35 && speed > 8) {
    const baseX = road.curveX(totalDist) + laneX;
    const h = road.headingAt(totalDist);
    skid.emit(baseX - 1.0, -1.45, h);
    skid.emit(baseX + 1.0, -1.45, h);
  }

  // audio mapping
  audio.updateEngine(speed01, Math.max(0, input.throttle));
  audio.updateSkid(slip * THREE.MathUtils.clamp(speed01 * 1.4, 0, 1));
  audio.updateTornado(weather.tornadoLevel);
  const w = WEATHERS[director.activeWeather];
  audio.updateAmbience(speed01, w.particle === 'rain' ? weather.ramp : 0);
}

function render(dt: number, t: number): void {
  // place car at road center + lane offset
  const baseX = road.curveX(totalDist);
  car.root.position.set(baseX + laneX, 0, 0);
  // face along the spline tangent + steer + drift yaw
  const heading = road.headingAt(totalDist);
  car.root.rotation.y = -heading + steerSmooth * 0.08 + yawDrift;
  car.body.position.y = car.stats.rideHeight; // tall trucks sit up, exotics low
  car.setFeel(roll, pitch, squash, cornerLean);
  car.steerWheels(steerSmooth * 0.4);
  car.spin(speed, dt);

  // apply blended biome/day-night/weather state
  const s = director.state;
  const fog = scene.fog as THREE.FogExp2;
  fog.color.copy(s.fog);
  fog.density = s.fogDensity;
  scene.background = null;
  sky.set(s.skyTop, s.skyLow, s.sunDir, s.sun, s.night);
  // stars + aurora at night; hidden under heavy/dark weather
  const wDef = WEATHERS[director.activeWeather];
  const clearSky = 1 - (director.activeWeather !== 'clear' ? wDef.dark * weather.ramp : 0);
  sky.update(t, camera.position, THREE.MathUtils.clamp(clearSky, 0, 1));
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
    // camera offset scales from the vehicle: long/tall rigs pull back & up,
    // exotics/bikes sit lower & closer.
    const cd = car.stats.camDist;
    const rh = car.stats.rideHeight;
    let cam: THREE.Vector3;
    if (camMode === 'chase') cam = new THREE.Vector3(cx - steerSmooth * 1.5, 5.2 + cd * 0.45 + rh, 11.5 + cd);
    else if (camMode === 'cinematic') cam = new THREE.Vector3(cx + 7 + cd * 0.4, 2.4 + cd * 0.3 + rh, 9 + cd * 0.6);
    else cam = new THREE.Vector3(cx, 2.0 + rh, 1.2 + cd * 0.3); // hood
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

// ----- vehicle selection (menu + pause panel) -----
function setVehicle(id: string): void {
  const frac = MAX_SPEED > 0 ? speed / MAX_SPEED : 0.5;
  const cfrac = MAX_SPEED > 0 ? cruise / MAX_SPEED : 0.5;
  car.setVehicle(id);
  MAX_SPEED = maxSpeedFor(car.stats.topSpeed);
  // preserve the relative pace so swapping mid-drive isn't jarring
  speed = MAX_SPEED * frac;
  cruise = MAX_SPEED * cfrac;
  HUD.markVehicle(id);
}
HUD.buildVehiclePickers(setVehicle, car.stats.id);

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
  sky.setReduced(reduced);
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
  forceNight: () => director.setClock(0),
  forceDay: () => director.setClock(12),
  setCruise: (v: number) => { cruise = v; },
  warp: (km: number) => { totalDist += km * 1000; },
  lockQuality: (tier: 0 | 1 | 2 | null) => perf.lock(tier),
  setVehicle: (id: string) => setVehicle(id),
  vehicles: () => VEHICLES.map((v) => ({ id: v.id, name: v.name, topSpeed: v.topSpeed })),
  state: () => ({ speed, totalDist, biome: director.currentBiomeId, weather: weather.current, tier: perf.tier, fps: perf.fps, props: props.activeCount, traffic: traffic.activeCount, slip, night: director.state.night, tornado: weather.tornadoLevel, vehicle: car.stats.id, maxSpeed: MAX_SPEED }),
};

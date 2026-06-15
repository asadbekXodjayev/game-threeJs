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
import { Terrain } from './world/terrain';
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
const terrain = new Terrain(rng.range(0, 1000));
scene.add(terrain.group);
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
const SPEED_FACTOR = 1.0; // km/h -> m/s: cars now reach their full rated top speed
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
let yawDrift = 0; // extra heading from the slide (car body yaws to slip angle)
let counterSteer = 0; // front-wheel opposite lock while drifting
let slipAngleDeg = 0; // measured |heading - velocity| in degrees (drift proof)
let driftForce = false; // QA / handbrake forced drift trigger
let shake = 0; // camera shake amount from collisions (decays)
let collisions = 0; // running count of player↔traffic collisions
let lastHitT = 0;
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

  // --- DRIFT: real, VISIBLE slip angle --------------------------------------
  // A drift is triggered two ways:
  //   1) HANDBRAKE / drift button (Space, Shift, gamepad A, touch) — instant
  //      grip break: the rear steps out hard while you hold it.
  //   2) Hard steering at speed beyond the tyre's grip budget — the rear lets
  //      go on its own (grip threshold scales with the vehicle's grip stat).
  // While drifting, the car BODY yaws to a large slip angle (target 30–42°) in
  // the direction of the turn, the front wheels COUNTER-STEER opposite lock, and
  // tyre smoke + skid marks + skid audio fire. Easing off recovers grip and the
  // car straightens — forgiving, capped, never spins fully, no fail state.
  const handbrake = input.drift || driftForce;
  const gripThreshold = (reduced ? 0.62 : 0.3) + (st.grip - 0.6) * 0.45;
  const demand = Math.abs(input.steer) * (0.35 + speed01 * 0.9);
  const overGrip = Math.max(0, demand - gripThreshold);
  // are we actively drifting? handbrake at any decent speed, OR over-grip cornering
  const fast = speed01 > 0.22;
  const drifting = (handbrake && fast) || overGrip > 0.04;
  const slipDir = Math.sign(input.steer || steerSmooth) || 1;

  // lateral slip velocity (used for skid-mark placement + a touch of lane drift)
  const slipAuthority = (reduced ? 16 : 32) * (0.4 + st.driftiness);
  const provoke = (handbrake && fast ? 0.5 + Math.abs(input.steer) * 0.6 : overGrip);
  slipVel += slipDir * provoke * slipAuthority * dt;
  slipVel -= slipVel * Math.min(1, (reduced ? 3.4 : 2.6) * (0.6 + st.grip) * dt);
  slipVel = THREE.MathUtils.clamp(slipVel, -8, 8);
  laneVel += slipVel * dt * 1.8;

  laneX += laneVel * dt;
  laneX = THREE.MathUtils.clamp(laneX, -8.5, 8.5);

  // big visible body yaw to the slip angle. Target peaks ~0.72 rad (≈41°) at a
  // full handbrake drift, scaled by driftiness; recovers fast when not drifting.
  const maxSlip = reduced ? 0.5 : 0.78; // rad
  const driftAmt = drifting ? THREE.MathUtils.clamp(
    (handbrake && fast ? 0.62 : 0) + provoke * 0.9, 0, 1,
  ) : 0;
  const targetYaw = slipDir * driftAmt * maxSlip * (0.7 + st.driftiness * 0.5);
  // attack fast into the drift, ease out a touch slower so it looks deliberate
  const yawEase = drifting ? 7 : 4.5;
  yawDrift += (targetYaw - yawDrift) * Math.min(1, yawEase * dt);

  // measured slip angle (degrees) = how far the body heading diverges from the
  // travel/tangent direction. yawDrift IS that divergence (travel ≈ tangent).
  slipAngleDeg = Math.abs(yawDrift) * 57.2958;

  // front wheels counter-steer (opposite lock), proportional to the slide
  const targetCounter = -slipDir * driftAmt * 0.55;
  counterSteer += (targetCounter - counterSteer) * Math.min(1, 9 * dt);

  // slip amount 0..1 for skid fx / smoke / audio
  const targetSlip = THREE.MathUtils.clamp(Math.max(Math.abs(slipVel) / 4, driftAmt), 0, 1);
  slip += (targetSlip - slip) * Math.min(1, 7 * dt);

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
  const playerX = road.curveX(totalDist) + laneX;
  props.update(dt, scroll, totalDist, playerX, speed);
  // real traffic collision: knock the player back, scrub speed, shake + bump SFX
  traffic.update(dt, scroll, totalDist, speed, playerX, st.mass, (hit) => {
    laneVel += hit.impulseX;
    speed = Math.max(minCruise * 0.5, speed * (1 - hit.scrub));
    cruise = Math.min(cruise, speed + 4);
    shake = Math.min(1.2, shake + hit.strength * 0.9);
    yawDrift += -Math.sign(hit.impulseX || 1) * hit.strength * 0.18; // jolt the body
    const nowT = totalDist; // distance-stamped throttle so we don't spam audio
    if (nowT - lastHitT > 3) { collisions++; audio.bump(hit.strength); lastHitT = nowT; }
  });
  landmarks.update(dt, scroll, totalDist, director.currentBiomeId);
  director.update(dt);
  weather.update(dt, car.root.position);

  // skid marks + tyre smoke while sliding (drift feedback)
  skid.update(dt, scroll);
  shake -= shake * Math.min(1, 4 * dt);
  if (slip > 0.3 && speed > 7) {
    const baseX = playerX;
    const h = road.headingAt(totalDist);
    const cy = road.heightAt(totalDist);
    skid.emit(baseX - 1.0, -1.45, h, cy);
    skid.emit(baseX + 1.0, -1.45, h, cy);
    if (slip > 0.45) { car.emitSmoke(-1); car.emitSmoke(1); }
  }

  // audio mapping
  audio.updateEngine(speed01, Math.max(0, input.throttle));
  audio.updateSkid(slip * THREE.MathUtils.clamp(speed01 * 1.4, 0, 1));
  audio.updateTornado(weather.tornadoLevel);
  const w = WEATHERS[director.activeWeather];
  audio.updateAmbience(speed01, w.particle === 'rain' ? weather.ramp : 0);
}

function render(dt: number, t: number): void {
  // place car on the elevated road center + lane offset
  const baseX = road.curveX(totalDist);
  const baseY = road.heightAt(totalDist);
  car.root.position.set(baseX + laneX, baseY, 0);
  // face along the spline tangent + steer + drift yaw (drift yaw is the big one).
  // Models are built front=+Z but the world's forward is -Z, so we add PI to
  // turn the nose to face AWAY from the chase camera (forward). The steer/drift
  // terms are negated to keep the nose leaning INTO turns after the 180° flip.
  const heading = road.headingAt(totalDist);
  car.root.rotation.y = Math.PI - heading - steerSmooth * 0.06 - yawDrift;
  // pitch the chassis with the road slope so it noses up hills / down into dips
  const slope = road.slopeAt(totalDist);
  car.root.rotation.x = slope;
  car.body.position.y = car.stats.rideHeight; // tall trucks sit up, exotics low
  car.setFeel(roll, pitch, squash, cornerLean);
  // front wheels: normal steer + counter-steer (opposite lock) while drifting
  car.steerWheels(steerSmooth * 0.4 + counterSteer);
  car.spin(speed, dt);
  car.updateSmoke(dt);

  // distant parallax terrain drifts with travel + tints to the biome ground
  terrain.update(totalDist, baseX, director.state.ground, director.state.night);

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

  // camera rig per mode with damping + lag. Camera Y tracks the car's terrain
  // height so it crests hills with the car — and because the road dips away on
  // the far side of a crest, you briefly lose sight of it (real elevation).
  const cx = car.root.position.x;
  const cy = car.root.position.y; // terrain height under the car
  if (photo) {
    // free orbit handled by pointer below; keep target on car
    cameraTarget.set(cx, cy + 2.2, -2);
    camera.lookAt(cameraTarget);
  } else {
    // camera offset scales from the vehicle: long/tall rigs pull back & up,
    // exotics/bikes sit lower & closer.
    const cd = car.stats.camDist;
    const rh = car.stats.rideHeight;
    let cam: THREE.Vector3;
    if (camMode === 'chase') cam = new THREE.Vector3(cx - steerSmooth * 1.5, cy + 5.2 + cd * 0.45 + rh, 11.5 + cd);
    else if (camMode === 'cinematic') cam = new THREE.Vector3(cx + 7 + cd * 0.4, cy + 2.4 + cd * 0.3 + rh, 9 + cd * 0.6);
    else cam = new THREE.Vector3(cx, cy + 2.0 + rh, 1.2 + cd * 0.3); // hood
    const lag = reduced ? 4 : 2.6;
    camera.position.lerp(cam, Math.min(1, lag * dt));
    // look toward the road AHEAD at its own elevation (so over a crest the gaze
    // points up at the rise, then the road drops out of view beyond it)
    const aheadY = road.heightAt(totalDist + 18);
    cameraTarget.lerp(new THREE.Vector3(cx + steerSmooth * 2, aheadY + 1.6, -18), Math.min(1, 3 * dt));
    // collision shake: jitter the camera briefly on impact
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
// traffic on/off toggle (menu → World)
document.getElementById('opt-traffic')?.addEventListener('change', (e) => {
  traffic.setEnabled((e.target as HTMLInputElement).checked);
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
  setClock: (h: number) => director.setClock(h),
  setCruise: (v: number) => { cruise = v; },
  warp: (km: number) => { totalDist += km * 1000; },
  lockQuality: (tier: 0 | 1 | 2 | null) => perf.lock(tier),
  setVehicle: (id: string) => setVehicle(id),
  vehicles: () => VEHICLES.map((v) => ({ id: v.id, name: v.name, topSpeed: v.topSpeed })),
  // drift control for QA: hold the handbrake drift on/off (steer is still needed)
  setDrift: (on: boolean) => { driftForce = on; },
  // steer override for QA so a sustained drift can be provoked headlessly
  setSteer: (v: number) => { input.steer = THREE.MathUtils.clamp(v, -1, 1); },
  // force a player↔traffic collision by parking a car right in front of us
  forceCollision: () => traffic.slamInFront(road.curveX(totalDist) + laneX, totalDist),
  // road-shape probes for the elevation/curve screenshots
  roadProbe: () => ({
    heightHere: road.heightAt(totalDist),
    heightAhead: road.heightAt(totalDist + 60),
    slopeDeg: road.slopeAt(totalDist) * 57.2958,
    curveX: road.curveX(totalDist),
    headingDeg: road.headingAt(totalDist) * 57.2958,
  }),
  state: () => ({
    speed, totalDist, biome: director.currentBiomeId, weather: weather.current,
    tier: perf.tier, fps: perf.fps, props: props.activeCount, scatter: scatter.activeCount, traffic: traffic.activeCount,
    slip, slipAngleDeg, drifting: slipAngleDeg > 10, collisions,
    night: director.state.night, tornado: weather.tornadoLevel, vehicle: car.stats.id,
    maxSpeed: MAX_SPEED, drawCalls: renderer.info.render.calls, triangles: renderer.info.render.triangles,
  }),
};

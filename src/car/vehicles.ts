import * as THREE from 'three';
import { buildFerrari } from './ferrari';

/**
 * Multi-vehicle roster (drivable + traffic). Each entry is a distinct stylized
 * LOW-POLY procedural model built from primitives (no external assets) plus a
 * stat block DERIVED FROM A REAL TOP SPEED so the vehicles genuinely feel
 * different. The player picks one; the traffic system draws random vehicles
 * from this same roster for variety.
 *
 * Stat fields and how they map to feel (consumed in main.ts / car.ts):
 *  - topSpeed   km/h — the real headline figure. maxSpeed (m/s) + auto-cruise
 *                target derive from it, so an F1 actually rips and a monster
 *                truck crawls.
 *  - accel      0..1 — throttle responsiveness (light/eager vs heavy/lazy).
 *  - grip       0..1 — higher = more grip, later & smaller slide.
 *  - driftiness 0..1 — how eager the rear is to step out / how big the slide.
 *  - mass       0..1 — heavier bodies lean less sharply, settle slower.
 *  - rideHeight m    — body sits this high; raises the chase camera too.
 *  - length/width m  — footprint; long rigs (semi) turn lazily & track wide.
 *  - steerEase  0..1 — steering quickness (F1 snappy, semi ponderous).
 *  - lean       0..1 — body-lean gain (motorcycle leans HARD into curves).
 *  - bounce     0..1 — suspension softness (monster truck bobs a lot).
 *  - camDist    m    — chase-camera pull-back (long/tall vehicles need more).
 *
 * Everything is procedural & lean — modest poly counts, flat-ish shading.
 */

export interface VehicleStats {
  topSpeed: number; // km/h (real headline)
  accel: number; // 0..1
  grip: number; // 0..1
  driftiness: number; // 0..1
  mass: number; // 0..1
  rideHeight: number; // metres
  length: number; // metres
  width: number; // metres
  steerEase: number; // 0..1
  lean: number; // 0..1 body-lean gain
  bounce: number; // 0..1 suspension softness
  camDist: number; // metres extra chase pull-back
}

export interface VehicleDef extends VehicleStats {
  id: string;
  name: string;
  /** Build a fresh, distinct low-poly model centred on the origin, wheels on y=0. */
  build: (paint?: number) => VehicleModel;
  /** Selectable by the player but kept OUT of background traffic (e.g. the Ferrari,
   *  which is an async-loaded GLB — heavy to clone many times, and the hero car). */
  playerOnly?: boolean;
}

/** A built model: the group plus the parts the handling code animates. */
export interface VehicleModel {
  group: THREE.Group;
  /** wheels that spin with speed; [0] & [1] are the steering front wheels.
   *  Object3D (not Mesh) so GLB wheel groups — like the Ferrari's — qualify too. */
  wheels: THREE.Object3D[];
  /** headlight emissive meshes — local positions used to mount spotlights. */
  headlightAnchors: THREE.Vector3[];
  /** explicit roll radius (m) for wheels that aren't simple cylinders (GLB). */
  wheelRadius?: number;
}

// ----------------------------------------------------------------- shared mats
// One palette of shared materials keeps draw setup cheap; paint is cloned so
// each instance can be tinted (traffic variety / player colour).
const M = {
  glass: new THREE.MeshStandardMaterial({ color: 0x141d24, roughness: 0.15, metalness: 0.6, flatShading: true }),
  trim: new THREE.MeshStandardMaterial({ color: 0x0d1014, roughness: 0.7, flatShading: true }),
  tyre: new THREE.MeshStandardMaterial({ color: 0x111417, roughness: 0.85, flatShading: true }),
  rim: new THREE.MeshStandardMaterial({ color: 0x9aa3ad, roughness: 0.35, metalness: 0.8, flatShading: true }),
  chrome: new THREE.MeshStandardMaterial({ color: 0xc8ccd2, roughness: 0.25, metalness: 0.9, flatShading: true }),
  head: new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff0c0, emissiveIntensity: 1, flatShading: true }),
  tail: new THREE.MeshStandardMaterial({ color: 0x3a0000, emissive: 0xff2200, emissiveIntensity: 0.7, flatShading: true }),
  dark: new THREE.MeshStandardMaterial({ color: 0x1b232b, roughness: 0.6, flatShading: true }),
};

function paintMat(color: number): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.42, metalness: 0.35, flatShading: true });
}

function box(w: number, h: number, d: number, mat: THREE.Material, x = 0, y = 0, z = 0): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  m.castShadow = true;
  return m;
}

/** A road wheel lying on the X axis (rotates on X to roll). */
function wheel(radius: number, width: number, mat: THREE.Material = M.tyre): THREE.Mesh {
  const g = new THREE.CylinderGeometry(radius, radius, width, 12);
  g.rotateZ(Math.PI / 2);
  const m = new THREE.Mesh(g, mat);
  m.castShadow = true;
  return m;
}

function addWheels(
  group: THREE.Group,
  out: THREE.Mesh[],
  spec: ReadonlyArray<readonly [number, number, number]>, // [x, z, radius]
  width: number,
): void {
  for (const [x, z, r] of spec) {
    const w = wheel(r, width);
    w.position.set(x, r, z);
    group.add(w);
    out.push(w);
  }
}

function headlights(group: THREE.Group, anchors: THREE.Vector3[], xs: number[], y: number, z: number): void {
  for (const x of xs) {
    group.add(box(0.34, 0.16, 0.08, M.head, x, y, z));
    anchors.push(new THREE.Vector3(x, y, z));
  }
}

function taillights(group: THREE.Group, xs: number[], y: number, z: number): void {
  for (const x of xs) group.add(box(0.34, 0.14, 0.07, M.tail, x, y, z));
}

// ============================================================== model builders
// Each builder returns a recognizable silhouette. Front of vehicle faces +Z
// (matches the existing Car: headlights at +z, taillights at -z).

function buildCoupe(paint: number): VehicleModel {
  const g = new THREE.Group();
  const wheels: THREE.Mesh[] = [];
  const anchors: THREE.Vector3[] = [];
  const p = paintMat(paint);
  g.add(box(1.9, 0.62, 4.2, p, 0, 0.62, 0)); // lower
  g.add(box(1.6, 0.6, 1.9, p, 0, 1.05, -0.2)); // fastback cabin
  g.add(box(1.64, 0.46, 1.7, M.glass, 0, 1.08, -0.2)); // greenhouse
  g.add(box(1.86, 0.18, 1.1, p, 0, 0.92, 1.5)); // hood
  headlights(g, anchors, [-0.6, 0.6], 0.78, 2.05);
  taillights(g, [-0.65, 0.65], 0.78, -2.05);
  addWheels(g, wheels, [[-0.95, 1.35, 0.42], [0.95, 1.35, 0.42], [-0.95, -1.35, 0.42], [0.95, -1.35, 0.42]], 0.3);
  return { group: g, wheels, headlightAnchors: anchors };
}

function buildSupercar(paint: number): VehicleModel {
  const g = new THREE.Group();
  const wheels: THREE.Mesh[] = [];
  const anchors: THREE.Vector3[] = [];
  const p = paintMat(paint);
  g.add(box(1.95, 0.42, 4.5, p, 0, 0.42, 0)); // very low slab
  // sleek tapered cabin (low canopy near the rear)
  const cab = box(1.5, 0.46, 1.8, M.glass, 0, 0.78, -0.4);
  g.add(cab);
  g.add(box(1.9, 0.2, 1.6, p, 0, 0.62, 1.3)); // long nose
  g.add(box(1.95, 0.16, 0.7, p, 0, 0.6, -1.9)); // rear haunch
  headlights(g, anchors, [-0.65, 0.65], 0.55, 2.2);
  taillights(g, [-0.7, 0.7], 0.6, -2.2);
  addWheels(g, wheels, [[-0.98, 1.5, 0.46], [0.98, 1.5, 0.46], [-0.98, -1.5, 0.46], [0.98, -1.5, 0.46]], 0.34);
  return { group: g, wheels, headlightAnchors: anchors };
}

function buildLambo(paint: number): VehicleModel {
  const g = new THREE.Group();
  const wheels: THREE.Mesh[] = [];
  const anchors: THREE.Vector3[] = [];
  const p = paintMat(paint);
  // aggressive wedge: low flat slab + sharply raked windscreen
  g.add(box(2.0, 0.4, 4.5, p, 0, 0.4, 0));
  const wedge = box(1.6, 0.4, 1.5, M.glass, 0, 0.72, -0.2);
  wedge.rotation.x = -0.32; // raked screen
  g.add(wedge);
  g.add(box(2.0, 0.14, 2.0, p, 0, 0.5, 1.2)); // sharp nose
  g.add(box(1.7, 0.12, 0.6, M.trim, 0, 0.62, -2.0)); // rear deck
  // low rear wing
  g.add(box(1.7, 0.06, 0.34, M.trim, 0, 0.96, -2.0));
  g.add(box(0.08, 0.34, 0.3, M.trim, -0.7, 0.79, -2.0));
  g.add(box(0.08, 0.34, 0.3, M.trim, 0.7, 0.79, -2.0));
  headlights(g, anchors, [-0.7, 0.7], 0.5, 2.2);
  taillights(g, [-0.72, 0.72], 0.58, -2.22);
  addWheels(g, wheels, [[-1.0, 1.5, 0.46], [1.0, 1.5, 0.46], [-1.0, -1.5, 0.48], [1.0, -1.5, 0.48]], 0.36);
  return { group: g, wheels, headlightAnchors: anchors };
}

function buildF1(paint: number): VehicleModel {
  const g = new THREE.Group();
  const wheels: THREE.Mesh[] = [];
  const anchors: THREE.Vector3[] = [];
  const p = paintMat(paint);
  // slim central monocoque, very low & planted
  g.add(box(0.6, 0.34, 4.6, p, 0, 0.4, 0));
  g.add(box(0.5, 0.3, 0.6, M.glass, 0, 0.6, -0.1)); // cockpit opening
  g.add(box(0.34, 0.4, 0.5, p, 0, 0.78, -0.3)); // airbox/halo hump
  // sidepods
  g.add(box(1.5, 0.3, 1.6, p, 0, 0.42, -0.3));
  // sharp front nose cone
  const nose = box(0.34, 0.22, 1.4, p, 0, 0.4, 1.9);
  g.add(nose);
  // front wing (wide low blade)
  g.add(box(1.7, 0.06, 0.5, M.trim, 0, 0.22, 2.5));
  // BIG rear wing
  g.add(box(1.4, 0.5, 0.1, M.trim, 0, 0.95, -2.3));
  g.add(box(1.4, 0.05, 0.4, M.trim, 0, 1.18, -2.3));
  headlights(g, anchors, [-0.2, 0.2], 0.4, 2.0);
  taillights(g, [0], 0.7, -2.3);
  // open exposed wheels (big & wide)
  addWheels(g, wheels, [[-0.95, 1.7, 0.5], [0.95, 1.7, 0.5], [-0.95, -1.7, 0.5], [0.95, -1.7, 0.5]], 0.46);
  return { group: g, wheels, headlightAnchors: anchors };
}

function buildSUV(paint: number): VehicleModel {
  const g = new THREE.Group();
  const wheels: THREE.Mesh[] = [];
  const anchors: THREE.Vector3[] = [];
  const p = paintMat(paint);
  // tall boxy body
  g.add(box(2.1, 1.0, 4.5, p, 0, 0.85, 0));
  g.add(box(2.0, 0.7, 2.6, p, 0, 1.55, -0.15)); // tall greenhouse box
  g.add(box(2.02, 0.6, 2.5, M.glass, 0, 1.55, -0.15));
  g.add(box(2.1, 0.2, 0.4, M.trim, 0, 0.5, 2.25)); // bumper
  headlights(g, anchors, [-0.75, 0.75], 1.0, 2.25);
  taillights(g, [-0.8, 0.8], 1.2, -2.25);
  addWheels(g, wheels, [[-1.05, 1.5, 0.5], [1.05, 1.5, 0.5], [-1.05, -1.5, 0.5], [1.05, -1.5, 0.5]], 0.4);
  return { group: g, wheels, headlightAnchors: anchors };
}

function buildMonster(paint: number): VehicleModel {
  const g = new THREE.Group();
  const wheels: THREE.Mesh[] = [];
  const anchors: THREE.Vector3[] = [];
  const p = paintMat(paint);
  // small high cab on a tall chassis — sits WAY up on huge wheels
  const lift = 1.4;
  g.add(box(0.2, 1.3, 3.0, M.trim, -0.9, lift, 0)); // chassis rail L
  g.add(box(0.2, 1.3, 3.0, M.trim, 0.9, lift, 0)); // chassis rail R
  g.add(box(2.0, 0.7, 3.0, p, 0, lift + 0.5, 0)); // body tub
  g.add(box(1.9, 0.85, 1.7, p, 0, lift + 1.25, -0.1)); // cab
  g.add(box(1.92, 0.6, 1.5, M.glass, 0, lift + 1.3, -0.1));
  headlights(g, anchors, [-0.65, 0.65], lift + 0.55, 1.55);
  taillights(g, [-0.7, 0.7], lift + 0.7, -1.55);
  // four oversized knobbly wheels
  const R = 0.95;
  addWheels(g, wheels, [[-1.15, 1.25, R], [1.15, 1.25, R], [-1.15, -1.25, R], [1.15, -1.25, R]], 0.7);
  for (const w of wheels) w.add(new THREE.Mesh(new THREE.TorusGeometry(R * 0.55, 0.12, 6, 10), M.rim));
  return { group: g, wheels, headlightAnchors: anchors };
}

function buildSemi(paint: number): VehicleModel {
  const g = new THREE.Group();
  const wheels: THREE.Mesh[] = [];
  const anchors: THREE.Vector3[] = [];
  const p = paintMat(paint);
  // CAB (front, +z) — tall, short
  g.add(box(2.3, 1.7, 2.6, p, 0, 1.35, 2.6)); // cab box
  g.add(box(2.32, 0.7, 0.8, M.glass, 0, 1.85, 3.7)); // windscreen
  g.add(box(2.3, 0.4, 0.3, M.chrome, 0, 0.7, 4.0)); // grille/bumper
  // exhaust stacks
  g.add(box(0.18, 1.6, 0.18, M.chrome, -1.0, 1.9, 2.0));
  g.add(box(0.18, 1.6, 0.18, M.chrome, 1.0, 1.9, 2.0));
  // TRAILER (long box back to -z)
  g.add(box(2.5, 2.6, 7.0, M.dark, 0, 1.9, -2.4));
  g.add(box(2.52, 0.1, 7.0, M.trim, 0, 0.6, -2.4)); // underride
  headlights(g, anchors, [-0.85, 0.85], 0.9, 4.0);
  taillights(g, [-1.0, 1.0], 0.7, -5.85);
  // 3 axles: steer (front), drive (under cab/trailer join), trailer (rear)
  addWheels(g, wheels, [
    [-1.05, 3.4, 0.55], [1.05, 3.4, 0.55], // steer
    [-1.1, 1.4, 0.55], [1.1, 1.4, 0.55], // drive
    [-1.1, -4.6, 0.55], [1.1, -4.6, 0.55], // trailer
  ], 0.45);
  return { group: g, wheels, headlightAnchors: anchors };
}

function buildMotorcycle(paint: number): VehicleModel {
  const g = new THREE.Group();
  const wheels: THREE.Mesh[] = [];
  const anchors: THREE.Vector3[] = [];
  const p = paintMat(paint);
  // narrow tank + seat + frame
  g.add(box(0.34, 0.4, 1.0, p, 0, 0.85, 0.25)); // tank
  g.add(box(0.3, 0.16, 0.7, M.trim, 0, 0.8, -0.4)); // seat
  g.add(box(0.22, 0.5, 0.18, M.dark, 0, 0.95, 0.85)); // front cowl
  // forks
  g.add(box(0.1, 0.7, 0.1, M.chrome, -0.12, 0.6, 0.95));
  g.add(box(0.1, 0.7, 0.1, M.chrome, 0.12, 0.6, 0.95));
  // handlebar
  g.add(box(0.55, 0.06, 0.06, M.trim, 0, 1.05, 0.85));
  // RIDER (so the silhouette reads clearly)
  g.add(box(0.36, 0.6, 0.32, M.dark, 0, 1.25, -0.15)); // torso
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.18, 8, 6), M.glass);
  head.position.set(0, 1.7, -0.05); g.add(head); // helmet
  g.add(box(0.18, 0.4, 0.16, M.dark, -0.18, 0.95, 0.5)); // arm L
  g.add(box(0.18, 0.4, 0.16, M.dark, 0.18, 0.95, 0.5)); // arm R
  headlights(g, anchors, [0], 0.95, 1.0);
  taillights(g, [0], 0.95, -1.0);
  // two in-line wheels
  addWheels(g, wheels, [[0, 1.05, 0.42], [0, -1.0, 0.42]], 0.2);
  return { group: g, wheels, headlightAnchors: anchors };
}

// ============================================================== the roster
// Stats scaled to real top speeds. `topSpeed` is the headline; derived runtime
// figures (max m/s, cruise) are computed in main.ts from it.
export const VEHICLES: VehicleDef[] = [
  {
    id: 'coupe', name: '2-Door Coupe', topSpeed: 250,
    accel: 0.62, grip: 0.6, driftiness: 0.6, mass: 0.45, rideHeight: 0.0,
    length: 4.2, width: 1.9, steerEase: 0.6, lean: 0.5, bounce: 0.35, camDist: 0,
    build: (c = 0xd24b3e) => buildCoupe(c),
  },
  {
    id: 'lambo', name: 'Lamborghini', topSpeed: 350,
    accel: 0.88, grip: 0.78, driftiness: 0.82, mass: 0.4, rideHeight: -0.12,
    length: 4.5, width: 2.0, steerEase: 0.8, lean: 0.45, bounce: 0.2, camDist: 0.3,
    build: (c = 0xe8b53a) => buildLambo(c),
  },
  {
    id: 'supercar', name: 'Supercar', topSpeed: 340,
    accel: 0.85, grip: 0.84, driftiness: 0.5, mass: 0.42, rideHeight: -0.1,
    length: 4.5, width: 1.95, steerEase: 0.78, lean: 0.4, bounce: 0.2, camDist: 0.3,
    build: (c = 0x2f7fce) => buildSupercar(c),
  },
  {
    id: 'f1', name: 'F1 Car', topSpeed: 370,
    accel: 1.0, grip: 1.0, driftiness: 0.12, mass: 0.18, rideHeight: -0.18,
    length: 4.6, width: 1.9, steerEase: 1.0, lean: 0.25, bounce: 0.1, camDist: 0.6,
    build: (c = 0xe23636) => buildF1(c),
  },
  {
    id: 'moto', name: 'Motorcycle', topSpeed: 300,
    accel: 0.92, grip: 0.66, driftiness: 0.55, mass: 0.16, rideHeight: 0.0,
    length: 2.1, width: 0.5, steerEase: 0.95, lean: 1.0, bounce: 0.4, camDist: -1.0,
    build: (c = 0x1f2933) => buildMotorcycle(c),
  },
  {
    id: 'suv', name: 'SUV', topSpeed: 200,
    accel: 0.5, grip: 0.55, driftiness: 0.4, mass: 0.7, rideHeight: 0.35,
    length: 4.5, width: 2.1, steerEase: 0.45, lean: 0.7, bounce: 0.55, camDist: 1.2,
    build: (c = 0x394a3a) => buildSUV(c),
  },
  {
    id: 'semi', name: 'Semi Truck', topSpeed: 120,
    accel: 0.22, grip: 0.6, driftiness: 0.1, mass: 1.0, rideHeight: 0.6,
    length: 12.0, width: 2.5, steerEase: 0.22, lean: 0.35, bounce: 0.3, camDist: 5.0,
    build: (c = 0x3460a8) => buildSemi(c),
  },
  {
    id: 'monster', name: 'Monster Truck', topSpeed: 100,
    accel: 0.3, grip: 0.5, driftiness: 0.3, mass: 0.9, rideHeight: 1.4,
    length: 4.0, width: 2.6, steerEase: 0.4, lean: 0.6, bounce: 1.0, camDist: 3.0,
    build: (c = 0x7a3bb0) => buildMonster(c),
  },
  {
    // The real GLB from three.js' webgl_materials_car example (clear-coat paint).
    // Player-only: async-loaded, so it's never built into the synchronous traffic
    // pool. Stats tuned to a planted, fast, grippy GT.
    id: 'ferrari', name: 'Ferrari', topSpeed: 340,
    accel: 0.9, grip: 0.9, driftiness: 0.45, mass: 0.42, rideHeight: -0.02,
    length: 4.5, width: 2.0, steerEase: 0.82, lean: 0.4, bounce: 0.18, camDist: 0.3,
    playerOnly: true,
    build: (c?: number) => buildFerrari(c),
  },
];

export const DEFAULT_VEHICLE = 'coupe';

export function getVehicle(id: string): VehicleDef {
  return VEHICLES.find((v) => v.id === id) ?? VEHICLES[0];
}

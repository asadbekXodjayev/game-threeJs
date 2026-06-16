import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import type { VehicleModel } from './vehicles';

/**
 * The Ferrari from the official three.js `webgl_materials_car` example — the one
 * real (non-procedural) model in the roster. We vendor the asset locally
 * (public/models/ferrari.glb, Draco-compressed; decoder in public/draco/) so the
 * game stays self-contained and works offline.
 *
 * The GLB load is async but the roster's build() is synchronous, so we PRELOAD
 * once and cache a template; build() then clones the template instantly. The
 * clear-coat car-paint material needs an environment map to read as paint — that
 * is set up scene-wide in main.ts (RoomEnvironment via PMREM).
 *
 * Front of the model faces +Z to match the procedural roster convention
 * (headlights at +z); main.ts flips it to point forward.
 */

const MODEL_URL = `${import.meta.env.BASE_URL}models/ferrari.glb`;
const DRACO_PATH = `${import.meta.env.BASE_URL}draco/`;

// Materials lifted from the three.js example. Body is a metallic clear-coat
// (the signature car paint); rims/trim are chrome; glass is transmissive.
const bodyMaterial = new THREE.MeshPhysicalMaterial({
  color: 0xd5132b, metalness: 1.0, roughness: 0.5, clearcoat: 1.0, clearcoatRoughness: 0.03,
});
const detailsMaterial = new THREE.MeshStandardMaterial({ color: 0xffffff, metalness: 1.0, roughness: 0.5 });
const glassMaterial = new THREE.MeshPhysicalMaterial({ color: 0xffffff, metalness: 0.25, roughness: 0, transmission: 1.0 });

let template: THREE.Object3D | null = null;
let measuredRadius = 0.36; // refined from the loaded model
let loadPromise: Promise<THREE.Object3D> | null = null;

/** True once the template is cached and buildFerrari() will return the real car. */
export function ferrariReady(): boolean {
  return template !== null;
}

/**
 * Give the car-paint materials their OWN environment map. Needed because when a
 * material falls back to scene.environment, the renderer forces its
 * envMapIntensity to scene.environmentIntensity (kept low for the world's mood).
 * Assigning envMap directly lets the Ferrari reflect at full strength like the
 * original example while the rest of the world stays calmly lit.
 */
export function setFerrariEnv(tex: THREE.Texture): void {
  bodyMaterial.envMap = tex; bodyMaterial.envMapIntensity = 1.15; bodyMaterial.needsUpdate = true;
  detailsMaterial.envMap = tex; detailsMaterial.envMapIntensity = 1.1; detailsMaterial.needsUpdate = true;
  glassMaterial.envMap = tex; glassMaterial.envMapIntensity = 1.0; glassMaterial.needsUpdate = true;
}

/** Kick off (or join) the one-time async load. Resolves when the template is ready. */
export function preloadFerrari(): Promise<THREE.Object3D> {
  if (loadPromise) return loadPromise;

  const draco = new DRACOLoader();
  draco.setDecoderPath(DRACO_PATH);
  const loader = new GLTFLoader();
  loader.setDRACOLoader(draco);

  loadPromise = loader.loadAsync(MODEL_URL).then((gltf) => {
    const car = gltf.scene.children[0]; // RootNode (main + 4 wheels + steering)

    // re-skin the named parts exactly like the example
    setMat(car, 'body', bodyMaterial);
    setMat(car, 'rim_fl', detailsMaterial);
    setMat(car, 'rim_fr', detailsMaterial);
    setMat(car, 'rim_rl', detailsMaterial);
    setMat(car, 'rim_rr', detailsMaterial);
    setMat(car, 'trim', detailsMaterial);
    setMat(car, 'glass', glassMaterial);

    car.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.isMesh) { mesh.castShadow = true; mesh.receiveShadow = false; }
    });

    // measure the real front-wheel radius for correct spin speed
    const fl = car.getObjectByName('wheel_fl');
    if (fl) {
      const b = new THREE.Box3().setFromObject(fl);
      measuredRadius = Math.max(0.2, (b.max.y - b.min.y) / 2);
    }

    template = car;
    draco.dispose();
    return car;
  });

  return loadPromise;
}

function setMat(root: THREE.Object3D, name: string, mat: THREE.Material): void {
  const o = root.getObjectByName(name) as THREE.Mesh | undefined;
  if (o && o.isMesh) o.material = mat;
}

/**
 * Synchronously build a Ferrari VehicleModel by cloning the cached template.
 * `paint` re-tints a per-instance clone of the body material so traffic / the
 * player can vary colour without disturbing the shared clear-coat parameters.
 * Throws if called before preloadFerrari() resolves — callers gate on ferrariReady().
 */
export function buildFerrari(paint?: number): VehicleModel {
  if (!template) throw new Error('ferrari.glb not loaded yet — call preloadFerrari() first');

  const car = template.clone(true);

  // face +Z (roster convention) — the GLB nose points -Z, so flip it
  const g = new THREE.Group();
  g.userData.keepGeometry = true; // clones share template geometry — don't dispose
  car.rotation.y = Math.PI;
  g.add(car);

  // per-instance paint: clone the body material only when a custom colour is given
  if (paint !== undefined) {
    const body = car.getObjectByName('body') as THREE.Mesh | undefined;
    if (body) {
      const m = (body.material as THREE.MeshPhysicalMaterial).clone();
      m.color.setHex(paint);
      body.material = m;
    }
  }

  // wheels: [0]&[1] are the steering fronts (roster convention)
  const wheels: THREE.Object3D[] = [];
  for (const n of ['wheel_fl', 'wheel_fr', 'wheel_rl', 'wheel_rr']) {
    const w = car.getObjectByName(n);
    if (w) wheels.push(w);
  }

  // headlight anchors at the nose (model space, before the +Z flip is applied by
  // the parent group; anchors live on g's frame so use post-flip +Z front)
  const anchors = [new THREE.Vector3(-0.62, 0.62, 2.0), new THREE.Vector3(0.62, 0.62, 2.0)];

  return { group: g, wheels, headlightAnchors: anchors, wheelRadius: measuredRadius };
}

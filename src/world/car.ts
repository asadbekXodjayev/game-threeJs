import * as THREE from 'three';
import { makeDiscTexture } from './textures';

/** Procedural low-poly 4-door sedan + headlights + body-lean rig. */
export class Car {
  root = new THREE.Group(); // positioned by handling (x = lane offset)
  body = new THREE.Group(); // gets lean/pitch/squash
  private wheels: THREE.Mesh[] = [];
  headlightL: THREE.SpotLight;
  headlightR: THREE.SpotLight;
  private glowL: THREE.Sprite;
  private glowR: THREE.Sprite;
  private tailMats: THREE.MeshStandardMaterial[] = [];

  constructor() {
    const paint = new THREE.MeshStandardMaterial({ color: 0xd24b3e, roughness: 0.45, metalness: 0.35 });
    const glass = new THREE.MeshStandardMaterial({ color: 0x1b2630, roughness: 0.15, metalness: 0.5 });
    const trim = new THREE.MeshStandardMaterial({ color: 0x101418, roughness: 0.7 });

    // lower body
    const lower = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.7, 4.4), paint);
    lower.position.y = 0.55;
    lower.castShadow = true;
    this.body.add(lower);

    // cabin (tapered)
    const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.62, 2.2), paint);
    cabin.position.set(0, 1.05, -0.15);
    cabin.castShadow = true;
    this.body.add(cabin);

    // greenhouse / windows
    const win = new THREE.Mesh(new THREE.BoxGeometry(1.74, 0.5, 2.0), glass);
    win.position.set(0, 1.08, -0.15);
    this.body.add(win);

    // hood + boot bevels
    const hood = new THREE.Mesh(new THREE.BoxGeometry(1.96, 0.18, 1.1), paint);
    hood.position.set(0, 0.85, 1.55);
    this.body.add(hood);

    // headlights (emissive blocks) + spotlights
    const hlMat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff0c0, emissiveIntensity: 1 });
    for (const sx of [-0.65, 0.65]) {
      const hl = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.18, 0.1), hlMat);
      hl.position.set(sx, 0.7, 2.2);
      this.body.add(hl);
    }
    // taillights
    const tlGeo = new THREE.BoxGeometry(0.4, 0.16, 0.08);
    for (const sx of [-0.7, 0.7]) {
      const tm = new THREE.MeshStandardMaterial({ color: 0x440000, emissive: 0xff2200, emissiveIntensity: 0.6 });
      const tl = new THREE.Mesh(tlGeo, tm);
      tl.position.set(sx, 0.7, -2.2);
      this.body.add(tl);
      this.tailMats.push(tm);
    }

    // wheels
    const wheelGeo = new THREE.CylinderGeometry(0.42, 0.42, 0.32, 14);
    wheelGeo.rotateZ(Math.PI / 2);
    for (const [wx, wz] of [[-1.0, 1.45], [1.0, 1.45], [-1.0, -1.45], [1.0, -1.45]] as const) {
      const w = new THREE.Mesh(wheelGeo, trim);
      w.position.set(wx, 0.42, wz);
      w.castShadow = true;
      this.body.add(w);
      this.wheels.push(w);
    }

    this.root.add(this.body);

    // spotlights for night driving
    const mkSpot = (sx: number) => {
      const s = new THREE.SpotLight(0xfff1cf, 0, 60, Math.PI / 7, 0.5, 1.4);
      s.position.set(sx, 0.7, 2.2);
      s.target.position.set(sx * 1.5, 0, 30);
      this.body.add(s);
      this.body.add(s.target);
      return s;
    };
    this.headlightL = mkSpot(-0.65);
    this.headlightR = mkSpot(0.65);

    // soft headlight glow sprites
    const disc = makeDiscTexture(true);
    const mkGlow = (sx: number) => {
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: disc, color: 0xfff0c0, transparent: true, opacity: 0, depthWrite: false }));
      sp.scale.set(1.4, 1.4, 1);
      sp.position.set(sx, 0.7, 2.3);
      this.body.add(sp);
      return sp;
    };
    this.glowL = mkGlow(-0.65);
    this.glowR = mkGlow(0.65);
  }

  /** spin wheels by speed (m/s) */
  spin(speed: number, dt: number): void {
    const a = (speed / 0.42) * dt;
    for (const w of this.wheels) w.rotation.x += a;
  }

  /** apply visual feel: lean (roll), pitch from accel, suspension squash */
  setFeel(roll: number, pitch: number, squash: number): void {
    this.body.rotation.z = roll;
    this.body.rotation.x = pitch;
    this.body.scale.y = 1 - squash;
  }

  /** front wheels steer angle */
  steerWheels(angle: number): void {
    this.wheels[0].rotation.y = angle;
    this.wheels[1].rotation.y = angle;
  }

  setHeadlights(on: number): void {
    const intensity = on * 3.2;
    this.headlightL.intensity = intensity;
    this.headlightR.intensity = intensity;
    this.glowL.material.opacity = on * 0.9;
    this.glowR.material.opacity = on * 0.9;
  }
}

import * as THREE from 'three';

/** Gradient sky dome with a shader; top + bottom colors + sun glow lerp at
 *  runtime for biome cross-fade, day/night and weather darkening.
 *
 *  Night additions (P1): a twinkling instanced starfield (THREE.Points) and an
 *  animated aurora / northern-lights shader band across the upper sky. Both fade
 *  in with `night` and out by day, layered under the existing day/night+weather.
 *  Respect prefers-reduced-motion (gentle drift, no harsh shimmer). */
export class Sky {
  mesh: THREE.Mesh;
  group = new THREE.Group();
  private mat: THREE.ShaderMaterial;
  private stars: THREE.Points;
  private starMat: THREE.ShaderMaterial;
  private aurora: THREE.Mesh;
  private auroraMat: THREE.ShaderMaterial;
  private night = 0;

  constructor() {
    this.mat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      uniforms: {
        uTop: { value: new THREE.Color(0x6fc6dd) },
        uBottom: { value: new THREE.Color(0xffe6bf) },
        uSunDir: { value: new THREE.Vector3(0, 0.4, -1).normalize() },
        uSunColor: { value: new THREE.Color(0xffd79a) },
        uNight: { value: 0 },
      },
      vertexShader: /* glsl */ `
        varying vec3 vDir;
        void main(){
          vDir = normalize(position);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        varying vec3 vDir;
        uniform vec3 uTop; uniform vec3 uBottom; uniform vec3 uSunDir;
        uniform vec3 uSunColor; uniform float uNight;
        void main(){
          float h = clamp(vDir.y * 0.5 + 0.5, 0.0, 1.0);
          vec3 col = mix(uBottom, uTop, pow(h, 0.8));
          float sun = pow(max(dot(normalize(vDir), normalize(uSunDir)), 0.0), 64.0);
          float halo = pow(max(dot(normalize(vDir), normalize(uSunDir)), 0.0), 6.0) * 0.35;
          col += uSunColor * (sun * 1.4 + halo);
          vec3 night = mix(vec3(0.015,0.02,0.05), vec3(0.0,0.0,0.015), h);
          col = mix(col, night, uNight);
          gl_FragColor = vec4(col, 1.0);
        }
      `,
    });
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(500, 24, 16), this.mat);
    this.mesh.frustumCulled = false;
    this.group.add(this.mesh);

    // ---- starfield (Points on the upper dome) ----
    const STARS = 1100;
    const sp = new Float32Array(STARS * 3);
    const ssize = new Float32Array(STARS);
    const sphase = new Float32Array(STARS);
    for (let i = 0; i < STARS; i++) {
      // upper hemisphere bias
      const u = Math.random();
      const theta = Math.acos(0.05 + u * 0.95); // toward zenith
      const phi = Math.random() * Math.PI * 2;
      const r = 480;
      sp[i * 3] = r * Math.sin(theta) * Math.cos(phi);
      sp[i * 3 + 1] = r * Math.cos(theta) * 0.9 + 40;
      sp[i * 3 + 2] = r * Math.sin(theta) * Math.sin(phi);
      ssize[i] = 1.2 + Math.random() * 2.6;
      sphase[i] = Math.random() * 6.28;
    }
    const sgeo = new THREE.BufferGeometry();
    sgeo.setAttribute('position', new THREE.BufferAttribute(sp, 3));
    sgeo.setAttribute('aSize', new THREE.BufferAttribute(ssize, 1));
    sgeo.setAttribute('aPhase', new THREE.BufferAttribute(sphase, 1));
    this.starMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: { uTime: { value: 0 }, uOpacity: { value: 0 }, uTwinkle: { value: 1 } },
      vertexShader: /* glsl */ `
        attribute float aSize; attribute float aPhase;
        uniform float uTime; uniform float uTwinkle;
        varying float vTw;
        void main(){
          vTw = 0.6 + 0.4 * sin(uTime * 2.2 + aPhase) * uTwinkle;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = aSize * (1.0 + vTw * 0.4);
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float uOpacity; varying float vTw;
        void main(){
          vec2 d = gl_PointCoord - 0.5;
          float a = smoothstep(0.5, 0.0, length(d));
          gl_FragColor = vec4(vec3(0.85,0.9,1.0), a * vTw * uOpacity);
        }
      `,
    });
    this.stars = new THREE.Points(sgeo, this.starMat);
    this.stars.frustumCulled = false;
    this.group.add(this.stars);

    // ---- aurora ribbons (curved band across the upper sky) ----
    // phi 0.55..1.45 rad from the top => elevation ~0.85 down to ~0.12, kept low
    // enough that the band sits near the horizon and is visible from the chase cam.
    const ageo = new THREE.SphereGeometry(470, 64, 32, 0, Math.PI * 2, 0.55, 0.95);
    this.auroraMat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: { uTime: { value: 0 }, uOpacity: { value: 0 }, uSpeed: { value: 1 } },
      vertexShader: /* glsl */ `
        varying vec3 vDir;
        void main(){ vDir = normalize(position);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }
      `,
      fragmentShader: /* glsl */ `
        varying vec3 vDir; uniform float uTime; uniform float uOpacity; uniform float uSpeed;
        // hash + smooth noise for drifting curtains
        float hash(float n){ return fract(sin(n)*43758.5453); }
        float noise(vec2 p){
          vec2 i=floor(p); vec2 f=fract(p); f=f*f*(3.0-2.0*f);
          float a=hash(i.x+i.y*57.0), b=hash(i.x+1.0+i.y*57.0);
          float c=hash(i.x+(i.y+1.0)*57.0), d=hash(i.x+1.0+(i.y+1.0)*57.0);
          return mix(mix(a,b,f.x),mix(c,d,f.x),f.y);
        }
        void main(){
          float az = atan(vDir.z, vDir.x);
          float el = vDir.y;
          float t = uTime * 0.06 * uSpeed;
          // vertical curtains that wave horizontally
          float n = noise(vec2(az*2.0 + t, el*2.0));
          n += 0.5*noise(vec2(az*4.0 - t*1.3, el*3.5 + 2.0));
          float curtain = pow(max(0.0, n - 0.32), 1.2) * 2.6;
          // band low across the sky so it reads from the chase camera
          float band = smoothstep(0.12, 0.28, el) * (1.0 - smoothstep(0.6, 0.85, el));
          float amt = curtain * band;
          // green->teal->violet gradient along elevation
          vec3 green = vec3(0.15, 0.95, 0.55);
          vec3 teal  = vec3(0.10, 0.75, 0.85);
          vec3 viol  = vec3(0.55, 0.30, 0.95);
          vec3 col = mix(green, teal, smoothstep(0.2,0.4,el));
          col = mix(col, viol, smoothstep(0.4,0.6,el));
          gl_FragColor = vec4(col * amt, amt * uOpacity);
        }
      `,
    });
    this.aurora = new THREE.Mesh(ageo, this.auroraMat);
    this.aurora.frustumCulled = false;
    this.group.add(this.aurora);
  }

  setReduced(r: boolean): void {
    this.starMat.uniforms.uTwinkle.value = r ? 0.25 : 1;
    this.auroraMat.uniforms.uSpeed.value = r ? 0.35 : 1;
  }

  set(top: THREE.Color, bottom: THREE.Color, sunDir: THREE.Vector3, sunColor: THREE.Color, night: number): void {
    (this.mat.uniforms.uTop.value as THREE.Color).copy(top);
    (this.mat.uniforms.uBottom.value as THREE.Color).copy(bottom);
    (this.mat.uniforms.uSunDir.value as THREE.Vector3).copy(sunDir);
    (this.mat.uniforms.uSunColor.value as THREE.Color).copy(sunColor);
    this.mat.uniforms.uNight.value = night;
    this.night = night;
  }

  /** animate stars + aurora; fade with night. weatherClear 0..1 hides them in storms. */
  update(t: number, camPos: THREE.Vector3, weatherClear = 1): void {
    this.group.position.set(camPos.x, 0, camPos.z);
    const vis = THREE.MathUtils.smoothstep(this.night, 0.45, 0.85) * weatherClear;
    this.starMat.uniforms.uTime.value = t;
    this.starMat.uniforms.uOpacity.value = vis;
    this.stars.visible = vis > 0.01;
    this.auroraMat.uniforms.uTime.value = t;
    this.auroraMat.uniforms.uOpacity.value = vis * 0.85;
    this.aurora.visible = vis > 0.01;
  }

  dispose(): void {
    this.mesh.geometry.dispose(); this.mat.dispose();
    this.stars.geometry.dispose(); this.starMat.dispose();
    this.aurora.geometry.dispose(); this.auroraMat.dispose();
  }
}

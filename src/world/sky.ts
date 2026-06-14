import * as THREE from 'three';

/** Gradient sky dome with a shader; top + bottom colors + sun glow lerp at
 *  runtime for biome cross-fade, day/night and weather darkening. */
export class Sky {
  mesh: THREE.Mesh;
  private mat: THREE.ShaderMaterial;

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
          // night: stars near top
          vec3 night = mix(vec3(0.02,0.03,0.06), vec3(0.0,0.0,0.02), h);
          float star = step(0.9992, fract(sin(dot(floor(vDir*180.0), vec3(12.9898,78.233,37.71)))*43758.5453));
          night += star * h * vec3(0.8,0.85,1.0);
          col = mix(col, night, uNight);
          gl_FragColor = vec4(col, 1.0);
        }
      `,
    });
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(500, 24, 16), this.mat);
    this.mesh.frustumCulled = false;
  }

  set(top: THREE.Color, bottom: THREE.Color, sunDir: THREE.Vector3, sunColor: THREE.Color, night: number): void {
    (this.mat.uniforms.uTop.value as THREE.Color).copy(top);
    (this.mat.uniforms.uBottom.value as THREE.Color).copy(bottom);
    (this.mat.uniforms.uSunDir.value as THREE.Vector3).copy(sunDir);
    (this.mat.uniforms.uSunColor.value as THREE.Color).copy(sunColor);
    this.mat.uniforms.uNight.value = night;
  }

  dispose(): void { this.mesh.geometry.dispose(); this.mat.dispose(); }
}

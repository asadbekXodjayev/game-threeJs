# CREDITS

## Code & engine
- **Three.js** (r0.166) — MIT License. https://threejs.org
- **GSAP** (3.12) — standard "no charge" license for this use. https://gsap.com
- **Vite**, **TypeScript** — MIT.
- Adaptive-quality manager + QA harness pattern adapted from the sibling `cars-ThreeJs`
  project (same author/workspace).

## 3D assets
All geometry is **procedurally generated from Three.js primitives** in this repo
(`src/world/*.ts`, `src/car/vehicles.ts`): the **8-vehicle roster** — 2-Door Coupe, Lamborghini,
Supercar, F1 car (open-wheel + front/rear wings), Motorcycle (two wheels + rider/helmet), SUV
(tall boxy), Semi Truck (cab + long trailer + exhaust stacks), Monster Truck (oversized wheels +
lifted body) — all **self-generated stylized low-poly interpretations** built from boxes /
cylinders / spheres, no branded, ripped, or downloaded models; the continuous spline-ribbon road
(with lane dividers + ground),
scatter (trees/pines/palms/rocks/cactus/buildings + foliage bushes/grass tufts), ambient life
(birds, deer, pedestrians), **light traffic** cars (instanced low-poly), **tyre skid-mark** dabs,
knockable props (cone/bin/ball), the **distant parallax terrain** silhouette bands
(`src/world/terrain.ts`), the **realistic sun disc + cratered moon sphere** (`src/world/sky.ts`),
the **tyre-smoke `Points` system** on the player car (`src/world/car.ts`), and the landmarks (Iron
Lattice Tower, Harbor Statue, Great Pyramids, Triumphal Arch, Sky Obelisk, Stone Colossus) with a
cheap far-LOD silhouette impostor.
The landmarks are **original stylized low-poly interpretations** — no branded or ripped models,
no trademarked signage. No external model files are downloaded.

## Procedural shaders (generated this pass)
All written in-repo, no external assets:
- **Night starfield** — instanced `THREE.Points` with a twinkle shader (`src/world/sky.ts`).
- **Aurora / northern lights** — animated drifting-curtain noise shader on an upper-sky band,
  green→teal→violet, fades in with night, reduced-motion-aware (`src/world/sky.ts`).
- **Tornado funnel** — a swirling-band shader on a tapered cone + a debris `Points` swarm,
  distant and cinematic (`src/world/weather.ts`).
- **Sky dome** gradient + sun-glow shader; the **denser (2600) starfield** now varies point size
  and brightness with a realistic faint-heavy magnitude distribution (`src/world/sky.ts`).

## Textures & imagery (isImagesUsed)
All bitmap imagery is **generated procedurally at runtime** via `<canvas>` in
`src/world/textures.ts` — no downloaded image files:
- Asphalt road texture with edge + dashed lane markings.
- Noised ground tile (tinted per biome).
- City billboard / landmark nameplate poster (gradient + grid + type).
- **Cratered MOON surface** (`makeMoonTexture`) — pale regolith grey with darker maria + craters
  (rim shadow + highlight relief), painted procedurally so the night moon reads as a real body.
- Radial disc sprite for particles, tyre smoke, headlight glow, and the sun/moon halos.
- OG cover + favicon are hand-authored SVG (`scripts/og-cover.mjs`).

> The owned preview images at `../threeJs/public/previews/*.jpg` were available as optional
> billboard art; this MVP ships fully procedural canvas imagery instead, so no third-party or
> external image licenses are required.

## Audio
**100% procedural Web Audio API** (`src/audio/audio.ts`) — synthesized oscillators and filtered
noise for the engine, wind, rain, lo-fi music bed, honk, thunder, **tyre skid** (bandpassed noise
driven by lateral slip), the **collision bump** (sine thud + noise crunch on physical traffic
impact), and the **deep tornado wind roar** (low-passed noise that swells with proximity).
**No audio files**, so no audio licenses apply.

## Fonts
- **Space Grotesk**, **Sora**, **JetBrains Mono** — all Open Font License (SIL OFL 1.1),
  served via Google Fonts.

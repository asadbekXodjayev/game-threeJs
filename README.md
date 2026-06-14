# ENDLESS DRIVE

A chill, **endless procedural road trip** built with vanilla **Three.js + Vite + TypeScript + GSAP**.
No score, no game over, no timer. A low-poly 4-door car cruises a procedurally generated
highway that never ends. Roughly every minute the world **cross-fades into a new biome**
(forest → mountains → beach → city, in a seeded random order), weather **rolls in and clears
on its own**, a slow day/night cycle turns the headlights on at dusk, ambient life drifts past,
and original stylized landmarks rise on the horizon. The player's only job is to steer and relax.

## Run

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # tsc (zero errors) + vite build + OG cover
npm run preview  # serves dist on strict port 4190
npm run qa       # headless smoke + soak (needs preview running on 4190)
```

Reproduce a specific drive with `?seed=123456` in the URL (shown on the title screen).

## Why this stack

The brief recommended vanilla three over R3F, and that's the right call for an **endless game
with hand-tuned pooling and a strict frame budget**. A single `requestAnimationFrame` loop with
a fixed-timestep physics step gives full control over allocation and draw-call discipline —
exactly what the `isEndless` / `isPooled` / `isFast` gates need. GSAP drives the loader intro and
the biome/landmark name reveals. **No React, no framer-motion** (React-only, excluded per brief).

**Audio is 100% procedural Web Audio API** — no audio files are downloaded. The engine note is
sawtooth + square oscillators whose frequency and gain track speed/throttle; wind and rain are
filtered noise; the lo-fi music bed is a slowly-swelling triangle chord; thunder is a low-passed
noise burst. Audio starts on the first user gesture (browser autoplay policy) and has per-channel
toggles (music / engine / ambience+weather).

**Knockable props use a tiny custom physics layer** (a capped pool of bodies with position +
velocity + angular velocity, gravity, bounce, friction and a sleep state) rather than Rapier.
This keeps the bundle small and the brief explicitly scoped it this way. *Production upgrade:*
swap `src/world/props.ts` for Rapier-wasm bodies for proper collision shapes and stacking.

## Architecture

```
src/
├── core/      rng (mulberry32) · pool · perf (adaptive quality) · input (kbd/touch/gamepad)
├── data/      biomes · weather · landmarks  (data-driven palettes & catalogues)
├── world/     road · car · scatter · life · weather · landmarks · props · sky · director
├── audio/     audio (procedural Web Audio)
├── ui/        hud
└── main.ts    scene wiring + the game loop + handling feel
```

The **Director** owns the timed biome cycle, the day/night clock, and weather scheduling. Each
frame it produces one **blended state** (fog, sky, sun, ground, road colours + night factor) that
the rest of the scene reads — the cross-fade lerps every parameter simultaneously over a 9-second
corridor, never a single-frame swap. See `RULES.md` for the per-gate status.

## Performance

DPR clamped to ≤2; a runtime FPS monitor steps quality down (DPR → shadows → particle density →
prop density → physics) and recovers when there's headroom. Everything repeated is instanced
(one draw call per prop/life kind) and pooled (road tiles, scatter, life, weather particles,
landmarks, physics bodies all recycle — nothing is created or destroyed in the loop). `FogExp2`
both sells the mood and hides the spawn distance. Rendering work is skipped when the tab is hidden.

## Deploy

`vercel.json` ships a single-page rewrite + long-cache headers for hashed assets. Target repo:
`https://github.com/asadbekXodjayev/game-threeJs` (the orchestrator pushes — do not push from here).

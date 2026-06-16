# Plain Three Controllers Toolkit

A deliberately plain **Vite + Three.js** controller toolkit for browser games.
No React. No Rapier. No Cannon. No runtime dependency except `three`; no dev dependency except `vite`.

This is a playable controller foundation, not a full rigid-body engine. The controllers are kinematic/game-style: they own their movement model, sample a lightweight collision world, emit animation state, and stay modular enough to import independently.

## Install and run

```bash
npm install
npm run verify
npm run dev
npm run build
```

## Dependency gate

`package.json` is intentionally narrow:

```json
"dependencies": { "three": "^0.184.0" },
"devDependencies": { "vite": "^8.0.16" }
```

The `npm run verify` script fails if any other dependency is added.

## What is included

### Character controller

- Walk / run / jump
- Slope handling through a configurable max slope angle
- Ground snapping and ground normal tracking
- Moving platform carry
- Capsule-style collision resolution against simple boxes
- Custom gravity per object through `GravitySystem`
- Animation-state output: `idle`, `walk`, `run`, `jump`, `fall`

### Custom gravity

- Directional gravity
- Point gravity for tiny planets
- Demo wall-walking gravity
- Demo gravity tunnel field
- Gravity can be sampled per controller/object instead of assuming global `Y-` gravity

### Vehicle controllers

- Simple kinematic car controller with throttle, reverse, brake, steering, drag, ground snap, and slope alignment
- Simple drone controller with horizontal flight, vertical thrust, drag, banking, and optional gravity influence

### Camera and input

- Smooth follow camera with mouse-look and custom up vectors
- Keyboard input
- Pointer-lock mouse input
- Touch joystick/buttons for mobile
- Time scaling and bullet-time helper

## Modular imports

```js
import {
  InputManager,
  TimeController,
  GravitySystem,
  PhysicsWorld,
  CharacterController,
  CarController,
  DroneController,
  SmoothFollowCamera,
} from './src/toolkit/index.js';
```

Use only the pieces you need. The character controller does not depend on the car/drone controllers, and none of the controllers depend on the demo app.

## Demo controls

- `1` character
- `2` car
- `3` drone
- `WASD` movement / drive / fly
- `Shift` run or descend
- `Space` jump or ascend
- `G` cycle gravity modes
- `B` bullet time
- Click viewport for mouse-look

## Current limitations

This is a lightweight toolkit, not a physics solver. It does not provide stacked rigid bodies, rotational inertia, continuous collision detection, constraint joints, or high-fidelity vehicle suspension. Moving platforms, slopes, gravity zones, and simple colliders are supported because those are the features needed for playable controller feel in a plain Three.js prototype.

Use Rapier/Cannon/Ammo later only if you actually need full rigid-body dynamics. This toolkit is meant to keep the game controller layer small, inspectable, and engine-owned.

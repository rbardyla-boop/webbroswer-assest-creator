# GLB/FBX Asset Import Gate

Purpose: prevent generated or third-party 3D assets from entering runtime as opaque, oversized, broken, or legally unclear payloads.

This gate applies to optional hero assets, creatures, props, pickups, vegetation variants, environment pieces, and animated models.

## Runtime boundary

Generated assets are produced offline. They must not require remote generation calls, remote model URLs, or client-side asset-generation SDKs at runtime.

Runtime may load accepted GLB/GLTF assets only after inspection and local inclusion.

## Preferred format

- Prefer `.glb` for runtime.
- `.gltf` with external buffers/textures is allowed only if file paths are stable and build-tested.
- `.fbx` is an interchange format, not the preferred browser runtime format.

## Required inspection

For each candidate asset, record:

- Source/provenance and license status.
- File size.
- Triangle count.
- Mesh count.
- Material count.
- Texture count, dimensions, and formats.
- Bounding box dimensions.
- Origin/pivot position.
- Up axis and forward axis.
- Scale relative to the player capsule.
- Shadow-casting and receiving policy.
- Animation clips, durations, and names, if present.
- Skeleton/bone count, if rigged.
- Morph target count, if present.
- Compression status, if Draco/Meshopt/KTX2 is used.

## Acceptance thresholds for this prototype

These are initial defaults, not permanent engine limits.

| Asset type | Target max triangles | Target max texture set | Notes |
| --- | ---: | --- | --- |
| Small prop | 2k | 1 x 1024 | Instancing preferred for repeats. |
| Hero prop | 10k | 1-2 x 2048 | Must have visible gameplay value. |
| Creature/NPC | 20k | 2 x 2048 | Requires animation gate. |
| Large environment piece | 30k | 2-4 x 2048 | Must be LOD/culling reviewed. |
| Foliage variant | 1k | 1 x 1024 | Must not compete with grass patch budget. |

Assets exceeding thresholds may still pass with a written reason and profiler evidence.

## Rigged/animated model checks

Required before runtime integration:

- Rest pose is coherent; T-pose/A-pose mismatch is documented.
- Skeleton hierarchy is stable and does not contain duplicate or unnamed critical bones.
- Animation clips are named and previewed.
- Root motion policy is explicit: in-place or root-motion-driven.
- Retargeting source and target skeletons are documented.
- Clip playback is tested with `THREE.AnimationMixer` in isolation before gameplay use.

## Material checks

- Prefer PBR-compatible materials.
- Avoid excessive unique materials; merge where possible.
- Ensure color space is correct for albedo/base color maps.
- Normal/roughness/metallic maps must be present only when they materially improve the result.
- Transparent materials require sorting/blending review.

## Integration checklist

Before merge:

- Asset is stored locally under the approved asset folder.
- Asset is referenced by a manifest or loader path, not hard-coded in multiple systems.
- Build passes.
- Browser smoke loads the asset without console errors.
- The debug HUD or profiler captures draw-call and triangle impact.
- Asset scale, pivot, shadows, and animation playback are visually checked.

## Current state

No generated GLB/FBX runtime asset path is active yet. This gate is ready for the first accepted hero prop, creature, or animated character.

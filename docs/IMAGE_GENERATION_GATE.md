# Image Generation Gate

Purpose: use generated images as concept/support material without polluting the runtime with oversized, unclear, or inconsistent art assets.

## Allowed uses

- Skybox concepts.
- Texture references.
- UI/icon concepts.
- Mood boards.
- Temporary placeholder art.

## Runtime acceptance checks

Before a generated image ships in runtime:

- Source/provenance is recorded.
- License/use rights are recorded.
- Image dimensions are appropriate for runtime use.
- Format is selected intentionally: PNG for alpha/UI, JPG/WebP for opaque art, KTX2 later for GPU texture optimization.
- File size is reasonable.
- Color profile and gamma are checked visually in browser.
- Mipmapping/tiling/seams are checked if used as a texture.
- UI images are tested against desktop and mobile safe areas.

## Prohibited default behavior

Do not add generated images directly into the live scene as final assets without compression review and browser evidence.

## Current state

No generated image runtime assets are active yet. Use this gate for future skybox, UI icon, texture-reference, and loading-screen work.

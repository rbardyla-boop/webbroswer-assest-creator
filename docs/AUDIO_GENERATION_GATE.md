# Audio Generation Gate

Purpose: defer generated audio until the core gameplay loop is stable enough to judge timing, repetition, mix, and player feedback value.

## Current posture

Audio generation is deferred. Do not add a permanent music/SFX system before the movement, camera, environment, and first gameplay loop are worth scoring.

## Future acceptance checks

When activated, each audio candidate must record:

- Source/provenance and license status.
- Intended use: UI, ambience, movement, impact, creature, music, warning, reward.
- Format and file size.
- Loop behavior, if looping.
- Loudness and clipping check.
- Browser autoplay handling.
- User mute/volume path.
- Mobile playback check.
- Repetition/fatigue review.

## Initial runtime rule

No audio may block game start. The game must remain playable muted and offline.

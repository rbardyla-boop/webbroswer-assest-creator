# Starvale Frontier — Hand-Drawn Browser MMO Slice

A clean-room browser MMO prototype inspired by the architectural shape of World of Claudecraft, but re-skinned toward a hand-drawn 3D/RTS-MMO feel. It is deliberately small enough to understand and run locally.

## What is included

- Offline browser play: click **Play Offline** and the same rule module runs locally with localStorage persistence.
- Online realm: dependency-free Node HTTP/WebSocket server with account registration, scrypt-hashed passwords, bearer tokens, persistent JSON character storage, and an authoritative world loop.
- Nine classes: Warrior, Paladin, Hunter, Rogue, Priest, Shaman, Mage, Warlock, Druid.
- Three connected zones: Eastbrook Vale, Mirefen Marsh, Thornpeak Heights.
- Enemies: wolves, boars, kobolds, bandits, undead, elite crypt skeletons, and Morthen the Gravecaller.
- Systems: XP/levels, HP/mana, class spells, cooldowns, bags, equipment, vendors, coin, quest log, map, chat with Enter, party invite/accept, trade, duel, kill credit, loot rights, quest credit, and private Hollow Crypt party instances.
- Rendering: Canvas hand-drawn 2.5D/orthographic style with sketch outlines, painted terrain, town props, roads, mobs, players, and readable MMO UI.

This is a playable vertical slice, not a production-scale MMO. The code is intentionally dependency-free so the multiplayer stack is easy to inspect and host.

## Run locally

```bash
npm start
# open http://localhost:8787
```

No install step is required because there are no runtime dependencies.

## VPS hosting

```bash
git clone <your repo> starvale-handdrawn-mmo
cd starvale-handdrawn-mmo
PORT=8787 npm start
```

Put Caddy or nginx in front of port 8787 for HTTPS. The browser automatically uses `wss://` when served over HTTPS.

Example Caddyfile:

```caddyfile
your.domain.com {
  reverse_proxy localhost:8787
}
```

Persistent accounts and characters live in `data/world.json`. Back that file up if people are playing on your realm.

## Controls

- `WASD` / arrows: move
- Click: target mob, player, NPC, vendor, or dungeon gate
- Right-click or `F`: interact, loot, talk, enter gate
- `1`-`4`: action bar
- `B`: bags
- `L`: quest log
- `M`: map
- `Enter`: chat
- Slash commands: `/p message`, `/invite Name`, `/duel Name`, `/trade Name`, `/complete q_wolves`

## Design notes

The game uses one shared rules module at `shared/rules.mjs`. Offline mode creates a local world and calls the same `tick()` and `command()` functions as the server. Online mode sends input and commands over WebSocket; the server owns the world, applies combat/loot/quest/vendor rules, and streams snapshots back to clients.

For a later Three.js upgrade, the existing grass-world foundation from the prior prototype can be reused: it already has Vite + Three.js scripts, deterministic terrain sampling, instanced grass, a grounded player controller, and first/third-person camera modules. This prototype keeps the gameplay rules independent so they can be rendered by Canvas now or Three.js later.

## Smoke test

```bash
npm run smoke
```

The smoke test creates a Mage, accepts the wolf quest, moves, kills a wolf through the shared sim, and validates that the snapshot contains the player.

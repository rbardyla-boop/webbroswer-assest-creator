// Slice Authoring Kit-1 — shared browser-proof helpers for slice completion runs.
//
// The three existing slice proofs (visual-benchmark, content-5, slice-1) share byte-identical in-page eval
// exprs — SEED / OPENING / SIGN / capture / STAGED / RECOVER / STRIKE / COMPLETE / REPLAY — parameterized only
// by scene ids + the expected identity title. This module factors them into descriptor-driven expr builders +
// a driver, so ONE helper drives ANY slice (3-beat + GLB OR 2-beat, no GLB) to completion. The existing proofs
// are left untouched (non-invasive); the kit proof + future Slice-2 use this. Wraps scripts/lib/browser.mjs.

/**
 * @typedef {Object} SliceDescriptor
 * @property {string} label
 * @property {string} buildModulePath  in-browser import path of the sample builder, e.g. '/src/world/samples/iceChapelV1.js'
 * @property {string} buildFnName      e.g. 'buildIceChapelV1'
 * @property {string} identityTitle    the slice's own completion identity, e.g. 'The Ice Chapel'
 * @property {string} arrivalTagline   the arrival-banner tagline
 * @property {string} signId           the orientation-sign object id
 * @property {Array<{id:string,kind:string}>} beats  combat-beat ids (order matters: beats[0] is the recover target)
 * @property {string} rewardId         the optional shrine-reward runtimeAssets id
 * @property {{assetId:string,fixtureImport:string,fixtureFn:string}|null} [glb]  optional GLB to register before seeding
 */

export function sliceDescriptor(d) {
  return { glb: null, ...d };
}

// --- editor seed (optionally registers a GLB fixture under the slice's asset id) -------------------
export const seedSliceExpr = (d) => `(async () => {
  const e = window.__WORLD_EDITOR__;
  if (!e) return { missing: true };
  const { ${d.buildFnName} } = await import('${d.buildModulePath}');
  const { WorldSerializer } = await import('/src/world/WorldSerializer.js');
${d.glb ? `  const { ${d.glb.fixtureFn} } = await import('${d.glb.fixtureImport}');
  const glb = await ${d.glb.fixtureFn}();
  const file = new File([new Blob([glb])], 'seed.glb', { type: 'model/gltf-binary' });
  try { await e._importGLTF(file); } catch (err) {}
  const imported = e.selectedAsset;
  const blob = imported && imported.type === 'gltf' ? await e.assetLibrary.store.getBlob(imported.id) : null;
  if (blob) {
    if (e.assetLibrary.get('${d.glb.assetId}')) await e.assetLibrary.delete('${d.glb.assetId}');
    await e.assetLibrary.storeAsset({ ...imported, id: '${d.glb.assetId}', name: 'Seed Asset' }, blob);
  }
` : ''}  new WorldSerializer().save(${d.buildFnName}());
  return { saved: true${d.glb ? `, fixedPresent: !!e.assetLibrary.get('${d.glb.assetId}')` : ""} };
})()`;

// --- the live slice wrapper resolved THIS scene's completion identity ------------------------------
export const openingExpr = () => `(() => {
  const fc = window.__FROZEN_CACHE_DEBUG__();
  return { present: fc.present, identity: fc.identity, completed: fc.completed };
})()`;

// --- the orientation sign loads + surfaces its framing on approach ---------------------------------
export const signExpr = (d) => `(async () => {
  const { ${d.buildFnName} } = await import('${d.buildModulePath}');
  const sign = ${d.buildFnName}().objects.find((o) => o.id === '${d.signId}');
  const p = sign.transform.position;
  const before = window.__INTERACTION_RUNTIME__.debugSnapshot().counts.signs;
  window.__COMBAT_DO__.teleportTo(p.x, p.z);
  window.__INTERACTION_RUNTIME__.update(0);
  return { signs: before, message: window.__INTERACTION_RUNTIME__.debugSnapshot().message };
})()`;

export const captureExpr = `(() => ({ perf: window.__PERF__.snapshot(), budget: window.__BUDGET__ ? window.__BUDGET__() : null }))()`;

// --- staged: every beat present + a combat target; the reward instantiated -------------------------
export const stagedExpr = (d) => `(() => {
  const enc = window.__ENCOUNTER__().encounters;
  const by = (id) => enc.find((e) => e.id === id);
  const beats = ${JSON.stringify(d.beats.map((b) => b.id))};
  const targetIds = window.__COMBAT__().targets.map((t) => t.id);
  const live = window.__ENEMY_LIVE__();
  const reward = window.__ARSENAL_WORLD__();
  const found = beats.map((id) => { const b = by(id); return { id, enemyId: b ? b.enemyId : null, type: b ? b.enemyType : null, label: b ? b.label : null }; });
  return {
    count: enc.length,
    beats: found,
    allTargeted: found.every((b) => targetIds.includes(b.enemyId)),
    liveKinds: live.map((l) => l.kind),
    rewardPresent: reward ? reward.ids.includes('${d.rewardId}') : false,
  };
})()`;

// --- recover: cross into beats[0]'s danger window → fires once + the shove is recoverable ----------
export const recoverExpr = (d) => `(() => {
  const enc = () => window.__ENCOUNTER__().encounters;
  const by = (id) => enc().find((e) => e.id === id);
  const aId = by('${d.beats[0].id}').enemyId, bId = by('${d.beats[1].id}').enemyId;
  const D = window.__COMBAT_DO__, T = window.__THREAT_DO__;
  const here = () => window.__ENEMY_PROXIMITY__().find((p) => p.id === aId);
  const there = () => window.__ENEMY_PROXIMITY__().find((p) => p.id === bId);
  const far = there() || here();
  for (let k = 0; k < 220; k++) { D.teleportTo(far.position[0], far.position[2] + 300); T.step(1 / 60); }
  const e0 = window.__THREAT__().events;
  const me = here(); const ot = there();
  let ax = me.position[0] - (ot ? ot.position[0] : me.position[0] - 1);
  let az = me.position[2] - (ot ? ot.position[2] : me.position[2]);
  const al = Math.hypot(ax, az) || 1; ax /= al; az /= al;
  D.teleportTo(me.position[0] + ax * 1.4, me.position[2] + az * 1.4);
  T.step(1 / 60);
  const snap = window.__THREAT__();
  const pos = window.__PLAYER_POS__ ? window.__PLAYER_POS__() : null;
  return { fired: snap.events - e0, warning: snap.feedback && snap.feedback.lastWarning, posFinite: !!pos && Number.isFinite(pos[0]) && Number.isFinite(pos[2]) };
})()`;

// --- strike: ONE equipped weapon defeats EVERY beat (each aimed at its live position) --------------
export const strikeExpr = (d) => `(() => {
  const enc = () => window.__ENCOUNTER__().encounters;
  const by = (id) => enc().find((e) => e.id === id);
  const D = window.__COMBAT_DO__, E = window.__ENEMY_DO__, K = window.__ENCOUNTER_DO__, live = window.__ENEMY_LIVE__;
  const beats = ${JSON.stringify(d.beats)};
  const fc = by(beats[0].id).position;
  const wid = window.__ARSENAL_CARRY_DO__.place({ x: fc[0] + 3, z: fc[2] + 1 });
  window.__ARSENAL_CARRY_DO__.equip(wid, 'rightHand');
  const results = [];
  let allSameWeapon = true;
  for (const beat of beats) {
    const id = beat.id;
    const eid = by(id).enemyId;
    const yOff = beat.kind === 'hover' ? 0 : 1.0;
    // Movers (patrol/hover) are in __ENEMY_LIVE__; a STATIONARY sentinel is NOT, so fall back to the
    // encounter centre (its grounded position) — exactly as the content-3 proof aims a stationary sentinel.
    const fire = () => {
      D.teleportNearTarget(eid, 6); window.__SCENE_SYNC__();
      const m = live().find((l) => l.id === eid);
      const p = m ? m.position : by(id).position;
      D.aimAt(p[0], p[1] + yOff, p[2]); D.useActiveWeapon(); D.step(); E.step();
    };
    let hit = null, g = 0;
    while (by(id).enemyState !== 'defeated' && g < 64) { fire(); const ev = D.lastEvent(); if (ev && ev.hit && ev.hit.targetId === eid) hit = ev; g++; }
    K.step();
    if (hit && hit.weaponId !== wid) allSameWeapon = false;
    results.push({ id, defeated: by(id).enemyState === 'defeated', completed: by(id).completed, hitWeapon: hit ? hit.weaponId : null });
  }
  return { wid, allSameWeapon, results };
})()`;

// --- completion: equip the relic (a free slot — rightHand holds the strike weapon) → deposit -------
export const completeExpr = () => `(() => {
  const O = window.__OBJECTIVE_DO__, FC = window.__FROZEN_CACHE_DO__;
  O.equipRelic('back');
  O.teleportToCache();
  const before = window.__OBJECTIVE_DEBUG__().completed;
  const deposited = FC.deposit();
  window.__SLICE_SENSORY_DO__.step();
  const fc = window.__FROZEN_CACHE_DEBUG__();
  const card = document.querySelector('.completion-card');
  const h1 = card ? card.querySelector('h1') : null;
  const body = card ? card.querySelector('p') : null;
  return { before, deposited, completed: window.__OBJECTIVE_DEBUG__().completed, cardVisible: fc.completionCardVisible, cardTitle: h1 ? h1.textContent : null, cardBody: body ? body.textContent : null, trophyPresent: fc.trophyPresent, completeCues: window.__SLICE_SENSORY__().cues.complete };
})()`;

// --- replay: reload → completion + identity + trophy + every beat cleared + reward persist ---------
export const replayExpr = (d) => `(() => {
  const fc = window.__FROZEN_CACHE_DEBUG__();
  const enc = window.__ENCOUNTER__().encounters;
  const by = (id) => enc.find((e) => e.id === id);
  const beats = ${JSON.stringify(d.beats.map((b) => b.id))};
  const card = document.querySelector('.completion-card');
  const h1 = card ? card.querySelector('h1') : null;
  window.__THREAT_DO__.step();
  return {
    objectiveCompleted: window.__OBJECTIVE_DEBUG__().completed,
    identityTitle: fc.identity.title,
    trophyPresent: fc.trophyPresent,
    cardTitle: h1 ? h1.textContent : null,
    beatsCleared: beats.map((id) => ({ id, completed: by(id).completed, enemyId: by(id).enemyId })),
    liveCount: window.__ENEMY_LIVE__().length,
    rewardPresent: window.__ARSENAL_WORLD__().ids.includes('${d.rewardId}'),
    threatEvents: window.__THREAT__().events,
  };
})()`;

/** Drive the in-page play sequence for a slice descriptor; returns the collected data. */
export async function driveSlicePlay(cdp, evalValue, d) {
  const opening = await evalValue(cdp, openingExpr());
  const sign = await evalValue(cdp, signExpr(d));
  const capture = await evalValue(cdp, captureExpr);
  const staged = await evalValue(cdp, stagedExpr(d));
  const recover = d.beats.length >= 2 ? await evalValue(cdp, recoverExpr(d)) : null;
  const strike = await evalValue(cdp, strikeExpr(d));
  const complete = await evalValue(cdp, completeExpr());
  return { opening, sign, capture, staged, recover, strike, complete };
}

/** Drive the in-page reload check for a slice descriptor. */
export async function driveSliceReplay(cdp, evalValue, d) {
  return await evalValue(cdp, replayExpr(d));
}

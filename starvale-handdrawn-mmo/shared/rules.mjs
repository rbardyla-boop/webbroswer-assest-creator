export const TICK_HZ = 20;
export const DT = 1 / TICK_HZ;
export const WORLD_SEED = 730421;
export const MAX_PARTY = 5;

export const CLASSES = {
  Warrior: { role: 'tank', hp: 145, mp: 0, armor: 14, power: 15, color: '#b45b36', spells: ['strike','rend','guard'] },
  Paladin: { role: 'hybrid', hp: 135, mp: 85, armor: 16, power: 12, color: '#d6b55d', spells: ['strike','holyLight','judgement'] },
  Hunter: { role: 'ranged', hp: 118, mp: 70, armor: 10, power: 14, color: '#7da060', spells: ['shoot','serpentShot','snare'] },
  Rogue: { role: 'melee', hp: 112, mp: 100, armor: 8, power: 17, color: '#9c8b55', spells: ['stab','eviscerate','dash'] },
  Priest: { role: 'healer', hp: 96, mp: 125, armor: 5, power: 12, color: '#d8d2bf', spells: ['smite','heal','shield'] },
  Shaman: { role: 'hybrid', hp: 118, mp: 105, armor: 9, power: 13, color: '#4b8cc2', spells: ['bolt','heal','shock'] },
  Mage: { role: 'caster', hp: 88, mp: 145, armor: 4, power: 18, color: '#65b8d8', spells: ['fireball','frostbolt','nova'] },
  Warlock: { role: 'caster', hp: 104, mp: 130, armor: 5, power: 16, color: '#8059b8', spells: ['shadowbolt','corruption','drain'] },
  Druid: { role: 'hybrid', hp: 116, mp: 115, armor: 8, power: 13, color: '#d18439', spells: ['wrath','rejuvenate','roots'] }
};

export const SPELLS = {
  attack: { name:'Attack', range: 18, cd: 1.2, cost: 0, kind:'damage', scale:1.0, text:'Weapon swing' },
  strike: { name:'Heroic Strike', range: 18, cd: 3.5, cost: 0, kind:'damage', scale:1.55, text:'Heavy melee hit' },
  rend: { name:'Rend', range: 18, cd: 5, cost: 0, kind:'dot', scale:0.55, text:'Bleed over time' },
  guard: { name:'Guard', range:0, cd: 12, cost:0, kind:'buff', buff:'guard', text:'Reduce damage briefly' },
  holyLight: { name:'Holy Light', range:70, cd: 4, cost:25, kind:'heal', scale:2.0, text:'Large heal' },
  judgement: { name:'Judgement', range:48, cd: 5, cost:18, kind:'damage', scale:1.45, text:'Holy strike' },
  shoot: { name:'Auto Shot', range:90, cd: 2.0, cost:0, kind:'damage', scale:1.1, text:'Ranged shot' },
  serpentShot: { name:'Serpent Shot', range:80, cd: 7, cost:16, kind:'dot', scale:0.7, text:'Poison shot' },
  snare: { name:'Snare Shot', range:80, cd:8, cost:14, kind:'cc', buff:'snared', text:'Slow target' },
  stab: { name:'Sinister Stab', range:17, cd:2.2, cost:20, kind:'damage', scale:1.5, text:'Fast melee strike' },
  eviscerate: { name:'Eviscerate', range:17, cd:8, cost:35, kind:'damage', scale:2.4, text:'Finisher burst' },
  dash: { name:'Sprint', range:0, cd:16, cost:20, kind:'buff', buff:'dash', text:'Move faster' },
  smite: { name:'Smite', range:72, cd:2.3, cost:18, kind:'damage', scale:1.25, text:'Holy bolt' },
  heal: { name:'Heal', range:70, cd:3.2, cost:22, kind:'heal', scale:1.65, text:'Restore health' },
  shield: { name:'Shield', range:70, cd:10, cost:24, kind:'buff', buff:'shield', text:'Absorb damage' },
  bolt: { name:'Lightning Bolt', range:78, cd:2.4, cost:17, kind:'damage', scale:1.35, text:'Lightning damage' },
  shock: { name:'Earth Shock', range:50, cd:6, cost:20, kind:'damage', scale:1.6, text:'Instant shock' },
  fireball: { name:'Fireball', range:84, cd:2.7, cost:22, kind:'damage', scale:1.65, text:'Big fire hit' },
  frostbolt: { name:'Frostbolt', range:80, cd:3.0, cost:20, kind:'damage', scale:1.25, buff:'snared', text:'Damage + slow' },
  nova: { name:'Frost Nova', range:28, cd:14, cost:28, kind:'aoeRoot', text:'Root nearby enemies' },
  shadowbolt: { name:'Shadow Bolt', range:82, cd:2.6, cost:20, kind:'damage', scale:1.5, text:'Shadow damage' },
  corruption: { name:'Corruption', range:78, cd:6, cost:22, kind:'dot', scale:0.85, text:'Shadow DoT' },
  drain: { name:'Drain Life', range:64, cd:8, cost:24, kind:'drain', scale:1.15, text:'Damage and heal self' },
  wrath: { name:'Wrath', range:76, cd:2.3, cost:18, kind:'damage', scale:1.25, text:'Nature damage' },
  rejuvenate: { name:'Rejuvenate', range:70, cd:7, cost:24, kind:'hot', scale:1.2, text:'Heal over time' },
  roots: { name:'Roots', range:64, cd:12, cost:24, kind:'cc', buff:'rooted', text:'Root target' }
};

export const ITEMS = {
  rusty_sword: { name:'Rusty Sword', slot:'weapon', price:18, power:3, level:1 },
  vale_staff: { name:'Vale Staff', slot:'weapon', price:22, power:4, mp:8, level:1 },
  scout_bow: { name:'Scout Bow', slot:'weapon', price:25, power:5, level:2 },
  patched_vest: { name:'Patched Vest', slot:'chest', price:16, armor:3, level:1 },
  copper_mail: { name:'Copper Mail', slot:'chest', price:55, armor:8, level:4 },
  field_rations: { name:'Field Rations', type:'food', price:4, heal:65, stack:20 },
  spring_water: { name:'Spring Water', type:'drink', price:4, mana:65, stack:20 },
  gravecaller_sigil: { name:'Gravecaller Sigil', type:'quest', quest:true },
  crypt_key: { name:'Hollow Crypt Key', type:'quest', quest:true },
  blue_graveblade: { name:'Blue Graveblade', slot:'weapon', power:14, armor:2, level:8, rare:true }
};

export const NPCS = [
  { id:'mayor', name:'Mayor Brindle', x:0, y:-8, kind:'quest', quests:['q_wolves','q_boars'] },
  { id:'aldric', name:'Brother Aldric', x:18, y:-18, kind:'quest', quests:['q_undead','q_sigil','q_crypt'] },
  { id:'smith', name:'Smith Haldren', x:-24, y:4, kind:'vendor', vendor:['rusty_sword','scout_bow','patched_vest','copper_mail'] },
  { id:'mira', name:'Mira the Provisioner', x:12, y:16, kind:'vendor', vendor:['field_rations','spring_water','vale_staff'] },
  { id:'fenbridge', name:'Fenbridge Scout', x:160, y:-120, kind:'quest', quests:['q_kobolds','q_bandits'] },
  { id:'cryptdoor', name:'Hollow Crypt Gate', x:245, y:-82, kind:'dungeon', dungeon:'hollow_crypt' }
];

export const QUESTS = {
  q_wolves: { name:'Wolves at the North Road', giver:'mayor', level:1, text:'Cull wolves beyond Eastbrook Vale.', objectives:[{type:'kill', target:'wolf', count:5}], rewards:{xp:180, coin:18, item:'patched_vest'}, next:'q_boars' },
  q_boars: { name:'Boar Meat for the Vale', giver:'mayor', level:2, text:'Bring down boars east of town.', objectives:[{type:'kill', target:'boar', count:4}], rewards:{xp:220, coin:24, item:'field_rations'} },
  q_kobolds: { name:'Copper Teeth', giver:'fenbridge', level:4, text:'Drive kobolds out of the copper dig.', objectives:[{type:'kill', target:'kobold', count:6}], rewards:{xp:380, coin:45, item:'rusty_sword'}, next:'q_bandits' },
  q_bandits: { name:'Gorrak\'s Red Sash', giver:'fenbridge', level:5, text:'Break the bandit camp southeast of the vale.', objectives:[{type:'kill', target:'bandit', count:6}], rewards:{xp:460, coin:62, item:'scout_bow'} },
  q_undead: { name:'The Restless Dead', giver:'aldric', level:3, text:'Restless dead gather near the ruined chapel.', objectives:[{type:'kill', target:'undead', count:8}], rewards:{xp:420, coin:40, item:'vale_staff'}, next:'q_sigil' },
  q_sigil: { name:'Whispers Below', giver:'aldric', level:6, text:'Find the Gravecaller sigil among the undead.', objectives:[{type:'collect', target:'gravecaller_sigil', count:1}], rewards:{xp:520, coin:80, item:'crypt_key'}, next:'q_crypt' },
  q_crypt: { name:'Into the Hollow', giver:'aldric', level:8, text:'Enter the Hollow Crypt and defeat Morthen the Gravecaller.', objectives:[{type:'kill', target:'gravecaller', count:1}], rewards:{xp:1500, coin:100, item:'blue_graveblade'} }
};

export const ZONES = [
  { id:'eastbrook', name:'Eastbrook Vale', min:1, max:7, x:-80, y:-80, w:280, h:220, desc:'market town, meadows, copper dig, ruined chapel' },
  { id:'mirefen', name:'Mirefen Marsh', min:6, max:13, x:130, y:-210, w:240, h:180, desc:'wet roads, kobold sinkholes, bandit bridges' },
  { id:'thornpeak', name:'Thornpeak Heights', min:13, max:20, x:320, y:-260, w:260, h:220, desc:'snowline, old watch, Gravewyrm route' }
];

export const MOB_TEMPLATES = {
  wolf: { name:'Vale Wolf', level:1, hp:55, dmg:7, xp:45, color:'#7b6f61', radius:11, loot:['field_rations'] },
  boar: { name:'Bristle Boar', level:2, hp:72, dmg:8, xp:55, color:'#8c5f47', radius:12, loot:['field_rations'] },
  kobold: { name:'Copper Kobold', level:4, hp:100, dmg:12, xp:80, color:'#b48a4c', radius:10, loot:['rusty_sword'] },
  bandit: { name:'Vale Bandit', level:5, hp:122, dmg:14, xp:96, color:'#984c43', radius:12, loot:['patched_vest','spring_water'] },
  undead: { name:'Restless Dead', level:6, hp:136, dmg:16, xp:110, color:'#b8c1b1', radius:12, loot:['gravecaller_sigil'] },
  crypt_skeleton: { name:'Crypt Boneguard', level:8, hp:235, dmg:25, xp:180, elite:true, color:'#d6d2c2', radius:13, loot:['spring_water'] },
  gravecaller: { name:'Morthen the Gravecaller', level:10, hp:780, dmg:38, xp:650, elite:true, boss:true, color:'#703a89', radius:22, loot:['blue_graveblade'] }
};

const SPAWNS = [
  { type:'wolf', x:-70, y:-120, n:8, r:50 }, { type:'boar', x:86, y:40, n:8, r:55 },
  { type:'kobold', x:-130, y:88, n:10, r:50 }, { type:'bandit', x:140, y:90, n:8, r:48 },
  { type:'undead', x:235, y:-74, n:11, r:60 }, { type:'kobold', x:205, y:-170, n:7, r:45 },
  { type:'bandit', x:285, y:-130, n:8, r:48 }
];

export function createCharacter(name, className='Warrior') {
  const c = CLASSES[className] || CLASSES.Warrior;
  return {
    id: uid('char'), name: cleanName(name) || 'Adventurer', className, level:1, xp:0, coin:35,
    x:0, y:0, zone:'eastbrook', instance:null, hp:c.hp, mp:c.mp, maxHp:c.hp, maxMp:c.mp,
    armor:c.armor, power:c.power, color:c.color, speed:58, facing:0,
    targetId:null, combatTargetId:null, cooldowns:{}, buffs:[], dots:[], quests:{}, completed:{},
    bag:['field_rations','spring_water'], equipment:{ weapon:null, chest:null }, partyId:null, duelId:null,
    createdAt: Date.now(), updatedAt: Date.now()
  };
}

export function createWorld({ mode='offline', seed=WORLD_SEED }={}) {
  const world = { mode, seed, time:0, players:{}, mobs:{}, corpses:{}, parties:{}, duels:{}, trades:{}, chats:[], events:[], nextMob:1, instances:{}, lootSeq:1 };
  spawnWorldMobs(world);
  return world;
}

export function addPlayer(world, charData, id=charData.id || uid('p')) {
  const p = normalizePlayer({ ...createCharacter(charData.name, charData.className), ...charData, id });
  p.online = true; p.input = { up:false, down:false, left:false, right:false };
  world.players[id] = p;
  emit(world, { kind:'system', text:`${p.name} entered ${zoneAt(p.x,p.y).name}.` });
  return p;
}

export function removePlayer(world, playerId) {
  const p = world.players[playerId];
  if (!p) return null;
  p.updatedAt = Date.now();
  leaveParty(world, playerId);
  delete world.players[playerId];
  emit(world, { kind:'system', text:`${p.name} left the realm.` });
  return p;
}

export function tick(world, dt=DT) {
  world.time += dt;
  world.events.length = 0;
  for (const p of Object.values(world.players)) tickPlayer(world, p, dt);
  for (const m of Object.values(world.mobs)) tickMob(world, m, dt);
  tickDots(world, dt);
  tickRespawns(world);
  tickDuels(world);
  for (const p of Object.values(world.players)) regen(p, dt);
}

function tickPlayer(world, p, dt) {
  if (p.dead) return;
  let speed = p.speed * buffMul(p, 'dash', 1.7) * buffMul(p, 'snared', 0.45) * (hasBuff(p,'rooted') ? 0 : 1);
  const dx = (p.input.right?1:0) - (p.input.left?1:0);
  const dy = (p.input.down?1:0) - (p.input.up?1:0);
  const len = Math.hypot(dx,dy) || 1;
  if (dx || dy) {
    p.x += (dx/len) * speed * dt;
    p.y += (dy/len) * speed * dt;
    p.facing = Math.atan2(dy, dx);
  }
  p.x = clamp(p.x, -210, 560); p.y = clamp(p.y, -320, 190); p.zone = zoneAt(p.x,p.y).id;
  const target = getTarget(world, p.targetId, p.instance);
  if (target && !target.dead && dist(p,target) < 19) p.combatTargetId = target.id;
  if (p.combatTargetId) autoAttack(world,p,p.combatTargetId,dt);
  p.buffs = p.buffs.filter(b => (b.t -= dt) > 0);
}

function tickMob(world, m, dt) {
  if (m.dead) return;
  m.cd = Math.max(0, (m.cd||0)-dt);
  m.buffs = (m.buffs||[]).filter(b => (b.t -= dt) > 0);
  if (hasBuff(m,'rooted')) return;
  let target = m.targetId && world.players[m.targetId];
  if (!target || target.dead || target.instance !== m.instance || dist(m,target) > 105) {
    target = nearestPlayer(world, m, m.aggro || (m.elite?64:48));
    m.targetId = target?.id || null;
  }
  if (target) {
    const d = dist(m,target); const sp = (m.elite?38:45) * buffMul(m,'snared',0.45);
    if (d > 18) moveToward(m,target,sp*dt); else mobHit(world,m,target);
    if (dist(m,m.home) > (m.leash||120)) resetMob(m);
  } else if (dist(m,m.home) > 3) moveToward(m,m.home,18*dt);
}

function tickDots(world, dt) {
  const units = [...Object.values(world.players), ...Object.values(world.mobs)];
  for (const u of units) {
    u.dots = (u.dots||[]).filter(d => {
      d.t -= dt; d.tick -= dt;
      if (d.tick <= 0) { d.tick += 1; damage(world, d.ownerId, u, d.damage, d.kind || 'dot'); }
      return d.t > 0 && !u.dead;
    });
  }
}

function tickRespawns(world) {
  for (const m of Object.values(world.mobs)) if (m.dead && world.time >= m.respawnAt) resetMob(m);
  for (const [id, inst] of Object.entries(world.instances)) {
    if (inst.emptySince && world.time - inst.emptySince > 300) { delete world.instances[id]; for (const [mid,m] of Object.entries(world.mobs)) if (m.instance===id) delete world.mobs[mid]; }
  }
}

function tickDuels(world) {
  for (const [id,d] of Object.entries(world.duels)) {
    const a=world.players[d.a], b=world.players[d.b]; if(!a||!b){delete world.duels[id];continue;}
    if (dist(a,b)>95 || a.hp<=1 || b.hp<=1) {
      const winner = a.hp>b.hp ? a : b;
      a.hp=Math.max(a.hp,1); b.hp=Math.max(b.hp,1); a.duelId=null; b.duelId=null;
      emit(world,{kind:'system', text:`${winner.name} wins the duel.`}); delete world.duels[id];
    }
  }
}

function autoAttack(world, p, targetId, dt) {
  p.swing = Math.max(0,(p.swing||0)-dt);
  const t = getTarget(world,targetId,p.instance); if(!t || t.dead || dist(p,t)>22) return;
  if (p.swing<=0) { p.swing = 1.8; damage(world,p.id,t, rollPower(p,1), 'swing'); }
}

function mobHit(world,m,p) {
  if ((m.cd||0)>0) return; m.cd = m.elite ? 1.65 : 2.1;
  damage(world,m.id,p, Math.max(1, m.dmg + randRange(m.id+world.time,-3,3) - armorDR(p.armor)), 'claw');
}

export function command(world, playerId, msg) {
  const p = world.players[playerId]; if (!p) return { ok:false, error:'no player' };
  const { type, data={} } = msg || {};
  if (type === 'input') { p.input = { ...p.input, ...data }; return {ok:true}; }
  if (type === 'target') { p.targetId = data.id; return {ok:true}; }
  if (type === 'cast') return cast(world,p,data.spell || 'attack',data.targetId || p.targetId);
  if (type === 'interact') return interact(world,p,data.id || p.targetId);
  if (type === 'acceptQuest') return acceptQuest(world,p,data.questId);
  if (type === 'buy') return buy(world,p,data.npcId,data.itemId);
  if (type === 'useItem') return useItem(world,p,data.slot ?? 0);
  if (type === 'equip') return equipItem(world,p,data.slot ?? 0);
  if (type === 'chat') return chat(world,p,data.text || '');
  if (type === 'invite') return inviteParty(world,p,data.name);
  if (type === 'acceptParty') return acceptParty(world,p,data.fromId);
  if (type === 'leaveParty') { leaveParty(world,p.id); return {ok:true}; }
  if (type === 'duel') return requestDuel(world,p,data.name);
  if (type === 'acceptDuel') return acceptDuel(world,p,data.fromId);
  if (type === 'trade') return requestTrade(world,p,data.name);
  if (type === 'acceptTrade') return acceptTrade(world,p,data.fromId);
  if (type === 'enterDungeon') return enterDungeon(world,p,data.dungeon || 'hollow_crypt');
  return { ok:false, error:'unknown command' };
}

export function cast(world,p,spellId,targetId) {
  const spell = SPELLS[spellId] || SPELLS.attack; if (cooling(p,spellId)) return fail('cooldown');
  const cls = CLASSES[p.className] || CLASSES.Warrior;
  if (![...cls.spells,'attack'].includes(spellId)) return fail('not learned');
  if ((p.mp||0) < spell.cost) return fail('not enough mana');
  let t = targetId ? getTarget(world,targetId,p.instance) : null;
  const selfSpells = ['guard','dash'];
  if (!t && (spell.kind==='heal'||spell.kind==='buff'||spell.kind==='hot'||selfSpells.includes(spellId))) t = p;
  if (!t || t.dead) return fail('no target');
  if (spell.range && dist(p,t)>spell.range) return fail('out of range');
  p.mp -= spell.cost; p.cooldowns[spellId] = spell.cd;
  setTimeoutCooldownHack(p, spellId, spell.cd);
  if (spell.kind==='damage') damage(world,p.id,t,rollPower(p,spell.scale),spellId);
  else if (spell.kind==='heal') heal(world,p,t,rollPower(p,spell.scale));
  else if (spell.kind==='dot') addDot(t,p.id,spellId,rollPower(p,spell.scale)/4,8);
  else if (spell.kind==='drain') { const amount=damage(world,p.id,t,rollPower(p,spell.scale),spellId); heal(world,p,p,Math.round(amount*0.65)); }
  else if (spell.kind==='hot') addDot(t,p.id,'hot',-Math.round(rollPower(p,spell.scale)/5),8);
  else if (spell.kind==='buff') addBuff(t, spell.buff, spellId==='shield'?12:8, spellId==='shield'?{absorb:rollPower(p,1.4)}:{});
  else if (spell.kind==='cc') addBuff(t, spell.buff, 5);
  else if (spell.kind==='aoeRoot') for (const m of Object.values(world.mobs)) if(!m.dead && m.instance===p.instance && dist(p,m)<spell.range) addBuff(m,'rooted',4);
  if (spell.buff && spell.kind==='damage') addBuff(t, spell.buff, 5);
  emit(world,{kind:'combat', text:`${p.name} casts ${spell.name}.`});
  return {ok:true};
}

function setTimeoutCooldownHack(p, id, cd) { p.cooldowns[id] = cd; }
function cooling(p, id) { return (p.cooldowns[id]||0)>0; }

export function cooldownTick(world, dt=DT) { for(const p of Object.values(world.players)) for(const k of Object.keys(p.cooldowns)) p.cooldowns[k]=Math.max(0,p.cooldowns[k]-dt); }

export function interact(world,p,id) {
  const npc = NPCS.find(n=>n.id===id || dist(p,n)<22); if (npc) return {ok:true,npc};
  const mob = world.mobs[id]; if (mob && mob.dead && mob.lootOwner && canLoot(world,p,mob)) return lootMob(world,p,mob);
  if (npc?.kind==='dungeon') return enterDungeon(world,p,npc.dungeon);
  return {ok:false,error:'nothing to interact'};
}

function acceptQuest(world,p,qid) {
  const q=QUESTS[qid]; if(!q) return fail('bad quest'); if(p.completed[qid]) return fail('already complete');
  if(!p.quests[qid]) p.quests[qid]={status:'active', progress:q.objectives.map(()=>0)};
  emit(world,{kind:'quest', to:p.id, text:`Accepted: ${q.name}`}); return {ok:true};
}

function completeQuest(world,p,qid) {
  const q=QUESTS[qid]; const log=p.quests[qid]; if(!q || !log || log.status!=='ready') return fail('not ready');
  delete p.quests[qid]; p.completed[qid]=true; addXP(world,p,q.rewards.xp); p.coin += q.rewards.coin||0; if(q.rewards.item) addItem(p,q.rewards.item);
  if (q.next) acceptQuest(world,p,q.next);
  emit(world,{kind:'quest', to:p.id, text:`Completed: ${q.name}`}); return {ok:true};
}

function buy(world,p,npcId,itemId) { const npc=NPCS.find(n=>n.id===npcId); const it=ITEMS[itemId]; if(!npc||!it||!npc.vendor?.includes(itemId)) return fail('not sold'); if(dist(p,npc)>28) return fail('too far'); if(p.coin<it.price) return fail('not enough coin'); p.coin-=it.price; addItem(p,itemId); return {ok:true}; }
function useItem(world,p,slot) { const itemId=p.bag[slot]; const it=ITEMS[itemId]; if(!it) return fail('empty'); if(it.heal) p.hp=Math.min(p.maxHp,p.hp+it.heal); if(it.mana) p.mp=Math.min(p.maxMp,p.mp+it.mana); p.bag.splice(slot,1); return {ok:true}; }
function equipItem(world,p,slot) { const itemId=p.bag[slot]; const it=ITEMS[itemId]; if(!it?.slot) return fail('not equipable'); const old=p.equipment[it.slot]; p.equipment[it.slot]=itemId; p.bag.splice(slot,1); if(old) p.bag.push(old); recalc(p); return {ok:true}; }

function chat(world,p,text) { text=String(text).slice(0,180).trim(); if(!text) return {ok:true}; if(text.startsWith('/')) return slash(world,p,text); const c={kind:'chat', from:p.name, party:false, text, time:Date.now()}; world.chats.push(c); emit(world,c); return {ok:true}; }
function slash(world,p,text) { const [cmd,...rest]=text.slice(1).split(' '); const arg=rest.join(' '); if(cmd==='p'){ const c={kind:'chat', from:p.name, party:true, partyId:p.partyId, text:arg, time:Date.now()}; world.chats.push(c); emit(world,c); return {ok:true}; } if(cmd==='invite') return inviteParty(world,p,arg); if(cmd==='duel') return requestDuel(world,p,arg); if(cmd==='trade') return requestTrade(world,p,arg); if(cmd==='complete') return completeQuest(world,p,arg); return fail('unknown slash command'); }

function inviteParty(world,p,name) { const t=findPlayerByName(world,name); if(!t) return fail('player not found'); if(p.partyId && world.parties[p.partyId]?.members.length>=MAX_PARTY) return fail('party full'); emit(world,{kind:'partyInvite', to:t.id, from:p.id, fromName:p.name}); return {ok:true}; }
function acceptParty(world,p,fromId) { const leader=world.players[fromId]; if(!leader) return fail('leader gone'); let party=leader.partyId && world.parties[leader.partyId]; if(!party) { party={id:uid('party'), leader:leader.id, members:[leader.id]}; world.parties[party.id]=party; leader.partyId=party.id; } if(party.members.length>=MAX_PARTY) return fail('party full'); if(!party.members.includes(p.id)) party.members.push(p.id); p.partyId=party.id; emit(world,{kind:'system', text:`${p.name} joins ${leader.name}'s party.`}); return {ok:true}; }
function leaveParty(world,id) { const p=world.players[id]; if(!p?.partyId) return; const party=world.parties[p.partyId]; if(!party) {p.partyId=null;return;} party.members=party.members.filter(x=>x!==id); p.partyId=null; if(party.members.length<=1){ for(const m of party.members) if(world.players[m]) world.players[m].partyId=null; delete world.parties[party.id]; } else if(party.leader===id) party.leader=party.members[0]; }

function requestDuel(world,p,name) { const t=findPlayerByName(world,name); if(!t||dist(p,t)>80) return fail('duel target not found/too far'); emit(world,{kind:'duelInvite', to:t.id, from:p.id, fromName:p.name}); return {ok:true}; }
function acceptDuel(world,p,fromId) { const a=world.players[fromId]; if(!a) return fail('gone'); const id=uid('duel'); world.duels[id]={id,a:a.id,b:p.id,start:world.time+3}; a.duelId=id; p.duelId=id; a.hp=a.maxHp; p.hp=p.maxHp; emit(world,{kind:'system', text:`Duel begins: ${a.name} vs ${p.name}.`}); return {ok:true}; }
function requestTrade(world,p,name) { const t=findPlayerByName(world,name); if(!t||dist(p,t)>35) return fail('trade target not found/too far'); emit(world,{kind:'tradeInvite', to:t.id, from:p.id, fromName:p.name}); return {ok:true}; }
function acceptTrade(world,p,fromId) { const a=world.players[fromId]; if(!a||dist(p,a)>40) return fail('gone/too far'); const ai=a.bag.findIndex(i=>!ITEMS[i]?.quest), bi=p.bag.findIndex(i=>!ITEMS[i]?.quest); if(ai<0||bi<0) return fail('both need a tradeable item'); const aa=a.bag[ai], bb=p.bag[bi]; a.bag[ai]=bb; p.bag[bi]=aa; emit(world,{kind:'system', text:`${a.name} and ${p.name} trade items.`}); return {ok:true}; }

function enterDungeon(world,p,dungeon) { if(dungeon!=='hollow_crypt') return fail('unknown dungeon'); const members = p.partyId ? world.parties[p.partyId].members.map(id=>world.players[id]).filter(Boolean) : [p]; let instId = p.partyId ? `crypt-${p.partyId}` : `crypt-${p.id}`; if(!world.instances[instId]) { world.instances[instId]={id:instId,dungeon,created:world.time}; spawnCrypt(world,instId); } for(const m of members) { if(dist(m,NPCS.find(n=>n.id==='cryptdoor'))<48 || m.id===p.id) { m.instance=instId; m.x=10; m.y=-18; } } emit(world,{kind:'system', text:`${p.name}'s party enters the Hollow Crypt.`}); return {ok:true}; }

function damage(world, ownerId, target, raw, kind='damage') {
  if(!target||target.dead) return 0;
  let amount = Math.max(1, Math.round(raw));
  const shield = (target.buffs||[]).find(b=>b.id==='shield'&&b.absorb>0); if(shield){ const s=Math.min(amount,shield.absorb); shield.absorb-=s; amount-=s; }
  amount = Math.max(0, amount - (hasBuff(target,'guard')?5:0)); target.hp -= amount;
  const owner=world.players[ownerId]; if(target.kind==='mob' && owner) tagMob(world, owner, target);
  if (target.kind==='mob' && target.hp<=0) killMob(world,owner,target); else if(target.kind==='player' && target.hp<=0) killPlayer(world,target);
  return amount;
}
function heal(world, caster, target, amount) { if(!target||target.dead) return 0; const a=Math.round(amount); target.hp=Math.min(target.maxHp,target.hp+a); emit(world,{kind:'combat', text:`${caster.name} heals ${target.name} for ${a}.`}); return a; }
function addDot(target, ownerId, id, damage, duration) { target.dots=target.dots||[]; target.dots.push({id, ownerId, damage:Math.round(damage), t:duration, tick:1}); }
function addBuff(target,id,t,extra={}) { target.buffs=target.buffs||[]; target.buffs=target.buffs.filter(b=>b.id!==id); target.buffs.push({id,t,...extra}); }
function hasBuff(u,id){return (u.buffs||[]).some(b=>b.id===id)} function buffMul(u,id,mul){return hasBuff(u,id)?mul:1}

function tagMob(world,p,m) { if(m.tagOwner) return; m.tagOwner=p.id; m.tagParty=p.partyId||null; m.lootOwner=p.partyId||p.id; }
function killMob(world,p,m) { m.dead=true; m.hp=0; m.respawnAt=world.time+(m.instance?999999:25+randRange(m.id,0,20)); if(p) rewardKill(world,p,m); emit(world,{kind:'combat', text:`${m.name} dies.`}); }
function rewardKill(world,p,m) { const recipients = creditPlayers(world,p,m); const xp = Math.round(m.xp * (m.elite?1.7:1) / Math.max(1,recipients.length) * groupBonus(recipients.length)); for(const r of recipients) { addXP(world,r,xp); questKillCredit(world,r,m.type); } if (m.loot?.length) m.lootDrop = m.loot[Math.floor(Math.abs(randRange(m.id,0,m.loot.length-0.001)))]; }
function creditPlayers(world,p,m) { if(m.tagParty && world.parties[m.tagParty]) return world.parties[m.tagParty].members.map(id=>world.players[id]).filter(x=>x&&!x.dead&&x.instance===m.instance&&dist(x,m)<110); return [p].filter(Boolean); }
function groupBonus(n){ return n>=5?1.43:n===4?1.3:n===3?1.166:1; }
function lootMob(world,p,m) { if(m.lootDrop) { addItem(p,m.lootDrop); questCollectCredit(world,p,m.lootDrop); m.lootDrop=null; } p.coin += m.elite?12:Math.max(1,Math.floor(m.level*2)); return {ok:true}; }
function canLoot(world,p,m){ return m.lootOwner === p.id || (p.partyId && m.lootOwner===p.partyId); }
function killPlayer(world,p) { if(p.duelId) { p.hp=1; return; } p.dead=true; p.hp=0; emit(world,{kind:'system', to:p.id, text:'You died. Returning to Eastbrook graveyard.'}); setTimeout(()=>{p.dead=false;p.hp=Math.max(1,Math.floor(p.maxHp*0.6));p.mp=Math.floor(p.maxMp*0.6);p.x=-18;p.y=24;p.instance=null;}, 2500); }

function questKillCredit(world,p,type){ for(const [qid,log] of Object.entries(p.quests)) { const q=QUESTS[qid]; if(!q||log.status!=='active') continue; q.objectives.forEach((o,i)=>{ if(o.type==='kill'&&o.target===type) log.progress[i]=Math.min(o.count,(log.progress[i]||0)+1); }); if(ready(q,log)) { log.status='ready'; emit(world,{kind:'quest', to:p.id, text:`Ready to turn in: ${q.name} (/complete ${qid})`}); } } }
function questCollectCredit(world,p,itemId){ for(const [qid,log] of Object.entries(p.quests)) { const q=QUESTS[qid]; if(!q||log.status!=='active') continue; q.objectives.forEach((o,i)=>{ if(o.type==='collect'&&o.target===itemId) log.progress[i]=Math.min(o.count,(log.progress[i]||0)+1); }); if(ready(q,log)) { log.status='ready'; emit(world,{kind:'quest', to:p.id, text:`Ready to turn in: ${q.name} (/complete ${qid})`}); } } }
function ready(q,log){ return q.objectives.every((o,i)=>(log.progress[i]||0)>=o.count); }
function addXP(world,p,xp){ p.xp += xp; while(p.xp >= xpNeed(p.level) && p.level < 20) { p.xp -= xpNeed(p.level); p.level++; recalc(p); p.hp=p.maxHp; p.mp=p.maxMp; emit(world,{kind:'level', to:p.id, text:`${p.name} reaches level ${p.level}.`}); } }
export function xpNeed(level){ return 260 + level*140; }
function addItem(p,itemId){ if(p.bag.length<24) p.bag.push(itemId); }
function recalc(p){ const cls=CLASSES[p.className]||CLASSES.Warrior; let hp=cls.hp+(p.level-1)*18, mp=cls.mp+(p.level-1)*10, armor=cls.armor+(p.level-1)*2, power=cls.power+(p.level-1)*3; for(const id of Object.values(p.equipment||{})){ const it=ITEMS[id]; if(!it) continue; hp+=it.hp||0; mp+=it.mp||0; armor+=it.armor||0; power+=it.power||0; } p.maxHp=hp; p.maxMp=mp; p.armor=armor; p.power=power; p.hp=Math.min(p.hp??hp,hp); p.mp=Math.min(p.mp??mp,mp); }
function regen(p,dt){ if(p.dead) return; p.hp=Math.min(p.maxHp,p.hp+dt*(1+p.level*0.08)); p.mp=Math.min(p.maxMp,p.mp+dt*(2+p.level*0.1)); for(const k of Object.keys(p.cooldowns||{})) p.cooldowns[k]=Math.max(0,p.cooldowns[k]-dt); }

function spawnWorldMobs(world){ for(const s of SPAWNS) for(let i=0;i<s.n;i++) spawnMob(world,s.type,s.x+randRange(`${s.type}${i}x`,-s.r,s.r),s.y+randRange(`${s.type}${i}y`,-s.r,s.r),null); }
function spawnCrypt(world,inst){ spawnMob(world,'crypt_skeleton',-18,-34,inst); spawnMob(world,'crypt_skeleton',28,-44,inst); spawnMob(world,'crypt_skeleton',54,-4,inst); spawnMob(world,'crypt_skeleton',82,-30,inst); spawnMob(world,'gravecaller',110,-12,inst); }
function spawnMob(world,type,x,y,instance){ const t=MOB_TEMPLATES[type]; const id=`m${world.nextMob++}`; world.mobs[id]={ id, kind:'mob', type, name:t.name, level:t.level, hp:t.hp, maxHp:t.hp, dmg:t.dmg, xp:t.xp, color:t.color, radius:t.radius, elite:t.elite, boss:t.boss, loot:t.loot||[], x,y, home:{x,y}, instance, buffs:[], dots:[], aggro:t.elite?78:52, leash:t.elite?160:120 }; return world.mobs[id]; }
function resetMob(m){ const t=MOB_TEMPLATES[m.type]; Object.assign(m,{dead:false,hp:t.hp,maxHp:t.hp,x:m.home.x,y:m.home.y,targetId:null,tagOwner:null,tagParty:null,lootOwner:null,lootDrop:null,dots:[],buffs:[]}); }
function nearestPlayer(world,m,r){ let best=null,bd=r; for(const p of Object.values(world.players)) if(!p.dead && p.instance===m.instance){ const d=dist(m,p); if(d<bd){bd=d;best=p;} } return best; }
function getTarget(world,id,instance){ const p=world.players[id]; if(p) return p.instance===instance?p:null; const m=world.mobs[id]; return m&&m.instance===instance?m:null; }
function findPlayerByName(world,name){ const low=String(name||'').trim().toLowerCase(); return Object.values(world.players).find(p=>p.name.toLowerCase()===low); }
function moveToward(a,b,step){ const d=Math.hypot(b.x-a.x,b.y-a.y)||1; a.x += (b.x-a.x)/d*step; a.y += (b.y-a.y)/d*step; }
function dist(a,b){ return Math.hypot((a.x||0)-(b.x||0),(a.y||0)-(b.y||0)); }
export { dist };
function rollPower(p,scale){ return Math.max(1, Math.round((p.power + (ITEMS[p.equipment?.weapon]?.power||0) + p.level*2) * scale + randRange(`${p.id}${p.swing||0}`,-3,4))); }
function armorDR(armor){ return Math.floor((armor||0)*0.18); }
function clamp(v,a,b){return Math.max(a,Math.min(b,v));}
function randRange(seed,a,b){ const s=String(seed); let h=2166136261; for(let i=0;i<s.length;i++) h=Math.imul(h^s.charCodeAt(i),16777619); const r=((h>>>0)%100000)/100000; return a+(b-a)*r; }
function zoneAt(x,y){ return ZONES.find(z=>x>=z.x&&x<=z.x+z.w&&y>=z.y&&y<=z.y+z.h) || ZONES[0]; }
export { zoneAt };
function cleanName(n){ return String(n||'').replace(/[^A-Za-z]/g,'').slice(0,14); }
export function uid(prefix='id'){ return `${prefix}_${Math.random().toString(36).slice(2,10)}${Date.now().toString(36).slice(-4)}`; }
function fail(error){ return {ok:false,error}; }
function emit(world,e){ world.events.push({...e,time:Date.now()}); if(e.kind==='chat') return; }
function normalizePlayer(p){ p.kind='player'; p.buffs=p.buffs||[]; p.dots=p.dots||[]; p.cooldowns=p.cooldowns||{}; p.quests=p.quests||{}; p.completed=p.completed||{}; p.bag=p.bag||[]; p.equipment=p.equipment||{}; recalc(p); return p; }

export function snapshot(world, viewerId=null) {
  if (!world) return null;
  const viewer = viewerId ? world.players[viewerId] : null;
  const inst = viewer?.instance || null;
  return {
    time: world.time,
    you: viewerId,
    players: Object.fromEntries(Object.entries(world.players).filter(([id,p])=>!viewer||p.instance===inst).map(([id,p])=>[id, publicPlayer(p)])),
    mobs: Object.fromEntries(Object.entries(world.mobs).filter(([id,m])=>m.instance===inst).map(([id,m])=>[id, publicMob(m)])),
    npcs: inst ? [] : NPCS,
    parties: world.parties,
    events: world.events.filter(e=>!e.to || e.to===viewerId || (e.partyId && viewer?.partyId===e.partyId)).slice(-20),
    chats: world.chats.filter(c=>!c.party || c.partyId===viewer?.partyId).slice(-40)
  };
}
function publicPlayer(p){ const {input,...rest}=p; return rest; }
function publicMob(m){ return m; }

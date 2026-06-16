import assert from 'node:assert/strict';
import { createWorld, createCharacter, addPlayer, command, tick, snapshot } from '../shared/rules.mjs';
assert.equal(snapshot(null, 'boot'), null);
const world = createWorld({ mode:'test' });
const p = addPlayer(world, createCharacter('Tester','Mage'), 'tester');
assert.equal(p.name, 'Tester');
command(world, p.id, { type:'acceptQuest', data:{ questId:'q_wolves' } });
assert.ok(p.quests.q_wolves);
command(world, p.id, { type:'input', data:{ up:true } });
for (let i=0;i<20;i++) tick(world, 1/20);
assert.notEqual(p.y, 0);
const wolf = Object.values(world.mobs).find(m => m.type === 'wolf');
p.x = wolf.x; p.y = wolf.y + 10; command(world, p.id, { type:'target', data:{ id:wolf.id } });
for (let i=0;i<120 && !wolf.dead;i++) { command(world, p.id, { type:'cast', data:{ spell:'fireball', targetId:wolf.id } }); tick(world,1/20); }
assert.equal(wolf.dead, true);
const s = snapshot(world, p.id);
assert.ok(s.players.tester);
console.log('smoke ok');

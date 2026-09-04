import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateCondition, evaluateMissions } from '../server/rules.mjs';

test('mission victory requires all declared world conditions', () => {
  const state = {
    missions: {
      M1: {
        id: 'M1',
        success_conditions: [
          { path: 'work.W1.status', op: 'eq', value: 'complete' },
          { path: 'artifacts.APP', op: 'exists' },
          { path: 'health.integrity', op: 'gte', value: 80 }
        ]
      }
    },
    work: { W1: { status: 'complete' } },
    artifacts: { APP: { id: 'APP' } },
    health: { integrity: 95 }
  };
  const result = evaluateMissions(state).M1;
  assert.equal(result.total, 3);
  assert.equal(result.met, 3);
  assert.equal(result.won, true);
});

test('condition evaluator exposes actual value for auditability', () => {
  const result = evaluateCondition({ a: { b: 7 } }, { path: 'a.b', op: 'gte', value: 10 });
  assert.equal(result.actual, 7);
  assert.equal(result.met, false);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ArtifactStore } from '../server/artifacts.mjs';

test('artifact store deduplicates bytes by sha256 and reads them back', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rug-artifacts-'));
  const store = new ArtifactStore(dir);
  const bytes = Buffer.from('same shared file bytes');
  const first = store.put(bytes);
  const second = store.put(bytes);
  assert.equal(first.digest, second.digest);
  assert.equal(first.size, bytes.length);
  assert.equal(store.has(first.digest), true);
  assert.deepEqual(store.read(first.digest), bytes);
  assert.equal(fs.readdirSync(dir).length, 1);
});

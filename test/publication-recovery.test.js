import test from 'node:test';
import assert from 'node:assert/strict';
import { createSqliteDatabase } from '../src/db.js';
import { recoverPublications } from '../src/publication-recovery.js';

function storeRuns(runs) {
  const db = createSqliteDatabase(':memory:');
  for (const [runId, adCount] of runs) {
    db.createRun({ id: runId, ownerMetaUserId: 'owner-1', status: 'completed', snapshot: { campaigns: [] }, createdAt: 1 });
    for (let index = 1; index <= adCount; index += 1) {
      db.updateNodeResult(runId, { clientId: `ad-${index}`, type: 'ad', status: 'created', name: `Ad ${index}`, remoteId: `${runId}-remote-${index}` });
    }
  }
  return db;
}

const published = (remoteId) => ({ postId: `1_${remoteId}`, permalinkUrl: `https://www.facebook.com/1/posts/${remoteId}` });

test('recovers late Post IDs across runs within one lookup budget per tick', async () => {
  const db = storeRuns([['run-1', 6], ['run-2', 6]]);
  const looked = [];
  const tick = () => recoverPublications({
    runIds: ['run-1', 'run-2'], db, tokenFor: async () => 'token', budget: 8, now: () => 1_000,
    metaClient: { getAdPublication: async (_token, remoteId) => { looked.push(remoteId); return published(remoteId); } }
  });

  assert.deepEqual(await tick(), { runs: 2, checked: 8, resolved: 8, pending: 4, errors: 0 });
  assert.equal((await tick()).checked, 4);
  assert.equal(looked.length, 12);
  assert.ok(db.getRun('run-2').nodes.every((node) => node.postId === `1_${node.remoteId}`));
});

test('skips runs whose owner is no longer connected', async () => {
  const db = storeRuns([['run-1', 2]]);
  const result = await recoverPublications({
    runIds: ['run-1', 'missing-run'], db, tokenFor: async () => null, now: () => 1_000,
    metaClient: { getAdPublication: async () => assert.fail('no token, no lookup') }
  });

  assert.deepEqual(result, { runs: 0, checked: 0, resolved: 0, pending: 0, errors: 0 });
});

test('a Post ID whose save failed is looked up again once its backoff passes', async () => {
  const db = storeRuns([['run-1', 1]]);
  let saveFails = true;
  let lookups = 0;
  let time = 1_000;
  const flakyDb = new Proxy(db, {
    get: (target, property) => (property === 'savePublication' && saveFails
      ? () => { throw new Error('database unavailable'); }
      : target[property])
  });
  const tick = () => recoverPublications({
    runIds: ['run-1'], db: flakyDb, tokenFor: async () => 'token', now: () => time,
    metaClient: { getAdPublication: async (_token, remoteId) => { lookups += 1; return published(remoteId); } }
  });

  assert.equal((await tick()).errors, 1);
  saveFails = false;
  await tick();
  assert.equal(lookups, 1, 'still in backoff');
  time = 61_000;
  assert.equal((await tick()).resolved, 1);
  assert.equal(lookups, 2);
  assert.equal(db.getRun('run-1').nodes[0].postId, '1_run-1-remote-1');
});

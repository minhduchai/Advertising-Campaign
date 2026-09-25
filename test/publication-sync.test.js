import test from 'node:test';
import assert from 'node:assert/strict';
import { createSqliteDatabase } from '../src/db.js';
import { syncRunPublications } from '../src/publication-sync.js';
import { recoverPublications } from '../src/publication-recovery.js';

function runStore(nodes, snapshot = { campaigns: [] }, runId = 'run-1', db = createSqliteDatabase(':memory:')) {
  db.createRun({ id: runId, ownerMetaUserId: 'owner-1', status: 'completed', snapshot, createdAt: 1 });
  for (const node of nodes) db.updateNodeResult(runId, node);
  return db;
}

function createdAd(index, extra = {}) {
  return {
    clientId: `ad-${index}`, parentClientId: 'adset-1', type: 'ad', status: 'created', name: `Ad ${index}`,
    remoteId: `remote-ad-${index}`, postId: null, permalinkUrl: null, error: null, ...extra
  };
}

const twelveAds = () => Array.from({ length: 12 }, (_, index) => createdAd(index + 1));
const published = (remoteId) => ({ postId: `1_${remoteId}`, permalinkUrl: `https://www.facebook.com/1/posts/${remoteId}` });
const sharedGroupSnapshot = {
  campaigns: [{
    clientId: 'campaign-1', adAccountId: 'act_1', pageId: 'page-1',
    adSets: [{ ads: [{ clientId: 'ad-1', creativeGroupId: 'group-1' }, { clientId: 'ad-2', creativeGroupId: 'group-1' }] }]
  }]
};

test('repeated syncs while Post IDs are missing only call Meta when each lookup is due', async () => {
  const db = runStore(twelveAds());
  let lookups = 0;
  let time = 1_000;
  const sync = () => syncRunPublications({
    run: db.getRun('run-1'), token: 'token', db, now: () => time,
    metaClient: { getAdPublication: async () => { lookups += 1; return { postId: null, permalinkUrl: null }; } }
  });

  for (const pollAt of [1_000, 4_000, 7_000, 10_000]) { // the browser seeding loop polls every 3 s
    time = pollAt;
    await sync();
  }
  assert.equal(lookups, 12, 'one lookup per group, then the backoff holds');

  time = 61_000;
  const retried = await sync();
  assert.equal(lookups, 24, 'a Post ID that appears late is still retried once the backoff passes');
  assert.equal(retried.pendingGroups, 12);
});

test('web routes and the recovery worker syncing one run at once look each group up once', async () => {
  const db = runStore(twelveAds());
  let lookups = 0;
  const metaClient = {
    getAdPublication: async () => {
      lookups += 1;
      await new Promise((resolve) => setTimeout(resolve, 5));
      return { postId: null, permalinkUrl: null };
    }
  };

  await Promise.all([
    syncRunPublications({ run: db.getRun('run-1'), token: 'token', db, metaClient, now: () => 1_000 }),
    recoverPublications({ runIds: ['run-1'], db, metaClient, tokenFor: async () => 'token', budget: 12, now: () => 1_000 })
  ]);
  assert.equal(lookups, 12);

  const tick = (time) => recoverPublications({ runIds: ['run-1'], db, metaClient, tokenFor: async () => 'token', budget: 12, now: () => time });
  await tick(30_000);
  assert.equal(lookups, 12, 'the next worker tick respects the backoff the web route started');
  await tick(61_000);
  assert.equal(lookups, 24);
});

test('shares a lookup only between Ads of the same Meta creative, never across creatives or Pages', async () => {
  const db = runStore([
    createdAd(1, { creativeId: 'creative-1' }),
    createdAd(2, { creativeId: 'creative-1' }),
    createdAd(3, { creativeId: 'creative-2' }),
    createdAd(4)
  ], {
    campaigns: [
      {
        clientId: 'campaign-1', adAccountId: 'act_1', pageId: 'page-1',
        adSets: [{ ads: ['ad-1', 'ad-2', 'ad-3'].map((clientId) => ({ clientId, creativeGroupId: 'group-1' })) }]
      },
      { clientId: 'campaign-2', adAccountId: 'act_1', pageId: 'page-2', adSets: [{ ads: [{ clientId: 'ad-4', creativeGroupId: 'group-1' }] }] }
    ]
  });
  const looked = [];

  await syncRunPublications({
    run: db.getRun('run-1'), token: 'token', db, now: () => 1_000,
    metaClient: { getAdPublication: async (_token, remoteId) => { looked.push(remoteId); return published(remoteId); } }
  });

  assert.deepEqual(looked.sort(), ['remote-ad-1', 'remote-ad-3', 'remote-ad-4']);
  assert.deepEqual(db.getRun('run-1').nodes.map((node) => node.postId), ['1_remote-ad-1', '1_remote-ad-1', '1_remote-ad-3', '1_remote-ad-4']);
});

test('saves a Post ID without overwriting a newer status, creative or error', async () => {
  const db = runStore([createdAd(1, { creativeId: 'creative-1' })]);
  const staleRun = db.getRun('run-1');
  // A retry replaced the Ad after the run was read.
  db.updateNodeResult('run-1', createdAd(1, {
    status: 'retry_pending', remoteId: null, creativeId: 'creative-2', error: { message: 'Đang chờ hạn mức Meta' }
  }));

  await syncRunPublications({
    run: staleRun, token: 'token', db, now: () => 1_000,
    updateNodeResult: (runId, node) => db.updateNodeResult(runId, node),
    metaClient: { getAdPublication: async () => published('remote-ad-1') }
  });

  const [node] = db.getRun('run-1').nodes;
  assert.deepEqual([node.status, node.creativeId, node.postId, node.error.message],
    ['retry_pending', 'creative-2', null, 'Đang chờ hạn mức Meta']);
});

test('looks up unresolved groups in parallel but never more than `concurrency` at once', async () => {
  const db = runStore(Array.from({ length: 6 }, (_, index) => createdAd(index + 1)));
  let inFlight = 0;
  let peak = 0;

  const sync = await syncRunPublications({
    run: db.getRun('run-1'),
    token: 'token',
    db,
    maxGroups: 5,
    concurrency: 2,
    metaClient: {
      getAdPublication: async (_token, remoteId) => {
        inFlight += 1;
        peak = Math.max(peak, inFlight);
        await new Promise((resolve) => setTimeout(resolve, 5));
        inFlight -= 1;
        return published(remoteId);
      }
    }
  });

  assert.equal(peak, 2);
  assert.deepEqual(sync, { attemptedGroups: 5, resolvedGroups: 5, pendingGroups: 1, errors: [] });
});

test('resolves one representative and updates every Ad sharing a creative group', async () => {
  const db = runStore([createdAd(1), createdAd(2, { parentClientId: 'adset-2' })], sharedGroupSnapshot);
  const calls = [];

  const sync = await syncRunPublications({
    run: db.getRun('run-1'),
    token: 'EAAG-token',
    db,
    metaClient: {
      getAdPublication: async (token, remoteId) => {
        calls.push({ token, remoteId });
        return { postId: '123_456', permalinkUrl: 'https://www.facebook.com/123/posts/456' };
      }
    }
  });

  assert.deepEqual(calls, [{ token: 'EAAG-token', remoteId: 'remote-ad-1' }]);
  assert.deepEqual(db.getRun('run-1').nodes.map(({ clientId, status, postId, permalinkUrl }) => ({ clientId, status, postId, permalinkUrl })), [
    { clientId: 'ad-1', status: 'created', postId: '123_456', permalinkUrl: 'https://www.facebook.com/123/posts/456' },
    { clientId: 'ad-2', status: 'created', postId: '123_456', permalinkUrl: 'https://www.facebook.com/123/posts/456' }
  ]);
  assert.deepEqual(sync, { attemptedGroups: 1, resolvedGroups: 1, pendingGroups: 0, errors: [] });
});

test('reuses an already resolved sibling without another Meta request', async () => {
  const db = runStore([
    createdAd(1, { postId: '123_456', permalinkUrl: 'https://www.facebook.com/123/posts/456' }),
    createdAd(2)
  ], sharedGroupSnapshot);

  const sync = await syncRunPublications({
    run: db.getRun('run-1'),
    token: 'EAAG-token',
    db,
    metaClient: { getAdPublication: async () => assert.fail('Meta should not be called') }
  });

  assert.equal(db.getRun('run-1').nodes[1].postId, '123_456');
  assert.equal(sync.resolvedGroups, 1);
  assert.equal(sync.attemptedGroups, 0);
});

test('keeps unresolved publications pending and returns sanitized Meta errors', async () => {
  const db = runStore([createdAd(1), createdAd(2)], sharedGroupSnapshot);
  const error = new Error('Token expired');
  error.meta = { code: 190, subcode: 463, message: 'Token expired', accessToken: 'must-not-leak' };

  const sync = await syncRunPublications({
    run: db.getRun('run-1'),
    token: 'EAAG-token',
    db,
    metaClient: { getAdPublication: async () => { throw error; } }
  });

  assert.deepEqual(sync, {
    attemptedGroups: 1,
    resolvedGroups: 0,
    pendingGroups: 1,
    errors: [{ message: 'Token expired', code: 190, subcode: 463 }]
  });
  assert.doesNotMatch(JSON.stringify(sync), /EAAG|must-not-leak/);
  assert.deepEqual(db.getRun('run-1').nodes.map((node) => node.postId), [null, null]);
});

test('keeps absent Meta error codes null instead of reporting code zero', async () => {
  const db = runStore([createdAd(1)]);
  const error = new Error('Meta đang xử lý');
  error.meta = { message: 'Meta đang xử lý', code: null, subcode: null };
  const sync = await syncRunPublications({
    run: db.getRun('run-1'),
    token: 'EAAG-token',
    db,
    metaClient: { getAdPublication: async () => { throw error; } }
  });

  assert.deepEqual(sync.errors, [{ message: 'Meta đang xử lý', code: null, subcode: null }]);
});

test('a throttled lookup waits for Meta cooldown before the group is tried again', async () => {
  const db = runStore([createdAd(1)]);
  let lookups = 0;
  let time = 1_000;
  const sync = () => syncRunPublications({
    run: db.getRun('run-1'), token: 'token', db, now: () => time,
    metaClient: {
      getAdPublication: async () => {
        lookups += 1;
        throw Object.assign(new Error('Đang chờ hạn mức Meta'), { name: 'MetaThrottleError', statusCode: 429, retryable: true, retryAfterMs: 90_000 });
      }
    }
  });

  await assert.rejects(sync(), { name: 'MetaThrottleError' });
  time = 61_000;
  await sync();
  assert.equal(lookups, 1);
  time = 91_000;
  await assert.rejects(sync(), { name: 'MetaThrottleError' });
  assert.equal(lookups, 2);
});

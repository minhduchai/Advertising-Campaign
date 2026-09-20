import test from 'node:test';
import assert from 'node:assert/strict';
import { syncRunPublications } from '../src/publication-sync.js';

function runFixture() {
  return {
    id: 'run-1',
    snapshot: {
      version: 2,
      campaigns: [{
        adSets: [{
          ads: [
            { clientId: 'ad-1', creativeGroupId: 'creative-group-1' },
            { clientId: 'ad-2', creativeGroupId: 'creative-group-1' }
          ]
        }]
      }]
    },
    nodes: [
      { clientId: 'ad-1', parentClientId: 'adset-1', type: 'ad', status: 'created', name: 'Ad 1', remoteId: 'remote-ad-1', postId: null, permalinkUrl: null, error: null },
      { clientId: 'ad-2', parentClientId: 'adset-2', type: 'ad', status: 'created', name: 'Ad 2', remoteId: 'remote-ad-2', postId: null, permalinkUrl: null, error: null }
    ]
  };
}

test('looks up unresolved groups in parallel but never more than `concurrency` at once', async () => {
  const run = {
    id: 'run-1',
    snapshot: { campaigns: [] },
    nodes: Array.from({ length: 6 }, (_, index) => ({
      clientId: `ad-${index + 1}`, type: 'ad', status: 'created', remoteId: `remote-ad-${index + 1}`, postId: null, permalinkUrl: null
    }))
  };
  let inFlight = 0;
  let peak = 0;

  const sync = await syncRunPublications({
    run,
    token: 'token',
    maxGroups: 5,
    concurrency: 2,
    metaClient: {
      getAdPublication: async () => {
        inFlight += 1;
        peak = Math.max(peak, inFlight);
        await new Promise((resolve) => setTimeout(resolve, 5));
        inFlight -= 1;
        return { postId: '1_2', permalinkUrl: 'https://www.facebook.com/1/posts/2' };
      }
    },
    updateNodeResult: async () => {}
  });

  assert.equal(peak, 2);
  assert.deepEqual(sync, { attemptedGroups: 5, resolvedGroups: 5, pendingGroups: 1, errors: [] });
});

test('resolves one representative and updates every Ad sharing a creative group', async () => {
  const calls = [];
  const updates = [];
  const sync = await syncRunPublications({
    run: runFixture(),
    token: 'EAAG-token',
    metaClient: {
      getAdPublication: async (token, remoteId) => {
        calls.push({ token, remoteId });
        return {
          postId: '123_456',
          permalinkUrl: 'https://www.facebook.com/123/posts/456'
        };
      }
    },
    updateNodeResult: async (runId, node) => updates.push({ runId, node })
  });

  assert.deepEqual(calls, [{ token: 'EAAG-token', remoteId: 'remote-ad-1' }]);
  assert.deepEqual(updates.map(({ runId, node }) => ({
    runId,
    clientId: node.clientId,
    status: node.status,
    postId: node.postId,
    permalinkUrl: node.permalinkUrl
  })), [
    { runId: 'run-1', clientId: 'ad-1', status: 'created', postId: '123_456', permalinkUrl: 'https://www.facebook.com/123/posts/456' },
    { runId: 'run-1', clientId: 'ad-2', status: 'created', postId: '123_456', permalinkUrl: 'https://www.facebook.com/123/posts/456' }
  ]);
  assert.deepEqual(sync, {
    attemptedGroups: 1,
    resolvedGroups: 1,
    pendingGroups: 0,
    errors: []
  });
});

test('reuses an already resolved sibling without another Meta request', async () => {
  const run = runFixture();
  run.nodes[0].postId = '123_456';
  run.nodes[0].permalinkUrl = 'https://www.facebook.com/123/posts/456';
  const updates = [];

  const sync = await syncRunPublications({
    run,
    token: 'EAAG-token',
    metaClient: {
      getAdPublication: async () => assert.fail('Meta should not be called')
    },
    updateNodeResult: async (_runId, node) => updates.push(node)
  });

  assert.equal(updates.length, 1);
  assert.equal(updates[0].clientId, 'ad-2');
  assert.equal(updates[0].postId, '123_456');
  assert.equal(sync.resolvedGroups, 1);
  assert.equal(sync.attemptedGroups, 0);
});

test('keeps unresolved publications pending and returns sanitized Meta errors', async () => {
  const error = new Error('Token expired');
  error.meta = { code: 190, subcode: 463, message: 'Token expired', accessToken: 'must-not-leak' };

  const sync = await syncRunPublications({
    run: runFixture(),
    token: 'EAAG-token',
    metaClient: { getAdPublication: async () => { throw error; } },
    updateNodeResult: async () => assert.fail('Pending nodes must not be overwritten')
  });

  assert.deepEqual(sync, {
    attemptedGroups: 1,
    resolvedGroups: 0,
    pendingGroups: 1,
    errors: [{ message: 'Token expired', code: 190, subcode: 463 }]
  });
  assert.doesNotMatch(JSON.stringify(sync), /EAAG|must-not-leak/);
});

test('keeps absent Meta error codes null instead of reporting code zero', async () => {
  const error = new Error('Meta đang xử lý');
  error.meta = { message: 'Meta đang xử lý', code: null, subcode: null };
  const sync = await syncRunPublications({
    run: runFixture(),
    token: 'EAAG-token',
    metaClient: { getAdPublication: async () => { throw error; } },
    updateNodeResult: async () => assert.fail('Pending nodes must not be overwritten')
  });

  assert.deepEqual(sync.errors, [{ message: 'Meta đang xử lý', code: null, subcode: null }]);
});

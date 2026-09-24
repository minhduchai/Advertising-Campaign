import test from 'node:test';
import assert from 'node:assert/strict';
import { collectWorkflowCleanupMediaIds, processWorkflowSeedingBatch } from '../src/request-handler.js';

test('processes three comments in one workflow subrequest while preserving delays', async () => {
  const jobs = [1, 2, 3].map((id) => ({ id, status: 'created' }));
  const waits = [];
  const result = await processWorkflowSeedingBatch({
    batchSize: 3,
    processNext: async () => ({ job: jobs.shift() ?? null, retryAfterMs: 4_000 }),
    wait: async (milliseconds) => waits.push(milliseconds)
  });

  assert.equal(result.processed, 3);
  assert.deepEqual(waits, [4_000, 4_000]);
});

test('stops a seeding batch immediately when manual review is required', async () => {
  let calls = 0;
  const result = await processWorkflowSeedingBatch({
    batchSize: 3,
    processNext: async () => ({ job: { id: ++calls, status: 'needs_review' }, retryAfterMs: null }),
    wait: async () => assert.fail('must not wait after needs_review')
  });

  assert.equal(calls, 1);
  assert.equal(result.processed, 1);
  assert.equal(result.job.status, 'needs_review');
});

test('workflow cleanup preserves every media file referenced by seeding', () => {
  const finalRun = {
    execution: {
      campaigns: [{
        seeding: { items: [{ imageMediaId: 'shared-media' }, { imageMediaId: 'seed-only-media' }] },
        adSets: [{ ads: [
          { clientId: 'ad-1', mediaId: 'ad-media' },
          { clientId: 'ad-2', mediaId: 'shared-media' },
          { clientId: 'ad-3', mediaId: 'failed-media' },
          { clientId: 'ad-4', mediaId: 'stored-meta-media', mediaAsset: { kind: 'image' } }
        ] }]
      }]
    },
    nodes: [
      { clientId: 'ad-1', type: 'ad', remoteId: 'meta-ad-1' },
      { clientId: 'ad-2', type: 'ad', remoteId: 'meta-ad-2' },
      { clientId: 'ad-3', type: 'ad', remoteId: null },
      { clientId: 'ad-4', type: 'ad', remoteId: 'meta-ad-4' }
    ]
  };

  assert.deepEqual(collectWorkflowCleanupMediaIds(finalRun), ['ad-media']);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { processWorkflowSeedingBatch } from '../src/request-handler.js';

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

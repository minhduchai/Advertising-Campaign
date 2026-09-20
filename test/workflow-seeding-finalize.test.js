import test from 'node:test';
import assert from 'node:assert/strict';
import { reconcileWorkflowSeeding } from '../src/workflow-seeding-finalize.js';

test('late Post ID keeps workflow pending and creates missing seeding jobs without duplicates', async () => {
  const run = { id: 'r', ownerMetaUserId: 'u', snapshot: { campaigns: [{ clientId: 'c', pageId: 'p', seeding: { enabled: true, items: [{ id: 'i', message: 'hello' }] }, adSets: [{ ads: [{ clientId: 'a' }] }] }] }, nodes: [{ clientId: 'a', type: 'ad', status: 'created', remoteId: 'remote' }] };
  let jobs = [], ready = false;
  const db = { getRun: async () => run, updateNodeResult: async (_id, n) => { run.nodes = [n]; }, listSeedingJobs: async () => jobs,
    insertSeedingJobs: async (_owner, items) => { jobs.push(...items); },
    claimNextSeedingJob: async () => null };
  const metaClient = { getAdPublication: async () => ready ? { postId: 'p_post', permalinkUrl: 'https://example.com/post' } : null };
  const args = { run, db, metaClient, token: 'fake', mediaStore: {} };
  assert.equal((await reconcileWorkflowSeeding(args)).pending, true);
  assert.equal(jobs.length, 0);
  ready = true;
  assert.equal((await reconcileWorkflowSeeding(args)).pending, true);
  assert.equal(jobs.length, 1);
  await reconcileWorkflowSeeding(args);
  assert.equal(jobs.length, 1, 'repeated reconciliation must not duplicate jobs');
  jobs[0].status = 'created';
  assert.equal((await reconcileWorkflowSeeding(args)).pending, false);
});


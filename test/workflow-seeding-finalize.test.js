import test from 'node:test';
import assert from 'node:assert/strict';
import { createSqliteDatabase } from '../src/db.js';
import { reconcileWorkflowSeeding } from '../src/workflow-seeding-finalize.js';

test('late Post ID keeps workflow pending and creates missing seeding jobs without duplicates', async () => {
  const run = { id: 'r', ownerMetaUserId: 'u', snapshot: { campaigns: [{ clientId: 'c', pageId: 'p', seeding: { enabled: true, items: [{ id: 'i', message: 'hello' }] }, adSets: [{ ads: [{ clientId: 'a' }] }] }] }, nodes: [{ clientId: 'a', type: 'ad', status: 'created', remoteId: 'remote' }] };
  let jobs = [], ready = false, lookups = 0, time = 1_000;
  const lookupSchedule = createSqliteDatabase(':memory:');
  const db = { getRun: async () => run, listSeedingJobs: async () => jobs,
    insertSeedingJobs: async (_owner, items) => { jobs.push(...items); },
    claimNextSeedingJob: async () => null,
    listPublicationLookups: (...args) => lookupSchedule.listPublicationLookups(...args),
    claimPublicationLookups: (...args) => lookupSchedule.claimPublicationLookups(...args),
    schedulePublicationLookups: (...args) => lookupSchedule.schedulePublicationLookups(...args),
    savePublication: async (_id, _nodes, { postId, permalinkUrl }) => { run.nodes = [{ ...run.nodes[0], postId, permalinkUrl }]; } };
  const metaClient = { getAdPublication: async () => {
    lookups += 1;
    return ready ? { postId: 'p_post', permalinkUrl: 'https://example.com/post' } : null;
  } };
  const args = { run, db, metaClient, token: 'fake', mediaStore: {}, now: () => time };
  assert.equal((await reconcileWorkflowSeeding(args)).pending, true);
  assert.equal(jobs.length, 0);
  ready = true;
  time = 31_000; // finalize runs again 30 s later; the lookup backoff has not passed yet
  assert.equal((await reconcileWorkflowSeeding(args)).pending, true);
  assert.equal(jobs.length, 0);
  time = 61_000;
  assert.equal((await reconcileWorkflowSeeding(args)).pending, true);
  assert.equal(jobs.length, 1);
  await reconcileWorkflowSeeding(args);
  assert.equal(jobs.length, 1, 'repeated reconciliation must not duplicate jobs');
  assert.equal(lookups, 2);
  jobs[0].status = 'created';
  assert.equal((await reconcileWorkflowSeeding(args)).pending, false);
});


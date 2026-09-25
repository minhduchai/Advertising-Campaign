import { prepareRunSeeding, processNextSeedingJob } from './seeding-service.js';
import { syncRunPublications } from './publication-sync.js';

// Reconcile late Post IDs before deciding that a workflow is finished.
export async function reconcileWorkflowSeeding({ run, db, token, metaClient, mediaStore, loadPageEngagementContext, now = Date.now }) {
  // Finalize repeats every 30 s; the shared lookup schedule keeps that from re-asking Meta each time.
  await syncRunPublications({ run, token, metaClient, db, now });
  run = await db.getRun(run.id);
  let jobs = await db.listSeedingJobs(run.ownerMetaUserId, run.id);
  const prepared = await prepareRunSeeding({ run, ownerMetaUserId: run.ownerMetaUserId, existingJobs: jobs,
    insertJobs: (owner, items) => db.insertSeedingJobs(owner, items) });
  if (prepared.conflicts.length || prepared.invalidTargets.length) return { needsReview: true, pending: false };
  await processNextSeedingJob({ runId: run.id, ownerMetaUserId: run.ownerMetaUserId, db, token, metaClient, mediaStore, loadPageEngagementContext });
  jobs = await db.listSeedingJobs(run.ownerMetaUserId, run.id);
  return { pending: prepared.waitingPostCount > 0 || jobs.some(job => ['pending', 'posting'].includes(job.status)),
    waitingPostCount: prepared.waitingPostCount };
}

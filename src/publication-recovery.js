import { syncRunPublications } from './publication-sync.js';

// Recover publication metadata only; never create ads or post comments. The worker shares the web routes'
// grouped lookups, backoff and leases, within one lookup budget per tick.
export async function recoverPublications({ runIds, db, metaClient, tokenFor, budget = 8, now = Date.now }) {
  const result = { runs: 0, checked: 0, resolved: 0, pending: 0, errors: 0 };
  for (const runId of runIds) {
    if (budget <= 0) break;
    const run = await db.getRun(runId, { execution: false });
    const token = run ? await tokenFor(run.ownerMetaUserId) : null;
    if (!token) continue;
    const sync = await syncRunPublications({ run, token, metaClient, db, maxGroups: budget, now });
    budget -= sync.attemptedGroups;
    result.runs += 1;
    result.checked += sync.attemptedGroups;
    result.resolved += sync.resolvedGroups;
    result.pending += sync.pendingGroups;
    result.errors += sync.errors.length;
  }
  return result;
}

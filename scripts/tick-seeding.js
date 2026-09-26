import { loadConfig } from '../src/config.js';
import { createDatabaseForConfig } from '../src/database.js';
import { createSqlTransport } from '../src/postgres-transport.js';
import { decryptToken } from '../src/crypto.js';
import { createMetaClient } from '../src/meta-client.js';
import { createR2MediaStore } from '../src/r2-media.js';
import { prepareRunSeeding, processNextSeedingJob } from '../src/seeding-service.js';

const MAX_RUNTIME_MS = 100_000;
const MAX_JOBS_PER_TICK = 24;
const startedAt = Date.now();
const config = loadConfig();
const sql = createSqlTransport(config.databaseUrl);
const db = createDatabaseForConfig(config);
const metaClient = createMetaClient(config);
const r2Store = createR2MediaStore({ config, db });
if (!r2Store) throw new Error('R2 storage is required for the seeding worker.');
const mediaStore = r2Store;

let processed = 0;
let prepared = 0;
let failures = 0;
try {
  // These failures happened before createPageComment was called, so retrying
  // cannot duplicate a Facebook comment. Network failures after mutation are
  // stored as needs_review and are deliberately excluded here.
  await sql`UPDATE seeding_jobs SET status = 'pending', started_at = NULL,
      completed_at = NULL, available_at = ${Date.now()}, updated_at = ${Date.now()}
    WHERE status = 'failed' AND meta_comment_id IS NULL AND attempt_count < 4
      AND error_json->>'type' = 'TypeError' AND error_json->>'message' = 'fetch failed'`;
  // Preparation gates each campaign independently; other campaigns may still be creating.
  // Job claims remain atomic if a browser is processing too.
  const candidates = await sql`SELECT id FROM runs
    WHERE status IN ('creating', 'retrying_ad', 'seeding', 'completed', 'completed_with_errors')
      AND created_at >= ${Date.now() - 14 * 86400000}
    ORDER BY created_at DESC LIMIT 20`;
  for (const candidate of candidates) {
    if (processed >= MAX_JOBS_PER_TICK || Date.now() - startedAt >= MAX_RUNTIME_MS) break;
    const run = await db.getRun(candidate.id);
    if (!run?.snapshot?.campaigns?.some(campaign => campaign.seeding?.enabled)) continue;
    const connection = await db.getConnection(run.ownerMetaUserId);
    if (!connection) continue;
    const token = decryptToken(connection.accessTokenCiphertext, config.tokenEncryptionKey);
    try {
      // tick-publication-recovery owns missing Post ID lookups and their backoff.
      const existingJobs = await db.listSeedingJobs(run.ownerMetaUserId, run.id);
      const plan = await prepareRunSeeding({ run, ownerMetaUserId: run.ownerMetaUserId,
        existingJobs, insertJobs: (owner, jobs) => db.insertSeedingJobs(owner, jobs) });
      prepared += plan.jobs.length;
      if (plan.conflicts.length || plan.invalidTargets.length) continue;
      while (processed < MAX_JOBS_PER_TICK && Date.now() - startedAt < MAX_RUNTIME_MS) {
        const result = await processNextSeedingJob({ runId: run.id,
          ownerMetaUserId: run.ownerMetaUserId, db, metaClient, mediaStore, token });
        if (!result.job) break;
        processed += 1;
        if (result.job.status !== 'created') failures += 1;
        const delay = Math.min(5000, Math.max(0, Number(result.retryAfterMs) || 0));
        if (delay && Date.now() - startedAt + delay < MAX_RUNTIME_MS) {
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
    } catch (error) {
      failures += 1;
      console.error(JSON.stringify({ runId: run.id, code: String(error.meta?.code ?? error.name) }));
    }
  }
  console.log(JSON.stringify({ at: new Date().toISOString(), prepared, processed, failures }));
} catch (error) {
  console.error(JSON.stringify({ at: new Date().toISOString(), status: 'error', code: error.name }));
  process.exitCode = 1;
} finally {
  await sql.end?.();
  process.exit();
}

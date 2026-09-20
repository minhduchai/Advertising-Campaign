import { loadConfig } from '../src/config.js';
import { createSqlTransport } from '../src/postgres-transport.js';
import { decryptToken } from '../src/crypto.js';
import { createMetaClient } from '../src/meta-client.js';
import { recoverPublications } from '../src/publication-recovery.js';

const config = loadConfig();
const sql = createSqlTransport(config.databaseUrl);
const meta = createMetaClient(config);
try {
  await sql`CREATE TABLE IF NOT EXISTS publication_recovery (
    run_id TEXT NOT NULL, client_id TEXT NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0, next_at BIGINT NOT NULL DEFAULT 0,
    last_error TEXT, PRIMARY KEY (run_id, client_id))`;
  // Durable retry dates prevent slow or inaccessible posts starving newer ads.
  const jobs = await sql`SELECT n.run_id, n.client_id, n.remote_id,
      c.access_token_ciphertext, COALESCE(q.attempts, 0) AS attempts
    FROM node_results n JOIN runs r ON r.id = n.run_id
    JOIN connections c ON c.meta_user_id = r.owner_meta_user_id
    LEFT JOIN publication_recovery q ON q.run_id = n.run_id AND q.client_id = n.client_id
    WHERE n.type = 'ad' AND n.status = 'created' AND n.remote_id IS NOT NULL
      AND (NULLIF(n.post_id, '') IS NULL OR NULLIF(n.permalink_url, '') IS NULL)
      AND COALESCE(q.next_at, 0) <= ${Date.now()}
    ORDER BY COALESCE(q.next_at, 0), r.created_at, n.client_id LIMIT 8`;
  const result = await recoverPublications({
    jobs,
    lookup: job => meta.getAdPublication(
      decryptToken(job.access_token_ciphertext, config.tokenEncryptionKey), job.remote_id),
    // Update metadata only, with identity guards, so a concurrent publisher's
    // status, creative, and error fields cannot be overwritten by stale state.
    save: (job, value) => sql`UPDATE node_results SET
      post_id = COALESCE(NULLIF(post_id, ''), ${value.postId}),
      permalink_url = COALESCE(NULLIF(permalink_url, ''), ${value.permalinkUrl})
      WHERE run_id = ${job.run_id} AND client_id = ${job.client_id}
        AND remote_id = ${job.remote_id} AND status = 'created'`,
    schedule: (job, value) => sql`INSERT INTO publication_recovery
      (run_id, client_id, attempts, next_at, last_error)
      VALUES (${job.run_id}, ${job.client_id}, ${value.attempts}, ${value.nextAt}, ${value.code})
      ON CONFLICT (run_id, client_id) DO UPDATE SET
        attempts = EXCLUDED.attempts, next_at = EXCLUDED.next_at, last_error = EXCLUDED.last_error`
  });
  console.log(JSON.stringify({ at: new Date().toISOString(), ...result }));
} catch (error) {
  console.error(JSON.stringify({ at: new Date().toISOString(), status: 'error', code: error.name }));
  process.exitCode = 1;
} finally {
  await sql.end?.();
}

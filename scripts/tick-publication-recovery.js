import { loadConfig } from '../src/config.js';
import { createSqlTransport } from '../src/postgres-transport.js';
import { createPostgresDatabase } from '../src/postgres-db.js';
import { decryptToken } from '../src/crypto.js';
import { createMetaClient } from '../src/meta-client.js';
import { recoverPublications } from '../src/publication-recovery.js';

const config = loadConfig();
const sql = createSqlTransport(config.databaseUrl);
const db = createPostgresDatabase(sql);
const meta = createMetaClient(config);
try {
  await sql`CREATE TABLE IF NOT EXISTS publication_recovery (
    run_id TEXT NOT NULL, client_id TEXT NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0, next_at BIGINT NOT NULL DEFAULT 0,
    last_error TEXT, PRIMARY KEY (run_id, client_id))`;
  // Durable retry dates prevent slow or inaccessible posts starving newer ads.
  const runs = await sql`SELECT n.run_id
    FROM node_results n JOIN runs r ON r.id = n.run_id
    JOIN connections c ON c.meta_user_id = r.owner_meta_user_id
    LEFT JOIN publication_recovery q ON q.run_id = n.run_id AND q.client_id = n.client_id
    WHERE n.type = 'ad' AND n.status = 'created' AND n.remote_id IS NOT NULL
      AND (NULLIF(n.post_id, '') IS NULL OR NULLIF(n.permalink_url, '') IS NULL)
      AND COALESCE(q.next_at, 0) <= ${Date.now()}
    GROUP BY n.run_id ORDER BY MIN(COALESCE(q.next_at, 0)), MIN(r.created_at) LIMIT 8`;
  // Grouped by creative, with the same backoff and leases as the web routes, so a Post that seeding
  // or history is already looking up is not looked up again here.
  const result = await recoverPublications({
    runIds: runs.map((row) => row.run_id),
    db,
    metaClient: meta,
    tokenFor: async (ownerMetaUserId) => {
      const connection = await db.getConnection(ownerMetaUserId);
      return connection ? decryptToken(connection.accessTokenCiphertext, config.tokenEncryptionKey) : null;
    }
  });
  console.log(JSON.stringify({ at: new Date().toISOString(), ...result }));
} catch (error) {
  console.error(JSON.stringify({ at: new Date().toISOString(), status: 'error', code: error.name }));
  process.exitCode = 1;
} finally {
  await sql.end?.();
}

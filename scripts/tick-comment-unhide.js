import { loadConfig } from '../src/config.js';
import { createSqlTransport } from '../src/postgres-transport.js';
import { tickCommentUnhide } from '../src/comment-unhide-scheduler.js';

// Invoked by cron under flock. No web-server restart or browser is needed.
const config = loadConfig();
const sql = createSqlTransport(config.databaseUrl);
const db = {
  async getConnection(owner) {
    const [row] = await sql`SELECT access_token_ciphertext FROM connections WHERE meta_user_id = ${owner}`;
    return row ? { accessTokenCiphertext: row.access_token_ciphertext } : null;
  }
};
try {
  const result = await tickCommentUnhide({ config, db });
  console.log(JSON.stringify({ at: new Date().toISOString(), ...result }));
  if (['disabled', 'needs_review', 'retry_pending'].includes(result.status)) process.exitCode = 1;
} catch (error) {
  console.error(JSON.stringify({ at: new Date().toISOString(), status: 'error', code: error.name }));
  process.exitCode = 1;
} finally {
  await sql.end?.();
}

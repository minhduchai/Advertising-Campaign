import { createSqlTransport } from '../src/postgres-transport.js';
const sql = createSqlTransport(process.env.DATABASE_URL);
await sql`CREATE TABLE IF NOT EXISTS comment_unhide_jobs (
  owner_id TEXT NOT NULL, post_id TEXT NOT NULL, run_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending', state JSONB NOT NULL DEFAULT '{}',
  next_at BIGINT NOT NULL, lease TEXT, lease_until BIGINT,
  attempts INTEGER NOT NULL DEFAULT 0, last_error TEXT,
  updated_at BIGINT, PRIMARY KEY (owner_id, post_id)
)`;
await sql`CREATE INDEX IF NOT EXISTS comment_unhide_due_idx ON comment_unhide_jobs(status, next_at)`;
console.log('Comment unhide schema ready');
await sql.end?.();

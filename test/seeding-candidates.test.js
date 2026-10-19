import test from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { createPoolSql } from '../src/postgres-transport.js';
import { seedingCandidates } from '../scripts/seeding-candidates.js';

test('due old seeding runs outrank 25 newer runs, blocked sequences stay blocked, stale writes get reviewed',
  { skip: !process.env.SEEDING_TEST_DATABASE_URL }, async () => {
    const client = new pg.Client({ connectionString: process.env.SEEDING_TEST_DATABASE_URL });
    await client.connect();
    try {
      await client.query('BEGIN');
      // Session-local temporary tables shadow real tables; rollback leaves production rows untouched.
      await client.query(`CREATE TEMP TABLE runs (id text, status text, created_at bigint) ON COMMIT DROP;
        CREATE TEMP TABLE seeding_jobs (run_id text, status text, available_at bigint, started_at bigint,
          campaign_client_id text DEFAULT 'campaign', post_id text DEFAULT 'post', position int DEFAULT 0) ON COMMIT DROP`);
      const now = Date.now(), old = now - 30 * 86400000;
      for (let i = 0; i < 25; i++) await client.query('INSERT INTO runs VALUES ($1, $2, $3)', [`new-${i}`, 'completed', now - i]);
      for (const id of ['due', 'blocked', 'stale', 'future', 'live']) {
        await client.query('INSERT INTO runs VALUES ($1, $2, $3)', [id, 'completed', old]);
      }
      await client.query(`INSERT INTO seeding_jobs (run_id,status,available_at,started_at,position) VALUES
        ('due','pending',$1,NULL,0), ('blocked','needs_review',$1,NULL,0), ('blocked','pending',$1,NULL,1),
        ('stale','posting',$1,$2,0), ('future','pending',$3,NULL,0), ('live','posting',$1,$4,0)`,
      [now - 1000, now - 600000, now + 60000, now]);
      const sql = createPoolSql({ query: client.query.bind(client) });
      const rows = await seedingCandidates(sql, now);
      assert.equal(rows.length, 20);
      assert.deepEqual(rows.slice(0, 2).map(r => r.id).sort(), ['due', 'stale']);
      assert.ok(!rows.some(r => ['blocked', 'future', 'live'].includes(r.id)));
    } finally {
      await client.query('ROLLBACK');
      await client.end();
    }
  });

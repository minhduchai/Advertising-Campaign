import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createSqliteDatabase } from '../src/db.js';
import { createServer } from '../src/server.js';
import { workflowAuthHeaders } from '../src/workflow-auth.js';
import { request, testConfig } from './helpers.js';

test('a signed request cannot be replayed against another server instance', async (context) => {
  const directory = mkdtempSync(join(tmpdir(), 'workflow-replay-'));
  const path = join(directory, 'test.sqlite');
  const config = { ...testConfig(), workflowEnabled: true, workflowSharedSecret: 'test-workflow-secret' };
  const firstDb = createSqliteDatabase(path);
  const secondDb = createSqliteDatabase(path);
  const first = createServer({ config, db: firstDb, metaClient: {} });
  const second = createServer({ config, db: secondDb, metaClient: {} });
  context.after(() => {
    first.close(); second.close(); firstDb.close(); secondDb.close();
    rmSync(directory, { recursive: true, force: true });
  });
  const pathname = '/api/internal/workflow/runs/missing/plan';
  const headers = workflowAuthHeaders({ method: 'GET', pathname, nonce: 'shared-nonce' }, config.workflowSharedSecret);
  const accepted = await request(first, pathname, { headers });
  assert.equal(accepted.status, 404, 'authenticated request reaches the run lookup');
  const replay = await request(second, pathname, { headers });
  assert.equal(replay.status, 401);
  assert.match(replay.body.error, /replay/);
  const invalid = { ...headers, 'x-workflow-nonce': 'invalid-signature-nonce' };
  assert.equal((await request(first, pathname, { headers: invalid })).status, 401);
  const corrected = workflowAuthHeaders({ method: 'GET', pathname, nonce: 'invalid-signature-nonce' }, config.workflowSharedSecret);
  assert.equal((await request(second, pathname, { headers: corrected })).status, 404, 'bad signatures do not consume nonces');
});

test('nonce expiry includes the final allowed timestamp and permits cleanup afterward', () => {
  const db = createSqliteDatabase(':memory:');
  try {
    assert.equal(db.claimWorkflowNonce('hash', 1000, 0), true);
    assert.equal(db.claimWorkflowNonce('hash', 1000, 1000), false);
    assert.equal(db.claimWorkflowNonce('hash', 2000, 1001), true);
  } finally { db.close(); }
});

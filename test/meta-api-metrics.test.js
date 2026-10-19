import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { recordMetaApiCall } from '../src/meta-api-metrics.js';
import { createMetaClient } from '../src/meta-client.js';
import { getDefaultAutoSelectFamilyAttemptTimeout, setDefaultAutoSelectFamilyAttemptTimeout } from 'node:net';

test('allows IPv4 at least one second before IPv6 fallback without shortening an existing override', () => {
  const original = getDefaultAutoSelectFamilyAttemptTimeout();
  try {
    setDefaultAutoSelectFamilyAttemptTimeout(250);
    createMetaClient({ apiVersion: 'v24.0' });
    assert.equal(getDefaultAutoSelectFamilyAttemptTimeout(), 1000);
    setDefaultAutoSelectFamilyAttemptTimeout(2000);
    createMetaClient({ apiVersion: 'v24.0' });
    assert.equal(getDefaultAutoSelectFamilyAttemptTimeout(), 2000);
  } finally { setDefaultAutoSelectFamilyAttemptTimeout(original); }
});

test('Meta request telemetry records successes and failed attempts without query, body or secrets; files rotate', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'meta-metrics-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, 'meta-api-calls.jsonl');
  let calls = 0;
  const client = createMetaClient({ apiVersion: 'v24.0', errorJournalDirectory: join(dir, 'errors') }, {
    networkRetryDelay: async () => {}, fetchImpl: async () => {
      if (++calls === 1) throw new TypeError('fetch failed', { cause: { code: 'ENOTFOUND' } });
      return Response.json({ id: '123' }, { headers: { 'x-app-usage': '{"call_count":70}' } });
    }
  });
  await client.createCampaign('secret-token', 'act_123456', new URLSearchParams({ name: 'private-ad' }));
  const raw = readFileSync(path, 'utf8');
  const rows = raw.trim().split('\n').map(JSON.parse);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].networkError, true);
  assert.equal(rows[1].status, 200);
  assert.equal(rows[1].usage, 70);
  assert.equal(rows[1].endpoint, '/v24.0/act_:id/campaigns');
  assert.doesNotMatch(raw, /secret-token|private-ad|authorization/);
  writeFileSync(path, 'x'.repeat(5 * 1024 * 1024));
  recordMetaApiCall(join(dir, 'errors'), { input: 'https://graph.facebook.com/v24.0/private-id?access_token=hidden',
    options: {}, response: Response.json({}), startedAt: Date.now(), attempt: 1 });
  assert.equal(statSync(`${path}.1`).size, 5 * 1024 * 1024);
  assert.doesNotMatch(readFileSync(path, 'utf8'), /hidden|private-id/);
  assert.doesNotThrow(() => recordMetaApiCall(path, { input: 'invalid' }));
});

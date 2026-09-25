import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMetaRateLimiter, parseUsageHeaders, policyForUsage } from '../src/meta-rate-limiter.js';
import { createMetaClient } from '../src/meta-client.js';
import { testConfig } from './helpers.js';

async function sharedClients(t, count) {
  const directory = await mkdtemp(join(tmpdir(), 'meta-cooldown-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const sent = [];
  const replies = { next: () => Response.json({ id: 'ok' }) };
  const fetchImpl = async (url) => {
    sent.push(new URL(url).pathname);
    return replies.next();
  };
  // Separate clients stand in for the web server and the cron workers: each has its own limiter.
  const clients = Array.from({ length: count }, () => createMetaClient(
    { ...testConfig(), metaReadCacheDirectory: directory }, { fetchImpl }
  ));
  return { clients, sent, replies };
}

const campaign = () => new URLSearchParams({ name: 'C' });

test('processes sharing the cache directory respect account and app cooldowns from each other', async (t) => {
  const { clients: [web, cron, unhide], sent, replies } = await sharedClients(t, 3);

  replies.next = () => Response.json({ error: { message: 'User request limit reached', code: 17 } }, {
    status: 400, headers: { 'retry-after': '120' }
  });
  await assert.rejects(web.createCampaign('token', 'act_1', campaign()), { name: 'MetaThrottleError' });

  replies.next = () => Response.json({ id: 'ok' }, { headers: { 'x-app-usage': JSON.stringify({ call_count: 5 }) } });
  sent.length = 0;
  await assert.rejects(cron.createCampaign('token', 'act_1', campaign()), { name: 'MetaThrottleError' });
  assert.equal(await cron.createCampaign('token', 'act_2', campaign()), 'ok', 'another account is not paused');
  await assert.rejects(cron.createCampaign('token', 'act_1', campaign()), { name: 'MetaThrottleError' },
    'a low-usage response must not clear a cooldown that is still active');
  assert.deepEqual(sent, ['/v25.0/act_2/campaigns']);

  replies.next = () => Response.json({ error: { message: 'Application request limit reached', code: 4 } }, {
    status: 400, headers: { 'retry-after': '120' }
  });
  await assert.rejects(unhide.readModerationPost('page-token', '1_2'), { name: 'MetaThrottleError' });
  sent.length = 0;
  await assert.rejects(cron.createCampaign('token', 'act_2', campaign()), { name: 'MetaThrottleError' });
  await assert.rejects(cron.getAdPublication('token', 'ad-1'), { name: 'MetaThrottleError' });
  assert.deepEqual(sent, [], 'an app-wide limit pauses every process before it sends');
});

test('a high-usage pause seen by one process holds back the others', async (t) => {
  const { clients: [web, cron], sent, replies } = await sharedClients(t, 2);

  replies.next = () => Response.json({ id: 'ok' }, {
    headers: { 'x-ad-account-usage': JSON.stringify({ acc_id_util_pct: 96 }) }
  });
  assert.equal(await web.createCampaign('token', 'act_7', campaign()), 'ok');

  sent.length = 0;
  await assert.rejects(cron.createCampaign('token', 'act_7', campaign()), { name: 'MetaThrottleError' });
  replies.next = () => Response.json({ id: 'ok' });
  assert.equal(await cron.createCampaign('token', 'act_8', campaign()), 'ok');
  assert.deepEqual(sent, ['/v25.0/act_8/campaigns']);
});

test('maps Meta usage headers to the approved pacing policy', () => {
  assert.equal(parseUsageHeaders(new Headers({
    'x-app-usage': JSON.stringify({ call_count: 61, total_cputime: 10, total_time: 5 })
  })), 61);
  assert.deepEqual(policyForUsage(49), { concurrency: 3, delayMs: 0, pauseMs: 0 });
  assert.deepEqual(policyForUsage(50), { concurrency: 2, delayMs: 500, pauseMs: 0 });
  assert.deepEqual(policyForUsage(70), { concurrency: 1, delayMs: 2_000, pauseMs: 0 });
  assert.deepEqual(policyForUsage(85), { concurrency: 1, delayMs: 0, pauseMs: 30_000 });
  assert.deepEqual(policyForUsage(95), { concurrency: 1, delayMs: 0, pauseMs: 120_000 });
});

test('runs two requests at a time while usage is unknown', () => {
  assert.deepEqual(policyForUsage(null), { concurrency: 2, delayMs: 0, pauseMs: 0 });
  assert.equal(createMetaRateLimiter().status().concurrency, 2);
});

test('requires a 10 point drop before increasing concurrency', async () => {
  let now = 0;
  const limiter = createMetaRateLimiter({ now: () => now });
  limiter.observe(new Response(null, { headers: { 'x-app-usage': JSON.stringify({ call_count: 70 }) } }));
  assert.equal(limiter.status().concurrency, 1);
  now = 59_000;
  limiter.observe(new Response(null, { headers: { 'x-app-usage': JSON.stringify({ call_count: 69 }) } }));
  assert.equal(limiter.status().concurrency, 1);
  now = 60_000;
  limiter.observe(new Response(null, { headers: { 'x-app-usage': JSON.stringify({ call_count: 60 }) } }));
  assert.equal(limiter.status().concurrency, 2);
});

test('falls back to two requests at a time after stale headers', () => {
  let now = 0;
  const limiter = createMetaRateLimiter({ now: () => now });
  limiter.observe(new Response(null, { headers: { 'x-app-usage': JSON.stringify({ call_count: 10 }) } }));
  assert.equal(limiter.status().concurrency, 3);
  now = 10 * 60_000 + 1;
  assert.equal(limiter.status().concurrency, 2);
  assert.equal(limiter.status().stale, true);
});

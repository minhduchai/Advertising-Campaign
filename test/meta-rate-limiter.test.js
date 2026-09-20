import test from 'node:test';
import assert from 'node:assert/strict';
import { createMetaRateLimiter, parseUsageHeaders, policyForUsage } from '../src/meta-rate-limiter.js';

test('maps Meta usage headers to the approved pacing policy', () => {
  assert.equal(parseUsageHeaders(new Headers({
    'x-app-usage': JSON.stringify({ call_count: 61, total_cputime: 10, total_time: 5 })
  })), 61);
  assert.deepEqual(policyForUsage(49), { concurrency: 5, delayMs: 0, pauseMs: 0 });
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
  assert.equal(limiter.status().concurrency, 5);
  now = 10 * 60_000 + 1;
  assert.equal(limiter.status().concurrency, 2);
  assert.equal(limiter.status().stale, true);
});

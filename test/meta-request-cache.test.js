import test from 'node:test';
import assert from 'node:assert/strict';
import { createMetaRequestCache } from '../src/meta-request-cache.js';

test('invalidated in-flight reads cannot overwrite or remove their replacement', async () => {
  const cache = createMetaRequestCache();
  let finishOld;
  let finishNew;
  const old = cache.load('user:1:x', 1000, () => new Promise(resolve => { finishOld = resolve; }));
  await Promise.resolve();
  cache.invalidatePrefix('user:1:');
  const fresh = cache.load('user:1:x', 1000, () => new Promise(resolve => { finishNew = resolve; }));
  await Promise.resolve();
  finishOld('old');
  await old;
  assert.equal(cache.peek('user:1:x'), undefined);
  const shared = cache.load('user:1:x', 1000, () => assert.fail('duplicate request'));
  finishNew('new');
  assert.deepEqual(await Promise.all([fresh, shared]), ['new', 'new']);
  assert.equal(cache.peek('user:1:x'), 'new');
});

test('caches successful Meta responses until TTL expires', async () => {
  let currentTime = 1_000;
  let calls = 0;
  const cache = createMetaRequestCache({ now: () => currentTime });
  const loader = async () => ({ calls: ++calls });

  assert.deepEqual(await cache.load('user:1:resources', 500, loader), { calls: 1 });
  assert.deepEqual(await cache.load('user:1:resources', 500, loader), { calls: 1 });
  currentTime = 1_501;
  assert.deepEqual(await cache.load('user:1:resources', 500, loader), { calls: 2 });
});

test('deduplicates concurrent Meta requests and does not cache failures', async () => {
  let calls = 0;
  const cache = createMetaRequestCache();
  const loader = async () => {
    calls += 1;
    await new Promise((resolve) => setTimeout(resolve, 5));
    return calls;
  };

  assert.deepEqual(await Promise.all([
    cache.load('same', 1_000, loader),
    cache.load('same', 1_000, loader)
  ]), [1, 1]);

  await assert.rejects(cache.load('failed', 1_000, async () => { throw new Error('Meta failed'); }));
  assert.equal(await cache.load('failed', 1_000, async () => 2), 2);
});

test('invalidates all cached entries for a connected Meta user', async () => {
  const cache = createMetaRequestCache();
  let calls = 0;
  const loader = async () => ++calls;
  await cache.load('user:1:resources', 10_000, loader);
  await cache.load('user:1:account:act_1', 10_000, loader);
  cache.invalidatePrefix('user:1:');
  assert.equal(await cache.load('user:1:resources', 10_000, loader), 3);
});

test('prunes expired entries and caps the cache size', async () => {
  let currentTime = 1_000;
  let calls = 0;
  const cache = createMetaRequestCache({ now: () => currentTime, maxEntries: 2 });
  const load = (key, ttl = 10_000) => cache.load(key, ttl, async () => ++calls);

  await load('first');
  await load('second');
  await load('third');
  assert.equal(await load('first'), 4);

  currentTime = 20_000;
  assert.equal(await load('third'), 5);
});

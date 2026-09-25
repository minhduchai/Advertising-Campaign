import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, writeFile, utimes } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMetaReadCache } from '../src/meta-read-cache.js';
import { createMetaClient } from '../src/meta-client.js';
import { testConfig } from './helpers.js';

async function directoryFor(t) {
  const directory = await mkdtemp(join(tmpdir(), 'meta-cache-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

test('89 seeding reads across worker instances reuse two paginated resources, isolated by token and Page', async t => {
  const directory = await directoryFor(t);
  const config = { ...testConfig(), metaReadCacheDirectory: directory };
  let calls = 0;
  const fetchImpl = async url => {
    calls++;
    if (String(url).includes('/permissions')) return Response.json({ data: [
      { permission: 'pages_manage_engagement', status: 'granted' },
      { permission: 'pages_manage_posts', status: 'granted' }
    ] });
    if (String(url).includes('after=next')) return Response.json({ data: [{ id: '2', access_token: 'page-secret-2' }] });
    return Response.json({ data: [{ id: '1', access_token: 'page-secret-1' }],
      paging: { next: 'https://graph.facebook.com/v25.0/me/accounts?after=next' } });
  };
  const first = createMetaClient(config, { fetchImpl });
  const second = createMetaClient(config, { fetchImpl });
  await Promise.all(Array.from({ length: 89 }, async (_, i) => {
    const pageId = i % 2 ? '1' : '2';
    const result = await (i % 2 ? first : second).getPageEngagementContext('user-secret', [pageId]);
    assert.equal(result.permissionGranted, true);
    assert.deepEqual([...result.pages.keys()], [pageId]);
    assert.equal(result.pages.get(pageId).accessToken, `page-secret-${pageId}`);
  }));
  assert.equal(calls, 3, 'one permissions request and two accounts pages total');
  const restarted = createMetaClient(config, { fetchImpl });
  await restarted.getPagePublishingContext('user-secret', ['1']);
  await restarted.getPermissionStatus('user-secret', ['pages_manage_engagement']);
  assert.equal(calls, 3);
  await restarted.getPageEngagementContext('different-user-secret', ['2']);
  assert.equal(calls, 6);
  for (const file of await readdir(directory)) {
    assert.match(file, /^[a-f0-9]{64}\.json$/);
    assert.doesNotMatch(await readFile(join(directory, file), 'utf8'), /user-secret|page-secret/);
  }
});

test('disk hits do not extend expiry, mutations do not leak, and failed refreshes can retry', async t => {
  const directory = await directoryFor(t);
  let time = 1000;
  let calls = 0;
  const options = { directory, encryptionKey: Buffer.alloc(32, 7), now: () => time };
  const first = createMetaReadCache(options);
  const loader = async () => ({ calls: ++calls });
  const initial = await first.load('key', 1000, loader);
  initial.calls = 999;
  assert.equal((await first.load('key', 1000, loader)).calls, 1);
  time = 1900;
  const restarted = createMetaReadCache(options);
  assert.equal((await restarted.load('key', 1000, loader)).calls, 1);
  time = 2001;
  assert.equal((await restarted.load('key', 1000, loader)).calls, 2);
  await assert.rejects(first.load('failure', 1000, async () => { throw new Error('Meta failed'); }), /Meta failed/);
  assert.equal(await restarted.load('failure', 1000, async () => 'recovered'), 'recovered');
  assert.equal((await readdir(directory)).some(name => /\.lock$|\.tmp$/.test(name)), false);
});

test('writes and video polling are never cached', async () => {
  let calls = 0;
  const client = createMetaClient(testConfig(), { fetchImpl: async () => {
    calls++;
    return Response.json({ id: 'created', status: { video_status: 'processing' } });
  } });
  await client.getVideoStatus('token', 'video');
  await client.getVideoStatus('token', 'video');
  await client.createPageComment('page-token', 'post', { message: 'one' });
  await client.createPageComment('page-token', 'post', { message: 'two' });
  assert.equal(calls, 4);
});

test('recovers an abandoned worker lock and an unreadable encrypted entry', async t => {
  const directory = await directoryFor(t);
  const key = createHash('sha256').update('abandoned').digest('hex');
  const path = join(directory, `${key}.json`);
  await writeFile(path, 'broken cache');
  await writeFile(`${path}.lock`, '');
  const old = new Date(Date.now() - 180_000);
  await utimes(`${path}.lock`, old, old);
  const cache = createMetaReadCache({ directory, encryptionKey: Buffer.alloc(32, 7) });
  assert.equal(await cache.load('abandoned', 1000, async () => 'fresh'), 'fresh');
  assert.deepEqual(await readdir(directory), [`${key}.json`]);
});

test('never saves partial account pagination after a Meta failure', async t => {
  const directory = await directoryFor(t);
  let fail = true;
  let accountReads = 0;
  const client = createMetaClient({ ...testConfig(), metaReadCacheDirectory: directory }, {
    fetchImpl: async url => {
      if (String(url).includes('/permissions')) return Response.json({ data: [] });
      if (String(url).includes('after=next')) {
        if (fail) throw new Error('network down');
        return Response.json({ data: [{ id: '2', access_token: 'secret-2' }] });
      }
      accountReads++;
      return Response.json({ data: [{ id: '1' }],
        paging: { next: 'https://graph.facebook.com/v25.0/me/accounts?after=next' } });
    }
  });
  await assert.rejects(client.getPageEngagementContext('token', ['2']), /network down/);
  fail = false;
  const result = await client.getPageEngagementContext('token', ['2']);
  assert.equal(accountReads, 2);
  assert.equal(result.pages.get('2').accessToken, 'secret-2');
});

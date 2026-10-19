import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, writeFile, utimes } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMetaReadCache } from '../src/meta-read-cache.js';
import { createMetaClient } from '../src/meta-client.js';
import { testConfig } from './helpers.js';
import { decryptToken, encryptToken } from '../src/crypto.js';

async function directoryFor(t) {
  const directory = await mkdtemp(join(tmpdir(), 'meta-cache-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

test('Page permalink permission denial is shared across posts and workers but isolated by token and Page', async t => {
  const config = { ...testConfig(), metaReadCacheDirectory: await directoryFor(t) };
  let reads = 0;
  const fetchImpl = async input => {
    const path = new URL(input).pathname;
    if (path.includes('/ad-')) return Response.json({ creative: { object_story_id: `${path.endsWith('other') ? '222' : '111'}_${path.match(/ad-(\d+)/)?.[1] ?? '900'}` } });
    if (!path.includes('_')) return Response.json({});
    reads++;
    return Response.json({ error: { code: 10, message: 'pages_read_engagement permission required' } }, { status: 400 });
  };
  const one = createMetaClient(config, { fetchImpl });
  const two = createMetaClient(config, { fetchImpl });
  for (let i = 1; i <= 5; i++) {
    const publication = await (i % 2 ? one : two).getAdPublication('token-one', `ad-${i}`);
    assert.equal(publication.permalinkUrl, `https://www.facebook.com/111/posts/${i}`);
  }
  assert.equal(reads, 1);
  await two.getAdPublication('token-two', 'ad-6');
  await two.getAdPublication('token-one', 'ad-other');
  assert.equal(reads, 3);
  const key = createHash('sha256').update(JSON.stringify(['post-permalink-access', 'https://graph.facebook.com/v25.0', 'token-one', '111'])).digest('hex');
  const path = join(config.metaReadCacheDirectory, `${key}.json`);
  const expired = JSON.parse(decryptToken(await readFile(path, 'utf8'), config.tokenEncryptionKey));
  expired.expiresAt = Date.now() - 1;
  await writeFile(path, encryptToken(JSON.stringify(expired), config.tokenEncryptionKey));
  await createMetaClient(config, { fetchImpl }).getAdPublication('token-one', 'ad-10');
  assert.equal(reads, 4, 'permissions are probed again after expiry');
});

test('successful permission probe never substitutes another Posts permalink', async t => {
  const config = { ...testConfig(), metaReadCacheDirectory: await directoryFor(t) };
  let reads = 0;
  const client = createMetaClient(config, { fetchImpl: async input => {
    const path = new URL(input).pathname;
    if (path.includes('/ad-')) return Response.json({ creative: { object_story_id: `111_${path.endsWith('ad-1') ? '1' : '2'}` } });
    if (new URL(input).searchParams.get('fields') === 'access_token') return Response.json({});
    reads++;
    return Response.json({ permalink_url: `https://www.facebook.com/posts/${path.split('_').at(-1)}` });
  } });
  assert.equal((await client.getAdPublication('token', 'ad-1')).permalinkUrl, 'https://www.facebook.com/posts/1');
  assert.equal((await client.getAdPublication('token', 'ad-2')).permalinkUrl, 'https://www.facebook.com/posts/2');
  assert.equal(reads, 2);
});

test('recovers permalink reads with a Page token and reuses it for sibling posts', async t => {
  const config = { ...testConfig(), metaReadCacheDirectory: await directoryFor(t) };
  let denied = 0, tokenReads = 0;
  const fetchImpl = async (input, options) => {
    const url = new URL(input), path = url.pathname;
    if (path.includes('/ad-')) return Response.json({ creative: { object_story_id: `111_${path.endsWith('ad-1') ? '1' : '2'}` } });
    if (url.searchParams.get('fields') === 'access_token') { tokenReads++; return Response.json({ access_token: 'page-secret' }); }
    if (options.headers.authorization !== 'Bearer page-secret') {
      denied++; return Response.json({ error: { code: 10, message: 'Page permission required' } }, { status: 400 });
    }
    return Response.json({ permalink_url: `https://www.facebook.com/reel/${path.split('_').at(-1)}` });
  };
  const first = createMetaClient(config, { fetchImpl }), second = createMetaClient(config, { fetchImpl });
  assert.equal((await first.getAdPublication('token', 'ad-1')).permalinkUrl, 'https://www.facebook.com/reel/1');
  assert.equal((await second.getAdPublication('token', 'ad-2')).permalinkUrl, 'https://www.facebook.com/reel/2');
  assert.equal(denied, 0);
  assert.equal(tokenReads, 1);
  for (const file of await readdir(config.metaReadCacheDirectory)) {
    assert.doesNotMatch(await readFile(join(config.metaReadCacheDirectory, file), 'utf8'), /page-secret/);
  }
});

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

test('writes and pending video polling are never cached', async () => {
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

test('ready videos without a thumbnail are refreshed until the thumbnail arrives', async t => {
  const directory = await directoryFor(t);
  const config = { ...testConfig(), metaReadCacheDirectory: directory };
  let calls = 0;
  const fetchImpl = async () => Response.json({ status: { video_status: 'ready' },
    thumbnails: { data: ++calls === 1 ? [] : [{ uri: 'https://example.com/thumb' }] } });
  const client = createMetaClient(config, { fetchImpl });
  assert.equal((await client.getVideoStatus('token', 'video')).thumbnail, undefined);
  assert.deepEqual(await readdir(directory), []);
  assert.equal((await client.getVideoStatus('token', 'video')).thumbnail.imageUrl, 'https://example.com/thumb');
  await createMetaClient(config, { fetchImpl }).getVideoStatus('token', 'video');
  assert.equal(calls, 2);
});

test('ready videos survive client restart, but pending and failed videos never persist', async t => {
  const directory = await directoryFor(t);
  const config = { ...testConfig(), metaReadCacheDirectory: directory };
  let calls = 0;
  let status = 'processing';
  const fetchImpl = async () => {
    calls++;
    return Response.json({ status: { video_status: status }, thumbnails: { data: [{ uri: 'https://example.com/thumb' }] } });
  };
  const client = createMetaClient(config, { fetchImpl });
  await client.getVideoStatus('token-a', 'video');
  await client.getVideoStatus('token-a', 'video');
  assert.equal(calls, 2);
  assert.deepEqual(await readdir(directory), []);
  status = 'error';
  await client.getVideoStatus('token-a', 'video');
  assert.deepEqual(await readdir(directory), []);
  status = 'ready';
  await client.getVideoStatus('token-a', 'video');
  const restarted = createMetaClient(config, { fetchImpl });
  assert.equal((await restarted.getVideoStatus('token-a', 'video')).thumbnail.imageUrl, 'https://example.com/thumb');
  assert.equal(calls, 4);
  await restarted.getVideoStatus('token-b', 'video');
  assert.equal(calls, 5, 'different tokens must not share cached data');
});

test('selective cache expires ready values and never retains a non-cacheable refresh', async t => {
  const directory = await directoryFor(t);
  let now = 0;
  const options = { directory, encryptionKey: Buffer.alloc(32, 7), now: () => now };
  const cache = createMetaReadCache(options);
  let calls = 0;
  let ready = true;
  const read = client => client.load('video', 1000, async () => ({ ready, calls: ++calls }), { shouldCache: value => value.ready });
  await read(cache);
  now = 1001;
  ready = false;
  await read(cache);
  await read(cache);
  await read(createMetaReadCache(options));
  assert.equal(calls, 4);
});

test('Business discovery uses 15 minutes without extending permission or token cache', async t => {
  const directory = await directoryFor(t);
  const config = { ...testConfig(), metaReadCacheDirectory: directory };
  const client = createMetaClient(config, { fetchImpl: async url => Response.json({
    data: String(url).includes('/businesses') ? [{ id: 'business' }] : []
  }) });
  const start = Date.now();
  await client.listGlobalPageCatalog('token');
  await client.getPageEngagementContext('token', ['page']);
  const durations = await Promise.all((await readdir(directory)).map(async file => {
    const entry = JSON.parse(decryptToken(await readFile(join(directory, file), 'utf8'), config.tokenEncryptionKey));
    return Math.round((entry.expiresAt - start) / 60000);
  }));
  assert.equal(durations.filter(minutes => minutes === 15).length, 3);
  assert.equal(durations.filter(minutes => minutes === 5).length, 3);
});

test('different Ads sharing a Post reuse its actual permalink across workers', async t => {
  const directory = await directoryFor(t);
  const config = { ...testConfig(), metaReadCacheDirectory: directory };
  let postReads = 0;
  let adReads = 0;
  const fetchImpl = async url => {
    if (new URL(url).searchParams.get('fields') === 'access_token') return Response.json({ access_token: 'page-token' });
    if (new URL(url).searchParams.get('fields') === 'permalink_url') {
      postReads++;
      return Response.json({ permalink_url: 'https://www.facebook.com/reel/123' });
    }
    adReads++;
    return Response.json({ creative: { effective_object_story_id: '1_123' } });
  };
  for (const id of ['ad-1', 'ad-2']) {
    const result = await createMetaClient(config, { fetchImpl }).getAdPublication('token', id);
    assert.equal(result.permalinkUrl, 'https://www.facebook.com/reel/123');
  }
  assert.equal(adReads, 2, 'do not guess different Ads share the same Post');
  assert.equal(postReads, 1);
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

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createLazyVercelHandler, createVercelHandler } from '../src/vercel-runtime.js';
import { signSession } from '../src/crypto.js';
import { invoke, productionEnvironment } from './helpers.js';

test('lazy initialization returns sanitized JSON on boot failure and retries on the next request', async () => {
  let attempts = 0;
  const handler = createLazyVercelHandler(() => {
    attempts += 1;
    if (attempts === 1) throw new Error('Missing private configuration');
    return (_request, response) => { response.writeHead(200); response.end('ready'); };
  });
  assert.equal(attempts, 0);
  const failed = await invoke(handler, '/health');
  assert.equal(failed.status, 503);
  assert.doesNotMatch(JSON.stringify(failed.body), /private configuration/);
  assert.equal((await invoke(handler, '/health')).body, 'ready');
  assert.equal((await invoke(handler, '/health')).body, 'ready');
  assert.equal(attempts, 2);
});

test('composes production dependencies exactly once', async () => {
  const calls = [];
  const fakeDatabase = {};
  const fakeMediaStore = {};
  const fakeMetaClient = {};
  const handler = createVercelHandler(productionEnvironment, {
    createDatabase: (config) => (calls.push(['database', config.databaseUrl]), fakeDatabase),
    createMediaStore: ({ config }) => (calls.push(['media', config.mediaUploadMode]), fakeMediaStore),
    createMetaClient: () => fakeMetaClient
  });

  const response = await invoke(handler, '/api/health');

  assert.deepEqual(calls, [
    ['database', 'postgresql://example.invalid/app'],
    ['media', 'vercel-blob']
  ]);
  assert.equal(response.status, 200);
  assert.deepEqual(response.body, { ok: true });
});

test('serves Blob completion routes through the Vercel composition', async () => {
  let completion;
  const handler = createVercelHandler(productionEnvironment, {
    createDatabase: () => ({
      createSession: () => ({ id: 'new-session' }),
      getSession: () => ({ id: 'session-user', metaUserId: 'meta-user-1' })
    }),
    createMediaStore: () => ({
      completeUpload: async (value) => {
        completion = value;
        return { id: value.input.mediaId, mimeType: value.input.mimeType };
      }
    }),
    createMetaClient: () => ({})
  });
  const input = {
    mediaId: 'media-1',
    name: 'creative.jpg',
    mimeType: 'image/jpeg',
    size: 11,
    blob: { url: 'https://example.test/blob', pathname: 'meta-ads/media-1/creative.jpg' }
  };
  const session = signSession('session-user', productionEnvironment.SESSION_SECRET);

  const response = await invoke(handler, '/api/media/complete', {
    method: 'POST',
    headers: {
      cookie: `meta_ads_session=${encodeURIComponent(session)}`,
      'content-type': 'application/json'
    },
    body: JSON.stringify(input)
  });

  assert.equal(response.status, 201);
  assert.deepEqual(response.body, { id: 'media-1', kind: 'image' });
  assert.deepEqual(completion, { ownerMetaUserId: 'meta-user-1', input });
});

test('restores a nested API pathname forwarded by the Vercel router', async () => {
  const oauthStates = [];
  const handler = createVercelHandler(productionEnvironment, {
    createDatabase: () => ({
      createSession: async () => ({ id: 'session-user' }),
      createOAuthState: async (sessionId, state) => oauthStates.push({ sessionId, state })
    }),
    createMediaStore: () => ({}),
    createMetaClient: () => ({
      createAuthorizationUrl: (state) => `https://www.facebook.com/dialog/oauth?state=${state}`
    })
  });

  const response = await invoke(handler, '/api/router?__path=auth/meta/start');

  assert.equal(response.status, 302);
  assert.match(response.location, /^https:\/\/www\.facebook\.com\/dialog\/oauth\?state=/);
  assert.equal(oauthStates.length, 1);
});

test('routes every API depth through one stable Vercel function', async () => {
  const config = JSON.parse(await readFile(new URL('../vercel.json', import.meta.url), 'utf8'));

  assert.deepEqual(config.functions['api/router.js'], { maxDuration: 300 });
  assert.ok(config.rewrites.some(({ source, destination }) => (
    source === '/api/:path*' && destination === '/api/router?__path=:path*'
  )));
});

test('excludes local runtime data from Vercel deployments', async () => {
  const ignoreRules = (await readFile(new URL('../.vercelignore', import.meta.url), 'utf8'))
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'));

  assert.ok(ignoreRules.includes('data/'));
});

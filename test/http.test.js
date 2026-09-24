import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { createServer } from '../src/server.js';
import { readJson } from '../src/http.js';
import { request, testConfig } from './helpers.js';
import { signSession } from '../src/crypto.js';

test('rejects malformed JSON as a client error', async () => {
  await assert.rejects(readJson(Readable.from(['{"broken":'])), (error) => (
    error.statusCode === 400 && error.expose === true
  ));
});

test('ignores malformed unrelated cookies while preserving the signed session', async (context) => {
  const config = testConfig();
  const server = createServer({
    config,
    metaClient: {},
    db: {
      createSession: () => { throw new Error('Must preserve the existing session'); },
      getSession: (id) => ({ id, metaUserId: null })
    }
  });
  context.after(() => server.close());
  const cookie = encodeURIComponent(signSession('existing-session', config.sessionSecret));
  const response = await request(server, '/', {
    headers: { cookie: `unrelated=%ZZ; meta_ads_session=${cookie}` }
  });
  assert.equal(response.status, 200);
  assert.match(response.sessionCookie, /meta_ads_session=existing-session\./);
});

test('replaces malformed session cookies with an anonymous session', async (context) => {
  const server = createServer({
    config: testConfig(), metaClient: {},
    db: { createSession: () => ({ id: 'replacement' }), getSession: () => null }
  });
  context.after(() => server.close());
  const response = await request(server, '/', { headers: { cookie: 'meta_ads_session=%ZZ' } });
  assert.equal(response.status, 200);
  assert.match(response.sessionCookie, /meta_ads_session=replacement\./);
});

test('returns a JSON not-found response for an unknown API route', async (context) => {
  const server = createServer({
    config: testConfig(),
    metaClient: {},
    db: {
      createSession: () => ({ id: 'session-not-found' }),
      getSession: () => null
    }
  });
  context.after(() => server.close());

  const response = await request(server, '/api/unknown');

  assert.equal(response.status, 404);
  assert.deepEqual(response.body, { error: 'Not found' });
});

test('limits JSON request bodies by default', async () => {
  const requestBody = Readable.from([Buffer.alloc(5 * 1024 * 1024 + 1, 32)]);
  await assert.rejects(readJson(requestBody), (error) => (
    error.statusCode === 413 && error.message === 'Request body is too large'
  ));
});

test('anonymous draft validation has a smaller request limit', async (context) => {
  const server = createServer({ config: testConfig(), metaClient: {},
    db: { createSession: () => ({ id: 'anonymous' }), getSession: () => null } });
  context.after(() => server.close());
  const validSize = await request(server, '/api/drafts/validate', {
    method: 'POST', body: JSON.stringify({ campaigns: [] })
  });
  assert.equal(validSize.status, 422);
  const tooLarge = await request(server, '/api/drafts/validate', {
    method: 'POST', body: JSON.stringify({ padding: 'a'.repeat(256 * 1024) })
  });
  assert.equal(tooLarge.status, 413);
});

test('creates a signed anonymous session before serving the application', async (context) => {
  const db = {
    createSession() {
      return { id: 'session-created', metaUserId: null, metaUserName: null };
    },
    getSession() {
      return null;
    }
  };
  const server = createServer({ config: testConfig(), metaClient: {}, db });
  context.after(() => server.close());

  const response = await request(server, '/');

  assert.match(response.sessionCookie, /meta_ads_session=session-created\./);
  assert.match(response.sessionCookie, /HttpOnly/);
  assert.match(response.sessionCookie, /Max-Age=2592000/);
  assert.match(response.sessionCookie, /Expires=[^;]+GMT/);
  assert.match(response.sessionCookie, /SameSite=Lax/);
  assert.doesNotMatch(response.body, /id="run-results"[^>]*aria-live/);
});

test('requires an explicitly injected database', () => {
  assert.throws(
    () => createServer({ config: testConfig(), metaClient: {} }),
    /createServer requires a database/
  );
});

test('rejects hosted media mode in the local-only server', () => {
  assert.throws(
    () => createServer({
      config: { ...testConfig(), mediaUploadMode: 'r2' },
      metaClient: {},
      db: {},
      mediaStore: {}
    }),
    /Local server only supports local media uploads/
  );
});

test('does not create competing sessions for static assets or health checks', async (context) => {
  let createdSessions = 0;
  const server = createServer({
    config: testConfig(),
    metaClient: {},
    db: {
      createSession: () => {
        createdSessions += 1;
        return { id: `session-${createdSessions}`, metaUserId: null };
      },
      getSession: () => null
    }
  });
  context.after(() => server.close());

  const [css, launchCss, module, health] = await Promise.all([
    request(server, '/app.css'),
    request(server, '/launch-control.css'),
    request(server, '/workspace.js'),
    request(server, '/health')
  ]);

  assert.equal(createdSessions, 0);
  assert.equal(css.sessionCookie, null);
  assert.equal(launchCss.sessionCookie, null);
  assert.equal(launchCss.status, 200);
  assert.equal(module.sessionCookie, null);
  assert.equal(health.sessionCookie, null);
  assert.deepEqual(health.body, { ok: true });
});

test('serves brand images as image bytes without requiring a session', async (context) => {
  const server = createServer({ config: testConfig(), metaClient: {}, db: {
    createSession: () => { throw new Error('Image requests must not create sessions'); }
  } });
  context.after(() => server.close());
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  for (const [path, type, signature] of [
    ['/assets/lg-clinic-logo-128.png', 'image/png', '89504e470d0a1a0a'],
    ['/assets/lg-clinic-logo.png', 'image/png', '89504e470d0a1a0a'],
    ['/favicon.ico?v=lg-2', 'image/x-icon', '00000100']
  ]) {
    const response = await fetch(`http://127.0.0.1:${server.address().port}${path}`);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type'), type);
    assert.equal(response.headers.get('set-cookie'), null);
    const content = Buffer.from(await response.arrayBuffer());
    assert.equal(content.subarray(0, signature.length / 2).toString('hex'), signature);
  }
});

test('serves every browser ES module used by the workspace', async (context) => {
  const server = createServer({
    config: testConfig(),
    metaClient: {},
    db: {
      createSession: () => ({ id: 'session-static', metaUserId: null }),
      getSession: () => null
    }
  });
  context.after(() => server.close());

  const modules = await Promise.all([
    request(server, '/app.js'),
    request(server, '/state.js'),
    request(server, '/api.js'),
    request(server, '/api-client.js'),
    request(server, '/run-progress.js'),
    request(server, '/activity-history.js'),
    request(server, '/audience.js'),
    request(server, '/conversation.js'),
    request(server, '/seeding.js'),
    request(server, '/seeding-runner.js'),
    request(server, '/local-demo-resources.js'),
    request(server, '/workspace.js'),
    request(server, '/workspace-view.js')
  ]);

  assert.deepEqual(modules.map((response) => response.status), [200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200]);
  assert.ok(modules.every((response) => typeof response.body === 'string'));
});

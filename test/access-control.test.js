import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createAccessControl } from '../src/access-control.js';
import { createServer } from '../src/server.js';
import { signSession } from '../src/crypto.js';
import { createSqliteDatabase } from '../src/db.js';
import { createPostgresDatabase } from '../src/postgres-db.js';
import { request, testConfig } from './helpers.js';

test('access gate protects API and old sessions; admin grants and revokes survive a restart', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'access-test-'));
  const config = { ...testConfig(), accessAdminMetaUserIds: ['123'], accessControlFile: join(directory, 'users.json') };
  let called = 0;
  const server = createServer({ config, metaClient: {}, db: {
    getSession: id => ({ id, metaUserId: id === 'anonymous' ? null : id }),
    createSession: () => ({ id: 'anonymous' }),
    listAccessProfiles: () => [{ id: '456', name: 'Mỹ Thi', lastSeen: 1 }],
    getConnection: () => { called++; return { metaUserName: 'Test' }; }
  } });
  t.after(() => { server.close(); rmSync(directory, { recursive: true, force: true }); });
  const headers = id => ({ cookie: `meta_ads_session=${encodeURIComponent(signSession(id, config.sessionSecret))}` });
  assert.equal((await request(server, '/', { headers: headers('anonymous') })).status, 200);
  for (const path of ['/', '/api/auth/session', '/api/resources', '/api/runs', '/admin/access']) {
    const denied = await request(server, path, { headers: headers('456') });
    assert.equal(denied.status, 404, path);
    assert.match(denied.body, /404 — Không tìm thấy trang/);
  }
  assert.equal(called, 0);
  assert.equal((await request(server, '/admin/access', { headers: headers('123') })).status, 200);
  const catalog = await request(server, '/api/admin/access', { headers: headers('123') });
  assert.deepEqual(catalog.body.profiles, [{ id: '456', name: 'Mỹ Thi', lastSeen: 1 }]);
  const change = (id, allowed, extra = {}) => request(server, '/api/admin/access', {
    method: 'POST', headers: { ...headers('123'), 'content-type': 'application/json', 'x-access-management': '1', ...extra },
    body: JSON.stringify({ metaUserId: id, allowed })
  });
  assert.equal((await change('456', true, { origin: 'https://evil.example' })).status, 404);
  assert.equal((await change('456', true, { 'x-access-management': '' })).status, 404);
  assert.equal((await change('100085913387852', true)).status, 400, 'public Facebook profile ID must not be accepted as a known app identity');
  assert.equal((await change('456', true)).status, 200);
  const annotated = await request(server, '/api/admin/access', { method: 'POST', headers: {
    ...headers('123'), 'content-type': 'application/json', 'x-access-management': '1'
  }, body: JSON.stringify({ metaUserId: '456', allowed: true, label: 'Mỹ Thi — Marketing', facebookUrl: '100085913387852' }) });
  assert.equal(annotated.status, 200);
  const savedCatalog = await request(server, '/api/admin/access', { headers: headers('123') });
  assert.equal(savedCatalog.body.users.find(user => user.id === '456').label, 'Mỹ Thi — Marketing');
  assert.equal(savedCatalog.body.users.find(user => user.id === '456').facebookUrl, 'https://www.facebook.com/profile.php?id=100085913387852');
  assert.equal(createAccessControl(config).allows('456'), true);
  assert.equal((await request(server, '/api/auth/session', { headers: headers('456') })).status, 200);
  assert.equal((await request(server, '/api/admin/access', { headers: headers('456') })).status, 404);
  assert.equal((await change('123', false)).status, 400);
  assert.equal((await change('456', false)).status, 200);
  assert.equal((await request(server, '/api/auth/session', { headers: headers('456') })).status, 404);
  assert.equal(createAccessControl(config).allows('456'), false);
  writeFileSync(config.accessControlFile, '{broken');
  assert.throws(() => createAccessControl(config).allows('456'));
});

test('access profiles include unapproved OAuth identities, grouped without cookies or tokens', () => {
  const db = createSqliteDatabase(':memory:');
  const first = db.createSession();
  const second = db.createSession();
  db.createSession();
  db.attachMetaUser(first.id, { id: '456', name: 'Mỹ Thi' });
  db.attachMetaUser(second.id, { id: '456', name: 'Mỹ Thi' });
  const profiles = db.listAccessProfiles();
  assert.equal(profiles.length, 1);
  assert.deepEqual(Object.keys(profiles[0]).sort(), ['id', 'lastSeen', 'name']);
  assert.equal(profiles[0].id, '456');
  assert.equal(profiles[0].name, 'Mỹ Thi');
});

test('Postgres exposes only profile IDs, names and numeric timestamps to the access picker', async () => {
  const db = createPostgresDatabase(async () => [{ id: '456', name: 'Mỹ Thi', last_seen: '1792200487534' }]);
  assert.deepEqual(await db.listAccessProfiles(), [{ id: '456', name: 'Mỹ Thi', lastSeen: 1792200487534 }]);
});

test('OAuth denies unapproved profile without storing its access token', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'access-oauth-'));
  const config = { ...testConfig(), accessAdminMetaUserIds: ['123'], accessControlFile: join(directory, 'users.json') };
  let attached;
  const server = createServer({ config, db: {
    createSession: () => ({ id: 'anon' }),
    consumeOAuthState: () => ({ sessionId: 'anon' }),
    attachMetaUser: (id, profile) => { attached = profile; },
    upsertConnection: () => assert.fail('Unapproved token must not be stored')
  }, metaClient: { exchangeCode: () => ({ accessToken: 'private-token' }), getProfile: () => ({ id: '456', name: 'User' }) } });
  t.after(() => { server.close(); rmSync(directory, { recursive: true, force: true }); });
  const result = await request(server, '/api/auth/meta/callback?code=test&state=test');
  assert.equal(result.status, 404);
  assert.equal(attached.id, '456');
  assert.ok(!result.body.includes('private-token'));
});

test('recognition labels and Facebook links persist without replacing the authenticated app ID', t => {
  const directory = mkdtempSync(join(tmpdir(), 'access-labels-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const config = { accessAdminMetaUserIds: ['123'], accessControlFile: join(directory, 'users.json') };
  const access = createAccessControl(config);
  access.update('456', true, { label: 'Mỹ Thi — Marketing', facebookUrl: '100085913387852' });
  const reloaded = createAccessControl(config);
  const user = reloaded.list().find(user => user.id === '456');
  assert.equal(user.label, 'Mỹ Thi — Marketing');
  assert.equal(user.facebookUrl, 'https://www.facebook.com/profile.php?id=100085913387852');
  assert.equal(reloaded.allows('456'), true);
  assert.equal(reloaded.allows('100085913387852'), false);
  reloaded.update('456', false);
  reloaded.update('456', true);
  assert.equal(reloaded.list().find(user => user.id === '456').label, user.label);
  assert.throws(() => access.update('456', true, { facebookUrl: 'https://facebook.com.evil.example/test' }));
  assert.throws(() => access.update('456', true, { facebookUrl: 'javascript:alert(1)' }));
  access.update('456', true, { label: '', facebookUrl: 'https://www.facebook.com/luu.uc.trong.344938' });
  assert.equal(access.list().find(user => user.id === '456').facebookUrl, 'https://www.facebook.com/luu.uc.trong.344938');
});

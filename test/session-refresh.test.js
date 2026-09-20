import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from '../src/server.js';
import { createSqliteDatabase } from '../src/db.js';
import { signSession, encryptToken } from '../src/crypto.js';
import { request, testConfig } from './helpers.js';

test('keeps the authenticated session across repeated refreshes and Meta outages', async (context) => {
  const config = testConfig();
  const db = createSqliteDatabase(':memory:');
  const session = db.createSession();
  db.attachMetaUser(session.id, { id: 'owner', name: 'Account' });
  db.upsertConnection({ metaUserId: 'owner', accessTokenCiphertext: encryptToken('private-token', config.tokenEncryptionKey) });
  const server = createServer({ config, db, metaClient: {
    listAdAccounts: async () => { throw new Error('Temporary Meta outage'); },
    listGlobalPageCatalog: async () => ({ pages: [], discovery: {} }),
    getPermissionStatus: async () => ({})
  } });
  context.after(() => { server.close(); db.close(); });
  let cookie = `meta_ads_session=${encodeURIComponent(signSession(session.id, config.sessionSecret))}`;
  for (let i = 0; i < 3; i++) {
    const result = await request(server, '/api/auth/session', { headers: { cookie } });
    assert.equal(result.status, 200);
    assert.deepEqual(result.body, { connected: true, metaUser: { id: 'owner', name: 'Account' } });
    assert.ok(!JSON.stringify(result.body).includes('private-token'));
    assert.match(result.sessionCookie, /Max-Age=2592000/);
    cookie = result.sessionCookie.split(';')[0];
  }
  const failed = await request(server, '/api/resources', { headers: { cookie } });
  assert.equal(failed.status, 500);
  const refreshed = await request(server, '/api/auth/session', { headers: { cookie } });
  assert.equal(refreshed.body.connected, true);
});

test('anonymous session check returns disconnected without consulting Meta', async (context) => {
  const server = createServer({ config: testConfig(), metaClient: {},
    db: { createSession: () => ({ id: 'anonymous' }), getSession: () => null } });
  context.after(() => server.close());
  const result = await request(server, '/api/auth/session');
  assert.deepEqual(result.body, { connected: false, metaUser: null });
});

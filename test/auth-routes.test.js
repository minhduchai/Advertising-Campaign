import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from '../src/server.js';
import { decryptToken, encryptToken, signSession } from '../src/crypto.js';
import { createSqliteDatabase } from '../src/db.js';
import { request, testConfig } from './helpers.js';

test('starts OAuth with a stored state tied to the current session', async (context) => {
  const states = [];
  const config = testConfig();
  const server = createServer({
    config,
    db: {
      createSession: () => ({ id: 'new-session' }),
      getSession: () => ({ id: 'session-user', metaUserId: null }),
      createOAuthState: (sessionId, state) => states.push({ sessionId, state })
    },
    metaClient: {
      createAuthorizationUrl: (state) => `https://www.facebook.com/dialog/oauth?state=${state}`
    }
  });
  context.after(() => server.close());

  const session = signSession('session-user', config.sessionSecret);
  const response = await request(server, '/api/auth/meta/start', {
    headers: { cookie: `meta_ads_session=${encodeURIComponent(session)}` }
  });

  assert.equal(response.status, 302);
  assert.match(response.location, /^https:\/\/www\.facebook\.com\/dialog\/oauth\?state=/);
  assert.equal(states.length, 1);
  assert.equal(states[0].sessionId, 'session-user');
});

test('disconnects the current Meta profile without deleting application data', async (context) => {
  const config = testConfig();
  const calls = [];
  const server = createServer({
    config,
    db: {
      createSession: () => ({ id: 'new-session' }),
      getSession: () => ({ id: 'session-user', metaUserId: 'meta-user-1', metaUserName: 'Minh' }),
      disconnectMetaUser: async (sessionId, metaUserId) => calls.push({ sessionId, metaUserId })
    },
    metaClient: {}
  });
  context.after(() => server.close());

  const session = signSession('session-user', config.sessionSecret);
  const response = await request(server, '/api/auth/meta/disconnect', {
    method: 'POST',
    headers: { cookie: `meta_ads_session=${encodeURIComponent(session)}` }
  });

  assert.equal(response.status, 200);
  assert.deepEqual(response.body, { connected: false });
  assert.deepEqual(calls, [{ sessionId: 'session-user', metaUserId: 'meta-user-1' }]);
});

test('disconnecting an already disconnected Meta session is idempotent', async (context) => {
  const config = testConfig();
  const server = createServer({
    config,
    db: {
      createSession: () => ({ id: 'new-session' }),
      getSession: () => ({ id: 'session-user', metaUserId: null })
    },
    metaClient: {}
  });
  context.after(() => server.close());

  const session = signSession('session-user', config.sessionSecret);
  const response = await request(server, '/api/auth/meta/disconnect', {
    method: 'POST',
    headers: { cookie: `meta_ads_session=${encodeURIComponent(session)}` }
  });

  assert.equal(response.status, 200);
  assert.deepEqual(response.body, { connected: false });
});

test('loads connection state and the shared Page catalog without returning the Meta token', async (context) => {
  const config = testConfig();
  const calls = [];
  const server = createServer({
    config,
    db: {
      createSession: () => ({ id: 'new-session' }),
      getSession: () => ({ id: 'session-user', metaUserId: 'meta-user-1', metaUserName: 'Minh' }),
      getConnection: () => ({
        metaUserId: 'meta-user-1',
        metaUserName: 'Minh',
        accessTokenCiphertext: encryptToken('EAAG-secret-token', config.tokenEncryptionKey)
      })
    },
    metaClient: {
      listAdAccounts: async (token) => {
        calls.push({ type: 'ad-accounts', token });
        return [{ id: 'act_1', name: 'Demo account', currency: 'VND' }];
      },
      listGlobalPageCatalog: async (token) => {
        calls.push({ type: 'global-pages', token });
        return {
          pages: [{
            id: 'page-1',
            name: 'LG Clinic',
            sources: ['MANAGED'],
            tasks: ['ADVERTISE'],
            canAdvertise: true,
            unavailableReason: null
          }],
          discovery: {
            requiresBusinessReconnect: false,
            warnings: [],
            counts: { total: 1, available: 1, unavailable: 0, promotable: 0, managed: 1, businessOwned: 0, businessClient: 0 }
          }
        };
      },
      getPermissionStatus: async (token) => {
        calls.push({ type: 'permissions', token });
        return { pages_manage_engagement: calls.filter(call => call.type === 'permissions').length === 1 };
      }
    }
  });
  context.after(() => server.close());

  const session = signSession('session-user', config.sessionSecret);
  const response = await request(server, '/api/resources', {
    headers: { cookie: `meta_ads_session=${encodeURIComponent(session)}` }
  });

  assert.deepEqual(response.body, {
    connected: true,
    metaUser: { id: 'meta-user-1', name: 'Minh' },
    mediaUploadMode: 'local',
    adAccounts: [{ id: 'act_1', name: 'Demo account', currency: 'VND' }],
    pages: [{
      id: 'page-1',
      name: 'LG Clinic',
      sources: ['MANAGED'],
      canAdvertise: true,
      unavailableReason: null
    }],
    pageDiscovery: {
      requiresBusinessReconnect: false,
      warnings: [],
      counts: { total: 1, available: 1, unavailable: 0, promotable: 0, managed: 1, businessOwned: 0, businessClient: 0 }
    },
    capabilities: { pagesManageEngagement: true, telegramNetworkUpload: false }
  });
  assert.deepEqual(calls.map(({ type }) => type).sort(), ['ad-accounts', 'global-pages', 'permissions']);
  assert.doesNotMatch(JSON.stringify(response.body), /EAAG-secret-token/);
  assert.doesNotMatch(JSON.stringify(response.body), /tasks/);
  const refreshed = await request(server, '/api/resources', {
    headers: { cookie: `meta_ads_session=${encodeURIComponent(session)}` }
  });
  assert.equal(refreshed.body.capabilities.pagesManageEngagement, false);
  assert.equal(calls.filter(call => call.type === 'ad-accounts').length, 1);
  assert.equal(calls.filter(call => call.type === 'global-pages').length, 1);
  assert.equal(calls.filter(call => call.type === 'permissions').length, 2);
});

test('returns account-scoped audiences without scanning Business Pages', async (context) => {
  const config = testConfig();
  const calls = [];
  const server = createServer({
    config,
    db: {
      createSession: () => ({ id: 'new-session' }),
      getSession: () => ({ id: 'session-user', metaUserId: 'meta-user-1' }),
      getConnection: () => ({
        accessTokenCiphertext: encryptToken('EAAG-secret-token', config.tokenEncryptionKey)
      })
    },
    metaClient: {
      listGlobalPageCatalog: async () => {
        throw new Error('Business Page catalog must not load for account resources');
      },
      listCustomAudiences: async (token, accountId) => {
        calls.push({ type: 'audiences', token, accountId });
        return [{ id: 'ca-1', name: 'Đã nhắn tin', subtype: 'ENGAGEMENT' }];
      },
      listSavedAudiences: async (token, accountId) => {
        calls.push({ type: 'saved-audiences', token, accountId });
        return [{ id: 'saved-1', name: 'Nữ 22-45', compatible: true, issues: [], content: {} }];
      }
    }
  });
  context.after(() => server.close());

  const session = signSession('session-user', config.sessionSecret);
  const response = await request(server, '/api/ad-account-resources?adAccountId=act_1', {
    headers: { cookie: `meta_ads_session=${encodeURIComponent(session)}` }
  });

  assert.equal(response.status, 200);
  assert.deepEqual(response.body, {
    customAudiences: [{ id: 'ca-1', name: 'Đã nhắn tin', subtype: 'ENGAGEMENT' }],
    savedAudiences: [{ id: 'saved-1', name: 'Nữ 22-45', compatible: true, issues: [], content: {} }],
    promotablePageIds: [],
    pageEligibilityKnown: false
  });
  assert.deepEqual(calls.map(({ type, accountId }) => ({ type, accountId })), [
    { type: 'audiences', accountId: 'act_1' },
    { type: 'saved-audiences', accountId: 'act_1' }
  ]);
  assert.doesNotMatch(JSON.stringify(response.body), /EAAG/);
  assert.doesNotMatch(JSON.stringify(response.body), /tasks/);
});

test('proxies valid targeting searches with the server-side token', async (context) => {
  const config = testConfig();
  let received;
  const server = createServer({
    config,
    db: {
      createSession: () => ({ id: 'new-session' }),
      getSession: () => ({ id: 'session-user', metaUserId: 'meta-user-1' }),
      getConnection: () => ({
        accessTokenCiphertext: encryptToken('EAAG-secret-token', config.tokenEncryptionKey)
      })
    },
    metaClient: {
      searchTargeting: async (token, input) => {
        received = { token, input };
        return [{ id: '6001', name: 'Skincare', path: [], targetingField: 'interests' }];
      }
    }
  });
  context.after(() => server.close());

  const session = signSession('session-user', config.sessionSecret);
  const response = await request(
    server,
    '/api/targeting-search?adAccountId=act_1&category=interest&query=skin',
    { headers: { cookie: `meta_ads_session=${encodeURIComponent(session)}` } }
  );

  assert.equal(response.status, 200);
  assert.deepEqual(response.body, {
    results: [{ id: '6001', name: 'Skincare', path: [], targetingField: 'interests' }]
  });
  assert.deepEqual(received.input, { category: 'interest', query: 'skin' });
  assert.equal(received.token, 'EAAG-secret-token');
});

test('proxies Vietnam region searches with the server-side token', async (context) => {
  const config = testConfig();
  let received;
  const server = createServer({
    config,
    db: {
      createSession: () => ({ id: 'new-session' }),
      getSession: () => ({ id: 'session-user', metaUserId: 'meta-user-1' }),
      getConnection: () => ({
        accessTokenCiphertext: encryptToken('EAAG-secret-token', config.tokenEncryptionKey)
      })
    },
    metaClient: {
      searchLocations: async (token, query) => {
        received = { token, query };
        return [{ key: '3998', name: 'Nghệ An', type: 'region', countryCode: 'VN' }];
      }
    }
  });
  context.after(() => server.close());

  const session = signSession('session-user', config.sessionSecret);
  const response = await request(
    server,
    '/api/location-search?adAccountId=act_1&query=Ngh%E1%BB%87%20An',
    { headers: { cookie: `meta_ads_session=${encodeURIComponent(session)}` } }
  );

  assert.equal(response.status, 200);
  assert.deepEqual(response.body, {
    results: [{ key: '3998', name: 'Nghệ An', type: 'region', countryCode: 'VN' }]
  });
  assert.deepEqual(received, { token: 'EAAG-secret-token', query: 'Nghệ An' });
});

test('rejects invalid ad-account and targeting resource requests before Graph calls', async (context) => {
  const config = testConfig();
  let graphCalls = 0;
  const server = createServer({
    config,
    db: {
      createSession: () => ({ id: 'new-session' }),
      getSession: () => ({ id: 'session-user', metaUserId: 'meta-user-1' }),
      getConnection: () => ({
        accessTokenCiphertext: encryptToken('EAAG-secret-token', config.tokenEncryptionKey)
      })
    },
    metaClient: new Proxy({}, { get: () => async () => { graphCalls += 1; } })
  });
  context.after(() => server.close());

  const session = signSession('session-user', config.sessionSecret);
  const headers = { cookie: `meta_ads_session=${encodeURIComponent(session)}` };
  const responses = await Promise.all([
    request(server, '/api/ad-account-resources', { headers }),
    request(server, '/api/ad-account-resources?adAccountId=123', { headers }),
    request(server, '/api/targeting-search?adAccountId=act_1&category=interest&query=x', { headers }),
    request(server, '/api/targeting-search?adAccountId=act_1&category=unknown&query=skin', { headers }),
    request(server, '/api/location-search?adAccountId=act_1&query=x', { headers }),
    request(server, '/api/location-search?adAccountId=123&query=Ngh%E1%BB%87%20An', { headers })
  ]);

  assert.deepEqual(responses.map((response) => response.status), [400, 400, 400, 400, 400, 400]);
  assert.equal(responses[2].body.error, 'Nhập ít nhất 2 ký tự để tìm kiếm');
  assert.equal(graphCalls, 0);
});

test('requires a connected Meta session for ad-account resources', async (context) => {
  const config = testConfig();
  const server = createServer({
    config,
    db: {
      createSession: () => ({ id: 'new-session' }),
      getSession: () => ({ id: 'session-user', metaUserId: null })
    },
    metaClient: {}
  });
  context.after(() => server.close());

  const session = signSession('session-user', config.sessionSecret);
  const response = await request(server, '/api/ad-account-resources?adAccountId=act_1', {
    headers: { cookie: `meta_ads_session=${encodeURIComponent(session)}` }
  });

  assert.equal(response.status, 401);
});

test('exchanges a valid OAuth callback and stores only the encrypted token', async (context) => {
  const config = testConfig();
  let storedConnection;
  let attachedUser;
  const server = createServer({
    config,
    db: {
      createSession: () => ({ id: 'new-session' }),
      getSession: () => ({ id: 'session-user', metaUserId: null }),
      consumeOAuthState: () => ({ sessionId: 'session-user' }),
      upsertConnection: (connection) => { storedConnection = connection; },
      attachMetaUser: (sessionId, user) => { attachedUser = { sessionId, user }; }
    },
    metaClient: {
      exchangeCode: async () => ({ accessToken: 'EAAG-callback-token' }),
      getProfile: async () => ({ id: 'meta-user-1', name: 'Minh' })
    }
  });
  context.after(() => server.close());

  const session = signSession('session-user', config.sessionSecret);
  const response = await request(server, '/api/auth/meta/callback?code=oauth-code&state=oauth-state', {
    headers: { cookie: `meta_ads_session=${encodeURIComponent(session)}` }
  });

  assert.equal(response.status, 302);
  assert.equal(response.location, '/?connected=1');
  assert.equal(decryptToken(storedConnection.accessTokenCiphertext, config.tokenEncryptionKey), 'EAAG-callback-token');
  assert.deepEqual(attachedUser, {
    sessionId: 'session-user',
    user: { id: 'meta-user-1', name: 'Minh' }
  });
});

test('awaits connection persistence before completing the OAuth callback', async (context) => {
  const config = testConfig();
  let connectionPersisted = false;
  const server = createServer({
    config,
    db: {
      createSession: () => ({ id: 'new-session' }),
      getSession: () => ({ id: 'session-user', metaUserId: null }),
      consumeOAuthState: () => ({ sessionId: 'session-user' }),
      async upsertConnection() {
        await new Promise((resolve) => setTimeout(resolve, 10));
        connectionPersisted = true;
      },
      attachMetaUser: () => undefined
    },
    metaClient: {
      exchangeCode: async () => ({ accessToken: 'EAAG-callback-token' }),
      getProfile: async () => ({ id: 'meta-user-1', name: 'Minh' })
    }
  });
  context.after(() => server.close());

  const session = signSession('session-user', config.sessionSecret);
  const response = await request(server, '/api/auth/meta/callback?code=oauth-code&state=oauth-state', {
    headers: { cookie: `meta_ads_session=${encodeURIComponent(session)}` }
  });

  assert.equal(response.status, 302);
  assert.equal(connectionPersisted, true);
});

test('refuses resource discovery until a Meta user has connected', async (context) => {
  const server = createServer({
    config: testConfig(),
    db: {
      createSession: () => ({ id: 'new-session', metaUserId: null }),
      getSession: () => null
    },
    metaClient: {}
  });
  context.after(() => server.close());

  const response = await request(server, '/api/resources');

  assert.equal(response.status, 401);
  assert.deepEqual(response.body, { error: 'Connect Meta first' });
});

test('serves owner-scoped audience-template CRUD to a connected Meta profile', async (context) => {
  const config = testConfig();
  const template = audienceTemplateFixture();
  const calls = [];
  const server = createServer({
    config,
    db: {
      createSession: () => ({ id: 'new-session', metaUserId: null }),
      getSession: () => ({ id: 'session-user', metaUserId: 'meta-user-1' }),
      getConnection: () => ({ metaUserId: 'meta-user-1', accessTokenCiphertext: 'ciphertext' }),
      listAudienceTemplates: () => [template],
      createAudienceTemplate: (owner, input) => {
        calls.push(['create', input]);
        return { ...template, ...input };
      },
      updateAudienceTemplate: (owner, id, input) => {
        calls.push(['update', id, input]);
        return { ...template, ...input, id };
      },
      duplicateAudienceTemplate: (owner, id, name) => {
        calls.push(['duplicate', id, name]);
        return { ...template, id: 'tool_audience_copy', name };
      },
      deleteAudienceTemplate: (owner, id) => {
        calls.push(['delete', id]);
        return true;
      }
    },
    metaClient: {}
  });
  context.after(() => server.close());

  const session = signSession('session-user', config.sessionSecret);
  const headers = {
    cookie: `meta_ads_session=${encodeURIComponent(session)}`,
    'content-type': 'application/json'
  };
  const createBody = { name: 'Nữ 23-45 HCM', content: template.content };

  const listed = await request(server, '/api/audience-templates', { headers });
  const created = await request(server, '/api/audience-templates', {
    method: 'POST', headers, body: JSON.stringify(createBody)
  });
  const updated = await request(server, '/api/audience-templates/tool_audience_1', {
    method: 'PUT', headers, body: JSON.stringify({ ...createBody, name: 'Nữ 25-45 HCM' })
  });
  const duplicated = await request(server, '/api/audience-templates/tool_audience_1/duplicate', {
    method: 'POST', headers, body: JSON.stringify({ name: 'Nữ 23-45 HCM - Bản sao' })
  });
  const deleted = await request(server, '/api/audience-templates/tool_audience_1', {
    method: 'DELETE', headers, body: JSON.stringify({})
  });

  assert.equal(listed.status, 200);
  assert.deepEqual(listed.body, { templates: [template] });
  assert.equal(created.status, 201);
  assert.equal(created.body.template.name, createBody.name);
  assert.equal(updated.status, 200);
  assert.equal(updated.body.template.name, 'Nữ 25-45 HCM');
  assert.equal(duplicated.status, 201);
  assert.equal(duplicated.body.template.name, 'Nữ 23-45 HCM - Bản sao');
  assert.deepEqual(deleted.body, { deleted: true });
  assert.deepEqual(calls.map(([operation]) => operation), ['create', 'update', 'duplicate', 'delete']);
});

test('still loads a private audience library when legacy template claiming fails', async (context) => {
  const config = testConfig();
  const template = audienceTemplateFixture();
  const server = createServer({
    config,
    db: {
      createSession: () => ({ id: 'new-session', metaUserId: null }),
      getSession: () => ({ id: 'session-user', metaUserId: 'meta-user-1' }),
      getConnection: () => ({ metaUserId: 'meta-user-1', accessTokenCiphertext: 'ciphertext' }),
      claimLegacyTemplateLibraries: async () => { throw new Error('legacy migration conflict'); },
      listAudienceTemplates: () => [template]
    },
    metaClient: {}
  });
  context.after(() => server.close());

  const session = signSession('session-user', config.sessionSecret);
  const response = await request(server, '/api/audience-templates', {
    headers: { cookie: `meta_ads_session=${encodeURIComponent(session)}` }
  });

  assert.equal(response.status, 200);
  assert.deepEqual(response.body, { templates: [template] });
});

test('rejects anonymous and disconnected audience-template reads and mutations without touching persistence', async (context) => {
  const config = testConfig();
  const mutationCalls = [];
  let session = { id: 'session-user', metaUserId: null };
  let connection = null;
  const server = createServer({
    config,
    db: {
      createSession: () => ({ id: 'new-session', metaUserId: null }),
      getSession: () => session,
      getConnection: () => connection,
      listAudienceTemplates: () => [],
      createAudienceTemplate: () => mutationCalls.push('create'),
      updateAudienceTemplate: () => mutationCalls.push('update'),
      duplicateAudienceTemplate: () => mutationCalls.push('duplicate'),
      deleteAudienceTemplate: () => mutationCalls.push('delete')
    },
    metaClient: {}
  });
  context.after(() => server.close());
  const cookie = signSession('session-user', config.sessionSecret);
  const headers = {
    cookie: `meta_ads_session=${encodeURIComponent(cookie)}`,
    'content-type': 'application/json'
  };
  const body = JSON.stringify({ name: 'Audience', content: audienceTemplateFixture().content });

  const listed = await request(server, '/api/audience-templates', { headers });
  const anonymous = await request(server, '/api/audience-templates', { method: 'POST', headers, body });
  session = { id: 'session-user', metaUserId: 'meta-user-1' };
  const disconnected = await request(server, '/api/audience-templates/tool_audience_1', {
    method: 'DELETE', headers, body: JSON.stringify({})
  });

  assert.equal(listed.status, 401);
  assert.equal(anonymous.status, 401);
  assert.deepEqual(anonymous.body, { error: 'Connect Meta first' });
  assert.equal(disconnected.status, 403);
  assert.deepEqual(disconnected.body, { error: 'Meta connection is no longer available. Reconnect Meta first.' });
  assert.deepEqual(mutationCalls, []);
});

test('returns 400 for invalid audience templates and 404 for missing IDs', async (context) => {
  const config = testConfig();
  const server = createServer({
    config,
    db: {
      createSession: () => ({ id: 'new-session', metaUserId: null }),
      getSession: () => ({ id: 'session-user', metaUserId: 'meta-user-1' }),
      getConnection: () => ({ metaUserId: 'meta-user-1', accessTokenCiphertext: 'ciphertext' }),
      listAudienceTemplates: () => [],
      createAudienceTemplate: () => { throw new Error('invalid input reached persistence'); },
      updateAudienceTemplate: () => null,
      duplicateAudienceTemplate: () => null,
      deleteAudienceTemplate: () => false
    },
    metaClient: {}
  });
  context.after(() => server.close());

  const session = signSession('session-user', config.sessionSecret);
  const headers = {
    cookie: `meta_ads_session=${encodeURIComponent(session)}`,
    'content-type': 'application/json'
  };
  const invalid = await request(server, '/api/audience-templates', {
    method: 'POST', headers, body: JSON.stringify({ name: '', content: {} })
  });
  const missingUpdate = await request(server, '/api/audience-templates/tool_audience_missing', {
    method: 'PUT',
    headers,
    body: JSON.stringify({ name: 'Mẫu hợp lệ', content: audienceTemplateFixture().content })
  });
  const missingDuplicate = await request(server, '/api/audience-templates/tool_audience_missing/duplicate', {
    method: 'POST', headers, body: JSON.stringify({ name: 'Bản sao' })
  });
  const missingDelete = await request(server, '/api/audience-templates/tool_audience_missing', {
    method: 'DELETE', headers, body: JSON.stringify({})
  });

  assert.equal(invalid.status, 400);
  assert.match(invalid.body.error, /name is required/i);
  assert.deepEqual(
    [missingUpdate.status, missingDuplicate.status, missingDelete.status],
    [404, 404, 404]
  );
});

test('returns a safe 400 response for SQLite and Postgres audience-template name conflicts', async (context) => {
  const conflicts = [
    Object.assign(new Error('UNIQUE constraint failed: audience_templates.name_key'), {
      code: 'ERR_SQLITE_ERROR',
      errcode: 2067,
      errstr: 'constraint failed'
    }),
    Object.assign(new Error('duplicate key value violates unique constraint "audience_templates_name_key_idx"'), {
      code: '23505',
      constraint: 'audience_templates_name_key_idx',
      detail: 'Key (name_key)=(nữ 23-45 hcm) already exists.'
    })
  ];

  for (const conflict of conflicts) {
    const config = testConfig();
    const server = createServer({
      config,
      db: {
        createSession: () => ({ id: 'new-session', metaUserId: null }),
        getSession: () => ({ id: 'session-user', metaUserId: 'meta-user-1' }),
        getConnection: () => ({ metaUserId: 'meta-user-1', accessTokenCiphertext: 'ciphertext' }),
        createAudienceTemplate: () => { throw conflict; },
        updateAudienceTemplate: () => { throw conflict; },
        duplicateAudienceTemplate: () => { throw conflict; },
        deleteAudienceTemplate: () => false
      },
      metaClient: {}
    });
    context.after(() => server.close());
    const session = signSession('session-user', config.sessionSecret);
    const headers = {
      cookie: `meta_ads_session=${encodeURIComponent(session)}`,
      'content-type': 'application/json'
    };
    const body = JSON.stringify({
      name: 'Nữ 23-45 HCM',
      content: audienceTemplateFixture().content
    });
    const responses = await Promise.all([
      request(server, '/api/audience-templates', { method: 'POST', headers, body }),
      request(server, '/api/audience-templates/tool_audience_1', { method: 'PUT', headers, body }),
      request(server, '/api/audience-templates/tool_audience_1/duplicate', {
        method: 'POST',
        headers,
        body: JSON.stringify({ name: 'Nữ 23-45 HCM' })
      })
    ]);

    for (const response of responses) {
      assert.equal(response.status, 400);
      assert.deepEqual(response.body, {
        error: 'Tên mẫu đối tượng đã tồn tại. Vui lòng chọn tên khác.'
      });
      assert.doesNotMatch(JSON.stringify(response.body), /constraint|name_key|23505|audience_templates/i);
    }
  }
});

test('returns 400 when SQLite detects Unicode case-equivalent audience-template names', async (context) => {
  const database = createSqliteDatabase(':memory:');
  const config = testConfig();
  await database.createSession({ id: 'session-user' });
  await database.attachMetaUser('session-user', { id: 'meta-user-1', name: 'Tester' });
  await database.upsertConnection({
    metaUserId: 'meta-user-1',
    metaUserName: 'Tester',
    accessTokenCiphertext: 'ciphertext'
  });
  const server = createServer({ config, db: database, metaClient: {} });
  context.after(() => {
    server.close();
    database.close();
  });
  const session = signSession('session-user', config.sessionSecret);
  const headers = {
    cookie: `meta_ads_session=${encodeURIComponent(session)}`,
    'content-type': 'application/json'
  };
  const content = audienceTemplateFixture().content;

  const first = await request(server, '/api/audience-templates', {
    method: 'POST',
    headers,
    body: JSON.stringify({ name: 'ĐỐI TƯỢNG', content })
  });
  const duplicate = await request(server, '/api/audience-templates', {
    method: 'POST',
    headers,
    body: JSON.stringify({ name: 'đối tượng', content })
  });

  assert.equal(first.status, 201);
  assert.equal(duplicate.status, 400);
  assert.deepEqual(duplicate.body, {
    error: 'Tên mẫu đối tượng đã tồn tại. Vui lòng chọn tên khác.'
  });
});

function audienceTemplateFixture() {
  return {
    id: 'tool_audience_1',
    name: 'Nữ 23-45 HCM',
    content: {
      ageMin: 23,
      ageMax: 45,
      genders: [2],
      locales: [],
      includedRegions: [{ key: '2428', name: 'Hồ Chí Minh', type: 'region', countryCode: 'VN' }],
      excludedRegions: [],
      includedCustomAudienceIds: [],
      excludedCustomAudienceIds: [],
      detailedTargeting: [],
      advantageAudienceEnabled: false
    },
    createdAt: 1,
    updatedAt: 1
  };
}

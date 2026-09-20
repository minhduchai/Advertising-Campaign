import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from '../src/server.js';
import { createDatabase } from '../src/db.js';
import { encryptToken, signSession } from '../src/crypto.js';
import { request, testConfig } from './helpers.js';

const conversationFixture = {
  sourceTemplateId: null,
  templateName: 'Mẫu tư vấn',
  greeting: 'Chào bạn, chúng tôi có thể giúp gì?',
  quickReplies: [],
  showBusinessPhoneNumber: false,
  businessPhoneNumber: '',
  customerActions: [{
    id: 'button-1',
    label: 'Đăng Ký Ngay',
    type: 'OPEN_URL',
    value: 'https://lgclinic.vn/dang-ky'
  }]
};

function connectedFixture() {
  const config = testConfig();
  const database = createDatabase(':memory:');
  let metaCalls = 0;
  const metaClient = new Proxy({}, {
    get() {
      return async () => {
        metaCalls += 1;
        throw new Error('Conversation template routes must not call Meta');
      };
    }
  });
  const server = createServer({ config, db: database, metaClient });
  return {
    database,
    server,
    connect(metaUserId) {
      const session = database.createSession();
      database.attachMetaUser(session.id, { id: metaUserId, name: metaUserId });
      database.upsertConnection({
        metaUserId,
        metaUserName: metaUserId,
        accessTokenCiphertext: encryptToken(`token-${metaUserId}`, config.tokenEncryptionKey)
      });
      return `meta_ads_session=${encodeURIComponent(signSession(session.id, config.sessionSecret))}`;
    },
    getMetaCalls: () => metaCalls
  };
}

function jsonOptions(cookie, method, body = {}) {
  return {
    method,
    headers: { cookie, 'content-type': 'application/json' },
    body: JSON.stringify(body)
  };
}

test('connected users manage isolated conversation-template libraries without Meta calls', async (context) => {
  const fixture = connectedFixture();
  context.after(() => fixture.server.close());
  const firstUser = fixture.connect('owner-1');
  const secondUser = fixture.connect('owner-2');

  const initial = await request(fixture.server, '/api/conversation-templates', {
    headers: { cookie: firstUser }
  });
  assert.equal(initial.status, 200);
  assert.equal(initial.body.templates.length, 1);
  assert.equal(initial.body.templates[0].name, 'Dịch vụ triệt nách nữ');
  assert.equal(initial.body.templates[0].isDefault, true);
  assert.equal(initial.body.templates[0].pageId, undefined);
  const seedId = initial.body.templates[0].id;

  const editedSeed = await request(
    fixture.server,
    `/api/conversation-templates/${seedId}`,
    jsonOptions(secondUser, 'PUT', {
      name: 'Mẫu chung đã sửa',
      template: { ...conversationFixture, greeting: 'Nội dung đã được người dùng khác sửa' }
    })
  );
  assert.equal(editedSeed.status, 404);

  const created = await request(
    fixture.server,
    '/api/conversation-templates',
    jsonOptions(firstUser, 'POST', { name: 'Mẫu mới', template: conversationFixture })
  );
  assert.equal(created.status, 201);

  const visibleToSecondUser = await request(fixture.server, '/api/conversation-templates', {
    headers: { cookie: secondUser }
  });
  assert.equal(visibleToSecondUser.body.templates.length, 0);

  const duplicated = await request(
    fixture.server,
    `/api/conversation-templates/${created.body.template.id}/duplicate`,
    jsonOptions(secondUser, 'POST')
  );
  assert.equal(duplicated.status, 404);

  const madeDefault = await request(
    fixture.server,
    `/api/conversation-templates/${created.body.template.id}/default`,
    jsonOptions(firstUser, 'POST')
  );
  assert.equal(madeDefault.body.template.isDefault, true);

  const deletedSeed = await request(
    fixture.server,
    `/api/conversation-templates/${seedId}`,
    jsonOptions(secondUser, 'DELETE')
  );
  assert.equal(deletedSeed.status, 404);
  assert.equal(fixture.getMetaCalls(), 0);
});

test('returns not found for malformed conversation-template identifiers', async (context) => {
  const fixture = connectedFixture();
  context.after(() => fixture.server.close());
  const cookie = fixture.connect('owner-malformed');

  const response = await request(fixture.server, '/api/conversation-templates/%E0%A4%A', {
    headers: { cookie }
  });

  assert.equal(response.status, 404);
  assert.deepEqual(response.body, { error: 'Not found' });
});

test('private template routes validate content and hide missing template IDs', async (context) => {
  const fixture = connectedFixture();
  context.after(() => fixture.server.close());
  const cookie = fixture.connect('owner-1');

  const invalid = await request(
    fixture.server,
    '/api/conversation-templates',
    jsonOptions(cookie, 'POST', {
      name: '',
      template: { ...conversationFixture, greeting: '', customerActions: [] }
    })
  );
  assert.equal(invalid.status, 422);
  assert.ok(invalid.body.errors.some(({ path }) => path === 'name'));
  assert.ok(invalid.body.errors.some(({ path }) => path === 'template.greeting'));
  assert.ok(!invalid.body.errors.some(({ path }) => path === 'template.customerActions'));

  const missing = await request(
    fixture.server,
    '/api/conversation-templates/missing',
    jsonOptions(cookie, 'PUT', { name: 'Không tồn tại', template: conversationFixture })
  );
  assert.equal(missing.status, 404);
});

test('owners can delete legacy Page-scoped conversation templates from their private library', async (context) => {
  const fixture = connectedFixture();
  context.after(() => fixture.server.close());
  const cookie = fixture.connect('owner-1');
  const legacy = fixture.database.createConversationTemplate({
    ownerMetaUserId: 'owner-1',
    pageId: 'legacy-page-1',
    name: 'Mẫu cũ theo Page',
    template: conversationFixture
  });

  const deleted = await request(
    fixture.server,
    `/api/conversation-templates/${legacy.id}`,
    jsonOptions(cookie, 'DELETE')
  );

  assert.equal(deleted.status, 200);
  assert.equal(deleted.body.deleted, true);
  assert.equal(fixture.database.getConversationTemplate('owner-1', legacy.id), null);
});

test('private template routes require a connected Meta session', async (context) => {
  const config = testConfig();
  const database = createDatabase(':memory:');
  const session = database.createSession();
  const server = createServer({ config, db: database, metaClient: {} });
  context.after(() => server.close());
  const cookie = `meta_ads_session=${encodeURIComponent(signSession(session.id, config.sessionSecret))}`;

  const response = await request(server, '/api/conversation-templates', { headers: { cookie } });
  assert.equal(response.status, 401);
});

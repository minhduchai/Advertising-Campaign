import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from '../src/server.js';
import { createDatabase } from '../src/db.js';
import { encryptToken, signSession } from '../src/crypto.js';
import { request, testConfig } from './helpers.js';

const audienceContent = {
  sourceAdAccountId: 'act_1',
  ageMin: 22,
  ageMax: 45,
  genders: [2],
  locales: [],
  includedRegions: [{ key: '3847', name: 'Ho Chi Minh City', type: 'region', countryCode: 'VN' }],
  excludedRegions: [],
  includedCities: [],
  excludedCities: [],
  includedCustomLocations: [],
  excludedCustomLocations: [],
  includedCustomAudienceIds: [],
  excludedCustomAudienceIds: [],
  detailedTargeting: [],
  advantageAudienceEnabled: false
};

const presetInput = {
  name: 'Triệt bikini nữ',
  content: {
    campaignName: 'Campaign nữ',
    adSetName: 'No Target Nữ 22–45',
    audienceTemplateId: 'tool_audience_1',
    audienceTemplateName: 'Nữ làm đẹp 22–45',
    audienceContent,
    seedingTemplateId: 'seed-1',
    seedingTemplateName: 'Seeding nữ',
    conversationTemplateId: 'conversation-1',
    conversationTemplateName: 'Tư vấn nữ'
  }
};

function fixture() {
  const config = testConfig();
  const database = createDatabase(':memory:');
  const server = createServer({ config, db: database, metaClient: {} });
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
    }
  };
}

function jsonOptions(cookie, method, body) {
  return {
    method,
    headers: { cookie, 'content-type': 'application/json' },
    body: JSON.stringify(body)
  };
}

function saveLinkedTemplates(database, ownerMetaUserId) {
  database.createSeedingTemplate({
    id: 'seed-1',
    ownerMetaUserId,
    name: 'Seeding nữ',
    items: [{ id: 'seed-item-1', message: 'Comment', imageMediaId: null }]
  });
  database.createConversationTemplate({
    id: 'conversation-1',
    ownerMetaUserId,
    pageId: '__shared__',
    name: 'Tư vấn nữ',
    template: { greeting: 'Xin chào', customerActions: [] }
  });
}

test('Campaign preset CRUD is isolated by connected Meta owner', async (context) => {
  const testFixture = fixture();
  context.after(() => testFixture.server.close());
  const ownerOne = testFixture.connect('owner-1');
  const ownerTwo = testFixture.connect('owner-2');
  saveLinkedTemplates(testFixture.database, 'owner-1');

  const created = await request(
    testFixture.server,
    '/api/campaign-presets',
    jsonOptions(ownerOne, 'POST', presetInput)
  );
  assert.equal(created.status, 201);
  assert.equal(created.body.preset.name, presetInput.name);
  assert.equal(created.body.preset.ownerMetaUserId, undefined);

  const ownList = await request(testFixture.server, '/api/campaign-presets', { headers: { cookie: ownerOne } });
  const foreignList = await request(testFixture.server, '/api/campaign-presets', { headers: { cookie: ownerTwo } });
  assert.equal(ownList.body.presets.length, 1);
  assert.deepEqual(foreignList.body.presets, []);

  const updated = await request(
    testFixture.server,
    `/api/campaign-presets/${created.body.preset.id}`,
    jsonOptions(ownerOne, 'PUT', { ...presetInput, name: 'Cấu hình đã sửa' })
  );
  assert.equal(updated.body.preset.name, 'Cấu hình đã sửa');

  const foreignDelete = await request(testFixture.server, `/api/campaign-presets/${created.body.preset.id}`, {
    method: 'DELETE', headers: { cookie: ownerTwo }
  });
  assert.equal(foreignDelete.status, 404);

  const deleted = await request(testFixture.server, `/api/campaign-presets/${created.body.preset.id}`, {
    method: 'DELETE', headers: { cookie: ownerOne }
  });
  assert.deepEqual(deleted.body, { deleted: true });
});

test('Campaign preset routes validate content and require a connected Meta session', async (context) => {
  const testFixture = fixture();
  context.after(() => testFixture.server.close());
  const connected = testFixture.connect('owner-1');

  const invalid = await request(
    testFixture.server,
    '/api/campaign-presets',
    jsonOptions(connected, 'POST', { name: '', content: {} })
  );
  assert.equal(invalid.status, 422);
  assert.ok(invalid.body.errors.some(({ path }) => path === 'content.seedingTemplateId'));
  assert.ok(invalid.body.errors.some(({ path }) => path === 'content.conversationTemplateId'));
  assert.ok(invalid.body.errors.some(({ path }) => path === 'content.audienceContent'));

  const missingReferences = await request(
    testFixture.server,
    '/api/campaign-presets',
    jsonOptions(connected, 'POST', presetInput)
  );
  assert.equal(missingReferences.status, 422);
  assert.ok(missingReferences.body.errors.some(({ path }) => path === 'content.seedingTemplateId'));
  assert.ok(missingReferences.body.errors.some(({ path }) => path === 'content.conversationTemplateId'));

  const session = testFixture.database.createSession();
  const config = testConfig();
  const disconnectedCookie = `meta_ads_session=${encodeURIComponent(signSession(session.id, config.sessionSecret))}`;
  const disconnected = await request(testFixture.server, '/api/campaign-presets', {
    headers: { cookie: disconnectedCookie }
  });
  assert.equal(disconnected.status, 401);
});

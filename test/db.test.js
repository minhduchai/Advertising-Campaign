import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { createDatabase } from '../src/db.js';
import { validateAudienceTemplate } from '../src/audience-template.js';
import { registerDatabaseContract } from './database-contract.js';

const SHARED_LIBRARY_OWNER_ID = '__shared_conversation_library__';

test('media relocation preserves ID and requires both owner and previous URL', () => {
  const db = createDatabase(':memory:');
  try {
    const old = 'r2://bucket/ads/owner/media/a.jpg';
    const key = 'Seeding/owner/media/a.jpg';
    db.saveMedia({ id: 'media', ownerMetaUserId: 'owner', name: 'a.jpg', mimeType: 'image/jpeg', sizeBytes: 10, blobUrl: old, blobPathname: 'ads/owner/media/a.jpg' });
    assert.equal(db.updateMediaLocation('other', 'media', old, `r2://bucket/${key}`, key), null);
    assert.equal(db.updateMediaLocation('owner', 'media', 'stale', `r2://bucket/${key}`, key), null);
    assert.equal(db.updateMediaLocation('owner', 'media', old, `r2://bucket/${key}`, key).id, 'media');
    assert.equal(db.getMedia('owner', 'media').blobPathname, key);
  } finally { db.close(); }
});
const SHARED_LIBRARY_PAGE_ID = '__shared__';

const audienceContentFixture = {
  sourceAdAccountId: 'act_1',
  ageMin: 23,
  ageMax: 45,
  genders: [2],
  locales: [24],
  includedRegions: [{ key: '3984', name: 'Hồ Chí Minh', type: 'region', countryCode: 'VN' }],
  excludedRegions: [{ key: '3998', name: 'Nghệ An', type: 'region', countryCode: 'VN' }],
  includedCities: [],
  excludedCities: [],
  includedCustomLocations: [],
  excludedCustomLocations: [],
  includedCustomAudienceIds: ['custom-include-1'],
  excludedCustomAudienceIds: ['custom-exclude-1'],
  detailedTargeting: [{ id: 'interest-1', name: 'Spa', targetingField: 'interests' }],
  advantageAudienceEnabled: false
};

test('validates and normalizes supported audience template content', () => {
  assert.deepEqual(validateAudienceTemplate({
    name: '  Nữ làm đẹp 23–45  ',
    content: audienceContentFixture
  }), {
    name: 'Nữ làm đẹp 23–45',
    content: audienceContentFixture
  });
});

test('rejects invalid audience template names, unsupported fields, and duplicate IDs', () => {
  assert.throws(() => validateAudienceTemplate({ name: ' ', content: {} }), /name/i);
  assert.throws(() => validateAudienceTemplate({ name: 'x'.repeat(121), content: {} }), /120/);
  assert.throws(() => validateAudienceTemplate({
    name: 'Unsupported',
    content: { ...audienceContentFixture, countries: ['VN'] }
  }), /countries/);
  assert.throws(() => validateAudienceTemplate({
    name: 'Duplicate',
    content: { ...audienceContentFixture, includedCustomAudienceIds: ['same', 'same'] }
  }), /duplicate/i);
  assert.throws(() => validateAudienceTemplate({
    name: 'Missing source account',
    content: { ...audienceContentFixture, sourceAdAccountId: null }
  }), /sourceAdAccountId/);
});

test('allows only targeting fields supported by the Meta client', () => {
  const targetingFields = [
    'interests',
    'behaviors',
    'life_events',
    'industries',
    'income',
    'family_statuses',
    'education_statuses',
    'relationship_statuses'
  ];
  const validated = validateAudienceTemplate({
    name: 'Meta allowlist',
    content: {
      ...audienceContentFixture,
      detailedTargeting: targetingFields.map((targetingField, index) => ({
        id: `target-${index}`,
        name: `Target ${index}`,
        targetingField
      }))
    }
  });
  assert.deepEqual(validated.content.detailedTargeting.map(({ targetingField }) => targetingField), targetingFields);

  assert.throws(() => validateAudienceTemplate({
    name: 'Unsupported targeting field',
    content: {
      ...audienceContentFixture,
      detailedTargeting: [{ id: 'target-1', name: 'Invalid', targetingField: 'political_views' }]
    }
  }), /targetingField/i);
});

test('accepts valid numeric ID scalars without coercing booleans or objects', () => {
  const validated = validateAudienceTemplate({
    name: 'Strict IDs',
    content: {
      ...audienceContentFixture,
      locales: [24, '6'],
      includedCustomAudienceIds: ['123', 456]
    }
  });
  assert.deepEqual(validated.content.locales, [24, 6]);
  assert.deepEqual(validated.content.includedCustomAudienceIds, ['123', '456']);

  for (const invalidLocale of [true, {}, '24.5', 'not-a-number']) {
    assert.throws(() => validateAudienceTemplate({
      name: 'Invalid locale',
      content: { ...audienceContentFixture, locales: [invalidLocale] }
    }), /locales/i);
  }
  for (const invalidAudienceId of [true, {}, [], Number.NaN]) {
    assert.throws(() => validateAudienceTemplate({
      name: 'Invalid custom audience',
      content: { ...audienceContentFixture, includedCustomAudienceIds: [invalidAudienceId] }
    }), /includedCustomAudienceIds/i);
  }
  assert.throws(() => validateAudienceTemplate({
    name: 'Invalid age',
    content: { ...audienceContentFixture, ageMin: { valueOf: () => 23 } }
  }), /ageMin/i);
});

test('accepts only unique Vietnam regions and rejects overlap across include and exclude', () => {
  const hcm = { key: 3984, name: 'Hồ Chí Minh', type: 'region', countryCode: 'vn' };
  const normalized = validateAudienceTemplate({
    name: 'Vietnam regions',
    content: { ...audienceContentFixture, includedRegions: [hcm], excludedRegions: [] }
  });
  assert.deepEqual(normalized.content.includedRegions, [{
    key: '3984', name: 'Hồ Chí Minh', type: 'region', countryCode: 'VN'
  }]);

  for (const invalidRegion of [
    { key: '3984', name: 'Hồ Chí Minh', type: 'city', countryCode: 'VN' },
    { key: '3984', name: 'Hồ Chí Minh', type: 'region', countryCode: 'US' },
    { key: {}, name: 'Hồ Chí Minh', type: 'region', countryCode: 'VN' },
    { key: true, name: 'Hồ Chí Minh', type: 'region', countryCode: 'VN' }
  ]) {
    assert.throws(() => validateAudienceTemplate({
      name: 'Invalid region',
      content: { ...audienceContentFixture, includedRegions: [invalidRegion], excludedRegions: [] }
    }), /region|Vietnam|key/i);
  }

  assert.throws(() => validateAudienceTemplate({
    name: 'Duplicate region',
    content: { ...audienceContentFixture, includedRegions: [hcm, hcm], excludedRegions: [] }
  }), /duplicate/i);
  assert.throws(() => validateAudienceTemplate({
    name: 'Overlapping region',
    content: { ...audienceContentFixture, includedRegions: [hcm], excludedRegions: [hcm] }
  }), /include|exclude|overlap|both/i);
});

test('SQLite audience templates provide owner-scoped CRUD', async () => {
  const database = createDatabase(':memory:');
  const created = await database.createAudienceTemplate('owner-1', {
    name: 'Nữ làm đẹp 23–45',
    content: audienceContentFixture,
    now: 1_000
  });

  assert.match(created.id, /^tool_audience_/);
  assert.deepEqual(created, {
    id: created.id,
    name: 'Nữ làm đẹp 23–45',
    content: audienceContentFixture,
    createdAt: 1_000,
    updatedAt: 1_000
  });
  assert.deepEqual(await database.listAudienceTemplates('owner-1'), [created]);
  assert.deepEqual(await database.listAudienceTemplates('owner-2'), []);

  const updated = await database.updateAudienceTemplate('owner-1', created.id, {
    name: 'Nữ làm đẹp 25–45',
    content: { ...audienceContentFixture, ageMin: 25 },
    now: 2_000
  });
  assert.equal(updated.name, 'Nữ làm đẹp 25–45');
  assert.equal(updated.content.ageMin, 25);
  assert.equal(updated.createdAt, 1_000);
  assert.equal(updated.updatedAt, 2_000);

  assert.equal(await database.updateAudienceTemplate('owner-2', created.id, {
    name: 'Không được sửa', content: audienceContentFixture
  }), null);
  const duplicate = await database.duplicateAudienceTemplate('owner-1', created.id, 'Bản sao');
  assert.match(duplicate.id, /^tool_audience_/);
  assert.notEqual(duplicate.id, created.id);
  assert.equal(duplicate.name, 'Bản sao');
  assert.deepEqual(duplicate.content, updated.content);

  assert.equal(await database.deleteAudienceTemplate('owner-2', created.id), false);
  assert.equal(await database.deleteAudienceTemplate('owner-1', created.id), true);
  assert.deepEqual((await database.listAudienceTemplates('owner-1')).map(({ name }) => name), ['Bản sao']);
  database.close();
});

test('SQLite audience template names are unique without case sensitivity', async () => {
  const database = createDatabase(':memory:');
  const name = 'Đối tượng nữ';
  await database.createAudienceTemplate('owner-1', { name, content: audienceContentFixture });

  assert.throws(() => database.createAudienceTemplate('owner-1', {
    name: name.normalize('NFD').toUpperCase(),
    content: audienceContentFixture
  }), /unique/i);
  database.close();
});

test('SQLite safely backfills name keys when migrating legacy audience templates', () => {
  const directory = mkdtempSync(join(tmpdir(), 'meta-ads-audience-migration-'));
  const path = join(directory, 'legacy.sqlite');
  const legacy = new DatabaseSync(path);
  legacy.exec(`
    CREATE TABLE audience_templates (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      content_json TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `);
  legacy.prepare(`
    INSERT INTO audience_templates (id, name, content_json, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?)
  `).run('tool_audience_legacy', 'Đối tượng nữ', JSON.stringify(audienceContentFixture), 1, 1);
  legacy.prepare(`
    INSERT INTO audience_templates (id, name, content_json, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(
    'tool_audience_duplicate',
    'Đối tượng nữ'.normalize('NFD').toUpperCase(),
    JSON.stringify(audienceContentFixture),
    2,
    2
  );
  legacy.close();

  let migrated;
  try {
    const database = createDatabase(path);
    database.close();
    migrated = new DatabaseSync(path);
    const columns = migrated.prepare('PRAGMA table_info(audience_templates)').all().map(({ name }) => name);
    const rows = migrated.prepare('SELECT name, name_key FROM audience_templates ORDER BY created_at')
      .all()
      .map(({ name, name_key: nameKey }) => ({ name, name_key: nameKey }));
    const index = migrated.prepare(`
      SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'audience_templates_owner_name_key_idx'
    `).get();
    migrated.close();
    migrated = null;

    assert.ok(columns.includes('name_key'));
    assert.deepEqual(rows, [
      { name: 'Đối tượng nữ', name_key: 'đối tượng nữ' },
      { name: 'ĐỐI TƯỢNG NỮ (2)', name_key: 'đối tượng nữ (2)' }
    ]);
    assert.equal(index.name, 'audience_templates_owner_name_key_idx');
  } finally {
    migrated?.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('OAuth state can be consumed exactly once by its session', async () => {
  const database = createDatabase(':memory:');
  await database.createOAuthState('session-a', 'state-a');

  assert.deepEqual(await database.consumeOAuthState('state-a'), { sessionId: 'session-a' });
  assert.equal(await database.consumeOAuthState('state-a'), null);
});

test('connections retain encrypted token data without returning a plaintext field', async () => {
  const database = createDatabase(':memory:');
  await database.upsertConnection({
    metaUserId: 'meta-user-1',
    metaUserName: 'Minh',
    accessTokenCiphertext: 'encrypted-value'
  });

  assert.deepEqual(await database.getConnection('meta-user-1'), {
    metaUserId: 'meta-user-1',
    metaUserName: 'Minh',
    accessTokenCiphertext: 'encrypted-value'
  });
});

test('disconnecting Meta clears the session identity and encrypted connection only', async () => {
  const database = createDatabase(':memory:');
  const session = await database.createSession({ id: 'session-user' });
  await database.attachMetaUser(session.id, { id: 'meta-user-1', name: 'Minh' });
  await database.upsertConnection({
    metaUserId: 'meta-user-1',
    metaUserName: 'Minh',
    accessTokenCiphertext: 'encrypted-value'
  });

  await database.disconnectMetaUser(session.id, 'meta-user-1');

  assert.equal((await database.getSession(session.id)).metaUserId, null);
  assert.equal((await database.getSession(session.id)).metaUserName, null);
  assert.equal(await database.getConnection('meta-user-1'), null);
});

const conversationFixture = {
  sourceTemplateId: null,
  templateName: 'Mẫu tư vấn',
  greeting: 'Chào bạn, chúng tôi có thể giúp gì?',
  quickReplies: [{ id: 'q1', title: 'Tôi cần tư vấn', payload: 'reply_q1' }],
  showBusinessPhoneNumber: false,
  businessPhoneNumber: '',
  customerActions: []
};

test('conversation templates round-trip JSON and remain isolated by owner and Page', async () => {
  const database = createDatabase(':memory:');
  const created = await database.createConversationTemplate({
    ownerMetaUserId: 'owner-1',
    pageId: 'page-1',
    name: 'Tư vấn bikini',
    template: conversationFixture
  });
  await database.createConversationTemplate({
    ownerMetaUserId: 'owner-1',
    pageId: 'page-2',
    name: 'Page khác',
    template: conversationFixture
  });
  await database.createConversationTemplate({
    ownerMetaUserId: 'owner-2',
    pageId: 'page-1',
    name: 'Owner khác',
    template: conversationFixture
  });

  assert.deepEqual(await database.listConversationTemplates('owner-1', 'page-1'), [created]);
  assert.equal(await database.getConversationTemplate('owner-2', created.id), null);
  assert.deepEqual(created.template, conversationFixture);
  assert.equal(created.isDefault, false);
  assert.equal(typeof created.createdAt, 'number');
});

test('media and conversation templates require the matching owner', async () => {
  const database = createDatabase(':memory:');
  await database.saveMedia({
    id: 'media-1',
    ownerMetaUserId: 'owner-a',
    name: 'image.jpg',
    mimeType: 'image/jpeg',
    content: Buffer.from('image')
  });
  await database.createConversationTemplate({
    id: 'owner-b',
    ownerMetaUserId: 'owner-a',
    pageId: 'page-1',
    name: 'Collision',
    template: conversationFixture
  });

  assert.equal(await database.getMedia('owner-b', 'media-1'), null);
  assert.throws(() => database.getMedia('media-1'), /ownerMetaUserId and id/);
  assert.equal(await database.getConversationTemplate('owner-b', 'owner-a'), null);
});

test('migrates legacy media without losing rows', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'meta-ads-db-'));
  const path = join(directory, 'legacy.sqlite');
  const legacy = new DatabaseSync(path);
  legacy.exec(`
    CREATE TABLE media (
      id TEXT PRIMARY KEY,
      owner_meta_user_id TEXT NOT NULL,
      name TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      content BLOB NOT NULL,
      created_at INTEGER NOT NULL
    );
  `);
  legacy.prepare(`
    INSERT INTO media (id, owner_meta_user_id, name, mime_type, content, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run('media-legacy', 'owner-a', 'legacy.jpg', 'image/jpeg', Buffer.from('legacy'), 1);
  legacy.close();

  try {
    const script = `
      import { createDatabase } from ${JSON.stringify(pathToFileURL(join(process.cwd(), 'src', 'db.js')).href)};
      const database = createDatabase(${JSON.stringify(path)});
      const media = database.getMedia('owner-a', 'media-legacy');
      console.log(JSON.stringify({ id: media.id, name: media.name, sizeBytes: media.sizeBytes }));
    `;
    const result = spawnSync(process.execPath, ['--input-type=module', '--eval', script], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    const media = JSON.parse(result.stdout);
    assert.equal(media.name, 'legacy.jpg');
    assert.equal(media.id, 'media-legacy');
    assert.equal(media.sizeBytes, 6);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('updates, duplicates, and keeps one default conversation template per Page', async () => {
  const database = createDatabase(':memory:');
  const first = await database.createConversationTemplate({
    ownerMetaUserId: 'owner-1',
    pageId: 'page-1',
    name: 'Mẫu 1',
    template: conversationFixture
  });
  const second = await database.createConversationTemplate({
    ownerMetaUserId: 'owner-1',
    pageId: 'page-1',
    name: 'Mẫu 2',
    template: conversationFixture
  });

  assert.equal((await database.setDefaultConversationTemplate({
    id: first.id,
    ownerMetaUserId: 'owner-1',
    pageId: 'page-1'
  })).isDefault, true);
  await database.setDefaultConversationTemplate({
    id: second.id,
    ownerMetaUserId: 'owner-1',
    pageId: 'page-1'
  });
  const afterDefault = await database.listConversationTemplates('owner-1', 'page-1');
  assert.deepEqual(afterDefault.filter((template) => template.isDefault).map(({ id }) => id), [second.id]);

  const updated = await database.updateConversationTemplate({
    id: first.id,
    ownerMetaUserId: 'owner-1',
    name: 'Mẫu đã sửa',
    template: { ...conversationFixture, greeting: 'Lời chào mới' }
  });
  assert.equal(updated.name, 'Mẫu đã sửa');
  assert.equal(updated.template.greeting, 'Lời chào mới');
  assert.ok(updated.updatedAt >= first.updatedAt);
  assert.equal(await database.updateConversationTemplate({
    id: first.id,
    ownerMetaUserId: 'owner-2',
    name: 'Không được sửa',
    template: conversationFixture
  }), null);

  const duplicated = await database.duplicateConversationTemplate({
    id: first.id,
    ownerMetaUserId: 'owner-1',
    name: 'Mẫu đã sửa - Bản sao'
  });
  assert.equal(duplicated.name, 'Mẫu đã sửa - Bản sao');
  assert.equal(duplicated.pageId, 'page-1');
  assert.equal(duplicated.isDefault, false);
  assert.deepEqual(duplicated.template, {
    ...updated.template,
    sourceTemplateId: null,
    templateName: 'Mẫu đã sửa - Bản sao'
  });
});

test('deletes the current default, promotes the next template, and owner-scopes deletion', async () => {
  const database = createDatabase(':memory:');
  const defaultTemplate = await database.createConversationTemplate({
    ownerMetaUserId: 'owner-1',
    pageId: 'page-1',
    name: 'Mặc định',
    template: conversationFixture
  });
  const removable = await database.createConversationTemplate({
    ownerMetaUserId: 'owner-1',
    pageId: 'page-1',
    name: 'Có thể xóa',
    template: conversationFixture
  });
  await database.setDefaultConversationTemplate({
    id: defaultTemplate.id,
    ownerMetaUserId: 'owner-1',
    pageId: 'page-1'
  });

  assert.equal(await database.deleteConversationTemplate({ id: removable.id, ownerMetaUserId: 'owner-2' }), false);
  assert.equal(await database.deleteConversationTemplate({ id: defaultTemplate.id, ownerMetaUserId: 'owner-1' }), true);
  assert.equal((await database.getConversationTemplate('owner-1', removable.id)).isDefault, true);
});

test('seeds the shared conversation library once and does not restore a deleted seed', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'meta-ads-shared-library-'));
  const path = join(directory, 'shared.sqlite');
  try {
    const firstDatabase = createDatabase(path);
    const seededTemplates = await firstDatabase.listConversationTemplates(
      SHARED_LIBRARY_OWNER_ID,
      SHARED_LIBRARY_PAGE_ID
    );
    assert.equal(seededTemplates.length, 1);
    assert.equal(seededTemplates[0].name, 'Dịch vụ triệt nách nữ');
    assert.equal(seededTemplates[0].isDefault, true);
    assert.equal(await firstDatabase.deleteConversationTemplate({
      id: seededTemplates[0].id,
      ownerMetaUserId: SHARED_LIBRARY_OWNER_ID
    }), true);
    firstDatabase.close();

    const reopenedDatabase = createDatabase(path);
    assert.deepEqual(await reopenedDatabase.listConversationTemplates(
      SHARED_LIBRARY_OWNER_ID,
      SHARED_LIBRARY_PAGE_ID
    ), []);
    reopenedDatabase.close();
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('stores immutable run reports with node names and Reel permalinks', () => {
  const database = createDatabase(':memory:');
  const snapshot = {
    adAccountId: 'act_1',
    campaigns: [{ clientId: 'campaign-1', name: 'Campaign A', adSets: [] }]
  };
  database.createRun({
    id: 'run-report',
    ownerMetaUserId: 'owner-a',
    status: 'creating',
    adAccountId: 'act_1',
    snapshot,
    createdAt: 1_000
  });
  database.updateNodeResult('run-report', {
    clientId: 'ad-1',
    parentClientId: 'adset-1',
    type: 'ad',
    name: 'VIDEO SẸO RỖ',
    status: 'created',
    remoteId: 'meta-ad-1',
    postId: 'page-1_123',
    permalinkUrl: 'https://www.facebook.com/reel/123'
  });
  database.updateRunStatus('run-report', 'completed', 2_000);

  assert.deepEqual(database.getRun('run-report'), {
    id: 'run-report',
    ownerMetaUserId: 'owner-a',
    status: 'completed',
    adAccountId: 'act_1',
    snapshot,
    createdAt: 1_000,
    completedAt: 2_000,
    legacy: false,
    nodes: [{
      clientId: 'ad-1',
      parentClientId: 'adset-1',
      type: 'ad',
      name: 'VIDEO SẸO RỖ',
      status: 'created',
      remoteId: 'meta-ad-1',
      postId: 'page-1_123',
      permalinkUrl: 'https://www.facebook.com/reel/123',
      error: null
    }]
  });
});

test('lists owner-scoped run history by date with pagination and legacy markers', () => {
  const database = createDatabase(':memory:');
  database.createRun({ id: 'run-old', ownerMetaUserId: 'owner-a', status: 'completed', createdAt: 1_000 });
  database.createRun({
    id: 'run-middle',
    ownerMetaUserId: 'owner-a',
    status: 'completed_with_errors',
    adAccountId: 'act_1',
    snapshot: { adAccountId: 'act_1', campaigns: [] },
    createdAt: 2_000
  });
  database.createRun({
    id: 'run-new',
    ownerMetaUserId: 'owner-a',
    status: 'completed',
    adAccountId: 'act_1',
    snapshot: { adAccountId: 'act_1', campaigns: [] },
    createdAt: 3_000
  });
  database.createRun({ id: 'run-foreign', ownerMetaUserId: 'owner-b', status: 'completed', createdAt: 2_500 });
  database.updateNodeResult('run-new', {
    clientId: 'campaign-1', type: 'campaign', name: 'Campaign', status: 'created', remoteId: 'meta-campaign'
  });
  database.updateNodeResult('run-new', {
    clientId: 'adset-1', parentClientId: 'campaign-1', type: 'adSet', name: 'Ad Set', status: 'created', remoteId: 'meta-adset'
  });
  database.updateNodeResult('run-new', {
    clientId: 'ad-1', parentClientId: 'adset-1', type: 'ad', name: 'Ad', status: 'failed', error: { message: 'Meta error' }
  });

  const first = database.listRuns('owner-a', { from: 1_500, to: 3_500, limit: 1, offset: 0 });
  assert.equal(first.items.length, 1);
  assert.deepEqual(first.items[0], {
    id: 'run-new',
    status: 'completed',
    adAccountId: 'act_1',
    createdAt: 3_000,
    completedAt: null,
    workflowLeaseExpiresAt: null,
    legacy: false,
    counts: { total: 3, created: 2, failed: 1, skipped: 0, campaigns: 1, adSets: 1, ads: 1 },
    campaigns: []
  });
  assert.equal(first.nextOffset, 1);

  const second = database.listRuns('owner-a', { from: 1_500, to: 3_500, limit: 1, offset: first.nextOffset });
  assert.deepEqual(second.items.map(({ id }) => id), ['run-middle']);
  assert.equal(second.nextOffset, null);

  const legacy = database.listRuns('owner-a', { from: 0, to: 1_500, limit: 20, offset: 0 });
  assert.equal(legacy.items[0].legacy, true);
  assert.equal(legacy.items.some(({ id }) => id === 'run-foreign'), false);
});

test('SQLite seeding migrations are idempotent and competing connections keep one posting job per run', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'meta-ads-seeding-'));
  const path = join(directory, 'database.sqlite');
  const firstDatabase = createDatabase(path);
  const secondDatabase = createDatabase(path);
  try {
    firstDatabase.createRun({ id: 'run-1', ownerMetaUserId: 'owner-a', status: 'creating', createdAt: 1_000 });
    firstDatabase.insertSeedingJobs('owner-a', [{
      id: 'job-1', runId: 'run-1', campaignClientId: 'campaign-1', pageId: 'page-1', postId: 'post-1',
      itemId: 'item-1', position: 0, sequence: 0, message: 'First', imageMediaId: null, status: 'pending',
      metaCommentId: null, error: null, attemptCount: 0, availableAt: 1_000, startedAt: null,
      completedAt: null, createdAt: 1_000, updatedAt: 1_000
    }, {
      id: 'job-2', runId: 'run-1', campaignClientId: 'campaign-2', pageId: 'page-1', postId: 'post-2',
      itemId: 'item-2', position: 0, sequence: 1, message: 'Second', imageMediaId: null, status: 'pending',
      metaCommentId: null, error: null, attemptCount: 0, availableAt: 1_000, startedAt: null,
      completedAt: null, createdAt: 1_000, updatedAt: 1_000
    }]);

    const claims = await Promise.all([
      Promise.resolve().then(() => firstDatabase.claimNextSeedingJob({
        ownerMetaUserId: 'owner-a', runId: 'run-1', now: 1_000, staleBefore: 500
      })),
      Promise.resolve().then(() => secondDatabase.claimNextSeedingJob({
        ownerMetaUserId: 'owner-a', runId: 'run-1', now: 1_000, staleBefore: 500
      }))
    ]);
    assert.equal(claims.filter(Boolean).length, 1);
    assert.equal(firstDatabase.listSeedingJobs('owner-a', 'run-1').filter(({ status }) => status === 'posting').length, 1);

    const sqlite = new DatabaseSync(path);
    const indexes = sqlite.prepare(`
      SELECT name FROM sqlite_master
      WHERE type = 'index' AND name IN ('seeding_templates_owner_updated_idx', 'seeding_jobs_owner_run_status_idx')
      ORDER BY name
    `).all().map(({ name }) => name);
    sqlite.close();
    assert.deepEqual(indexes, ['seeding_jobs_owner_run_status_idx', 'seeding_templates_owner_updated_idx']);
  } finally {
    firstDatabase.close();
    secondDatabase.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('SQLite competing connections persist only one opposing Campaign selection per Post', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'meta-ads-seeding-conflict-'));
  const path = join(directory, 'database.sqlite');
  const firstDatabase = createDatabase(path);
  const secondDatabase = createDatabase(path);
  try {
    firstDatabase.createRun({ id: 'run-1', ownerMetaUserId: 'owner-a', status: 'creating', createdAt: 1_000 });
    const result = await Promise.allSettled([
      Promise.resolve().then(() => firstDatabase.insertSeedingJobs('owner-a', [{
        id: 'job-1', runId: 'run-1', campaignClientId: 'campaign-1', pageId: 'page-1', postId: 'post-1',
        itemId: 'item-1', position: 0, sequence: 0, message: 'First', createdAt: 1_000
      }])),
      Promise.resolve().then(() => secondDatabase.insertSeedingJobs('owner-a', [{
        id: 'job-2', runId: 'run-1', campaignClientId: 'campaign-2', pageId: 'page-1', postId: 'post-1',
        itemId: 'item-1', position: 0, sequence: 1, message: 'Second', createdAt: 1_000
      }]))
    ]);

    assert.equal(result.filter(({ status }) => status === 'fulfilled').length, 1);
    assert.equal(result.filter((entry) =>
      entry.status === 'rejected' && entry.reason?.code === 'SEEDING_POST_CONFLICT'
    ).length, 1);
    const jobs = firstDatabase.listSeedingJobs('owner-a', 'run-1');
    assert.equal(jobs.length, 1);
    assert.equal(new Set(jobs.map(({ campaignClientId }) => campaignClientId)).size, 1);
  } finally {
    firstDatabase.close();
    secondDatabase.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

registerDatabaseContract('SQLite database', async () => createDatabase(':memory:'));

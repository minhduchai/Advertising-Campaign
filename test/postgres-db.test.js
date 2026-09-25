import test from 'node:test';
import assert from 'node:assert/strict';
import { createPostgresDatabase } from '../src/postgres-db.js';

function createSqlStub(responses) {
  const calls = [];
  const sql = async (strings, ...values) => {
    calls.push({ text: String.raw(strings, ...values.map(() => '?')), values });
    return responses.shift() ?? [];
  };
  sql.calls = calls;
  sql.transactionCalls = [];
  sql.transaction = async (queries) => {
    sql.transactionCalls.push(queries);
    return Promise.all(queries);
  };
  return sql;
}

test('Postgres getRun loads the run and nodes together and only selects the execution draft on request', async () => {
  const row = { id: 'run-1', owner_meta_user_id: 'owner-a', status: 'creating', snapshot_json: null, created_at: '1', completed_at: null };
  const sql = createSqlStub([[row], [], [row], []]);
  const database = createPostgresDatabase(sql);

  assert.equal((await database.getRun('run-1')).id, 'run-1');
  await database.getRun('run-1', { execution: false });

  assert.deepEqual([sql.calls[0].values[0], sql.calls[2].values[0]], [true, false]);
  assert.match(sql.calls[1].text, /FROM node_results/);
});

test('Postgres claims only due Post ID lookups and saves Post IDs without touching status, creative or error', async () => {
  const sql = createSqlStub([[{ client_id: 'ad-1' }], []]);
  const db = createPostgresDatabase(sql);

  assert.deepEqual(await db.claimPublicationLookups('run-1', ['ad-1', 'ad-2'], { now: 1_000, leaseUntil: 61_000 }), ['ad-1']);
  assert.match(sql.calls[0].text, /DO UPDATE SET next_at = EXCLUDED\.next_at\s+WHERE publication_recovery\.next_at <= \?/);
  assert.deepEqual(sql.calls[0].values, ['run-1', 61_000, ['ad-1', 'ad-2'], 1_000]);

  await db.savePublication('run-1', [{ clientId: 'ad-1', remoteId: 'remote-1' }], {
    postId: '1_2', permalinkUrl: 'https://www.facebook.com/1/posts/2'
  });
  assert.match(sql.calls[1].text, /SET\s+post_id = COALESCE\(NULLIF\(node_results\.post_id, ''\), \?\),\s+permalink_url = COALESCE/);
  assert.match(sql.calls[1].text, /node_results\.remote_id = target\.remote_id AND node_results\.status = 'created'/);
  assert.doesNotMatch(sql.calls[1].text, /creative_id|error_json|SET status/);
});

test('Postgres claims each workflow nonce atomically and expires old claims', async () => {
  const sql = createSqlStub([[], [{ nonce_hash: 'hash' }], [], []]);
  const db = createPostgresDatabase(sql);
  assert.equal(await db.claimWorkflowNonce('hash', 5000, 1000), true);
  assert.equal(await db.claimWorkflowNonce('hash', 5000, 1000), false);
  assert.equal(sql.transactionCalls.length, 2);
  assert.match(sql.calls[0].text, /DELETE FROM workflow_request_nonces WHERE expires_at </);
  assert.match(sql.calls[1].text, /ON CONFLICT \(nonce_hash\) DO NOTHING RETURNING nonce_hash/);
  assert.deepEqual(sql.calls[1].values, ['hash', 5000]);
});

test('R2 registry lookup is bucket-specific and metadata deletion requires matching ownership and URL', async () => {
  const sql = createSqlStub([[{ blob_pathname: 'ads/owner/media/a.jpg' }], []]);
  const db = createPostgresDatabase(sql);
  assert.deepEqual(await db.registeredR2Keys('bucket', ['ads/owner/media/a.jpg']), ['ads/owner/media/a.jpg']);
  assert.deepEqual(sql.calls[0].values, [['r2://bucket/ads/owner/media/a.jpg']]);
  assert.equal(await db.deleteMedia('other-owner', 'media', 'r2://bucket/ads/owner/media/a.jpg'), false);
  assert.match(sql.calls[1].text, /owner_meta_user_id = \? AND id = \? AND blob_url = \?/);
});

const templateRow = {
  id: 'template-1',
  owner_meta_user_id: 'owner-a',
  page_id: 'page-1',
  name: 'Template',
  template_json: '{"greeting":"Hello"}',
  is_default: true,
  created_at: '1',
  updated_at: '2'
};

const seedingTemplateRow = {
  id: 'seed-template-1',
  owner_meta_user_id: 'owner-a',
  name: 'Triệt nách nữ',
  items_json: '[{"id":"item-1","message":"Comment 1","imageMediaId":null}]',
  created_at: '1000',
  updated_at: '2000'
};

const campaignPresetContent = {
  campaignName: 'Campaign nữ',
  adSetName: 'No Target Nữ 22–45',
  audienceTemplateId: 'tool_audience_1',
  audienceTemplateName: 'Nữ làm đẹp 22–45',
  audienceContent: {
    sourceAdAccountId: 'act_1',
    ageMin: 22,
    ageMax: 45,
    genders: [2],
    locales: [],
    includedRegions: [],
    excludedRegions: [],
    includedCities: [],
    excludedCities: [],
    includedCustomLocations: [],
    excludedCustomLocations: [],
    includedCustomAudienceIds: [],
    excludedCustomAudienceIds: [],
    detailedTargeting: [],
    advantageAudienceEnabled: false
  },
  seedingTemplateId: 'seed-template-1',
  seedingTemplateName: 'Seeding nữ',
  conversationTemplateId: 'conversation-template-1',
  conversationTemplateName: 'Tư vấn nữ'
};

const campaignPresetRow = {
  id: 'campaign-preset-1',
  owner_meta_user_id: 'owner-a',
  name: 'Triệt bikini nữ',
  content_json: JSON.stringify(campaignPresetContent),
  created_at: '1000',
  updated_at: '2000'
};

const seedingJobRow = {
  id: 'seed-job-1',
  run_id: 'run-1',
  owner_meta_user_id: 'owner-a',
  campaign_client_id: 'campaign-1',
  page_id: 'page-1',
  post_id: 'post-1',
  item_id: 'item-1',
  position: 0,
  sequence: 0,
  message: 'Comment 1',
  image_media_id: null,
  status: 'posting',
  meta_comment_id: null,
  error_json: null,
  attempt_count: 1,
  available_at: '1000',
  started_at: '2000',
  completed_at: null,
  created_at: '1000',
  updated_at: '2000'
};

const telegramUploadJobRow = {
  id: 'telegram-job-1',
  owner_meta_user_id: 'owner-a',
  media_id: 'a'.repeat(32),
  network_path: '\\\\192.168.1.6\\marketing\\video.mp4',
  intent_code: 'intent-code',
  status: 'queued',
  lease_token: null,
  lease_expires_at: null,
  error_message: null,
  uploaded_bytes: '0',
  total_bytes: '0',
  expires_at: '9000',
  created_at: '1000',
  updated_at: '1000'
};

const audienceContent = {
  sourceAdAccountId: 'act_1',
  ageMin: 23,
  ageMax: 45,
  genders: [2],
  locales: [],
  includedRegions: [{ key: '3984', name: 'Hồ Chí Minh', type: 'region', countryCode: 'VN' }],
  excludedRegions: [],
  includedCustomAudienceIds: ['custom-1'],
  excludedCustomAudienceIds: [],
  detailedTargeting: [{ id: 'interest-1', name: 'Spa', targetingField: 'interests' }],
  advantageAudienceEnabled: false
};

const audienceTemplateRow = {
  id: 'tool_audience_1',
  name: 'Nữ làm đẹp 23–45',
  content_json: JSON.stringify(audienceContent),
  created_at: '1000',
  updated_at: '1000'
};

test('Postgres audience template CRUD is owner-scoped and maps the SQLite contract', async () => {
  const updatedRow = {
    ...audienceTemplateRow,
    name: 'Nữ làm đẹp 25–45',
    content_json: JSON.stringify({ ...audienceContent, ageMin: 25 }),
    updated_at: '2000'
  };
  const duplicateRow = {
    ...updatedRow,
    id: 'tool_audience_2',
    name: 'Bản sao',
    created_at: '3000',
    updated_at: '3000'
  };
  const sql = createSqlStub([
    [audienceTemplateRow],
    [audienceTemplateRow],
    [updatedRow],
    [duplicateRow],
    [{ id: 'tool_audience_1' }]
  ]);
  const database = createPostgresDatabase(sql);

  assert.deepEqual(await database.listAudienceTemplates('owner-1'), [{
    id: 'tool_audience_1',
    name: 'Nữ làm đẹp 23–45',
    content: audienceContent,
    createdAt: 1_000,
    updatedAt: 1_000
  }]);
  assert.equal((await database.createAudienceTemplate('owner-1', {
    id: 'tool_audience_1', name: 'Nữ làm đẹp 23–45', content: audienceContent, now: 1_000
  })).id, 'tool_audience_1');
  assert.equal((await database.updateAudienceTemplate('owner-1', 'tool_audience_1', {
    name: 'Nữ làm đẹp 25–45', content: { ...audienceContent, ageMin: 25 }, now: 2_000
  })).updatedAt, 2_000);
  assert.equal((await database.duplicateAudienceTemplate('owner-1', 'tool_audience_1', 'Bản sao')).name, 'Bản sao');
  assert.equal(await database.deleteAudienceTemplate('owner-1', 'tool_audience_1'), true);

  assert.equal(sql.calls.every(({ text }) => text.includes('owner_meta_user_id')), true);
  assert.match(sql.calls[1].text, /INSERT INTO audience_templates/);
  assert.match(sql.calls[1].text, /name_key/);
  assert.ok(sql.calls[1].values.includes('nữ làm đẹp 23–45'));
  assert.match(sql.calls[2].text, /UPDATE audience_templates/);
  assert.ok(sql.calls[2].values.includes('nữ làm đẹp 25–45'));
  assert.match(sql.calls[3].text, /INSERT INTO audience_templates/);
  assert.match(sql.calls[3].text, /SELECT content_json/);
  assert.ok(sql.calls[3].values.includes('bản sao'));
  assert.match(sql.calls[4].text, /DELETE FROM audience_templates/);
});

test('maps string-valued Postgres timestamps to numbers', async () => {
  const sql = createSqlStub([
    [{ id: 'session-1', meta_user_id: null, created_at: '1', updated_at: '1' }],
    [{ state: 'state-1', session_id: 'session-1', expires_at: '2' }]
  ]);
  const database = createPostgresDatabase(sql);

  const session = await database.createSession({ id: 'session-1', now: 1 });
  const state = await database.createOAuthState({ state: 'state-1', sessionId: 'session-1', expiresAt: 2 });

  assert.deepEqual(session, {
    id: 'session-1',
    metaUserId: null,
    createdAt: 1,
    updatedAt: 1,
  });
  assert.deepEqual(state, { state: 'state-1', sessionId: 'session-1', expiresAt: 2 });
});

test('Postgres media lookup rejects unscoped access and returns no foreign media', async () => {
  const sql = createSqlStub([[]]);
  const database = createPostgresDatabase(sql);

  await assert.rejects(database.getMedia('media-1'), /ownerMetaUserId and id/);
  assert.equal(await database.getMedia('owner-b', 'media-1'), null);
  assert.deepEqual(sql.calls[0].values, ['owner-b', 'media-1']);
});

test('Postgres upload agent persistence consumes codes and owner-scopes device lookup and revocation', async () => {
  const deviceRow = {
    id: 'device-1',
    owner_meta_user_id: 'owner-a',
    token_hash: 'token-hash',
    device_json: { name: 'Studio PC' },
    revoked_at: null,
    created_at: '1000',
    updated_at: '1000'
  };
  const sql = createSqlStub([
    [{ code_hash: 'pairing-hash', owner_meta_user_id: 'owner-a', expires_at: '2000', created_at: '1000' }],
    [{ owner_meta_user_id: 'owner-a' }],
    [deviceRow],
    [],
    [],
    [{ id: 'device-1' }]
  ]);
  const database = createPostgresDatabase(sql);

  await database.createUploadAgentPairingCode({
    codeHash: 'pairing-hash', ownerMetaUserId: 'owner-a', expiresAt: 2_000, createdAt: 1_000
  });
  assert.deepEqual(await database.consumeUploadAgentPairingCode('pairing-hash', 1_500), {
    ownerMetaUserId: 'owner-a'
  });
  assert.equal((await database.saveUploadAgentDevice({
    id: 'device-1', ownerMetaUserId: 'owner-a', tokenHash: 'token-hash',
    device: { name: 'Studio PC' }, createdAt: 1_000
  })).tokenHash, 'token-hash');
  assert.equal(await database.getUploadAgentDevice('owner-b', 'device-1'), null);
  assert.equal(await database.revokeUploadAgentDevice('owner-b', 'device-1', 2_000), false);
  assert.equal(await database.revokeUploadAgentDevice('owner-a', 'device-1', 2_000), true);

  assert.match(sql.calls[1].text, /DELETE FROM upload_agent_pairing_codes/);
  assert.match(sql.calls[1].text, /expires_at > \?/);
  assert.deepEqual(sql.calls[3].values, ['owner-b', 'device-1']);
  assert.equal(sql.calls[4].values.includes('owner-b'), true);
  assert.equal(sql.calls[4].values.includes('device-1'), true);
  assert.equal(sql.calls[5].values.includes('owner-a'), true);
  assert.equal(sql.calls[5].values.includes('device-1'), true);
});

test('Postgres Telegram upload jobs are owner-scoped and claimed atomically', async () => {
  const claimedRow = {
    ...telegramUploadJobRow,
    status: 'uploading',
    lease_token: 'lease-1',
    lease_expires_at: '8000',
    updated_at: '2000'
  };
  const completedRow = {
    ...claimedRow,
    status: 'completed',
    lease_token: null,
    lease_expires_at: null,
    updated_at: '3000'
  };
  const progressRow = {
    ...claimedRow,
    uploaded_bytes: String(32 * 1024 * 1024),
    total_bytes: String(100 * 1024 * 1024),
    updated_at: '2500'
  };
  const sql = createSqlStub([
    [telegramUploadJobRow],
    [telegramUploadJobRow],
    [claimedRow],
    [progressRow],
    [completedRow]
  ]);
  const database = createPostgresDatabase(sql);

  const created = await database.createTelegramUploadJob({
    id: 'telegram-job-1',
    ownerMetaUserId: 'owner-a',
    mediaId: 'a'.repeat(32),
    networkPath: telegramUploadJobRow.network_path,
    intentCode: 'intent-code',
    expiresAt: 9_000,
    createdAt: 1_000
  });
  assert.equal(created.networkPath, telegramUploadJobRow.network_path);
  assert.equal((await database.getTelegramUploadJobByMedia('owner-a', 'a'.repeat(32))).id, 'telegram-job-1');
  assert.equal((await database.claimNextTelegramUploadJob({
    now: 2_000,
    leaseToken: 'lease-1',
    leaseExpiresAt: 8_000
  })).status, 'uploading');
  const progress = await database.updateTelegramUploadJobProgress({
    id: 'telegram-job-1',
    leaseToken: 'lease-1',
    uploadedBytes: 32 * 1024 * 1024,
    totalBytes: 100 * 1024 * 1024,
    leaseExpiresAt: 8_500,
    now: 2_500
  });
  assert.equal(progress.uploadedBytes, 32 * 1024 * 1024);
  assert.equal(progress.totalBytes, 100 * 1024 * 1024);
  assert.equal((await database.finishTelegramUploadJob({
    id: 'telegram-job-1',
    leaseToken: 'lease-1',
    status: 'completed',
    now: 3_000
  })).status, 'completed');

  assert.match(sql.calls[2].text, /FOR UPDATE SKIP LOCKED/);
  assert.match(sql.calls[2].text, /status = 'queued'/);
  assert.deepEqual(sql.calls[1].values, ['owner-a', 'a'.repeat(32)]);
  assert.ok(sql.calls[3].values.includes(32 * 1024 * 1024));
  assert.ok(sql.calls[4].values.includes('lease-1'));
});

test('Postgres template lookup does not reverse owner and id on collisions', async () => {
  const sql = createSqlStub([[]]);
  const database = createPostgresDatabase(sql);

  assert.equal(await database.getConversationTemplate('owner-b', 'owner-a'), null);
  assert.equal(sql.calls.length, 1);
  assert.deepEqual(sql.calls[0].values, ['owner-b', 'owner-a']);
});

test('Postgres default changes lock the target then update it in order', async () => {
  const missingTargetSql = createSqlStub([[], []]);
  const missingTargetDatabase = createPostgresDatabase(missingTargetSql);
  assert.equal(await missingTargetDatabase.setDefaultConversationTemplate('owner-a', 'missing'), null);
  assert.equal(missingTargetSql.transactionCalls.length, 1);
  assert.equal(missingTargetSql.transactionCalls[0].length, 2);

  const foreignTargetSql = createSqlStub([[], []]);
  const foreignTargetDatabase = createPostgresDatabase(foreignTargetSql);
  assert.equal(await foreignTargetDatabase.setDefaultConversationTemplate('owner-b', 'template-1'), null);
  assert.equal(foreignTargetSql.transactionCalls.length, 1);
  assert.deepEqual(foreignTargetSql.calls[0].values.slice(0, 2), ['owner-b', 'template-1']);

  const selectedSql = createSqlStub([[], [templateRow]]);
  const selectedDatabase = createPostgresDatabase(selectedSql);
  assert.deepEqual(await selectedDatabase.setDefaultConversationTemplate('owner-a', 'template-1'), {
    id: 'template-1',
    ownerMetaUserId: 'owner-a',
    pageId: 'page-1',
    name: 'Template',
    template: { greeting: 'Hello' },
    isDefault: true,
    createdAt: 1,
    updatedAt: 2
  });
  assert.equal(selectedSql.transactionCalls[0].length, 2);
  assert.match(selectedSql.calls[0].text, /FOR UPDATE/);
  assert.match(selectedSql.calls[0].text, /id <> target\.id/);
  assert.match(selectedSql.calls[1].text, /RETURNING id/);
});

test('Postgres deletion promotes the newest remaining template when deleting the default', async () => {
  const sql = createSqlStub([[{ id: 'template-1' }]]);
  const database = createPostgresDatabase(sql);

  assert.equal(await database.deleteConversationTemplate('owner-a', 'template-1'), true);
  assert.equal(sql.calls.length, 1);
  assert.match(sql.calls[0].text, /DELETE FROM conversation_templates/);
  assert.match(sql.calls[0].text, /ORDER BY updated_at DESC/);
  assert.match(sql.calls[0].text, /conversation_templates\.id <> deleted\.id/);
  assert.match(sql.calls[0].text, /SET is_default = TRUE/);
});

test('Postgres batch imports guard cross-owner IDs before owner-safe upserts and default selection', async () => {
  const sql = createSqlStub([[{ import_guard: 1 }], [{ id: 'template-1' }], [templateRow]]);
  const database = createPostgresDatabase(sql);

  const imported = await database.importConversationTemplates('owner-a', [{
    id: 'template-1',
    pageId: 'page-1',
    name: 'Template',
    template: { greeting: 'Hello' },
    isDefault: true,
    createdAt: 1,
    updatedAt: 2
  }]);

  assert.deepEqual(imported, {
    id: 'template-1',
    ownerMetaUserId: 'owner-a',
    pageId: 'page-1',
    name: 'Template',
    template: { greeting: 'Hello' },
    isDefault: true,
    createdAt: 1,
    updatedAt: 2
  });
  assert.equal(sql.transactionCalls.length, 1);
  assert.equal(sql.transactionCalls[0].length, 3);
  assert.match(sql.calls[0].text, /ANY\(\?::text\[\]\)/);
  assert.doesNotMatch(sql.calls[0].text, /1 \/ 0/);
  assert.match(sql.calls[0].text, /COUNT\(\*\) FROM conflicts/);
  assert.match(sql.calls[1].text, /WHERE conversation_templates\.owner_meta_user_id = EXCLUDED\.owner_meta_user_id/);
  assert.doesNotMatch(sql.calls[2].text, /1 \/ 0/);
  assert.match(sql.calls[2].text, /COUNT\(\*\) FROM selected/);
});

test('Postgres batch import selects one default template per Page', async () => {
  const secondTemplateRow = {
    ...templateRow,
    id: 'template-2',
    page_id: 'page-2',
    name: 'Template 2'
  };
  const sql = createSqlStub([
    [{ import_guard: 1 }],
    [{ id: 'template-1' }],
    [{ id: 'template-2' }],
    [templateRow],
    [secondTemplateRow]
  ]);
  const database = createPostgresDatabase(sql);

  await database.importConversationTemplates('owner-a', [
    {
      id: 'template-1',
      pageId: 'page-1',
      name: 'Template 1',
      template: { greeting: 'Hello 1' },
      isDefault: true,
      createdAt: 1,
      updatedAt: 2
    },
    {
      id: 'template-2',
      pageId: 'page-2',
      name: 'Template 2',
      template: { greeting: 'Hello 2' },
      isDefault: true,
      createdAt: 1,
      updatedAt: 2
    }
  ]);

  assert.equal(sql.transactionCalls[0].length, 5);
  assert.equal(sql.calls.slice(-2).every(({ text }) => /COUNT\(\*\) FROM selected/.test(text)), true);
});

test('Postgres single-template import preserves a cross-owner row on ID conflict', async () => {
  const sql = createSqlStub([[]]);
  const database = createPostgresDatabase(sql);

  await assert.rejects(database.importConversationTemplate('owner-b', {
    id: 'template-1',
    pageId: 'page-1',
    name: 'Template',
    template: { greeting: 'Hello' },
    isDefault: false,
    createdAt: 1,
    updatedAt: 2
  }), /owner/i);
  assert.match(sql.calls[0].text, /WHERE conversation_templates\.owner_meta_user_id = EXCLUDED\.owner_meta_user_id/);
});

test('Postgres maps run reports and owner-scoped paginated history', async () => {
  const snapshot = { version: 1, adAccountId: 'act_1', campaigns: [] };
  const sql = createSqlStub([
    [{
      id: 'run-1', owner_meta_user_id: 'owner-a', status: 'completed', ad_account_id: 'act_1',
      snapshot_json: snapshot, created_at: '1000', completed_at: '2000'
    }],
    [{
      client_id: 'ad-1', parent_client_id: 'adset-1', type: 'ad', name: 'VIDEO', status: 'created',
      remote_id: 'meta-ad', post_id: 'page_1', permalink_url: 'https://www.facebook.com/reel/1', error_json: null
    }],
    [{
      id: 'run-1', status: 'completed', ad_account_id: 'act_1', snapshot_json: snapshot,
      created_at: '1000', completed_at: '2000', total_count: '1', created_count: '1', failed_count: '0',
      skipped_count: '0', campaign_count: '0', adset_count: '0', ad_count: '1'
    }],
    [{
      run_id: 'run-1', client_id: 'ad-1', parent_client_id: 'adset-1', type: 'ad', name: 'VIDEO', status: 'created',
      remote_id: 'meta-ad', post_id: 'page_1', permalink_url: 'https://www.facebook.com/reel/1', error_json: null
    }]
  ]);
  const database = createPostgresDatabase(sql);

  const detail = await database.getRun('run-1');
  const history = await database.listRuns('owner-a', { from: 500, to: 1_500, limit: 20, offset: 40 });

  assert.equal(detail.createdAt, 1_000);
  assert.equal(detail.completedAt, 2_000);
  assert.equal(detail.legacy, false);
  assert.equal(detail.nodes[0].name, 'VIDEO');
  assert.equal(detail.nodes[0].permalinkUrl, 'https://www.facebook.com/reel/1');
  assert.deepEqual(history.items[0].counts, {
    total: 1, created: 1, failed: 0, skipped: 0, campaigns: 0, adSets: 0, ads: 1
  });
  assert.deepEqual(history.items[0].campaigns, []);
  assert.equal(history.nextOffset, null);
  assert.deepEqual(sql.calls[2].values, ['owner-a', 500, 1_500, 21, 40]);
});

test('Postgres seeding template CRUD maps JSON and scopes every mutation by owner', async () => {
  const sql = createSqlStub([
    [seedingTemplateRow],
    [seedingTemplateRow],
    [{ ...seedingTemplateRow, id: 'seed-template-2', name: 'Bản sao', updated_at: '3000' }],
    [{ id: 'seed-template-1' }]
  ]);
  const database = createPostgresDatabase(sql);

  const created = await database.createSeedingTemplate({
    id: 'seed-template-1', ownerMetaUserId: 'owner-a', name: 'Triệt nách nữ',
    items: [{ id: 'item-1', message: 'Comment 1', imageMediaId: null }], now: 1_000
  });
  const updated = await database.updateSeedingTemplate({
    ownerMetaUserId: 'owner-a', id: 'seed-template-1', name: 'Triệt nách nữ', items: created.items, now: 2_000
  });
  const duplicate = await database.duplicateSeedingTemplate({
    ownerMetaUserId: 'owner-a', id: 'seed-template-1', newId: 'seed-template-2', name: 'Bản sao', now: 3_000
  });
  const deleted = await database.deleteSeedingTemplate('owner-a', 'seed-template-1');

  assert.equal(created.createdAt, 1_000);
  assert.equal(updated.updatedAt, 2_000);
  assert.equal(duplicate.id, 'seed-template-2');
  assert.equal(deleted, true);
  assert.match(sql.calls[1].text, /owner_meta_user_id = \?/);
  assert.match(sql.calls[2].text, /SELECT.+FROM seeding_templates/s);
  assert.match(sql.calls[2].text, /INSERT INTO seeding_templates/s);
  assert.deepEqual(sql.calls[3].values.slice(0, 2), ['owner-a', 'seed-template-1']);
});

test('Postgres Campaign preset CRUD maps JSON and scopes every query by owner', async () => {
  const updatedRow = {
    ...campaignPresetRow,
    name: 'Triệt bikini nữ mới',
    updated_at: '3000'
  };
  const sql = createSqlStub([
    [campaignPresetRow],
    [campaignPresetRow],
    [campaignPresetRow],
    [updatedRow],
    [{ id: 'campaign-preset-1' }]
  ]);
  const database = createPostgresDatabase(sql);

  const created = await database.createCampaignPreset({
    id: 'campaign-preset-1', ownerMetaUserId: 'owner-a', name: campaignPresetRow.name,
    content: campaignPresetContent, now: 1_000
  });
  const listed = await database.listCampaignPresets('owner-a');
  const found = await database.getCampaignPreset('owner-a', 'campaign-preset-1');
  const updated = await database.updateCampaignPreset({
    ownerMetaUserId: 'owner-a', id: 'campaign-preset-1', name: updatedRow.name,
    content: campaignPresetContent, now: 3_000
  });
  const deleted = await database.deleteCampaignPreset('owner-a', 'campaign-preset-1');

  assert.deepEqual(created.content, campaignPresetContent);
  assert.equal(created.createdAt, 1_000);
  assert.equal(listed[0].id, 'campaign-preset-1');
  assert.equal(found.ownerMetaUserId, 'owner-a');
  assert.equal(updated.name, 'Triệt bikini nữ mới');
  assert.equal(updated.updatedAt, 3_000);
  assert.equal(deleted, true);
  assert.ok(sql.calls.slice(1).every(({ text }) => /owner_meta_user_id = \?/.test(text)));
});

test('Postgres duplicates an empty seeding template as an empty item array', async () => {
  const emptyDuplicateRow = {
    ...seedingTemplateRow,
    id: 'seed-template-2',
    name: 'Empty copy',
    items_json: '[]',
    updated_at: '3000'
  };
  const sql = createSqlStub([[emptyDuplicateRow]]);
  const database = createPostgresDatabase(sql);

  const duplicate = await database.duplicateSeedingTemplate({
    ownerMetaUserId: 'owner-a', id: 'seed-template-empty', newId: 'seed-template-2', name: 'Empty copy', now: 3_000
  });

  assert.deepEqual(duplicate.items, []);
  assert.match(sql.calls[0].text, /COALESCE\([\s\S]*jsonb_agg\(/);
  assert.match(sql.calls[0].text, /'\[\]'::jsonb/);
  assert.doesNotMatch(sql.calls[0].text, /copied\.items_json IS NOT NULL/);
});

test('Postgres inserts seeding jobs only when every run belongs to the owner', async () => {
  const sql = createSqlStub([[], [{ count: '0', conflict: false }]]);
  const database = createPostgresDatabase(sql);

  assert.equal(await database.insertSeedingJobs('owner-b', [{
    id: 'seed-job-1', runId: 'run-1', campaignClientId: 'campaign-1', pageId: 'page-1', postId: 'post-1',
    itemId: 'item-1', position: 0, sequence: 0, message: 'Comment 1', createdAt: 1_000
  }]), 0);

  assert.equal(sql.transactionCalls.length, 1);
  assert.equal(sql.transactionCalls[0].length, 2);
  assert.equal(sql.calls.length, 2);
  assert.match(sql.calls[0].text, /FROM runs/);
  assert.match(sql.calls[0].text, /runs\.owner_meta_user_id = \?/);
  assert.match(sql.calls[0].text, /FOR UPDATE/);
  assert.match(sql.calls[1].text, /NOT EXISTS/);
  assert.match(sql.calls[1].text, /SELECT DISTINCT run_id/);
  assert.match(sql.calls[1].text, /COUNT\(DISTINCT campaign_client_id\)/);
  assert.match(sql.calls[1].text, /existing\.campaign_client_id <> input_jobs\.campaign_client_id/);
});

test('Postgres reports guarded seeding Post conflicts with a stable error code', async () => {
  const sql = createSqlStub([[{ id: 'run-1' }], [{ count: '0', conflict: true }]]);
  const database = createPostgresDatabase(sql);

  await assert.rejects(database.insertSeedingJobs('owner-a', [{
    id: 'seed-job-1', runId: 'run-1', campaignClientId: 'campaign-2', pageId: 'page-1', postId: 'post-1',
    itemId: 'item-1', position: 0, sequence: 0, message: 'Comment 1', createdAt: 1_000
  }]), (error) => error?.code === 'SEEDING_POST_CONFLICT');

  assert.equal(sql.transactionCalls.length, 1);
  assert.equal(sql.transactionCalls[0].length, 2);
  assert.match(sql.calls[0].text, /FOR UPDATE/);
  assert.match(sql.calls[1].text, /seeding_jobs AS existing/);
});

test('Postgres guarded seeding insert preserves successful and idempotent counts', async () => {
  const sql = createSqlStub([
    [{ id: 'run-1' }],
    [{ count: '2', conflict: false }],
    [{ id: 'run-1' }],
    [{ count: '0', conflict: false }]
  ]);
  const database = createPostgresDatabase(sql);
  const jobs = [{
    id: 'seed-job-1', runId: 'run-1', campaignClientId: 'campaign-1', pageId: 'page-1', postId: 'post-1',
    itemId: 'item-1', position: 0, sequence: 0, message: 'Comment 1', createdAt: 1_000
  }, {
    id: 'seed-job-2', runId: 'run-1', campaignClientId: 'campaign-1', pageId: 'page-1', postId: 'post-1',
    itemId: 'item-2', position: 1, sequence: 0, message: 'Comment 2', createdAt: 1_000
  }];

  assert.equal(await database.insertSeedingJobs('owner-a', jobs), 2);
  assert.equal(await database.insertSeedingJobs('owner-a', jobs), 0);
  assert.equal(sql.transactionCalls.length, 2);
});

test('Postgres claim serializes by owner run and uses SKIP LOCKED for one atomic claim', async () => {
  const sql = createSqlStub([[], [], [seedingJobRow]]);
  const database = createPostgresDatabase(sql);

  const claimed = await database.claimNextSeedingJob({
    ownerMetaUserId: 'owner-a', runId: 'run-1', now: 2_000, staleBefore: 1_500
  });

  assert.equal(claimed.id, 'seed-job-1');
  assert.equal(claimed.attemptCount, 1);
  assert.equal(sql.transactionCalls.length, 1);
  assert.equal(sql.transactionCalls[0].length, 3);
  assert.match(sql.calls[0].text, /FROM runs/);
  assert.match(sql.calls[0].text, /owner_meta_user_id = \?/);
  assert.match(sql.calls[0].text, /FOR UPDATE/);
  assert.match(sql.calls[1].text, /status = 'needs_review'/);
  assert.match(sql.calls[1].text, /started_at < \?/);
  assert.match(sql.calls[2].text, /FOR UPDATE SKIP LOCKED/);
  assert.match(sql.calls[2].text, /prior\.position < candidate_job\.position/);
  assert.match(sql.calls[2].text, /prior\.status IN \('pending', 'posting', 'needs_review'\)/);
  assert.match(sql.calls[2].text, /attempt_count = candidate_job\.attempt_count \+ 1/);
});

test('Postgres finish atomically delays pending jobs and transition helpers remain owner-scoped', async () => {
  const finishedRow = {
    ...seedingJobRow,
    status: 'created',
    meta_comment_id: 'comment-1',
    completed_at: '2500',
    updated_at: '2500'
  };
  const sql = createSqlStub([
    [finishedRow],
    [{ ...seedingJobRow, status: 'pending', started_at: null, updated_at: '2600' }],
    [{ ...finishedRow, error_json: { manualConfirmation: true }, updated_at: '2700' }],
    [{ count: '2' }],
    [{ count: '2' }]
  ]);
  const database = createPostgresDatabase(sql);

  await database.finishSeedingJob({
    ownerMetaUserId: 'owner-a', runId: 'run-1', jobId: 'seed-job-1', status: 'created',
    metaCommentId: 'comment-1', error: null, now: 2_500, nextAvailableAt: 5_500
  });
  await database.retrySeedingJob({ ownerMetaUserId: 'owner-a', runId: 'run-1', jobId: 'seed-job-1', now: 2_600 });
  const confirmed = await database.confirmSeedingJob({
    ownerMetaUserId: 'owner-a', runId: 'run-1', jobId: 'seed-job-1', metaCommentId: 'manual-1', now: 2_700
  });
  assert.equal(await database.cancelSeedingJobs('owner-a', 'run-1', 2_800), 2);
  assert.equal(await database.resumeSeedingJobs('owner-a', 'run-1', 3_000), 2);

  assert.deepEqual(confirmed.error, { manualConfirmation: true });
  assert.match(sql.calls[0].text, /WITH finished AS/);
  assert.match(sql.calls[0].text, /GREATEST\(available_at, \?\)/);
  assert.match(sql.calls[0].text, /EXISTS \(SELECT 1 FROM finished\)/);
  assert.equal(sql.calls.slice(0, 5).every(({ text }) => /owner_meta_user_id = \?/.test(text)), true);
  assert.match(sql.calls[1].text, /status IN \('failed', 'needs_review'\)/);
  assert.match(sql.calls[2].text, /status = 'needs_review'/);
  assert.match(sql.calls[3].text, /status = 'pending'/);
  assert.match(sql.calls[4].text, /available_at = \?/);
});

test('Postgres workflow lease operations use guarded atomic updates', async () => {
  const sql = createSqlStub([
    [{ id: 'run-1' }],
    [],
    [{ id: 'run-1' }],
    [{ id: 'run-1' }],
    [{ id: 'run-1' }]
  ]);
  const database = createPostgresDatabase(sql);

  assert.equal(await database.claimWorkflowLease('run-1', 'token-a', 1_000, 600_000), true);
  assert.equal(await database.claimWorkflowLease('run-1', 'token-b', 1_001, 600_000), false);
  assert.equal(await database.renewWorkflowLease('run-1', 'token-a', 2_000, 600_000), true);
  assert.equal(await database.isWorkflowLeaseCurrent('run-1', 'token-a', 2_001), true);
  assert.equal(await database.releaseWorkflowLease('run-1', 'token-a'), true);

  assert.match(sql.calls[0].text, /workflow_lease_expires_at <= \?/);
  assert.match(sql.calls[2].text, /workflow_token = \?/);
  assert.match(sql.calls[3].text, /workflow_lease_expires_at > \?/);
  assert.match(sql.calls[4].text, /SET workflow_token = NULL/);
});

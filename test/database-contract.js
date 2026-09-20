import test from 'node:test';
import assert from 'node:assert/strict';

const encryptedConnectionFixture = {
  metaUserName: 'Minh',
  accessTokenCiphertext: 'encrypted-value'
};

const templateFixture = {
  id: 'template-1',
  pageId: 'page-1',
  name: 'Welcome',
  template: { greeting: 'Hello' }
};

const mediaFixture = {
  id: 'media-1',
  ownerMetaUserId: 'meta-user-1',
  name: 'image.jpg',
  mimeType: 'image/jpeg',
  content: Buffer.from('image'),
  sizeBytes: 5
};

const runFixture = {
  id: 'run-1',
  ownerMetaUserId: 'meta-user-1',
  status: 'creating'
};

const seedingItemFixture = {
  id: 'item-1',
  message: 'Comment 1',
  imageMediaId: null
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

function seedingJob(overrides = {}) {
  return {
    id: 'seed-job-1',
    runId: 'run-1',
    campaignClientId: 'campaign-1',
    pageId: 'page-1',
    postId: 'post-1',
    itemId: 'item-1',
    position: 0,
    sequence: 0,
    message: 'Comment 1',
    imageMediaId: null,
    status: 'pending',
    metaCommentId: null,
    error: null,
    attemptCount: 0,
    availableAt: 1_000,
    startedAt: null,
    completedAt: null,
    createdAt: 1_000,
    updatedAt: 1_000,
    ...overrides
  };
}

export function registerDatabaseContract(name, createDatabase) {
  test(`${name} stores sessions, connections, templates, media metadata, and runs`, async () => {
    const database = await createDatabase();
    const session = await database.createSession();
    await database.attachMetaUser(session.id, 'meta-user-1');
    await database.upsertConnection('meta-user-1', encryptedConnectionFixture);
    const template = await database.createConversationTemplate('meta-user-1', templateFixture);
    await database.saveMedia(mediaFixture);
    await database.createRun(runFixture);

    assert.equal((await database.getSession(session.id)).metaUserId, 'meta-user-1');
    assert.equal((await database.getConnection('meta-user-1')).metaUserId, 'meta-user-1');
    assert.equal((await database.getConversationTemplate('meta-user-1', template.id)).id, template.id);
    assert.equal((await database.getMedia('meta-user-1', 'media-1')).id, 'media-1');
    assert.equal((await database.getRun('run-1')).id, 'run-1');
  });

  test(`${name} grants one workflow lease per run and only allows takeover after expiry`, async () => {
    const database = await createDatabase();
    await database.createRun(runFixture);

    assert.equal(await database.claimWorkflowLease('run-1', 'workflow-a', 1_000, 600_000), true);
    assert.equal(await database.claimWorkflowLease('run-1', 'workflow-b', 1_001, 600_000), false);
    assert.equal(await database.renewWorkflowLease('run-1', 'workflow-a', 2_000, 600_000), true);
    assert.equal(await database.isWorkflowLeaseCurrent('run-1', 'workflow-a', 601_999), true);
    assert.equal(await database.claimWorkflowLease('run-1', 'workflow-b', 602_000, 600_000), true);
    assert.equal(await database.isWorkflowLeaseCurrent('run-1', 'workflow-a', 602_000), false);
    assert.equal(await database.releaseWorkflowLease('run-1', 'workflow-a'), false);
    assert.equal(await database.releaseWorkflowLease('run-1', 'workflow-b'), true);
    assert.equal(await database.claimWorkflowLease('run-1', 'workflow-c', 602_001, 600_000), true);
  });

  test(`${name} consumes pairing codes once and owner-scopes device lookup and revocation`, async () => {
    const database = await createDatabase();
    await database.createUploadAgentPairingCode({
      codeHash: 'pairing-hash',
      ownerMetaUserId: 'owner-a',
      expiresAt: 2_000,
      createdAt: 1_000
    });

    assert.deepEqual(await database.consumeUploadAgentPairingCode('pairing-hash', 1_999), {
      ownerMetaUserId: 'owner-a'
    });
    assert.equal(await database.consumeUploadAgentPairingCode('pairing-hash', 1_999), null);

    await database.createUploadAgentPairingCode({
      codeHash: 'expired-hash',
      ownerMetaUserId: 'owner-a',
      expiresAt: 3_000,
      createdAt: 2_000
    });
    assert.equal(await database.consumeUploadAgentPairingCode('expired-hash', 3_000), null);

    const device = await database.saveUploadAgentDevice({
      id: 'device-1',
      ownerMetaUserId: 'owner-a',
      tokenHash: 'token-hash',
      device: { name: 'Studio PC', platform: 'win32' },
      createdAt: 4_000
    });
    assert.equal(device.tokenHash, 'token-hash');
    assert.equal(Object.hasOwn(device, 'token'), false);
    assert.equal(await database.getUploadAgentDevice('owner-b', 'device-1'), null);
    assert.equal(await database.revokeUploadAgentDevice('owner-b', 'device-1', 5_000), false);
    assert.equal((await database.getUploadAgentDevice('owner-a', 'device-1')).revokedAt, null);
    assert.equal(await database.revokeUploadAgentDevice('owner-a', 'device-1', 6_000), true);
    assert.equal((await database.getUploadAgentDevice('owner-a', 'device-1')).revokedAt, 6_000);
  });

  test(`${name} keeps seeding template CRUD owner-scoped and strips transient duplicate data`, async () => {
    const database = await createDatabase();
    const template = await database.createSeedingTemplate({
      id: 'seed-template-1',
      ownerMetaUserId: 'meta-user-1',
      name: 'Triệt nách nữ',
      items: [{ ...seedingItemFixture, blobUrl: 'blob:secret', accessToken: 'secret' }],
      now: 1_000
    });

    assert.deepEqual(Object.keys(template), [
      'id', 'ownerMetaUserId', 'name', 'items', 'createdAt', 'updatedAt'
    ]);
    assert.equal((await database.getSeedingTemplate('meta-user-1', template.id)).name, 'Triệt nách nữ');
    assert.equal(await database.getSeedingTemplate('meta-user-2', template.id), null);

    const updated = await database.updateSeedingTemplate({
      ownerMetaUserId: 'meta-user-1',
      id: template.id,
      name: 'Triệt nách nữ mới',
      items: [{ ...seedingItemFixture, blobUrl: 'blob:secret', accessToken: 'secret' }],
      now: 2_000
    });
    assert.equal(updated.name, 'Triệt nách nữ mới');
    assert.equal(updated.updatedAt, 2_000);
    assert.equal(await database.updateSeedingTemplate({
      ownerMetaUserId: 'meta-user-2', id: template.id, name: 'Foreign', items: [], now: 3_000
    }), null);

    const duplicate = await database.duplicateSeedingTemplate({
      ownerMetaUserId: 'meta-user-1',
      id: template.id,
      newId: 'seed-template-2',
      name: 'Bản sao',
      now: 3_000
    });
    assert.deepEqual(duplicate.items, [seedingItemFixture]);
    assert.deepEqual((await database.listSeedingTemplates('meta-user-1')).map(({ id }) => id), [
      'seed-template-2', 'seed-template-1'
    ]);
    assert.deepEqual(await database.listSeedingTemplates('meta-user-2'), []);
    assert.equal(await database.deleteSeedingTemplate('meta-user-2', template.id), false);
    assert.equal(await database.deleteSeedingTemplate('meta-user-1', template.id), true);
  });

  test(`${name} keeps Campaign preset CRUD owner-scoped`, async () => {
    const database = await createDatabase();
    const preset = await database.createCampaignPreset({
      id: 'campaign-preset-1',
      ownerMetaUserId: 'meta-user-1',
      name: 'Triệt bikini nữ',
      content: campaignPresetContent,
      now: 1_000
    });

    assert.deepEqual(Object.keys(preset), [
      'id', 'ownerMetaUserId', 'name', 'content', 'createdAt', 'updatedAt'
    ]);
    assert.deepEqual(preset.content, campaignPresetContent);
    assert.equal(await database.getCampaignPreset('meta-user-2', preset.id), null);
    assert.deepEqual(await database.listCampaignPresets('meta-user-2'), []);

    const updated = await database.updateCampaignPreset({
      ownerMetaUserId: 'meta-user-1',
      id: preset.id,
      name: 'Triệt bikini nữ mới',
      content: { ...campaignPresetContent, campaignName: 'Campaign mới' },
      now: 2_000
    });
    assert.equal(updated.name, 'Triệt bikini nữ mới');
    assert.equal(updated.content.campaignName, 'Campaign mới');
    assert.equal(updated.updatedAt, 2_000);
    assert.equal(await database.updateCampaignPreset({
      ownerMetaUserId: 'meta-user-2', id: preset.id, name: 'Foreign', content: campaignPresetContent, now: 3_000
    }), null);

    assert.equal(await database.deleteCampaignPreset('meta-user-2', preset.id), false);
    assert.equal(await database.deleteCampaignPreset('meta-user-1', preset.id), true);
  });

  test(`${name} inserts seeding jobs idempotently and never exposes another owner's run`, async () => {
    const database = await createDatabase();
    await database.createRun(runFixture);
    await database.createRun({ id: 'run-2', ownerMetaUserId: 'meta-user-2', status: 'creating' });
    const jobFixture = seedingJob();

    assert.equal(await database.insertSeedingJobs('meta-user-2', [jobFixture]), 0);
    assert.equal(await database.insertSeedingJobs('meta-user-1', [
      jobFixture,
      seedingJob({ id: 'seed-job-2', runId: 'run-2', itemId: 'item-2' })
    ]), 0);
    assert.equal(await database.insertSeedingJobs('meta-user-1', [jobFixture]), 1);
    await database.insertSeedingJobs('meta-user-1', [jobFixture, seedingJob({ id: 'duplicate-key' })]);

    const jobs = await database.listSeedingJobs('meta-user-1', 'run-1');
    assert.equal(jobs.length, 1);
    assert.deepEqual(jobs[0], { ...jobFixture, ownerMetaUserId: 'meta-user-1' });
    assert.deepEqual(await database.listSeedingJobs('meta-user-2', 'run-1'), []);
  });

  test(`${name} atomically rejects opposing Campaign selections for one run Post`, async () => {
    const database = await createDatabase();
    await database.createRun(runFixture);
    const firstSelection = [
      seedingJob(),
      seedingJob({ id: 'seed-job-2', itemId: 'item-2', position: 1, message: 'Comment 2' })
    ];
    const opposingSelection = [
      seedingJob({ id: 'seed-job-3', campaignClientId: 'campaign-2' }),
      seedingJob({ id: 'seed-job-4', campaignClientId: 'campaign-2', itemId: 'item-2', position: 1, message: 'Comment 2' })
    ];

    assert.equal(await database.insertSeedingJobs('meta-user-1', firstSelection), 2);
    await assert.rejects(
      async () => database.insertSeedingJobs('meta-user-1', opposingSelection),
      (error) => error?.code === 'SEEDING_POST_CONFLICT'
    );

    const jobs = await database.listSeedingJobs('meta-user-1', 'run-1');
    assert.equal(jobs.length, 2);
    assert.deepEqual([...new Set(jobs.map(({ campaignClientId }) => campaignClientId))], ['campaign-1']);
  });

  test(`${name} rejects a conflicting Campaign selection inside one batch without partial inserts`, async () => {
    const database = await createDatabase();
    await database.createRun(runFixture);

    await assert.rejects(async () => database.insertSeedingJobs('meta-user-1', [
      seedingJob(),
      seedingJob({ id: 'seed-job-2', campaignClientId: 'campaign-2', itemId: 'item-2' })
    ]), (error) => error?.code === 'SEEDING_POST_CONFLICT');

    assert.deepEqual(await database.listSeedingJobs('meta-user-1', 'run-1'), []);
  });

  test(`${name} claims one ordered seeding job, enforces predecessor creation, and applies delay`, async () => {
    const database = await createDatabase();
    await database.createRun(runFixture);
    await database.insertSeedingJobs('meta-user-1', [
      seedingJob(),
      seedingJob({ id: 'seed-job-2', itemId: 'item-2', position: 1, message: 'Comment 2' }),
      seedingJob({ id: 'seed-job-3', campaignClientId: 'campaign-2', postId: 'post-2', itemId: 'item-3', sequence: 1 })
    ]);

    const [firstClaim, competingClaim] = await Promise.all([
      database.claimNextSeedingJob({ ownerMetaUserId: 'meta-user-1', runId: 'run-1', now: 1_000, staleBefore: 500 }),
      database.claimNextSeedingJob({ ownerMetaUserId: 'meta-user-1', runId: 'run-1', now: 1_000, staleBefore: 500 })
    ]);
    assert.equal(firstClaim.id, 'seed-job-1');
    assert.equal(firstClaim.status, 'posting');
    assert.equal(firstClaim.attemptCount, 1);
    assert.equal(competingClaim, null);

    assert.equal(await database.finishSeedingJob({
      ownerMetaUserId: 'meta-user-2', runId: 'run-1', jobId: 'seed-job-1', status: 'created',
      metaCommentId: 'foreign', error: null, now: 2_000, nextAvailableAt: 5_500
    }), null);
    const finished = await database.finishSeedingJob({
      ownerMetaUserId: 'meta-user-1', runId: 'run-1', jobId: 'seed-job-1', status: 'created',
      metaCommentId: 'comment-1', error: null, now: 2_000, nextAvailableAt: 5_500
    });
    assert.equal(finished.status, 'created');
    assert.equal(finished.metaCommentId, 'comment-1');
    assert.equal(await database.claimNextSeedingJob({
      ownerMetaUserId: 'meta-user-1', runId: 'run-1', now: 5_499, staleBefore: 4_000
    }), null);

    const second = await database.claimNextSeedingJob({
      ownerMetaUserId: 'meta-user-1', runId: 'run-1', now: 5_500, staleBefore: 4_000
    });
    assert.equal(second.id, 'seed-job-2');
    assert.equal(second.startedAt, 5_500);
  });

  test(`${name} never leapfrogs an unavailable earlier comment on the same post`, async () => {
    const database = await createDatabase();
    await database.createRun(runFixture);
    await database.insertSeedingJobs('meta-user-1', [
      seedingJob({ availableAt: 2_000 }),
      seedingJob({ id: 'seed-job-2', itemId: 'item-2', position: 1, message: 'Comment 2' })
    ]);

    assert.equal(await database.claimNextSeedingJob({
      ownerMetaUserId: 'meta-user-1', runId: 'run-1', now: 1_000, staleBefore: 500
    }), null);
  });

  test(`${name} reviews stale posting jobs and owner-scopes retry, confirm, cancel, and resume`, async () => {
    const database = await createDatabase();
    await database.createRun(runFixture);
    await database.insertSeedingJobs('meta-user-1', [
      seedingJob(),
      seedingJob({ id: 'seed-job-2', campaignClientId: 'campaign-2', postId: 'post-2', itemId: 'item-2', sequence: 1 }),
      seedingJob({ id: 'seed-job-3', campaignClientId: 'campaign-3', postId: 'post-3', itemId: 'item-3', sequence: 2 })
    ]);
    await database.claimNextSeedingJob({ ownerMetaUserId: 'meta-user-1', runId: 'run-1', now: 1_000, staleBefore: 0 });

    const replacement = await database.claimNextSeedingJob({
      ownerMetaUserId: 'meta-user-1', runId: 'run-1', now: 2_000, staleBefore: 1_500
    });
    assert.equal(replacement.id, 'seed-job-2');
    let jobs = await database.listSeedingJobs('meta-user-1', 'run-1');
    assert.equal(jobs.find(({ id }) => id === 'seed-job-1').status, 'needs_review');
    assert.equal(jobs.filter(({ status }) => status === 'posting').length, 1);

    assert.equal(await database.retrySeedingJob({
      ownerMetaUserId: 'meta-user-2', runId: 'run-1', jobId: 'seed-job-1', now: 2_100
    }), null);
    const retried = await database.retrySeedingJob({
      ownerMetaUserId: 'meta-user-1', runId: 'run-1', jobId: 'seed-job-1', now: 2_100
    });
    assert.equal(retried.status, 'pending');

    await database.finishSeedingJob({
      ownerMetaUserId: 'meta-user-1', runId: 'run-1', jobId: 'seed-job-2', status: 'needs_review',
      metaCommentId: null, error: { message: 'Unknown result' }, now: 2_200, nextAvailableAt: 2_200
    });
    const confirmed = await database.confirmSeedingJob({
      ownerMetaUserId: 'meta-user-1', runId: 'run-1', jobId: 'seed-job-2', metaCommentId: 'manual-2', now: 2_300
    });
    assert.equal(confirmed.status, 'created');
    assert.equal(confirmed.metaCommentId, 'manual-2');
    assert.deepEqual(confirmed.error, { manualConfirmation: true });

    assert.equal(await database.cancelSeedingJobs('meta-user-2', 'run-1', 2_400), 0);
    assert.equal(await database.cancelSeedingJobs('meta-user-1', 'run-1', 2_400), 2);
    assert.equal(await database.resumeSeedingJobs('meta-user-1', 'run-1', 3_000), 2);
    jobs = await database.listSeedingJobs('meta-user-1', 'run-1');
    assert.equal(jobs.find(({ id }) => id === 'seed-job-1').availableAt, 3_000);
    assert.equal(jobs.find(({ id }) => id === 'seed-job-3').availableAt, 3_000);
  });
}

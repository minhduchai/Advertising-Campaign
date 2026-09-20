import test from 'node:test';
import assert from 'node:assert/strict';
import { publishDraft } from '../src/publisher.js';

const ad = {
  clientId: 'ad-1',
  name: 'Ad 1',
  primaryText: 'Chat now',
  headline: 'Offer',
  mediaId: 'media-image',
  conversation: {
    sourceTemplateId: null,
    templateName: 'Mẫu tư vấn',
    greeting: 'Chào bạn',
    quickReplies: [],
    showBusinessPhoneNumber: false,
    businessPhoneNumber: '',
    customerActions: [{
      id: 'button-1',
      label: 'Đăng Ký Ngay',
      type: 'OPEN_URL',
      value: 'https://lgclinic.vn/dang-ky'
    }]
  }
};

test('uses a direct Meta image asset without uploading media again', async () => {
  const directDraft = structuredClone(draft);
  directDraft.campaigns[0].adSets[0].ads[0].mediaAsset = {
    kind: 'image',
    accountId: 'act_1',
    imageHash: 'direct-image-hash',
    name: 'direct.jpg',
    mimeType: 'image/jpeg',
    sizeBytes: 123
  };
  let uploadCalls = 0;
  let creativeParams;

  await publishDraft({
    draft: directDraft,
    token: 'token',
    runId: 'run-direct-image',
    getMedia: async () => ({
      mimeType: 'image/jpeg',
      metaImageHash: 'direct-image-hash',
      name: 'direct.jpg'
    }),
    metaClient: {
      createCampaign: async () => 'campaign-remote',
      createAdSet: async () => 'adset-remote',
      uploadImage: async () => { uploadCalls += 1; return 'uploaded-again'; },
      createCreative: async (_token, _accountId, params) => {
        creativeParams = params;
        return 'creative-remote';
      },
      createAd: async () => 'ad-remote',
      getAdPublication: async () => ({})
    }
  });

  assert.equal(uploadCalls, 0);
  assert.equal(new URLSearchParams(creativeParams).get('object_story_spec').includes('direct-image-hash'), true);
});

const draft = {
  campaigns: [{
    clientId: 'campaign-1',
    name: 'Campaign 1',
    adAccountId: 'act_1',
    pageId: 'page_1',
    specialAdCategory: 'NONE',
    budgetStrategy: 'AD_SET',
    dailyBudget: 0,
    adSets: [{
      clientId: 'adset-1',
      name: 'Ad set 1',
      dailyBudget: 100000,
      locationMode: 'REGIONS',
      includedRegions: [{
        key: '3984',
        name: 'Thành phố Hồ Chí Minh',
        type: 'region',
        countryCode: 'VN'
      }],
      excludedRegions: [],
      ageMin: 18,
      ageMax: 45,
      genders: [],
      includedCustomAudienceIds: [],
      excludedCustomAudienceIds: [],
      detailedTargeting: [],
      advantageAudienceEnabled: false,
      startTime: '',
      endTime: '',
      ads: [ad]
    }]
  }]
};

function draftWithTwoAdSets(adSetOverrides, campaignOverrides = {}) {
  const adSets = adSetOverrides.map((overrides, index) => ({
    clientId: overrides.clientId,
    name: `Ad Set ${index + 1}`,
    dailyBudget: 100000,
    locationMode: 'REGIONS',
    includedRegions: [{
      key: '3984',
      name: 'Thành phố Hồ Chí Minh',
      type: 'region',
      countryCode: 'VN'
    }],
    excludedRegions: [],
    ageMin: 18,
    ageMax: 45,
    genders: [],
    includedCustomAudienceIds: [],
    excludedCustomAudienceIds: [],
    detailedTargeting: [],
    advantageAudienceEnabled: false,
    startTime: '',
    endTime: '',
    ads: [{ ...ad, clientId: `ad-${index + 1}` }]
  }));
  return {
    campaigns: [{
      clientId: 'campaign-1',
      name: 'Campaign 1',
      adAccountId: campaignOverrides.adAccountId ?? 'act_1',
      pageId: campaignOverrides.pageId ?? adSetOverrides[0]?.pageId ?? 'page-1',
      specialAdCategory: 'NONE',
      budgetStrategy: 'AD_SET',
      dailyBudget: 0,
      adSets
    }]
  };
}

function draftWithCampaigns(campaignOverrides) {
  return {
    campaigns: campaignOverrides.map((overrides, index) => ({
      ...structuredClone(draft.campaigns[0]),
      clientId: overrides.clientId ?? `campaign-${index + 1}`,
      name: overrides.name ?? `Campaign ${index + 1}`,
      adAccountId: overrides.adAccountId,
      pageId: overrides.pageId,
      adSets: [{
        ...structuredClone(draft.campaigns[0].adSets[0]),
        clientId: overrides.adSetId ?? `adset-${index + 1}`,
        name: `Ad Set ${index + 1}`,
        ads: [{ ...structuredClone(ad), clientId: `ad-${index + 1}` }]
      }]
    }))
  };
}

function shareAllAds(nextDraft, creativeGroupId = 'shared-creative') {
  for (const campaign of nextDraft.campaigns) {
    for (const adSet of campaign.adSets) {
      for (const nextAd of adSet.ads) {
        nextAd.creativeGroupId = creativeGroupId;
      }
    }
  }
  return nextDraft;
}

function imageFixture() {
  return {
    id: 'media-image',
    mimeType: 'image/jpeg',
    name: 'image.jpg',
    content: Buffer.from('image')
  };
}

function recordingMetaClient(calls) {
  return {
    createCampaign: async (_token, accountId, params) => {
      calls.push({ type: 'campaign', accountId, params });
      return 'remote-campaign';
    },
    createAdSet: async (_token, accountId, params) => {
      calls.push({ type: 'adset', accountId, params });
      return `remote-adset-${calls.length}`;
    },
    uploadImage: async () => 'image-hash',
    createCreative: async (_token, accountId, params) => {
      calls.push({ type: 'creative', accountId, params });
      return `remote-creative-${calls.length}`;
    },
    createAd: async (_token, accountId) => {
      calls.push({ type: 'ad', accountId });
      return 'remote-ad';
    }
  };
}

test('creates the parent hierarchy in order and activates every Meta object', async () => {
  const calls = [];
  const result = await publishDraft({
    draft,
    token: 'EAAG-test',
    runId: 'run-1',
    getMedia: () => ({ id: 'media-image', mimeType: 'image/jpeg', name: 'image.jpg', content: Buffer.from('image') }),
    metaClient: {
      createCampaign: async (_token, _accountId, params) => { calls.push({ type: 'campaign', params }); return 'remote-campaign'; },
      createAdSet: async (_token, _accountId, params) => { calls.push({ type: 'adset', params }); return 'remote-adset'; },
      uploadImage: async () => { calls.push({ type: 'image' }); return 'image-hash'; },
      createCreative: async (_token, _accountId, params) => { calls.push({ type: 'creative', params }); return 'remote-creative'; },
      createAd: async (_token, _accountId, params) => { calls.push({ type: 'ad', params }); return 'remote-ad'; }
    }
  });

  assert.deepEqual(calls.map((call) => call.type), ['campaign', 'adset', 'image', 'creative', 'ad']);
  assert.ok(calls.filter((call) => call.params).every((call) => call.params.get('status') === 'ACTIVE' || call.type === 'creative'));
  const creative = JSON.parse(calls.find((call) => call.type === 'creative').params.get('object_story_spec'));
  assert.equal(typeof creative.link_data.page_welcome_message, 'string');
  assert.deepEqual(result.nodes.map((node) => [node.clientId, node.status, node.remoteId]), [
    ['campaign-1', 'created', 'remote-campaign'],
    ['adset-1', 'created', 'remote-adset'],
    ['ad-1', 'created', 'remote-ad']
  ]);
});

test('reports object names and captures a Reel permalink without changing Ad success', async () => {
  const result = await publishDraft({
    draft,
    token: 'EAAG-test',
    runId: 'run-report',
    getMedia: imageFixture,
    metaClient: {
      createCampaign: async () => 'remote-campaign',
      createAdSet: async () => 'remote-adset',
      uploadImage: async () => 'image-hash',
      createCreative: async () => 'remote-creative',
      createAd: async () => 'remote-ad',
      getAdPublication: async () => ({
        postId: 'page-1_123',
        permalinkUrl: 'https://www.facebook.com/reel/123'
      })
    }
  });

  assert.deepEqual(result.nodes.map(({ type, name }) => [type, name]), [
    ['campaign', 'Campaign 1'],
    ['adSet', 'Ad set 1'],
    ['ad', 'Ad 1']
  ]);
  const createdAd = result.nodes.at(-1);
  assert.equal(createdAd.creativeId, 'remote-creative');
  assert.ok(createdAd.creativeArtifactKey);
  assert.deepEqual({
    ...createdAd,
    creativeId: undefined,
    creativeArtifactKey: undefined
  }, {
    clientId: 'ad-1',
    parentClientId: 'adset-1',
    type: 'ad',
    name: 'Ad 1',
    status: 'created',
    remoteId: 'remote-ad',
    postId: 'page-1_123',
    permalinkUrl: 'https://www.facebook.com/reel/123',
    creativeId: undefined,
    creativeArtifactKey: undefined
  });
});

test('keeps a created Ad successful when Meta cannot resolve its permalink', async () => {
  const result = await publishDraft({
    draft,
    token: 'EAAG-test',
    runId: 'run-report-no-link',
    getMedia: imageFixture,
    metaClient: {
      createCampaign: async () => 'remote-campaign',
      createAdSet: async () => 'remote-adset',
      uploadImage: async () => 'image-hash',
      createCreative: async () => 'remote-creative',
      createAd: async () => 'remote-ad',
      getAdPublication: async () => { throw new Error('Story is not ready'); }
    }
  });

  const adResult = result.nodes.find((node) => node.type === 'ad');
  assert.equal(adResult.status, 'created');
  assert.equal(adResult.remoteId, 'remote-ad');
  assert.equal(adResult.permalinkUrl, undefined);
  assert.equal(adResult.error, undefined);
});

test('awaits node result reports before resolving publication', async () => {
  const reported = [];

  await publishDraft({
    draft,
    token: 'EAAG-test',
    runId: 'run-1',
    getMedia: imageFixture,
    onNodeUpdate: async (_runId, node) => {
      await new Promise((resolve) => setTimeout(resolve, 10));
      if (node.status === 'created') reported.push(node.type);
    },
    metaClient: {
      createCampaign: async () => 'remote-campaign',
      createAdSet: async () => 'remote-adset',
      uploadImage: async () => 'image-hash',
      createCreative: async () => 'remote-creative',
      createAd: async () => 'remote-ad'
    }
  });

  assert.deepEqual(reported, ['campaign', 'adSet', 'ad']);
});

test('skips failed parent descendants and continues the next campaign', async () => {
  const twoCampaignDraft = {
    ...draft,
    campaigns: [
      { ...draft.campaigns[0], clientId: 'failed-campaign', name: 'Failed campaign' },
      { ...draft.campaigns[0], clientId: 'successful-campaign', name: 'Successful campaign', adSets: [{ ...draft.campaigns[0].adSets[0], clientId: 'successful-adset', ads: [{ ...ad, clientId: 'successful-ad' }] }] }
    ]
  };
  const result = await publishDraft({
    draft: twoCampaignDraft,
    token: 'EAAG-test',
    runId: 'run-1',
    getMedia: () => ({ id: 'media-image', mimeType: 'image/jpeg', name: 'image.jpg', content: Buffer.from('image') }),
    metaClient: {
      createCampaign: async (_token, _accountId, params) => {
        if (params.get('name') === 'Failed campaign') throw new Error('Campaign rejected');
        return 'remote-campaign';
      },
      createAdSet: async () => 'remote-adset',
      uploadImage: async () => 'image-hash',
      createCreative: async () => 'remote-creative',
      createAd: async () => 'remote-ad'
    }
  });

  assert.equal(result.nodes.find((node) => node.clientId === 'failed-campaign').status, 'failed');
  assert.equal(result.nodes.find((node) => node.clientId === 'adset-1').status, 'skipped');
  assert.equal(result.nodes.find((node) => node.clientId === 'successful-campaign').status, 'created');
  assert.equal(result.nodes.find((node) => node.clientId === 'successful-ad').status, 'created');
});

test('publishes each Campaign through its own account and Page', async () => {
  const calls = [];
  const pageDraft = draftWithCampaigns([
    { adAccountId: 'act_1', pageId: 'page-1', clientId: 'campaign-1', adSetId: 'adset-1' },
    { adAccountId: 'act_2', pageId: 'page-2', clientId: 'campaign-2', adSetId: 'adset-2' }
  ]);

  await publishDraft({
    draft: pageDraft,
    token: 'token',
    runId: 'run-1',
    getMedia: imageFixture,
    metaClient: recordingMetaClient(calls)
  });

  const promotedPages = calls
    .filter((call) => call.type === 'adset')
    .map((call) => JSON.parse(call.params.get('promoted_object')).page_id);
  const creativePages = calls
    .filter((call) => call.type === 'creative')
    .map((call) => JSON.parse(call.params.get('object_story_spec')).page_id);
  const campaignAccounts = calls
    .filter((call) => call.type === 'campaign')
    .map((call) => call.accountId);
  const descendantAccounts = calls
    .filter((call) => ['adset', 'creative', 'ad'].includes(call.type))
    .map((call) => call.accountId);

  assert.deepEqual(campaignAccounts, ['act_1', 'act_2']);
  assert.deepEqual(promotedPages, ['page-1', 'page-2']);
  assert.deepEqual(creativePages, ['page-1', 'page-2']);
  assert.deepEqual(descendantAccounts, ['act_1', 'act_1', 'act_1', 'act_2', 'act_2', 'act_2']);
});

test('creates four linked Ads with the exact same Meta creative', async () => {
  const calls = [];
  const sharedDraft = shareAllAds(draftWithTwoAdSets([
    { pageId: 'page-1', clientId: 'adset-1' },
    { pageId: 'page-1', clientId: 'adset-2' },
    { pageId: 'page-1', clientId: 'adset-3' },
    { pageId: 'page-1', clientId: 'adset-4' }
  ]));

  const result = await publishDraft({
    draft: sharedDraft,
    token: 'token',
    runId: 'run-shared',
    getMedia: imageFixture,
    metaClient: {
      createCampaign: async () => 'remote-campaign',
      createAdSet: async (_token, _accountId, params) => `remote-${params.get('name')}`,
      uploadImage: async () => { calls.push({ type: 'image' }); return 'image-hash'; },
      createCreative: async () => { calls.push({ type: 'creative' }); return 'creative-shared'; },
      createAd: async (_token, _accountId, params) => {
        calls.push({ type: 'ad', creative: JSON.parse(params.get('creative')).creative_id });
        return `remote-ad-${calls.filter((call) => call.type === 'ad').length}`;
      }
    }
  });

  assert.equal(calls.filter(({ type }) => type === 'image').length, 1);
  assert.equal(calls.filter(({ type }) => type === 'creative').length, 1);
  assert.equal(calls.filter(({ type }) => type === 'ad').length, 4);
  assert.deepEqual(calls.filter(({ type }) => type === 'ad').map((call) => call.creative), [
    'creative-shared', 'creative-shared', 'creative-shared', 'creative-shared'
  ]);
  assert.equal(result.nodes.filter((node) => node.type === 'ad' && node.status === 'created').length, 4);
});

test('stops after maxNewNodes Meta objects and reports an incomplete resumable result', async () => {
  const calls = [];
  const result = await publishDraft({
    draft,
    token: 'token',
    runId: 'run-bounded',
    maxNewNodes: 1,
    getMedia: imageFixture,
    metaClient: recordingMetaClient(calls)
  });

  assert.deepEqual(calls.map(({ type }) => type), ['campaign']);
  assert.equal(result.nodes.find((node) => node.clientId === 'campaign-1').remoteId, 'remote-campaign');
  assert.equal(result.nodes.some((node) => node.clientId === 'adset-1'), false);
  assert.equal(result.complete, false);
});

test('resumes from terminal existing nodes and reuses their remote parent IDs', async () => {
  const calls = [];
  const result = await publishDraft({
    draft,
    token: 'token',
    runId: 'run-resume-parent',
    existingNodes: [{
      clientId: 'campaign-1',
      parentClientId: null,
      type: 'campaign',
      name: 'Campaign 1',
      status: 'created',
      remoteId: 'existing-campaign'
    }],
    maxNewNodes: 1,
    getMedia: imageFixture,
    metaClient: recordingMetaClient(calls)
  });

  assert.deepEqual(calls.map(({ type }) => type), ['adset']);
  assert.equal(JSON.parse(calls[0].params.get('promoted_object')).page_id, 'page_1');
  assert.equal(calls[0].params.get('campaign_id'), 'existing-campaign');
  assert.equal(result.complete, false);
});

test('limits a manual retry to the selected Ad even when another Ad has no node', async () => {
  const retryDraft = structuredClone(draft);
  retryDraft.campaigns[0].adSets[0].ads.push({
    ...structuredClone(ad),
    clientId: 'ad-2',
    name: 'Ad 2'
  });
  const createdAds = [];

  const result = await publishDraft({
    draft: retryDraft,
    token: 'token',
    runId: 'run-targeted-retry',
    existingNodes: [
      { clientId: 'campaign-1', type: 'campaign', status: 'created', remoteId: 'remote-campaign' },
      { clientId: 'adset-1', type: 'adSet', status: 'created', remoteId: 'remote-adset' },
      { clientId: 'ad-1', type: 'ad', status: 'retry_pending' }
    ],
    onlyAdClientIds: new Set(['ad-1']),
    getMedia: imageFixture,
    metaClient: {
      createCampaign: async () => { throw new Error('Campaign must be reused'); },
      createAdSet: async () => { throw new Error('Ad Set must be reused'); },
      uploadImage: async () => 'image-hash',
      createCreative: async () => 'creative-retry',
      createAd: async (_token, _accountId, params) => {
        createdAds.push(params.get('name'));
        return 'remote-ad-1';
      }
    }
  });

  assert.deepEqual(createdAds, ['Ad 1']);
  assert.equal(result.nodes.find((node) => node.clientId === 'ad-1').status, 'created');
  assert.equal(result.nodes.some((node) => node.clientId === 'ad-2'), false);
  assert.equal(result.complete, false);
});

test('reuses a shared creative from an existing created Ad across invocations', async () => {
  const sharedDraft = shareAllAds(draftWithTwoAdSets([
    { pageId: 'page_1', clientId: 'adset-1' },
    { pageId: 'page_1', clientId: 'adset-2' }
  ]));
  let creativeCalls = 0;
  let imageCalls = 0;
  let adCalls = 0;
  const metaClient = {
    createCampaign: async () => 'remote-campaign',
    createAdSet: async (_token, _accountId, params) => `remote-${params.get('name')}`,
    uploadImage: async () => { imageCalls += 1; return 'image-hash'; },
    createCreative: async () => { creativeCalls += 1; return 'creative-shared'; },
    createAd: async () => { adCalls += 1; return `remote-ad-${adCalls}`; }
  };

  const first = await publishDraft({
    draft: sharedDraft,
    token: 'token',
    runId: 'run-shared-resume',
    maxNewNodes: 4,
    getMedia: imageFixture,
    metaClient
  });
  const existingAd = first.nodes.find((node) => node.clientId === 'ad-1');

  assert.equal(existingAd.creativeId, 'creative-shared');
  assert.ok(existingAd.creativeArtifactKey);
  assert.equal(first.complete, false);

  const resumed = await publishDraft({
    draft: sharedDraft,
    token: 'token',
    runId: 'run-shared-resume',
    existingNodes: first.nodes,
    getMedia: imageFixture,
    metaClient
  });

  assert.equal(imageCalls, 1);
  assert.equal(creativeCalls, 1);
  assert.equal(adCalls, 2);
  assert.equal(resumed.nodes.find((node) => node.clientId === 'ad-2').creativeId, 'creative-shared');
  assert.equal(resumed.complete, true);
});

test('creates independent Meta Ads for normal new Ads even when content matches', async () => {
  const independentDraft = draftWithTwoAdSets([
    { pageId: 'page-1', clientId: 'adset-1' },
    { pageId: 'page-1', clientId: 'adset-2' }
  ]);
  let creativeCalls = 0;
  let adCalls = 0;

  await publishDraft({
    draft: independentDraft,
    token: 'token',
    runId: 'run-independent',
    getMedia: imageFixture,
    metaClient: {
      createCampaign: async () => 'remote-campaign',
      createAdSet: async () => 'remote-adset',
      uploadImage: async () => 'image-hash',
      createCreative: async () => { creativeCalls += 1; return `creative-${creativeCalls}`; },
      createAd: async () => { adCalls += 1; return `remote-ad-${adCalls}`; }
    }
  });

  assert.equal(creativeCalls, 2);
  assert.equal(adCalls, 2);
});

test('does not share a creative when account, Page, or visible content differs', async () => {
  const pageDraft = shareAllAds(draftWithCampaigns([
    { adAccountId: 'act_1', pageId: 'page-1', clientId: 'campaign-1', adSetId: 'adset-1' },
    { adAccountId: 'act_1', pageId: 'page-2', clientId: 'campaign-2', adSetId: 'adset-2' },
    { adAccountId: 'act_1', pageId: 'page-1', clientId: 'campaign-3', adSetId: 'adset-3' },
    { adAccountId: 'act_2', pageId: 'page-1', clientId: 'campaign-4', adSetId: 'adset-4' }
  ]));
  pageDraft.campaigns[2].adSets[0].ads[0].primaryText = 'Different copy';
  const calls = [];

  await publishDraft({
    draft: pageDraft,
    token: 'token',
    runId: 'run-signatures',
    getMedia: imageFixture,
    metaClient: {
      createCampaign: async () => 'remote-campaign',
      createAdSet: async () => 'remote-adset',
      uploadImage: async () => { calls.push('image'); return `hash-${calls.length}`; },
      createCreative: async () => { calls.push('creative'); return `creative-${calls.length}`; },
      createAd: async () => 'remote-ad'
    }
  });

  assert.equal(calls.filter((call) => call === 'image').length, 4);
  assert.equal(calls.filter((call) => call === 'creative').length, 4);
});

test('continues linked Ads after one Ad creation fails', async () => {
  const sharedDraft = shareAllAds(draftWithTwoAdSets([
    { pageId: 'page-1', clientId: 'adset-1' },
    { pageId: 'page-1', clientId: 'adset-2' }
  ]));
  let creativeCalls = 0;
  let adCalls = 0;

  const result = await publishDraft({
    draft: sharedDraft,
    token: 'token',
    runId: 'run-partial-ad-failure',
    getMedia: imageFixture,
    metaClient: {
      createCampaign: async () => 'remote-campaign',
      createAdSet: async () => 'remote-adset',
      uploadImage: async () => 'image-hash',
      createCreative: async () => { creativeCalls += 1; return 'creative-shared'; },
      createAd: async () => {
        adCalls += 1;
        if (adCalls === 1) throw new Error('First Ad rejected');
        return 'remote-ad-2';
      }
    }
  });

  assert.equal(creativeCalls, 1);
  assert.equal(result.nodes.find((node) => node.clientId === 'ad-1').status, 'failed');
  assert.equal(result.nodes.find((node) => node.clientId === 'ad-2').status, 'created');
});

test('attempts a rejected shared creative once and reports every linked Ad', async () => {
  const sharedDraft = shareAllAds(draftWithTwoAdSets([
    { pageId: 'page-1', clientId: 'adset-1' },
    { pageId: 'page-1', clientId: 'adset-2' }
  ]));
  let creativeCalls = 0;
  let adCalls = 0;

  const result = await publishDraft({
    draft: sharedDraft,
    token: 'token',
    runId: 'run-creative-failure',
    getMedia: imageFixture,
    metaClient: {
      createCampaign: async () => 'remote-campaign',
      createAdSet: async () => 'remote-adset',
      uploadImage: async () => 'image-hash',
      createCreative: async () => { creativeCalls += 1; throw new Error('Creative rejected'); },
      createAd: async () => { adCalls += 1; return 'unused'; }
    }
  });

  assert.equal(creativeCalls, 1);
  assert.equal(adCalls, 0);
  assert.deepEqual(
    result.nodes.filter((node) => node.type === 'ad').map((node) => node.status),
    ['failed', 'failed']
  );
});

test('retries transient Meta creative errors before creating the Ad', async () => {
  let creativeCalls = 0;
  const delays = [];

  const result = await publishDraft({
    draft: structuredClone(draft),
    token: 'token',
    runId: 'run-transient-creative-retry',
    getMedia: imageFixture,
    delay: async (milliseconds) => { delays.push(milliseconds); },
    metaClient: {
      createCampaign: async () => 'remote-campaign',
      createAdSet: async () => 'remote-adset',
      uploadImage: async () => 'image-hash',
      createCreative: async () => {
        creativeCalls += 1;
        if (creativeCalls < 3) {
          const error = new Error('Meta temporary creative error');
          error.meta = { message: error.message, code: 100, subcode: 1487390 };
          throw error;
        }
        return 'creative-after-retry';
      },
      createAd: async () => 'remote-ad'
    }
  });

  assert.equal(creativeCalls, 3);
  assert.deepEqual(delays, [5_000, 12_000]);
  assert.equal(result.nodes.find((node) => node.clientId === 'ad-1').status, 'created');
});

test('stops transient creative retry after three total attempts', async () => {
  let creativeCalls = 0;
  const delays = [];

  const result = await publishDraft({
    draft: structuredClone(draft),
    token: 'token',
    runId: 'run-transient-creative-exhausted',
    getMedia: imageFixture,
    delay: async (milliseconds) => { delays.push(milliseconds); },
    metaClient: {
      createCampaign: async () => 'remote-campaign',
      createAdSet: async () => 'remote-adset',
      uploadImage: async () => 'image-hash',
      createCreative: async () => {
        creativeCalls += 1;
        const error = new Error('Meta temporary creative error');
        error.meta = { message: error.message, code: 100, subcode: 1487390 };
        throw error;
      },
      createAd: async () => 'unused'
    }
  });

  assert.equal(creativeCalls, 3);
  assert.deepEqual(delays, [5_000, 12_000]);
  assert.equal(result.nodes.find((node) => node.clientId === 'ad-1').status, 'failed');
});

test('reuses one Public Test post and keeps it when any linked Ad succeeds', async () => {
  const sharedDraft = shareAllAds(draftWithTwoAdSets([
    { pageId: 'page-1', clientId: 'adset-1' },
    { pageId: 'page-1', clientId: 'adset-2' }
  ]));
  for (const adSet of sharedDraft.campaigns[0].adSets) {
    adSet.ads[0].publicationMode = 'PUBLIC_TEST';
  }
  const calls = [];
  let adCalls = 0;

  const result = await publishDraft({
    draft: sharedDraft,
    token: 'token',
    runId: 'run-public-shared',
    getMedia: imageFixture,
    pagePublishingContexts: new Map([['page-1', { accessToken: 'page-token' }]]),
    metaClient: {
      createCampaign: async () => 'remote-campaign',
      createAdSet: async () => 'remote-adset',
      createPublicPhotoPost: async () => { calls.push('post'); return { postId: 'page-1_post-1' }; },
      createCreative: async () => { calls.push('creative'); return 'creative-public'; },
      createAd: async () => {
        adCalls += 1;
        if (adCalls === 1) throw new Error('First Ad rejected');
        return 'remote-ad-2';
      },
      deletePagePost: async () => { calls.push('delete'); return true; }
    }
  });

  assert.equal(calls.filter((call) => call === 'post').length, 1);
  assert.equal(calls.filter((call) => call === 'creative').length, 1);
  assert.equal(calls.filter((call) => call === 'delete').length, 0);
  assert.equal(result.nodes.find((node) => node.clientId === 'ad-2').postId, 'page-1_post-1');
});

test('deletes one shared Public Test post when every linked Ad fails', async () => {
  const sharedDraft = shareAllAds(draftWithTwoAdSets([
    { pageId: 'page-1', clientId: 'adset-1' },
    { pageId: 'page-1', clientId: 'adset-2' }
  ]));
  for (const adSet of sharedDraft.campaigns[0].adSets) {
    adSet.ads[0].publicationMode = 'PUBLIC_TEST';
  }
  let postCalls = 0;
  let deleteCalls = 0;

  await publishDraft({
    draft: sharedDraft,
    token: 'token',
    runId: 'run-public-cleanup',
    getMedia: imageFixture,
    pagePublishingContexts: new Map([['page-1', { accessToken: 'page-token' }]]),
    metaClient: {
      createCampaign: async () => 'remote-campaign',
      createAdSet: async () => 'remote-adset',
      createPublicPhotoPost: async () => { postCalls += 1; return { postId: 'page-1_post-1' }; },
      createCreative: async () => 'creative-public',
      createAd: async () => { throw new Error('Ad rejected'); },
      deletePagePost: async (_pageToken, postId) => {
        deleteCalls += 1;
        assert.equal(postId, 'page-1_post-1');
        return true;
      }
    }
  });

  assert.equal(postCalls, 1);
  assert.equal(deleteCalls, 1);
});

test('stops before the next Meta node when the publication deadline expires', async () => {
  let currentTime = 0;
  const calls = [];
  const reported = [];

  await assert.rejects(
    publishDraft({
      draft,
      token: 'token',
      runId: 'run-deadline-parent',
      deadlineAt: 10,
      now: () => currentTime,
      getMedia: imageFixture,
      onNodeUpdate: async (_runId, node) => reported.push(node),
      metaClient: {
        createCampaign: async () => {
          calls.push('campaign');
          currentTime = 10;
          return 'remote-campaign';
        },
        createAdSet: async () => {
          calls.push('adset');
          return 'remote-adset';
        }
      }
    }),
    (error) => error.name === 'PublicationDeadlineError' && error.expose === true
  );

  assert.deepEqual(calls, ['campaign']);
  assert.deepEqual(
    reported.filter((node) => node.clientId === 'campaign-1').map((node) => [node.status, node.remoteId]),
    [['creating', undefined], ['created', 'remote-campaign']]
  );
});

test('lets a deadline escape video polling instead of becoming a node failure', async () => {
  let currentTime = 0;
  let creativeCalls = 0;
  let adCalls = 0;
  let videoStatusCalls = 0;
  const reported = [];
  const videoDraft = structuredClone(draft);
  videoDraft.campaigns[0].adSets[0].ads[0].mediaId = 'media-video';

  await assert.rejects(
    publishDraft({
      draft: videoDraft,
      token: 'token',
      runId: 'run-deadline-video',
      deadlineAt: 5_000,
      now: () => currentTime,
      delay: async (milliseconds) => { currentTime += milliseconds; },
      getMedia: () => ({ id: 'media-video', mimeType: 'video/mp4', name: 'video.mp4' }),
      onNodeUpdate: async (_runId, node) => reported.push(node),
      metaClient: {
        createCampaign: async () => 'remote-campaign',
        createAdSet: async () => 'remote-adset',
        uploadVideo: async () => 'video-1',
        getVideoStatus: async () => {
          videoStatusCalls += 1;
          return { status: { video_status: videoStatusCalls <= 2 ? 'processing' : 'error' } };
        },
        createCreative: async () => { creativeCalls += 1; return 'creative-1'; },
        createAd: async () => { adCalls += 1; return 'ad-1'; }
      }
    }),
    (error) => error.name === 'PublicationDeadlineError'
  );

  assert.equal(creativeCalls, 0);
  assert.equal(adCalls, 0);
  assert.equal(reported.some((node) => node.type === 'ad' && node.status === 'failed'), false);
});

test('uploads and polls one Meta video when independent Ads reuse the same media', async () => {
  const videoDraft = draftWithTwoAdSets([
    { clientId: 'adset-1', pageId: 'page_1' },
    { clientId: 'adset-2', pageId: 'page_1' }
  ]);
  let uploads = 0;
  let statusChecks = 0;
  let cacheReads = 0;
  const saved = [];

  const result = await publishDraft({
    draft: videoDraft,
    token: 'token',
    runId: 'run-video-cache',
    ownerMetaUserId: 'owner-1',
    concurrency: 2,
    getMedia: async () => ({ id: 'media-image', mimeType: 'video/mp4', name: 'video.mp4' }),
    getMetaVideoId: async () => { cacheReads += 1; return null; },
    saveMetaVideoId: async (...args) => saved.push(args),
    metaClient: {
      createCampaign: async () => 'campaign-1',
      createAdSet: async (_token, _account, params) => `set-${params.get('name')}`,
      uploadVideo: async () => { uploads += 1; return 'video-1'; },
      getVideoStatus: async () => { statusChecks += 1; return { status: { video_status: 'ready' } }; },
      createCreative: async (_token, _account, params) => `creative-${params.get('name')}`,
      createAd: async (_token, _account, params) => `ad-${params.get('name')}`
    }
  });

  assert.equal(uploads, 1);
  assert.equal(statusChecks, 1);
  assert.equal(cacheReads, 1);
  assert.deepEqual(saved, [['owner-1', 'media-image', 'act_1', 'video-1']]);
  assert.equal(result.nodes.filter((node) => node.type === 'ad' && node.status === 'created').length, 2);
});

test('cleans up a Public Test post with an independent signal when its deadline expires', async () => {
  let currentTime = 0;
  let creativeCalls = 0;
  let adCalls = 0;
  const cleanupSignals = [];
  const controller = new AbortController();
  const publicDraft = structuredClone(draft);
  publicDraft.campaigns[0].adSets[0].ads[0].publicationMode = 'PUBLIC_TEST';

  await assert.rejects(
    publishDraft({
      draft: publicDraft,
      token: 'token',
      runId: 'run-public-deadline',
      deadlineAt: 10,
      now: () => currentTime,
      signal: controller.signal,
      getMedia: imageFixture,
      pagePublishingContexts: new Map([['page_1', { accessToken: 'page-token' }]]),
      metaClient: {
        createCampaign: async () => 'remote-campaign',
        createAdSet: async () => 'remote-adset',
        createPublicPhotoPost: async () => {
          currentTime = 10;
          return { postId: 'page-1_post-deadline' };
        },
        createCreative: async () => { creativeCalls += 1; return 'creative-public'; },
        createAd: async () => { adCalls += 1; return 'ad-public'; },
        deletePagePost: async (_pageToken, postId, options = {}) => {
          assert.equal(postId, 'page-1_post-deadline');
          cleanupSignals.push(options.signal);
          return true;
        }
      }
    }),
    (error) => error.name === 'PublicationDeadlineError'
  );

  assert.equal(creativeCalls, 0);
  assert.equal(adCalls, 0);
  assert.equal(cleanupSignals.length, 1);
  assert.ok(cleanupSignals[0] instanceof AbortSignal);
  assert.notEqual(cleanupSignals[0], controller.signal);
});

test('reports a created Public Test Ad before stopping at the post-write deadline', async () => {
  let currentTime = 0;
  let adCalls = 0;
  let deleteCalls = 0;
  const reported = [];
  const publicDraft = structuredClone(draft);
  const firstAd = publicDraft.campaigns[0].adSets[0].ads[0];
  firstAd.publicationMode = 'PUBLIC_TEST';
  publicDraft.campaigns[0].adSets[0].ads.push({
    ...structuredClone(firstAd),
    clientId: 'ad-2',
    name: 'Ad 2'
  });

  await assert.rejects(
    publishDraft({
      draft: publicDraft,
      token: 'token',
      runId: 'run-public-created-deadline',
      deadlineAt: 10,
      now: () => currentTime,
      getMedia: imageFixture,
      onNodeUpdate: async (_runId, node) => reported.push(node),
      pagePublishingContexts: new Map([['page_1', { accessToken: 'page-token' }]]),
      metaClient: {
        createCampaign: async () => 'remote-campaign',
        createAdSet: async () => 'remote-adset',
        createPublicPhotoPost: async () => ({ postId: 'page-1_post-created' }),
        createCreative: async () => 'creative-public',
        createAd: async () => {
          adCalls += 1;
          currentTime = 10;
          return 'remote-ad-1';
        },
        deletePagePost: async () => { deleteCalls += 1; return true; }
      }
    }),
    (error) => error.name === 'PublicationDeadlineError'
  );

  assert.equal(adCalls, 1);
  assert.equal(deleteCalls, 0);
  assert.ok(reported.some((node) => (
    node.clientId === 'ad-1'
    && node.status === 'created'
    && node.remoteId === 'remote-ad-1'
    && node.postId === 'page-1_post-created'
  )));
  assert.equal(reported.some((node) => node.clientId === 'ad-2'), false);
});

test('stops starting new nodes once stopStartingAt passes and reports how many were attempted', async () => {
  const calls = [];
  let clock = 0;
  const result = await publishDraft({
    draft,
    token: 'token',
    runId: 'run-soft-deadline',
    now: () => clock,
    stopStartingAt: 10,
    getMedia: imageFixture,
    metaClient: {
      ...recordingMetaClient(calls),
      createCampaign: async (...args) => {
        clock = 20; // node đầu tiên chạy quá ngưỡng mềm → không bắt đầu node tiếp theo
        return recordingMetaClient(calls).createCampaign(...args);
      }
    }
  });

  assert.deepEqual(calls.map(({ type }) => type), ['campaign']);
  assert.equal(result.nodes.find((node) => node.clientId === 'campaign-1').status, 'created');
  assert.equal(result.complete, false);
  assert.equal(result.attempted, 1);
});

test('looks up the permalink after releasing the creation slot', { timeout: 5000 }, async () => {
  const twoAds = draftWithTwoAdSets([{ clientId: 'adset-1' }, { clientId: 'adset-2' }]);
  let createdAds = 0;
  let releaseLookup;
  const lookupHeld = new Promise((resolve) => { releaseLookup = resolve; });

  const result = await publishDraft({
    draft: twoAds,
    token: 'token',
    runId: 'run-lookup',
    concurrency: 1,
    getMedia: imageFixture,
    metaClient: {
      ...recordingMetaClient([]),
      createAd: async () => {
        createdAds += 1;
        if (createdAds === 2) releaseLookup(); // only reachable if lookup 1 no longer blocks the single slot
        return `remote-ad-${createdAds}`;
      },
      getAdPublication: async () => { await lookupHeld; return {}; }
    }
  });

  assert.equal(createdAds, 2);
  assert.equal(result.complete, true);
});

test('runs Campaigns in parallel up to `concurrency` and sequentially when it is 1', async () => {
  async function peakCampaignCreations(concurrency) {
    let inFlight = 0;
    let peak = 0;
    await publishDraft({
      draft: draftWithCampaigns([{ adAccountId: 'act_1', pageId: 'page-1' }, { adAccountId: 'act_1', pageId: 'page-1' }]),
      token: 'token',
      runId: 'run-campaigns',
      concurrency,
      getMedia: imageFixture,
      metaClient: {
        ...recordingMetaClient([]),
        createCampaign: async () => {
          inFlight += 1;
          peak = Math.max(peak, inFlight);
          await new Promise((resolve) => setTimeout(resolve, 5));
          inFlight -= 1;
          return 'remote-campaign';
        }
      }
    });
    return peak;
  }

  assert.equal(await peakCampaignCreations(1), 1);
  assert.equal(await peakCampaignCreations(2), 2);
});

test('creates ad sets and ads in parallel but never more than `concurrency` at once', async () => {
  const parallelDraft = structuredClone(draft);
  parallelDraft.campaigns[0].adSets = Array.from({ length: 4 }, (_, index) => ({
    ...structuredClone(draft.campaigns[0].adSets[0]),
    clientId: `adset-${index + 1}`,
    ads: [{ ...structuredClone(ad), clientId: `ad-${index + 1}` }]
  }));
  let inFlight = 0;
  let peak = 0;
  const track = async (value) => {
    inFlight += 1;
    peak = Math.max(peak, inFlight);
    await new Promise((resolve) => setTimeout(resolve, 5));
    inFlight -= 1;
    return value;
  };

  const result = await publishDraft({
    draft: parallelDraft,
    token: 'token',
    runId: 'run-parallel',
    concurrency: 2,
    getMedia: imageFixture,
    metaClient: {
      createCampaign: () => track('remote-campaign'),
      createAdSet: (_token, _accountId, params) => track(`remote-${params.get('name')}`),
      uploadImage: async () => 'image-hash',
      createCreative: async () => 'creative-1',
      createAd: () => track('remote-ad')
    }
  });

  assert.equal(peak, 2);
  assert.equal(result.complete, true);
  assert.equal(result.nodes.filter((node) => node.status === 'created').length, 9);
});

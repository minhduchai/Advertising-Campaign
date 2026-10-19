import test from 'node:test';
import assert from 'node:assert/strict';
import { publishDraft } from '../src/publisher.js';
import { createMetaClient } from '../src/meta-client.js';

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
    customerActions: [{ id: 'button-1', label: 'Đăng Ký Ngay', type: 'OPEN_URL', value: 'https://lgclinic.vn/dang-ky' }]
  }
};

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
      includedRegions: [{ key: '3984', name: 'Thành phố Hồ Chí Minh', type: 'region', countryCode: 'VN' }],
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

const image = () => ({ id: 'media-image', mimeType: 'image/jpeg', name: 'image.jpg', content: Buffer.from('image') });

test('stops queued AdSet creates after the account capacity error and keeps other accounts publishing', async () => {
  for (const concurrency of [1, 3]) {
    const full = structuredClone(draft.campaigns[0]);
    full.adSets = Array.from({ length: 8 }, (_, i) => ({ ...structuredClone(full.adSets[0]),
      clientId: `full-set-${i}`, ads: [{ ...structuredClone(ad), clientId: `full-ad-${i}` }] }));
    const other = structuredClone(draft.campaigns[0]);
    other.clientId = 'other-campaign'; other.adAccountId = 'act_2';
    const calls = [];
    const result = await publishDraft({ draft: { campaigns: [full, other] }, concurrency, token: 'fake', runId: 'full-account', getMedia: image,
      metaClient: { createCampaign: async (_t, account) => `${account}-campaign`,
        createAdSet: async (_t, account) => {
          calls.push(account);
          if (account === 'act_1') throw Object.assign(new Error('Account has reached 10000 ad sets'), {
            meta: { code: 100, subcode: 1359133, message: 'Account has reached 10000 ad sets', type: 'OAuthException' }
          });
          return 'other-set';
        }, uploadImage: async () => 'hash', createCreative: async () => 'creative', createAd: async () => 'other-ad'
      } });
    assert.ok(calls.filter(account => account === 'act_1').length <= concurrency);
    assert.equal(calls.filter(account => account === 'act_2').length, 1);
    assert.equal(result.nodes.filter(n => n.type === 'adSet' && n.status === 'failed').length, 8);
    assert.equal(result.nodes.filter(n => n.type === 'ad' && n.status === 'skipped').length, 8);
    assert.equal(result.nodes.find(n => n.clientId === 'ad-1').status, 'created');
  }
});

test('a real deadline aborts an in-flight campaign write and preserves uncertain state', async () => {
  let calls = 0;
  const client = createMetaClient({ apiVersion: 'v24.0' }, { fetchImpl: async (_url, { signal }) => {
    calls++;
    return new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }));
  } });
  // Keep the test process alive while the production timeout intentionally uses unref().
  const keepAlive = setTimeout(() => {}, 1000);
  try {
    const result = await publishDraft({ draft, token: 'fake', runId: 'deadline-real', metaClient: client,
      getMedia: image, deadlineAt: Date.now() + 40, onDeadline: 'return' });
    assert.equal(calls, 1);
    assert.equal(result.nodes[0].status, 'failed');
    assert.equal(result.nodes[0].error.type, 'UncertainMetaWriteError');
    assert.ok(!result.nodes.some(node => node.status === 'created' && !node.remoteId));
  } finally { clearTimeout(keepAlive); }
});

test('an aborted Ad write remains uncertain and cannot be reset to retry_pending by the deadline', async () => {
  let adCalls = 0;
  const client = createMetaClient({ apiVersion: 'v24.0' }, { fetchImpl: async (input, { signal }) => {
    const edge = new URL(input).pathname.split('/').at(-1);
    if (edge === 'ads') {
      adCalls++;
      return new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }));
    }
    return Response.json(edge === 'adimages' ? { images: { one: { hash: 'hash' } } } : { id: edge });
  } });
  const keepAlive = setTimeout(() => {}, 1000);
  try {
    const result = await publishDraft({ draft, token: 'fake', runId: 'deadline-ad', metaClient: client,
      getMedia: image, deadlineAt: Date.now() + 100, onDeadline: 'return' });
    const node = result.nodes.find(node => node.type === 'ad');
    assert.equal(adCalls, 1);
    assert.equal(node.status, 'failed');
    assert.equal(node.error.type, 'UncertainAdWriteError');
  } finally { clearTimeout(keepAlive); }
});

test('deadline cancellation also interrupts a video polling delay', async () => {
  const started = Date.now();
  const result = await publishDraft({ draft, token: 'fake', runId: 'deadline-poll', ownerMetaUserId: 'deadline-poll-owner',
    getMedia: () => ({ id: 'deadline-video', mimeType: 'video/mp4' }),
    deadlineAt: started + 40, onDeadline: 'return', metaClient: {
      createCampaign: async () => 'campaign', createAdSet: async () => 'set', uploadVideo: async () => 'video',
      getVideoStatus: async () => ({ status: { video_status: 'processing' } })
    } });
  assert.ok(Date.now() - started < 500);
  assert.equal(result.deadlineHit, true);
  assert.equal(result.nodes.find(node => node.type === 'ad').status, 'retry_pending');
});

test('video processing can exceed two minutes and reuse the saved Video ID after the one-hour wait', async () => {
  let clock = 0, uploads = 0, ready = false;
  let saved;
  const client = {
    createCampaign: async () => 'campaign', createAdSet: async () => 'set',
    uploadVideo: async () => { uploads++; return 'video'; },
    getVideoStatus: async () => ({ status: { video_status: ready ? 'ready' : 'processing' }, thumbnail: { imageUrl: 'https://example.com/thumb' } }),
    createCreative: async () => 'creative', createAd: async () => 'ad'
  };
  const base = { draft, token: 'fake', runId: 'video-long', ownerMetaUserId: 'video-long-owner', metaClient: client,
    now: () => clock, delay: async ms => { clock += ms; },
    getMedia: () => ({ id: 'video-long', mimeType: 'video/mp4' }),
    getMetaVideoId: async () => saved, saveMetaVideoId: async (_o, _m, _a, id) => { saved = id; } };
  const pending = await publishDraft(base);
  assert.ok(clock >= 60 * 60_000);
  assert.equal(pending.nodes.find(node => node.type === 'ad').status, 'retry_pending');
  assert.equal(pending.nodes.find(node => node.type === 'ad').error.type, 'VideoProcessingPendingError');
  ready = true;
  const result = await publishDraft({ ...base, existingNodes: pending.nodes });
  assert.equal(result.nodes.find(node => node.type === 'ad').status, 'created');
  assert.equal(uploads, 1);
});

test('publishing waits for a thumbnail after Meta reports video ready', async () => {
  let reads = 0;
  const waits = [];
  const result = await publishDraft({ draft, token: 'fake', runId: 'thumbnail-late', ownerMetaUserId: 'thumbnail-late-owner',
    getMedia: () => ({ id: 'thumbnail-late-media', mimeType: 'video/mp4' }),
    getMetaVideoId: async () => 'thumbnail-late-video', delay: async ms => { waits.push(ms); },
    metaClient: {
      createCampaign: async () => 'campaign', createAdSet: async () => 'set',
      getVideoStatus: async () => ({ status: { video_status: 'ready' },
        thumbnail: ++reads === 1 ? undefined : { imageUrl: 'https://example.com/thumb' } }),
      createCreative: async (_token, _account, params) => {
        assert.equal(JSON.parse(params.get('object_story_spec')).video_data.image_url, 'https://example.com/thumb');
        return 'creative';
      }, createAd: async () => 'ad'
    } });
  assert.equal(reads, 2);
  assert.deepEqual(waits, [2000]);
  assert.equal(result.nodes.find(node => node.type === 'ad').status, 'created');
});

test('campaign failures retain network codes without storing private cause messages', async () => {
  const error = Object.assign(new TypeError('fetch failed', { cause: { message: 'Bearer private-token' } }), {
    networkCodes: ['ECONNRESET']
  });
  const result = await publishDraft({ draft, token: 'fake', runId: 'network', getMedia: image,
    metaClient: { createCampaign: async () => { throw error; } } });
  assert.deepEqual(result.nodes.find(node => node.type === 'campaign').error.networkCodes, ['ECONNRESET']);
  assert.doesNotMatch(JSON.stringify(result.nodes), /private-token/);
});

test('direct publishing waits out throttle at each mutation without recreating successful objects', async () => {
  for (const throttledMethod of ['createCampaign', 'createAdSet', 'uploadImage', 'createCreative', 'createAd']) {
    const calls = {};
    const waits = [];
    const metaClient = Object.fromEntries(['createCampaign', 'createAdSet', 'uploadImage', 'createCreative', 'createAd'].map((method) => [method, async () => {
      calls[method] = (calls[method] ?? 0) + 1;
      if (method === throttledMethod && calls[method] === 1) {
        throw Object.assign(new Error('quota'), { name: 'MetaThrottleError', retryable: true, statusCode: 429, retryAfterMs: 120000 });
      }
      return `${method}-remote`;
    }]));
    const result = await publishDraft({ draft, token: 'fake', runId: 'quota', ownerMetaUserId: 'owner',
      metaClient, getMedia: image, waitForThrottle: true, delay: async (ms) => { waits.push(ms); } });
    assert.equal(result.complete, true);
    assert.ok(result.nodes.every((node) => node.status === 'created'));
    assert.deepEqual(waits, [120000]);
    for (const method of Object.keys(metaClient)) assert.equal(calls[method], method === throttledMethod ? 2 : 1);
  }
});

test('waiting for quota never retries an uncertain mutation or changes the default Workflow behavior', async () => {
  for (const [waitForThrottle, error] of [
    [true, new TypeError('fetch failed')],
    [false, Object.assign(new Error('quota'), { name: 'MetaThrottleError', retryAfterMs: 120000 })]
  ]) {
    let calls = 0;
    const publish = () => publishDraft({ draft, token: 'fake', runId: 'run', metaClient: {
      createCampaign: async () => { calls++; throw error; }
    }, getMedia: image, waitForThrottle,
    delay: async () => assert.fail('must not wait or retry this error') });
    if (waitForThrottle) {
      const result = await publish();
      assert.equal(result.nodes[0].status, 'failed');
    } else await assert.rejects(publish, { name: 'MetaThrottleError' });
    assert.equal(calls, 1);
  }
});

test('with onDeadline "return" a hard deadline releases the interrupted ad for the next call instead of throwing', async () => {
  let clock = 0;
  const updates = [];
  const result = await publishDraft({
    draft,
    token: 'token',
    runId: 'run-deadline',
    now: () => clock,
    deadlineAt: 1000,
    onDeadline: 'return',
    onNodeUpdate: (_runId, node) => { updates.push(node); },
    getMedia: () => { clock = 5000; return image(); },
    metaClient: {
      createCampaign: async () => 'remote-campaign',
      createAdSet: async () => 'remote-adset',
      uploadImage: async () => 'image-hash',
      createCreative: async () => 'remote-creative',
      createAd: async () => 'remote-ad'
    }
  });

  assert.equal(result.deadlineHit, true);
  assert.equal(result.complete, false);
  assert.equal(result.attempted, 3);
  const finalStatus = Object.fromEntries(result.nodes.map((node) => [node.clientId, node.status]));
  assert.deepEqual(finalStatus, { 'campaign-1': 'created', 'adset-1': 'created', 'ad-1': 'retry_pending' });
  assert.equal(updates.at(-1).status, 'retry_pending', 'trạng thái retry_pending được ghi ra DB/UI');
});

test('by default a hard deadline still throws PublicationDeadlineError', async () => {
  let clock = 0;
  await assert.rejects(
    () => publishDraft({
      draft,
      token: 'token',
      runId: 'run-deadline-throw',
      now: () => clock,
      deadlineAt: 1000,
      getMedia: () => { clock = 5000; return image(); },
      metaClient: {
        createCampaign: async () => 'remote-campaign',
        createAdSet: async () => 'remote-adset',
        uploadImage: async () => 'image-hash',
        createCreative: async () => 'remote-creative',
        createAd: async () => 'remote-ad'
      }
    }),
    (error) => error.name === 'PublicationDeadlineError' && error.code === 'PUBLISH_DEADLINE_EXCEEDED'
  );
});

test('a released retry_pending ad is created on the next call without recreating finished nodes', async () => {
  const calls = [];
  const result = await publishDraft({
    draft,
    token: 'token',
    runId: 'run-resume',
    existingNodes: [
      { clientId: 'campaign-1', type: 'campaign', name: 'Campaign 1', status: 'created', remoteId: 'remote-campaign' },
      { clientId: 'adset-1', parentClientId: 'campaign-1', type: 'adSet', name: 'Ad set 1', status: 'created', remoteId: 'remote-adset' },
      { clientId: 'ad-1', parentClientId: 'adset-1', type: 'ad', name: 'Ad 1', status: 'retry_pending' }
    ],
    runStartedAt: 1_000,
    getMedia: image,
    metaClient: {
      createCampaign: async () => { calls.push('campaign'); return 'x'; },
      createAdSet: async () => { calls.push('adset'); return 'x'; },
      uploadImage: async () => 'image-hash',
      createCreative: async () => { calls.push('creative'); return 'remote-creative'; },
      createAd: async () => { calls.push('ad'); return 'remote-ad'; },
      findCreatedObject: async () => { calls.push('find'); return []; }
    }
  });

  assert.deepEqual(calls, ['creative', 'ad']);
  assert.equal(result.complete, true);
});

function adoptionHarness({ matches, existingStatus = 'creating', runStartedAt = 1_000_000, lookupError }) {
  const calls = [];
  const lookups = [];
  return {
    calls,
    lookups,
    run: () => publishDraft({
      draft,
      token: 'token',
      runId: 'run-adopt',
      existingNodes: [
        { clientId: 'campaign-1', type: 'campaign', name: 'Campaign 1', status: 'created', remoteId: 'remote-campaign' },
        { clientId: 'adset-1', parentClientId: 'campaign-1', type: 'adSet', name: 'Ad set 1', status: 'created', remoteId: 'remote-adset' },
        { clientId: 'ad-1', parentClientId: 'adset-1', type: 'ad', name: 'Ad 1', status: existingStatus }
      ],
      runStartedAt,
      waitForThrottle: true,
      delay: async () => {},
      getMedia: image,
      metaClient: {
        uploadImage: async () => 'image-hash',
        createCreative: async () => { calls.push('creative'); return 'remote-creative'; },
        createAd: async () => { calls.push('ad'); return 'remote-ad-new'; },
        findCreatedObject: async (_token, parentId, edge, name, options) => {
          lookups.push({ parentId, edge, name, sinceMs: options.sinceMs });
          if (lookupError && lookups.length === 1) throw lookupError;
          return matches;
        },
        getAdPublication: async () => ({})
      }
    })
  };
}

for (const lookupError of [new Error('lookup offline'), Object.assign(new Error('quota'), { name: 'MetaThrottleError', retryAfterMs: 1 })]) {
  test(`interrupted Ad remains uncertain after lookup ${lookupError.name}`, async () => {
    const harness = adoptionHarness({ matches: [], lookupError });
    const result = await harness.run();
    assert.deepEqual(harness.calls, []);
    assert.equal(result.nodes.find(node => node.type === 'ad').error.type, 'UncertainAdWriteError');
  });
}

test('adopts an ad that Meta already created before the interruption instead of creating a duplicate', async () => {
  const harness = adoptionHarness({ matches: [{ id: 'remote-ad-existing', name: 'Ad 1' }] });
  const result = await harness.run();

  assert.deepEqual(harness.calls, [], 'không tạo mẫu hay quảng cáo mới');
  assert.deepEqual(harness.lookups, [{ parentId: 'remote-adset', edge: 'ads', name: 'Ad 1', sinceMs: 1_000_000 - 60_000 }]);
  const adNode = result.nodes.find((node) => node.clientId === 'ad-1');
  assert.equal(adNode.status, 'created');
  assert.equal(adNode.remoteId, 'remote-ad-existing');
});

test('interrupted Ads with ambiguous or absent matches require manual confirmation, never a new write', async () => {
  for (const matches of [[], [{ id: 'a' }, { id: 'b' }]]) {
    const harness = adoptionHarness({ matches });
    const result = await harness.run();
    assert.deepEqual(harness.calls, []);
    assert.equal(result.nodes.find((node) => node.clientId === 'ad-1').error.type, 'UncertainAdWriteError');
  }
});

test('only nodes interrupted while creating are looked up on Meta, and never without a run start time', async () => {
  const notInterrupted = adoptionHarness({ matches: [{ id: 'x' }], existingStatus: 'retry_pending' });
  await notInterrupted.run();
  assert.equal(notInterrupted.lookups.length, 0);

  const withoutStart = adoptionHarness({ matches: [{ id: 'x' }], runStartedAt: null });
  await withoutStart.run();
  assert.equal(withoutStart.lookups.length, 0);
  assert.deepEqual(withoutStart.calls, []);
});

for (const failType of ['campaign', 'adSet', 'ad']) {
  test(`database failure persisting a created ${failType} must not overwrite it as failed`, async () => {
    const updates = [];
    await assert.rejects(publishDraft({ draft, token: 'fake', runId: 'db-failure', getMedia: image,
      metaClient: {
        createCampaign: async () => 'campaign-id', createAdSet: async () => 'adset-id',
        uploadImage: async () => 'hash', createCreative: async () => 'creative-id', createAd: async () => 'ad-id'
      },
      onNodeUpdate: async (_run, node) => {
        updates.push(node);
        if (node.type === failType && node.status === 'created') throw new Error('database unavailable');
      }
    }), /database unavailable/);
    assert.equal(updates.filter(node => node.type === failType && node.status === 'failed').length, 0);
  });
}

test('a failing lookup falls back to creating the object rather than stopping the run', async () => {
  const calls = [];
  const result = await publishDraft({
    draft,
    token: 'token',
    runId: 'run-lookup-error',
    existingNodes: [
      { clientId: 'campaign-1', type: 'campaign', name: 'Campaign 1', status: 'created', remoteId: 'remote-campaign' },
      { clientId: 'adset-1', parentClientId: 'campaign-1', type: 'adSet', name: 'Ad set 1', status: 'creating' }
    ],
    runStartedAt: 1_000_000,
    getMedia: image,
    metaClient: {
      createAdSet: async () => { calls.push('adset'); return 'remote-adset'; },
      uploadImage: async () => 'image-hash',
      createCreative: async () => 'remote-creative',
      createAd: async () => 'remote-ad',
      findCreatedObject: async () => { throw new Error('Graph unavailable'); },
      getAdPublication: async () => ({})
    }
  });

  assert.deepEqual(calls, ['adset']);
  assert.equal(result.nodes.find((node) => node.clientId === 'adset-1').remoteId, 'remote-adset');
});

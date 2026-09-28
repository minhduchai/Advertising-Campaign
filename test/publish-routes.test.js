import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer as createHttpServer } from 'node:http';
import { createServer } from '../src/server.js';
import { encryptToken, signSession } from '../src/crypto.js';
import * as requestHandler from '../src/request-handler.js';
import { createApiClient } from '../public/api.js';
import { request, testConfig } from './helpers.js';

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
      name: 'Ad Set 1',
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
      ads: [{
        clientId: 'ad-1',
        name: 'Ad 1',
        primaryText: 'Chat with us',
        headline: 'Offer',
        mediaId: 'media-1',
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
      }]
    }]
  }]
};

function validationServer(context) {
  const config = testConfig();
  const server = createServer({
    config,
    db: {
      createSession: () => ({ id: 'new-session' }),
      getSession: () => ({ id: 'session-user', metaUserId: 'meta-user-1' })
    },
    metaClient: {}
  });
  context.after(() => server.close());
  const session = signSession('session-user', config.sessionSecret);
  return {
    server,
    headers: { cookie: `meta_ads_session=${encodeURIComponent(session)}` }
  };
}

function createR2MultipartRouteServer(context, { metaUserId = 'meta-user-1', r2 } = {}) {
  const config = testConfig();
  const server = createHttpServer(requestHandler.createRequestHandler({
    config,
    db: {
      createSession: () => ({ id: 'new-session' }),
      getSession: () => ({ id: 'session-user', metaUserId })
    },
    mediaStore: { r2 },
    metaClient: {}
  }));
  context.after(() => server.close());
  const session = signSession('session-user', config.sessionSecret);
  return {
    server,
    headers: {
      cookie: `meta_ads_session=${encodeURIComponent(session)}`,
      'content-type': 'application/json'
    }
  };
}

function createPublishRouteServer(context, {
  metaClient: metaOverrides = {},
  getRun = () => null,
  db: dbOverrides = {},
  config: configOverrides = {}
} = {}) {
  const config = { ...testConfig(), ...configOverrides };
  const db = {
    createSession: () => ({ id: 'new-session' }),
    getSession: () => ({ id: 'session-user', metaUserId: 'meta-user-1' }),
    getConnection: () => ({ accessTokenCiphertext: encryptToken('EAAG-token', config.tokenEncryptionKey) }),
    getMedia: () => ({
      id: 'media-1', ownerMetaUserId: 'meta-user-1', mimeType: 'image/jpeg',
      name: 'creative.jpg', content: Buffer.from('image bytes')
    }),
    createRun: () => ({ id: 'run-1' }),
    updateNodeResult: () => undefined,
    updateRunStatus: () => undefined,
    getRun,
    listSeedingJobs: () => [],
    listPublicationLookups: () => [],
    claimPublicationLookups: (_runId, clientIds) => clientIds,
    schedulePublicationLookups: () => undefined,
    savePublication: () => undefined,
    ...dbOverrides
  };
  const metaClient = {
    listPromotablePages: async () => [{ id: 'page_1' }],
    getPagePublishingContext: async (_token, pageIds) => ({
      permissionGranted: true,
      pages: new Map(pageIds.map((pageId) => [String(pageId), {
        name: String(pageId), accessToken: '', tasks: []
      }]))
    }),
    createCampaign: async () => 'campaign-remote',
    createAdSet: async () => 'adset-remote',
    uploadImage: async () => 'image-hash',
    createCreative: async () => 'creative-remote',
    createAd: async () => 'ad-remote',
    ...metaOverrides
  };
  const server = createServer({ config, db, metaClient });
  context.after(() => server.close());
  const session = signSession('session-user', config.sessionSecret);
  return {
    server,
    headers: { cookie: `meta_ads_session=${encodeURIComponent(session)}` }
  };
}

async function serverAddress(server) {
  if (!server.listening) {
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
  }
  const { port } = server.address();
  return `http://127.0.0.1:${port}`;
}

async function readRemainingText(reader) {
  const decoder = new TextDecoder();
  let output = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) return output + decoder.decode();
    output += decoder.decode(value, { stream: true });
  }
}

function parseNdjson(source) {
  return source.trim().split('\n').filter(Boolean).map((line) => JSON.parse(line));
}

function deferred() {
  let resolve;
  const promise = new Promise((resolvePromise) => { resolve = resolvePromise; });
  return { promise, resolve };
}

// Meta resources the workspace loads first; run snapshots name Pages from this cached catalog.
function pageCatalogMeta(pages) {
  return {
    listAdAccounts: async () => [],
    listGlobalPageCatalog: async () => ({
      pages: pages.map(([id, name]) => ({ id, name, sources: ['MANAGED'], canAdvertise: true, unavailableReason: null })),
      discovery: { requiresBusinessReconnect: false, warnings: [], counts: {} }
    }),
    getPermissionStatus: async () => ({ pages_manage_engagement: true })
  };
}

function twoCampaignDraft() {
  const secondCampaign = structuredClone(draft.campaigns[0]);
  secondCampaign.clientId = 'campaign-2';
  secondCampaign.name = 'Campaign 2';
  secondCampaign.adAccountId = 'act_2';
  secondCampaign.pageId = 'page_2';
  secondCampaign.adSets[0].clientId = 'adset-2';
  secondCampaign.adSets[0].name = 'Ad Set 2';
  secondCampaign.adSets[0].ads[0].clientId = 'ad-2';
  secondCampaign.adSets[0].ads[0].name = 'Ad 2';
  return { campaigns: [structuredClone(draft.campaigns[0]), secondCampaign] };
}

test('stores an owned upload and returns an opaque media id', async (context) => {
  const config = testConfig();
  let savedMedia;
  const server = createServer({
    config,
    db: {
      createSession: () => ({ id: 'new-session' }),
      getSession: () => ({ id: 'session-user', metaUserId: 'meta-user-1' }),
      saveMedia: (media) => { savedMedia = media; return { id: 'media-1' }; }
    },
    metaClient: {}
  });
  context.after(() => server.close());

  const form = new FormData();
  form.set('file', new Blob(['image bytes'], { type: 'image/jpeg' }), 'creative.jpg');
  const session = signSession('session-user', config.sessionSecret);
  const response = await request(server, '/api/media', {
    method: 'POST',
    headers: { cookie: `meta_ads_session=${encodeURIComponent(session)}` },
    body: form
  });

  assert.deepEqual(response.body, { mediaId: 'media-1', kind: 'image' });
  assert.equal(savedMedia.ownerMetaUserId, 'meta-user-1');
  assert.equal(savedMedia.mimeType, 'image/jpeg');
  assert.equal(savedMedia.name, 'creative.jpg');
});

test('keeps the multipart media route unavailable outside local mode', async (context) => {
  const config = { ...testConfig(), mediaUploadMode: 'r2' };
  const server = createHttpServer(requestHandler.createRequestHandler({
    config,
    db: {
      createSession: () => ({ id: 'new-session' }),
      getSession: () => ({ id: 'session-user', metaUserId: 'meta-user-1' })
    },
    mediaStore: { saveUpload: () => assert.fail('local upload must not run') },
    metaClient: {}
  }));
  context.after(() => server.close());

  const session = signSession('session-user', config.sessionSecret);
  const response = await request(server, '/api/media', {
    method: 'POST',
    headers: { cookie: `meta_ads_session=${encodeURIComponent(session)}` },
    body: new FormData()
  });

  assert.equal(response.status, 404);
});

test('streams an owner-scoped image preview without exposing a Blob URL', async (context) => {
  const config = testConfig();
  const calls = [];
  const server = createServer({
    config,
    db: {
      createSession: () => ({ id: 'new-session' }),
      getSession: (id) => ({
        id,
        metaUserId: id === 'session-owner-two' ? 'meta-user-2' : 'meta-user-1'
      })
    },
    mediaStore: {
      getMedia: async ({ ownerMetaUserId, id }) => {
        calls.push({ ownerMetaUserId, id });
        if (ownerMetaUserId !== 'meta-user-1' || id !== 'media-image') {
          throw new Error('Media not found');
        }
        return {
          id,
          ownerMetaUserId,
          mimeType: 'image/png',
          content: Buffer.from('preview image bytes'),
          sourceUrl: 'https://signed-r2.example/image.png?signature=secret'
        };
      }
    },
    metaClient: {}
  });
  context.after(() => server.close());
  const ownerOneCookie = `meta_ads_session=${encodeURIComponent(signSession('session-owner-one', config.sessionSecret))}`;
  const ownerTwoCookie = `meta_ads_session=${encodeURIComponent(signSession('session-owner-two', config.sessionSecret))}`;
  const baseUrl = await serverAddress(server);

  const owned = await fetch(`${baseUrl}/api/media/media-image/preview`, {
    headers: { cookie: ownerOneCookie }
  });
  const foreign = await fetch(`${baseUrl}/api/media/media-image/preview`, {
    headers: { cookie: ownerTwoCookie }
  });

  assert.equal(owned.status, 200);
  assert.equal(owned.headers.get('content-type'), 'image/png');
  assert.equal(owned.headers.get('cache-control'), 'private, max-age=300');
  assert.equal(owned.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(Buffer.from(await owned.arrayBuffer()).toString(), 'preview image bytes');
  assert.equal(foreign.status, 404);
  assert.deepEqual(calls, [
    { ownerMetaUserId: 'meta-user-1', id: 'media-image' },
    { ownerMetaUserId: 'meta-user-2', id: 'media-image' }
  ]);
});

test('redirects owned R2 MP4 and MOV previews to short-lived signed URLs', async (context) => {
  const config = testConfig();
  const mediaById = new Map([
    ['media-mp4', {
      id: 'media-mp4',
      ownerMetaUserId: 'meta-user-1',
      mimeType: 'video/mp4',
      sourceUrl: 'https://signed-r2.example/video.mp4?signature=secret'
    }],
    ['media-mov', {
      id: 'media-mov',
      ownerMetaUserId: 'meta-user-1',
      mimeType: 'video/quicktime',
      sourceUrl: 'https://signed-r2.example/video.mov?signature=secret'
    }]
  ]);
  const server = createServer({
    config,
    db: {
      createSession: () => ({ id: 'new-session' }),
      getSession: () => ({ id: 'session-owner', metaUserId: 'meta-user-1' })
    },
    mediaStore: {
      getMedia: async ({ id }) => mediaById.get(id)
    },
    metaClient: {}
  });
  context.after(() => server.close());
  const cookie = `meta_ads_session=${encodeURIComponent(signSession('session-owner', config.sessionSecret))}`;

  const baseUrl = await serverAddress(server);
  for (const [mediaId, media] of mediaById) {
    const response = await fetch(`${baseUrl}/api/media/${mediaId}/preview`, {
      headers: { cookie },
      redirect: 'manual'
    });

    assert.equal(response.status, 302);
    assert.equal(response.headers.get('location'), media.sourceUrl);
    assert.equal(response.headers.get('cache-control'), 'private, no-store');
  }
});

test('allows multipart framing overhead above the exact 500 MB file limit', () => {
  const fileLimit = 500 * 1024 * 1024;

  assert.equal(requestHandler.isLocalMediaRequestTooLarge(fileLimit + 64 * 1024), false);
  assert.equal(requestHandler.isLocalMediaRequestTooLarge(fileLimit + 1024 * 1024 + 1), true);
});

test('routes the R2 multipart lifecycle through the connected session owner', async (context) => {
  const calls = [];
  const r2 = {
    createMultipartUpload: async (input) => {
      calls.push(['create', input]);
      return {
        mediaId: input.mediaId,
        uploadId: 'upload-1',
        key: `ads/${input.ownerMetaUserId}/${input.mediaId}/video.mp4`
      };
    },
    presignMultipartPart: async (input) => {
      calls.push(['part', input]);
      return { ...input, uploadUrl: 'https://upload.example.test/part-1' };
    },
    completeMultipartUpload: async (input) => {
      calls.push(['complete', input]);
      return { id: input.mediaId, name: input.name, mimeType: input.mimeType, sizeBytes: input.sizeBytes };
    },
    abortMultipartUpload: async (input) => {
      calls.push(['abort', input]);
      return { mediaId: input.mediaId, uploadId: input.uploadId, key: input.key, aborted: true };
    }
  };
  const { server, headers } = createR2MultipartRouteServer(context, { r2 });

  const created = await request(server, '/api/r2-media/multipart/create', {
    method: 'POST',
    headers,
    body: JSON.stringify({ name: 'video.mp4', mimeType: 'video/mp4', sizeBytes: 10 })
  });
  const shared = {
    ownerMetaUserId: 'meta-user-2',
    mediaId: created.body.mediaId,
    uploadId: created.body.uploadId,
    key: created.body.key
  };
  const part = await request(server, '/api/r2-media/multipart/part', {
    method: 'POST', headers, body: JSON.stringify({ ...shared, partNumber: 1 })
  });
  const completed = await request(server, '/api/r2-media/multipart/complete', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      ...shared, name: 'video.mp4', mimeType: 'video/mp4', sizeBytes: 10,
      parts: [{ partNumber: 1, etag: '"etag-1"' }]
    })
  });
  const aborted = await request(server, '/api/r2-media/multipart/abort', {
    method: 'POST', headers, body: JSON.stringify(shared)
  });

  assert.equal(created.status, 201);
  assert.match(created.body.mediaId, /^[a-f0-9]{32}$/);
  assert.equal(part.status, 200);
  assert.equal(part.body.partNumber, 1);
  assert.equal(completed.status, 201);
  assert.deepEqual(completed.body, {
    mediaId: created.body.mediaId,
    id: created.body.mediaId,
    name: 'video.mp4',
    mimeType: 'video/mp4',
    sizeBytes: 10
  });
  assert.equal(aborted.status, 200);
  assert.equal(aborted.body.aborted, true);
  assert.deepEqual(calls.map(([name, input]) => [name, input.ownerMetaUserId]), [
    ['create', 'meta-user-1'],
    ['part', 'meta-user-1'],
    ['complete', 'meta-user-1'],
    ['abort', 'meta-user-1']
  ]);
});

test('requires a connected Meta owner for every R2 multipart route', async (context) => {
  const fail = () => assert.fail('unauthenticated multipart operation must not run');
  const { server, headers } = createR2MultipartRouteServer(context, {
    metaUserId: null,
    r2: {
      createMultipartUpload: fail,
      presignMultipartPart: fail,
      completeMultipartUpload: fail,
      abortMultipartUpload: fail
    }
  });

  for (const route of ['create', 'part', 'complete', 'abort']) {
    const response = await request(server, `/api/r2-media/multipart/${route}`, {
      method: 'POST', headers, body: JSON.stringify({})
    });
    assert.equal(response.status, 401);
  }
});

test('exposes client methods for all R2 multipart operations', async () => {
  const requests = [];
  const api = createApiClient(async (url, options) => {
    requests.push({ url, method: options.method, body: JSON.parse(options.body) });
    return Response.json({ ok: true });
  });
  const inputs = [
    ['createMultipartUpload', 'create', { name: 'video.mp4', mimeType: 'video/mp4', sizeBytes: 10 }],
    ['presignMultipartPart', 'part', { mediaId: 'media-1', uploadId: 'upload-1', key: 'key', partNumber: 1 }],
    ['completeMultipartUpload', 'complete', { mediaId: 'media-1', uploadId: 'upload-1', key: 'key', parts: [] }],
    ['abortMultipartUpload', 'abort', { mediaId: 'media-1', uploadId: 'upload-1', key: 'key' }]
  ];

  for (const [method, route, body] of inputs) {
    await api[method](body);
    assert.deepEqual(requests.at(-1), {
      url: `/api/r2-media/multipart/${route}`,
      method: 'POST',
      body
    });
  }
});

test('returns 404 for removed direct Meta media routes', async (context) => {
  const config = testConfig();
  const server = createServer({
    config,
    db: {
      createSession: () => ({ id: 'new-session' }),
      getSession: () => ({ id: 'session-user', metaUserId: 'meta-user-1' })
    },
    metaClient: {}
  });
  context.after(() => server.close());
  const session = signSession('session-user', config.sessionSecret);

  for (const path of ['/api/meta-media/image?accountId=act_1', '/api/meta-media/video/start']) {
    const response = await request(server, path, {
      method: 'POST',
      headers: {
        cookie: `meta_ads_session=${encodeURIComponent(session)}`,
        'content-type': 'application/json'
      },
      body: JSON.stringify({})
    });
    assert.equal(response.status, 404);
  }
});

test('publishes a valid owned draft and returns per-node creation results', async (context) => {
  const config = testConfig();
  const savedNodes = [];
  const server = createServer({
    config,
    db: {
      createSession: () => ({ id: 'new-session' }),
      getSession: () => ({ id: 'session-user', metaUserId: 'meta-user-1' }),
      getConnection: () => ({
        accessTokenCiphertext: encryptToken('EAAG-token', config.tokenEncryptionKey)
      }),
      getMedia: () => ({
        id: 'media-1',
        ownerMetaUserId: 'meta-user-1',
        mimeType: 'image/jpeg',
        name: 'creative.jpg',
        content: new Uint8Array(Buffer.from('image bytes'))
      }),
      createRun: () => ({ id: 'run-1' }),
      updateNodeResult: (_runId, node) => savedNodes.push(node),
      updateRunStatus: () => undefined
    },
    metaClient: {
      listPromotablePages: async () => [{ id: 'page_1' }],
      getPagePublishingContext: async (_token, pageIds) => ({
        permissionGranted: true,
        pages: new Map(pageIds.map((pageId) => [String(pageId), {
          name: String(pageId), accessToken: '', tasks: []
        }]))
      }),
      createCampaign: async () => 'campaign-remote',
      createAdSet: async () => 'adset-remote',
      uploadImage: async (_token, _accountId, media) => {
        assert.equal(Buffer.isBuffer(media.content), true);
        return 'image-hash';
      },
      createCreative: async () => 'creative-remote',
      createAd: async () => 'ad-remote'
    }
  });
  context.after(() => server.close());

  const session = signSession('session-user', config.sessionSecret);
  const response = await request(server, '/api/runs', {
    method: 'POST',
    headers: {
      cookie: `meta_ads_session=${encodeURIComponent(session)}`,
      'content-type': 'application/json'
    },
    body: JSON.stringify(draft)
  });

  assert.equal(response.status, 201);
  assert.deepEqual(response.body.nodes.map((node) => [node.clientId, node.status]), [
    ['campaign-1', 'created'],
    ['adset-1', 'created'],
    ['ad-1', 'created']
  ]);
  assert.ok(savedNodes.some((node) => node.status === 'creating'));
});

test('a streaming direct run completes after throttle without sending a second HTTP response or recreating parents', async (context) => {
  const calls = { campaign: 0, adset: 0, creative: 0, ad: 0 };
  const statuses = [];
  const { server, headers } = createPublishRouteServer(context, {
    db: { updateRunStatus: (_id, status) => { statuses.push(status); } },
    metaClient: {
      createCampaign: async () => { calls.campaign++; return 'campaign-remote'; },
      createAdSet: async () => { calls.adset++; return 'adset-remote'; },
      createCreative: async () => { calls.creative++; return 'creative-remote'; },
      createAd: async () => {
        calls.ad++;
        if (calls.ad === 1) throw Object.assign(new Error('quota'), {
          name: 'MetaThrottleError', statusCode: 429, retryable: true, retryAfterMs: 1
        });
        return 'ad-remote';
      }
    }
  });
  const result = await request(server, '/api/runs', {
    method: 'POST', headers: { ...headers, 'content-type': 'application/json', accept: 'application/x-ndjson' },
    body: JSON.stringify(draft)
  });
  const events = parseNdjson(result.body);
  assert.equal(result.status, 201);
  assert.equal(events.at(-1).type, 'run_completed');
  assert.equal(events.at(-1).status, 'completed');
  assert.ok(events.some((event) => event.node?.status === 'retry_pending'));
  assert.ok(events.at(-1).nodes.every((node) => !node.error), 'old quota errors must not survive a successful retry');
  assert.deepEqual(calls, { campaign: 1, adset: 1, creative: 1, ad: 2 });
  assert.equal(statuses.at(-1), 'completed');
});

test('streams a persisted run start before Meta publication completes', async (context) => {
  const campaignGate = deferred();
  const { server, headers } = createPublishRouteServer(context, {
    metaClient: { createCampaign: async () => campaignGate.promise }
  });
  const address = await serverAddress(server);
  const response = await fetch(`${address}/api/runs`, {
    method: 'POST',
    headers: {
      ...headers,
      'content-type': 'application/json',
      accept: 'application/x-ndjson'
    },
    body: JSON.stringify(draft)
  });
  const reader = response.body.getReader();
  const firstChunk = new TextDecoder().decode((await reader.read()).value);
  assert.match(firstChunk, /"type":"run_started"/);

  campaignGate.resolve('campaign-remote');
  const remaining = await readRemainingText(reader);
  const events = parseNdjson(firstChunk + remaining);
  assert.deepEqual(events.map((event) => event.type), [
    'run_started',
    'node_updated', 'node_updated',
    'node_updated', 'node_updated',
    'node_updated', 'node_updated',
    'run_completed'
  ]);
});

test('persists a sanitized report snapshot before Meta publication', async (context) => {
  let createdRun;
  const { server, headers } = createPublishRouteServer(context, {
    db: {
      createRun: (run) => { createdRun = run; return { id: 'run-report' }; }
    },
    metaClient: pageCatalogMeta([['page_1', 'Duck Tool']])
  });

  assert.equal((await request(server, '/api/resources', { headers })).status, 200);
  const response = await request(server, '/api/runs', {
    method: 'POST',
    headers: { ...headers, 'content-type': 'application/json' },
    body: JSON.stringify(draft)
  });

  assert.equal(response.status, 201);
  assert.equal(createdRun.ownerMetaUserId, 'meta-user-1');
  assert.equal(createdRun.adAccountId, 'act_1');
  assert.equal(createdRun.snapshot.version, 3);
  assert.equal(createdRun.snapshot.campaigns[0].name, 'Campaign 1');
  assert.equal(createdRun.snapshot.campaigns[0].adAccountId, 'act_1');
  assert.equal(createdRun.snapshot.campaigns[0].pageName, 'Duck Tool');
  assert.equal('pageId' in createdRun.snapshot.campaigns[0].adSets[0], false);
  assert.deepEqual(createdRun.snapshot.campaigns[0].adSets[0].ads[0].media, {
    id: 'media-1',
    name: 'creative.jpg',
    mimeType: 'image/jpeg',
    sizeBytes: 11
  });
  assert.doesNotMatch(JSON.stringify(createdRun.snapshot), /image bytes/);
});

test('validates owned seeding template and media before Meta access, then snapshots the current Campaign copy', async (context) => {
  const currentDraft = structuredClone(draft);
  currentDraft.campaigns[0].seeding = {
    enabled: true,
    templateId: 'seed-template-1',
    templateName: 'Campaign copy',
    items: [{
      id: 'seed-item-1',
      message: 'Current Campaign text',
      imageMediaId: 'seed-media-1',
      blobUrl: 'blob:must-not-persist'
    }]
  };
  let createdRun;
  const mediaReads = [];
  const config = testConfig();
  const db = {
    createSession: () => ({ id: 'new-session' }),
    getSession: () => ({ id: 'session-user', metaUserId: 'meta-user-1' }),
    getConnection: () => ({ accessTokenCiphertext: encryptToken('EAAG-token', config.tokenEncryptionKey) }),
    getSeedingTemplate: () => ({
      id: 'seed-template-1',
      ownerMetaUserId: 'meta-user-1',
      name: 'Library was edited elsewhere',
      items: [{ id: 'different', message: 'Do not snapshot this', imageMediaId: null }]
    }),
    createRun: (run) => { createdRun = run; return { id: 'run-seeding' }; },
    updateNodeResult: () => undefined,
    updateRunStatus: () => undefined
  };
  const mediaStore = {
    async getMedia({ ownerMetaUserId, id }) {
      mediaReads.push({ ownerMetaUserId, id });
      if (id === 'media-1') return {
        id, ownerMetaUserId, mimeType: 'image/jpeg', name: 'creative.jpg', sizeBytes: 11, content: Buffer.from('image bytes')
      };
      return { id, ownerMetaUserId, mimeType: 'image/png', name: 'trusted.png', sizeBytes: 1024 };
    }
  };
  const replacement = createServer({
    config,
    db,
    mediaStore,
    metaClient: {
      listPromotablePages: async () => [{ id: 'page_1' }],
      getPagePublishingContext: async (_token, pageIds) => ({
        permissionGranted: true,
        pages: new Map(pageIds.map((pageId) => [String(pageId), {
          name: String(pageId), accessToken: '', tasks: []
        }]))
      }),
      createCampaign: async () => 'campaign-remote',
      createAdSet: async () => 'adset-remote',
      uploadImage: async () => 'image-hash',
      createCreative: async () => 'creative-remote',
      createAd: async () => 'ad-remote'
    }
  });
  context.after(() => replacement.close());
  const session = signSession('session-user', config.sessionSecret);

  const response = await request(replacement, '/api/runs', {
    method: 'POST',
    headers: {
      cookie: `meta_ads_session=${encodeURIComponent(session)}`,
      'content-type': 'application/json'
    },
    body: JSON.stringify(currentDraft)
  });

  assert.equal(response.status, 201);
  assert.deepEqual(mediaReads, [
    { ownerMetaUserId: 'meta-user-1', id: 'seed-media-1' },
    { ownerMetaUserId: 'meta-user-1', id: 'media-1' }
  ]);
  assert.deepEqual(createdRun.snapshot.campaigns[0].seeding, {
    enabled: true,
    templateId: 'seed-template-1',
    templateName: 'Campaign copy',
    items: [{
      id: 'seed-item-1', message: 'Current Campaign text', imageMediaId: 'seed-media-1', imageName: 'trusted.png'
    }]
  });
  assert.doesNotMatch(JSON.stringify(createdRun.snapshot), /blob:|Do not snapshot this/);
});

test('rejects missing seeding templates and untrusted seeding media before Meta reads or writes', async (context) => {
  const cases = [
    ['missing template', null, { mimeType: 'image/png', sizeBytes: 10 }],
    ['foreign media', { id: 'seed-template-1', ownerMetaUserId: 'meta-user-1' }, { ownerMetaUserId: 'meta-user-2', mimeType: 'image/png', sizeBytes: 10 }],
    ['wrong media type', { id: 'seed-template-1', ownerMetaUserId: 'meta-user-1' }, { mimeType: 'image/gif', sizeBytes: 10 }],
    ['oversized media', { id: 'seed-template-1', ownerMetaUserId: 'meta-user-1' }, { mimeType: 'image/png', sizeBytes: 200 * 1024 * 1024 + 1 }]
  ];
  for (const [name, template, seedingMedia] of cases) {
    await context.test(name, async (subcontext) => {
      const config = testConfig();
      let metaCalls = 0;
      let runsCreated = 0;
      const invalidDraft = structuredClone(draft);
      invalidDraft.campaigns[0].seeding = {
        enabled: true,
        templateId: 'seed-template-1',
        templateName: 'Campaign copy',
        items: [{ id: 'seed-item-1', message: '', imageMediaId: 'seed-media-1' }]
      };
      const server = createServer({
        config,
        db: {
          createSession: () => ({ id: 'new-session' }),
          getSession: () => ({ id: 'session-user', metaUserId: 'meta-user-1' }),
          getConnection: () => ({ accessTokenCiphertext: encryptToken('EAAG-token', config.tokenEncryptionKey) }),
          getSeedingTemplate: () => template,
          createRun: () => { runsCreated += 1; return { id: 'run-1' }; }
        },
        mediaStore: {
          getMedia: async ({ id }) => id === 'media-1'
            ? { id, ownerMetaUserId: 'meta-user-1', mimeType: 'image/jpeg', name: 'creative.jpg', sizeBytes: 10, content: Buffer.from('image') }
            : { id, ownerMetaUserId: 'meta-user-1', name: 'seed', ...seedingMedia }
        },
        metaClient: new Proxy({}, { get: () => async () => { metaCalls += 1; } })
      });
      subcontext.after(() => server.close());
      const session = signSession('session-user', config.sessionSecret);

      const response = await request(server, '/api/runs', {
        method: 'POST',
        headers: {
          cookie: `meta_ads_session=${encodeURIComponent(session)}`,
          'content-type': 'application/json'
        },
        body: JSON.stringify(invalidDraft)
      });

      assert.ok([400, 422].includes(response.status));
      assert.equal(metaCalls, 0);
      assert.equal(runsCreated, 0);
    });
  }
});

test('finishes publish NDJSON before any seeding queue work starts', async (context) => {
  let queueCalls = 0;
  const { server, headers } = createPublishRouteServer(context, {
    db: { insertSeedingJobs: () => { queueCalls += 1; } }
  });
  const response = await request(server, '/api/runs', {
    method: 'POST',
    headers: { ...headers, 'content-type': 'application/json', accept: 'application/x-ndjson' },
    body: JSON.stringify(draft)
  });

  const events = parseNdjson(response.body);
  assert.equal(events.at(-1).type, 'run_completed');
  assert.equal(queueCalls, 0);
});

test('fails an NDJSON run when a created node cannot be persisted', async (context) => {
  const attemptedNodeStatuses = [];
  const requestedRunStatuses = [];
  const persistenceFailure = new Error('Node persistence unavailable');
  const { server, headers } = createPublishRouteServer(context, {
    db: {
      updateNodeResult: async (_runId, node) => {
        attemptedNodeStatuses.push(node.status);
        if (node.status === 'created') throw persistenceFailure;
      },
      updateRunStatus: async (_runId, status) => requestedRunStatuses.push(status)
    }
  });
  const address = await serverAddress(server);
  const response = await fetch(`${address}/api/runs`, {
    method: 'POST',
    headers: {
      ...headers,
      'content-type': 'application/json',
      accept: 'application/x-ndjson'
    },
    body: JSON.stringify(draft)
  });

  assert.match(response.headers.get('content-type') ?? '', /^application\/x-ndjson/);
  const events = parseNdjson(await response.text());
  assert.ok(events.some((event) => event.type === 'run_failed'));
  assert.equal(events.some((event) => event.type === 'run_completed'), false);
  assert.deepEqual(requestedRunStatuses, ['failed']);
  assert.deepEqual(attemptedNodeStatuses, ['creating', 'created']);
});

test('returns only the connected owner run snapshot', async (context) => {
  const { server, headers } = createPublishRouteServer(context, {
    getRun: () => ({
      id: 'run-1',
      ownerMetaUserId: 'meta-user-1',
      status: 'completed',
      adAccountId: 'act_1',
      snapshot: { version: 1, adAccountId: 'act_1', campaigns: [] },
      createdAt: 1_000,
      completedAt: 2_000,
      legacy: false,
      nodes: []
    })
  });
  const response = await request(server, '/api/runs/run-1', { headers });
  assert.equal(response.status, 200);
  assert.deepEqual(response.body, {
    id: 'run-1',
    status: 'completed',
    adAccountId: 'act_1',
    snapshot: { version: 1, adAccountId: 'act_1', campaigns: [] },
    createdAt: 1_000,
    completedAt: 2_000,
    workflowLeaseExpiresAt: null,
    legacy: false,
    nodes: [],
    seeding: {
      summary: {
        posts: 0, total: 0, pending: 0, posting: 0, created: 0,
        failed: 0, needsReview: 0, cancelled: 0
      },
      jobs: [],
      conflicts: [],
      waitingPostCount: 0,
      waitingCampaignCount: 0
    }
  });
});

test('polling a nonterminal run never dispatches a second publishing workflow', async (context) => {
  let dispatchCalls = 0;
  const workflowServer = createHttpServer((_request, response) => {
    dispatchCalls += 1;
    response.writeHead(202, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ accepted: true, instanceId: 'unexpected-resume' }));
  });
  context.after(() => workflowServer.close());
  const workflowUrl = await serverAddress(workflowServer);
  const run = {
    id: 'run-1',
    ownerMetaUserId: 'meta-user-1',
    status: 'creating',
    adAccountId: 'act_1',
    snapshot: { version: 1, adAccountId: 'act_1', campaigns: [] },
    createdAt: 1_000,
    completedAt: null,
    legacy: false,
    nodes: []
  };
  const { server, headers } = createPublishRouteServer(context, {
    getRun: () => run,
    config: {
      workflowEnabled: true,
      workflowUrl,
      workflowSharedSecret: 'workflow-test-secret'
    }
  });

  const first = await request(server, '/api/runs/run-1', { headers });
  const second = await request(server, '/api/runs/run-1', { headers });
  await new Promise((resolve) => setTimeout(resolve, 50));

  assert.equal(first.status, 200);
  assert.equal(second.status, 200);
  assert.equal(dispatchCalls, 0);
});

test('manual workflow recovery is rejected while another workflow owns the run lease', async (context) => {
  let dispatchCalls = 0;
  const workflowServer = createHttpServer((_request, response) => {
    dispatchCalls += 1;
    response.writeHead(202, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ accepted: true, instanceId: 'unexpected-resume' }));
  });
  context.after(() => workflowServer.close());
  const workflowUrl = await serverAddress(workflowServer);
  const run = {
    id: 'run-1', ownerMetaUserId: 'meta-user-1', status: 'creating', adAccountId: 'act_1',
    snapshot: { version: 1, campaigns: [] }, createdAt: 1_000, completedAt: null, nodes: []
  };
  const { server, headers } = createPublishRouteServer(context, {
    getRun: () => run,
    db: { claimWorkflowLease: () => false },
    config: {
      workflowEnabled: true,
      workflowUrl,
      workflowSharedSecret: 'workflow-test-secret'
    }
  });

  const response = await request(server, '/api/runs/run-1/workflow/resume', {
    method: 'POST', headers
  });

  assert.equal(response.status, 409);
  assert.match(response.body.error, /đang hoạt động/i);
  assert.equal(dispatchCalls, 0);
});

test('manual workflow recovery is rejected when Workflow is disabled', async (context) => {
  const run = {
    id: 'run-1', ownerMetaUserId: 'meta-user-1', status: 'creating', adAccountId: 'act_1',
    snapshot: { version: 1, campaigns: [] }, execution: { campaigns: [] }, createdAt: 1_000, nodes: []
  };
  const { server, headers } = createPublishRouteServer(context, {
    getRun: () => run,
    config: { workflowEnabled: false }
  });

  const response = await request(server, '/api/runs/run-1/workflow/resume', {
    method: 'POST', headers
  });

  assert.equal(response.status, 409);
  assert.equal(response.body.reason, 'workflow_disabled');
  assert.match(response.body.error, /Workflow đang tắt/i);
});

test('retries only one failed Ad while preserving its successful Meta parents', async (context) => {
  let workflowPayload;
  const workflowServer = createHttpServer(async (request, response) => {
    let body = '';
    for await (const chunk of request) body += chunk;
    workflowPayload = JSON.parse(body);
    response.writeHead(202, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ accepted: true, instanceId: 'retry-ad-workflow' }));
  });
  context.after(() => workflowServer.close());
  const workflowUrl = await serverAddress(workflowServer);
  const run = {
    id: 'run-1',
    ownerMetaUserId: 'meta-user-1',
    status: 'completed_with_errors',
    adAccountId: 'act_1',
    snapshot: { version: 3, campaigns: [] },
    execution: structuredClone(draft),
    createdAt: 1_000,
    completedAt: 2_000,
    nodes: [
      { clientId: 'campaign-1', type: 'campaign', status: 'created', remoteId: 'campaign-remote', name: 'Campaign 1' },
      { clientId: 'adset-1', parentClientId: 'campaign-1', type: 'adSet', status: 'created', remoteId: 'adset-remote', name: 'Ad Set 1' },
      {
        clientId: 'ad-1', parentClientId: 'adset-1', type: 'ad', status: 'failed', name: 'Ad 1',
        error: { message: 'Meta temporary creative error', code: 100, subcode: 1487390 }
      }
    ]
  };
  const nodeUpdates = [];
  const statusUpdates = [];
  const { server, headers } = createPublishRouteServer(context, {
    getRun: () => run,
    db: {
      claimWorkflowLease: (_runId, token, _now, ttlMs) => {
        run.workflowToken = token;
        run.workflowLeaseExpiresAt = Date.now() + ttlMs;
        return true;
      },
      updateNodeResult: (_runId, node) => {
        nodeUpdates.push(node);
        const index = run.nodes.findIndex((entry) => entry.clientId === node.clientId);
        run.nodes[index] = { ...node };
      },
      updateRunStatus: (_runId, status, completedAt) => {
        statusUpdates.push({ status, completedAt });
        run.status = status;
        run.completedAt = completedAt;
      },
      releaseWorkflowLease: () => true
    },
    config: {
      workflowEnabled: true,
      workflowUrl,
      workflowSharedSecret: 'workflow-test-secret'
    }
  });

  const response = await request(server, '/api/runs/run-1/ads/ad-1/retry', {
    method: 'POST', headers
  });

  assert.equal(response.status, 202);
  assert.equal(response.body.accepted, true);
  assert.equal(response.body.run.status, 'retrying_ad');
  assert.equal(response.body.run.nodes.find((node) => node.clientId === 'campaign-1').remoteId, 'campaign-remote');
  assert.equal(response.body.run.nodes.find((node) => node.clientId === 'adset-1').remoteId, 'adset-remote');
  assert.equal(response.body.run.nodes.find((node) => node.clientId === 'ad-1').status, 'retry_pending');
  assert.deepEqual(nodeUpdates.map((node) => node.clientId), ['ad-1']);
  assert.deepEqual(statusUpdates, [{ status: 'retrying_ad', completedAt: null }]);
  assert.equal(workflowPayload.runId, 'run-1');
  assert.equal(workflowPayload.restart, true);
  assert.match(workflowPayload.restartKey, /^ad-[a-f0-9]{12}$/);
  assert.match(workflowPayload.workflowToken, /^[a-f0-9]{48}$/);
});

for (const retryType of ['ad', 'adSet', 'uncertain']) test(`retries one failed ${retryType} in-process when the workflow service is disabled`, async (context) => {
  const execution = structuredClone(draft);
  execution.campaigns[0].adSets[0].ads[0].mediaAsset = {
    kind: 'image', accountId: 'act_1', imageHash: 'stored-image-hash', mimeType: 'image/jpeg', name: 'stored.jpg'
  };
  const run = {
    id: 'run-1', ownerMetaUserId: 'meta-user-1', status: 'completed_with_errors', adAccountId: 'act_1',
    snapshot: { version: 3, campaigns: [] }, execution, createdAt: 1_000, completedAt: 2_000,
    nodes: [
      { clientId: 'campaign-1', type: 'campaign', status: 'created', remoteId: 'campaign-remote', name: 'Campaign 1' },
      { clientId: 'adset-1', parentClientId: 'campaign-1', type: 'adSet', status: 'created', remoteId: 'adset-remote', name: 'Ad Set 1' },
      { clientId: 'ad-1', parentClientId: 'adset-1', type: 'ad', status: 'failed', name: 'Ad 1', error: { message: 'Creative failed' } }
    ]
  };
  let parentWrites = 0;
  let adSetWrites = 0;
  if (retryType === 'uncertain') run.nodes[2].error.type = 'UncertainAdWriteError';
  if (retryType === 'adSet') {
    run.nodes[1] = { ...run.nodes[1], status: 'failed', remoteId: null };
    run.nodes[2] = { ...run.nodes[2], status: 'skipped' };
    const adSet = execution.campaigns[0].adSets[0];
    adSet.ads.push({ ...structuredClone(adSet.ads[0]), clientId: 'ad-2' });
    run.nodes.push({ ...run.nodes[2], clientId: 'ad-2' });
    execution.campaigns[0].adSets.push({ ...structuredClone(adSet), clientId: 'adset-other', ads: [] });
    run.nodes.push({ clientId: 'adset-other', type: 'adSet', status: 'created', remoteId: 'keep-adset' });
  }
  let creativeWrites = 0;
  let adWrites = 0;
  let released = false;
  const { server, headers } = createPublishRouteServer(context, {
    getRun: () => run,
    db: {
      claimWorkflowLease: (_runId, token) => { run.workflowToken = token; return true; },
      updateNodeResult: (_runId, node) => {
        const index = run.nodes.findIndex((entry) => entry.clientId === node.clientId);
        run.nodes[index] = { ...run.nodes[index], ...node };
      },
      updateRunStatus: (_runId, status, completedAt) => {
        run.status = status;
        run.completedAt = completedAt;
      },
      releaseWorkflowLease: (_runId, token) => {
        assert.equal(token, run.workflowToken);
        released = true;
        run.workflowToken = null;
        return true;
      }
    },
    metaClient: {
      createCampaign: async () => { parentWrites += 1; return 'unexpected-campaign'; },
      createAdSet: async () => { adSetWrites += 1; return 'adset-retry'; },
      uploadImage: async () => { throw new Error('Stored Meta image must be reused'); },
      createCreative: async () => { creativeWrites += 1; return 'creative-retry'; },
      createAd: async () => { adWrites += 1; return 'ad-retry'; },
      getAdPublication: async () => ({
        postId: 'page_1_123', permalinkUrl: 'https://www.facebook.com/page_1/posts/123'
      })
    }
  });

  const retryPath = retryType === 'adSet' ? 'adsets/adset-1' : 'ads/ad-1';
  const response = await request(server, `/api/runs/run-1/${retryPath}/retry`, {
    method: 'POST', headers,
    ...(retryType === 'uncertain' ? { body: JSON.stringify({ resolution: 'not_created', confirmed: true }) } : {})
  });

  assert.equal(response.status, 200);
  assert.equal(response.body.run.status, 'completed');
  assert.equal(response.body.run.nodes.find((node) => node.clientId === 'ad-1').remoteId, 'ad-retry');
  assert.equal(response.body.run.nodes.find((node) => node.clientId === 'ad-1').postId, 'page_1_123');
  assert.equal(parentWrites, 0);
  assert.equal(adSetWrites, retryType === 'adSet' ? 1 : 0);
  assert.ok(creativeWrites >= 1 && creativeWrites <= (retryType === 'adSet' ? 2 : 1));
  assert.equal(adWrites, retryType === 'adSet' ? 2 : 1);
  assert.equal(released, true);
  if (retryType === 'adSet') {
    assert.equal(run.nodes.find(node => node.clientId === 'ad-2').status, 'created');
    assert.equal(run.nodes.find(node => node.clientId === 'adset-other').remoteId, 'keep-adset');
    const again = await request(server, `/api/runs/run-1/${retryPath}/retry`, { method: 'POST', headers });
    assert.equal(again.status, 409);
    assert.equal(adSetWrites, 1);
    assert.equal(adWrites, 2);
  }
});

for (const scenario of ['missing-confirmation', 'wrong-account', 'wrong-adset', 'wrong-name', 'wrong-creative', 'valid', 'lease-busy', 'stale']) {
  test(`uncertain Ad resolution: ${scenario}`, async context => {
    const run = {
      id: 'run-1', ownerMetaUserId: 'meta-user-1', status: 'completed_with_errors',
      execution: structuredClone(draft), snapshot: { version: 3, campaigns: [] }, createdAt: 1000,
      nodes: [
        { clientId: 'campaign-1', type: 'campaign', status: 'created', remoteId: 'campaign-remote' },
        { clientId: 'adset-1', type: 'adSet', status: 'created', remoteId: 'adset-remote' },
        { clientId: 'ad-1', parentClientId: 'adset-1', type: 'ad', status: 'failed', creativeId: 'creative-1',
          error: { type: 'UncertainAdWriteError' } }
      ]
    };
    let reads = 0;
    let released = 0;
    let writes = 0;
    const { server, headers } = createPublishRouteServer(context, {
      getRun: () => run,
      db: {
        claimWorkflowLease: () => {
          if (scenario === 'stale') run.nodes[2].remoteId = 'already-created';
          return scenario !== 'lease-busy';
        },
        releaseWorkflowLease: () => { released++; },
        updateNodeResult: (_id, node) => { writes++; run.nodes[2] = node; },
        updateRunStatus: (_id, status) => { run.status = status; }
      },
      metaClient: {
        createAd: () => assert.fail('Adoption must not create ads'),
        getAdIdentity: async (_token, id) => {
          reads++;
          return { id, account_id: scenario === 'wrong-account' ? '2' : '1', campaign_id: 'campaign-remote',
            adset_id: scenario === 'wrong-adset' ? 'other' : 'adset-remote',
            name: scenario === 'wrong-name' ? 'other' : draft.campaigns[0].adSets[0].ads[0].name,
            creative: { id: scenario === 'wrong-creative' ? 'other' : 'creative-1' } };
        }
      }
    });
    const response = await request(server, '/api/runs/run-1/ads/ad-1/retry', {
      method: 'POST', headers,
      body: JSON.stringify({ resolution: 'existing', confirmed: scenario !== 'missing-confirmation', adId: '123456' })
    });
    assert.equal(response.status, scenario === 'valid' ? 200 : 409);
    assert.equal(writes, scenario === 'valid' ? 1 : 0);
    assert.equal(reads, ['missing-confirmation', 'lease-busy', 'stale'].includes(scenario) ? 0 : 1);
    assert.equal(released, ['missing-confirmation', 'lease-busy'].includes(scenario) ? 0 : 1);
    if (scenario === 'valid') {
      assert.equal(response.body.adopted, true);
      assert.equal(run.nodes[2].remoteId, '123456');
      const again = await request(server, '/api/runs/run-1/ads/ad-1/retry', { method: 'POST', headers });
      assert.equal(again.status, 409);
      assert.equal(writes, 1);
    }
  });
}

test('refreshes missing Post IDs for the connected owner without exposing the token', async (context) => {
  let storedNode = {
    clientId: 'ad-1', parentClientId: 'adset-1', type: 'ad', status: 'created', name: 'Ad 1',
    remoteId: 'remote-ad-1', postId: null, permalinkUrl: null, error: null
  };
  const run = () => ({
    id: 'run-1', ownerMetaUserId: 'meta-user-1', status: 'completed', adAccountId: 'act_1',
    snapshot: { version: 2, campaigns: [{ adSets: [{ ads: [{ clientId: 'ad-1', creativeGroupId: 'group-1' }] }] }] },
    createdAt: 1_000, completedAt: 2_000, legacy: false, nodes: [storedNode]
  });
  const metaCalls = [];
  const { server, headers } = createPublishRouteServer(context, {
    getRun: run,
    db: {
      savePublication: (_runId, _nodes, { postId, permalinkUrl }) => { storedNode = { ...storedNode, postId, permalinkUrl }; }
    },
    metaClient: {
      getAdPublication: async (token, remoteId) => {
        metaCalls.push({ token, remoteId });
        return { postId: '123_456', permalinkUrl: 'https://www.facebook.com/123/posts/456' };
      }
    }
  });

  const response = await request(server, '/api/runs/run-1/publications/refresh', {
    method: 'POST',
    headers
  });

  assert.equal(response.status, 200);
  assert.deepEqual(metaCalls, [{ token: 'EAAG-token', remoteId: 'remote-ad-1' }]);
  assert.equal(response.body.run.nodes[0].postId, '123_456');
  assert.equal(response.body.run.nodes[0].permalinkUrl, 'https://www.facebook.com/123/posts/456');
  assert.equal(response.body.run.nodes[0].status, 'created');
  assert.equal(response.body.sync.resolvedGroups, 1);
  assert.doesNotMatch(JSON.stringify(response.body), /EAAG-token/);
});

test('publication refresh rechecks run ownership after synchronization', async (context) => {
  let reads = 0;
  const { server, headers } = createPublishRouteServer(context, {
    getRun: () => {
      reads += 1;
      return {
        id: 'run-1',
        ownerMetaUserId: reads === 1 ? 'meta-user-1' : 'meta-user-2',
        status: 'completed',
        snapshot: { version: 3, campaigns: [] },
        nodes: []
      };
    }
  });

  const response = await request(server, '/api/runs/run-1/publications/refresh', {
    method: 'POST', headers
  });

  assert.equal(response.status, 404);
});

test('hides foreign run publication refresh behind not found', async (context) => {
  let metaCalls = 0;
  const { server, headers } = createPublishRouteServer(context, {
    getRun: () => ({ id: 'run-2', ownerMetaUserId: 'meta-user-2', status: 'completed', snapshot: {}, nodes: [] }),
    metaClient: { getAdPublication: async () => { metaCalls += 1; } }
  });

  const response = await request(server, '/api/runs/run-2/publications/refresh', {
    method: 'POST',
    headers
  });

  assert.equal(response.status, 404);
  assert.equal(metaCalls, 0);
});

test('lists only connected-owner runs with validated date filters and pagination', async (context) => {
  let listRequest;
  let detailReads = 0;
  let seedingReads = 0;
  const { server, headers } = createPublishRouteServer(context, {
    db: {
      getRun: () => { detailReads += 1; return null; },
      listSeedingJobs: () => { seedingReads += 1; return []; },
      listRuns: (ownerMetaUserId, options) => {
        listRequest = { ownerMetaUserId, options };
        return {
          items: [{
            id: 'run-2', status: 'completed', adAccountId: 'act_1', createdAt: 3_000,
            completedAt: 4_000, legacy: false,
            counts: { total: 3, created: 3, failed: 0, skipped: 0, campaigns: 1, adSets: 1, ads: 1 }
          }],
          nextOffset: 30
        };
      }
    }
  });

  const response = await request(server, '/api/runs?from=1000&to=5000&limit=10&offset=20', { headers });

  assert.equal(response.status, 200);
  assert.deepEqual(listRequest, {
    ownerMetaUserId: 'meta-user-1',
    options: { from: 1_000, to: 5_000, limit: 10, offset: 20 }
  });
  assert.equal(response.body.items[0].id, 'run-2');
  assert.equal('seeding' in response.body.items[0], false);
  assert.equal(response.body.nextOffset, 30);
  assert.equal(detailReads, 0);
  assert.equal(seedingReads, 0);

  const invalid = await request(server, '/api/runs?from=5000&to=1000', { headers });
  assert.equal(invalid.status, 400);
});

test('hides missing and foreign run ids behind the same response', async (context) => {
  const foreign = createPublishRouteServer(context, {
    getRun: () => ({ id: 'run-2', ownerMetaUserId: 'meta-user-2', status: 'creating', nodes: [] })
  });
  const response = await request(foreign.server, '/api/runs/run-2', { headers: foreign.headers });
  assert.equal(response.status, 404);
  assert.deepEqual(response.body, { error: 'Không tìm thấy lượt tạo' });
});

test('snapshots selected Page details without account-specific Page authorization', async (context) => {
  const publishingContextPageIds = [];
  const writeAccounts = [];
  let createdRun;
  const { server, headers } = createPublishRouteServer(context, {
    db: {
      createRun: (run) => { createdRun = run; return { id: 'run-multi-account' }; }
    },
    metaClient: {
      ...pageCatalogMeta([['page_1', 'LG Clinic'], ['page_2', 'LG Clinic Quận 7']]),
      getPagePublishingContext: async (_token, pageIds) => {
        publishingContextPageIds.push(...pageIds);
        return { permissionGranted: true, pages: new Map() };
      },
      createCampaign: async (_token, accountId) => { writeAccounts.push(['campaign', accountId]); return `campaign-${accountId}`; },
      createAdSet: async (_token, accountId) => { writeAccounts.push(['adSet', accountId]); return `adset-${accountId}`; },
      uploadImage: async (_token, accountId) => { writeAccounts.push(['image', accountId]); return `hash-${accountId}`; },
      createCreative: async (_token, accountId) => { writeAccounts.push(['creative', accountId]); return `creative-${accountId}`; },
      createAd: async (_token, accountId) => { writeAccounts.push(['ad', accountId]); return `ad-${accountId}`; }
    }
  });

  assert.equal((await request(server, '/api/resources', { headers })).status, 200);
  const response = await request(server, '/api/runs', {
    method: 'POST',
    headers: { ...headers, 'content-type': 'application/json' },
    body: JSON.stringify(twoCampaignDraft())
  });

  assert.equal(response.status, 201);
  assert.deepEqual(publishingContextPageIds, [], 'DARK ads need no Page token or posting permission');
  assert.equal(createdRun.adAccountId, null);
  assert.equal(createdRun.snapshot.adAccountId, null);
  assert.deepEqual(createdRun.snapshot.campaigns.map((campaign) => campaign.adAccountId), ['act_1', 'act_2']);
  assert.deepEqual(createdRun.snapshot.campaigns.map((campaign) => campaign.pageName), ['LG Clinic', 'LG Clinic Quận 7']);
  assert.deepEqual(writeAccounts, [
    ['campaign', 'act_1'], ['adSet', 'act_1'], ['image', 'act_1'], ['creative', 'act_1'], ['ad', 'act_1'],
    ['campaign', 'act_2'], ['adSet', 'act_2'], ['image', 'act_2'], ['creative', 'act_2'], ['ad', 'act_2']
  ]);
});

test('a DARK run skips the Page publishing context and falls back to the Page ID until the catalog is loaded', async (context) => {
  let contextCalls = 0;
  const createdRuns = [];
  const { server, headers } = createPublishRouteServer(context, {
    db: {
      createRun: (run) => { createdRuns.push(run); return { id: `run-dark-${createdRuns.length}` }; }
    },
    metaClient: {
      ...pageCatalogMeta([['page_1', 'LG Clinic']]),
      getPagePublishingContext: async () => { contextCalls += 1; return { permissionGranted: true, pages: new Map() }; }
    }
  });
  const publish = () => request(server, '/api/runs', {
    method: 'POST',
    headers: { ...headers, 'content-type': 'application/json' },
    body: JSON.stringify(draft)
  });

  assert.equal((await publish()).status, 201);
  assert.equal((await request(server, '/api/resources', { headers })).status, 200);
  assert.equal((await publish()).status, 201);

  assert.deepEqual(createdRuns.map((run) => run.snapshot.campaigns[0].pageName), ['page_1', 'LG Clinic']);
  assert.equal(contextCalls, 0);
});

test('Public Test still checks the Page publishing permission before any Meta write', async (context) => {
  let contextCalls = 0;
  let writes = 0;
  const publicDraft = structuredClone(draft);
  publicDraft.campaigns[0].adSets[0].ads[0].publicationMode = 'PUBLIC_TEST';
  const { server, headers } = createPublishRouteServer(context, {
    metaClient: {
      getPagePublishingContext: async () => { contextCalls += 1; return { permissionGranted: false, pages: new Map() }; },
      createCampaign: async () => { writes += 1; return 'campaign-remote'; }
    }
  });

  const response = await request(server, '/api/runs', {
    method: 'POST',
    headers: { ...headers, 'content-type': 'application/json' },
    body: JSON.stringify(publicDraft)
  });

  assert.equal(response.status, 403);
  assert.match(response.body.errors[0].message, /pages_manage_posts/);
  assert.equal(contextCalls, 1);
  assert.equal(writes, 0);
  assert.doesNotMatch(JSON.stringify(response.body), /EAAG-token/);
});

test('allows a Page to be combined with any Campaign account', async (context) => {
  let metaWrites = 0;
  const invalidDraft = twoCampaignDraft();
  invalidDraft.campaigns[1].pageId = 'page_1';
  const { server, headers } = createPublishRouteServer(context, {
    metaClient: {
      getPagePublishingContext: async () => ({
        permissionGranted: true,
        pages: new Map([
          ['page_1', { name: 'LG Clinic', accessToken: '', tasks: [] }],
          ['page_2', { name: 'LG Clinic Quận 7', accessToken: '', tasks: [] }]
        ])
      }),
      createCampaign: async () => { metaWrites += 1; },
      createAdSet: async () => { metaWrites += 1; },
      uploadImage: async () => { metaWrites += 1; },
      createCreative: async () => { metaWrites += 1; },
      createAd: async () => { metaWrites += 1; }
    }
  });

  const response = await request(server, '/api/runs', {
    method: 'POST',
    headers: { ...headers, 'content-type': 'application/json' },
    body: JSON.stringify(invalidDraft)
  });

  assert.equal(response.status, 201);
  assert.ok(metaWrites > 0);
});

test('validates a draft without making Meta write calls', async (context) => {
  const config = testConfig();
  let metaWrites = 0;
  const server = createServer({
    config,
    db: {
      createSession: () => ({ id: 'new-session' }),
      getSession: () => ({ id: 'session-user', metaUserId: 'meta-user-1' })
    },
    metaClient: new Proxy({}, {
      get: () => () => { metaWrites += 1; }
    })
  });
  context.after(() => server.close());

  const session = signSession('session-user', config.sessionSecret);
  const response = await request(server, '/api/drafts/validate', {
    method: 'POST',
    headers: {
      cookie: `meta_ads_session=${encodeURIComponent(session)}`,
      'content-type': 'application/json'
    },
    body: JSON.stringify(draft)
  });

  assert.equal(response.status, 200);
  assert.deepEqual(response.body, { valid: true, errors: [] });
  assert.equal(metaWrites, 0);
});

test('returns path-based errors for an invalid Campaign account and Page', async (context) => {
  const invalidDraft = structuredClone(draft);
  invalidDraft.campaigns[0].adAccountId = '';
  invalidDraft.campaigns[0].pageId = '';
  const { server, headers } = validationServer(context);
  const response = await request(server, '/api/drafts/validate', {
    method: 'POST',
    headers: { ...headers, 'content-type': 'application/json' },
    body: JSON.stringify(invalidDraft)
  });

  assert.equal(response.status, 422);
  assert.ok(response.body.errors.some((entry) => (
    entry.path === 'campaigns.0.adAccountId'
  )));
  assert.ok(response.body.errors.some((entry) => (
    entry.path === 'campaigns.0.pageId'
  )));
});

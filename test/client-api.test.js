import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createApiClient } from '../public/api.js';

const blobUploadEntrySource = await readFile(
  new URL('../src/client/blob-upload-entry.js', import.meta.url),
  'utf8'
);

test('encodes targeting queries and normalizes server errors', async () => {
  const requests = [];
  const api = createApiClient(async (url) => {
    requests.push(String(url));
    return Response.json({ error: 'Không có quyền Page' }, { status: 403 });
  });

  await assert.rejects(
    api.searchTargeting('act_1', 'interest', 'chăm sóc da'),
    /Không có quyền Page/
  );
  assert.match(requests[0], /query=ch%C4%83m%20s%C3%B3c%20da/);
});

test('encodes Vietnam location searches', async () => {
  let requestUrl;
  const api = createApiClient(async (url) => {
    requestUrl = String(url);
    return Response.json({ results: [] });
  });

  await api.searchLocations('act_123', 'Nghệ An');

  assert.equal(
    requestUrl,
    '/api/location-search?adAccountId=act_123&query=Ngh%E1%BB%87%20An'
  );
});

test('requests address geocoding only for an explicit location search', async () => {
  const urls = [];
  const api = createApiClient(async (url) => { urls.push(String(url)); return Response.json({ results: [] }); });
  await api.searchLocations('act_123', 'Đặng Văn Bi, Hồ Chí Minh');
  await api.searchLocations('act_123', 'Đặng Văn Bi, Hồ Chí Minh', { includeAddresses: true });
  assert.equal(new URL(urls[0], 'http://localhost').searchParams.has('includeAddresses'), false);
  assert.equal(new URL(urls[1], 'http://localhost').searchParams.get('includeAddresses'), '1');
  assert.equal(new URL(urls[1], 'http://localhost').searchParams.get('query'), 'Đặng Văn Bi, Hồ Chí Minh');
});

test('builds an encoded owner-scoped media preview URL', () => {
  const api = createApiClient();

  assert.equal(api.mediaPreviewUrl('media/image 1'), '/api/media/media%2Fimage%201/preview');
});

test('uses encoded owner-scoped seeding-template API routes', async () => {
  const requests = [];
  const api = createApiClient(async (url, options) => {
    requests.push({ url, options });
    return Response.json({ template: { id: 'template/1' }, templates: [] });
  });

  await api.loadSeedingTemplates();
  await api.createSeedingTemplate({ name: 'Mẫu', items: [] });
  await api.updateSeedingTemplate('template/1', { name: 'Mẫu sửa', items: [] });
  await api.duplicateSeedingTemplate('template/1', { name: 'Bản sao' });
  await api.deleteSeedingTemplate('template/1');

  assert.deepEqual(requests.map(({ url }) => url), [
    '/api/seeding-templates',
    '/api/seeding-templates',
    '/api/seeding-templates/template%2F1',
    '/api/seeding-templates/template%2F1/duplicate',
    '/api/seeding-templates/template%2F1'
  ]);
  assert.deepEqual(requests.map(({ options }) => options?.method), [undefined, 'POST', 'PUT', 'POST', 'DELETE']);
  assert.deepEqual(JSON.parse(requests[4].options.body), {});
});

test('uses encoded owner-scoped Campaign preset API routes', async () => {
  const requests = [];
  const api = createApiClient(async (url, options = {}) => {
    requests.push({ url: String(url), options });
    return Response.json({ preset: { id: 'preset/1' }, presets: [], deleted: true });
  });
  const body = { name: 'Triệt bikini nữ', content: { campaignName: 'Campaign nữ' } };

  await api.loadCampaignPresets();
  await api.createCampaignPreset(body);
  await api.updateCampaignPreset('preset/1', body);
  await api.deleteCampaignPreset('preset/1');

  assert.deepEqual(requests.map(({ url }) => url), [
    '/api/campaign-presets',
    '/api/campaign-presets',
    '/api/campaign-presets/preset%2F1',
    '/api/campaign-presets/preset%2F1'
  ]);
  assert.deepEqual(requests.map(({ options }) => options.method ?? 'GET'), [
    'GET', 'POST', 'PUT', 'DELETE'
  ]);
});

test('uses shared audience-template CRUD routes and HTTP methods', async () => {
  const requests = [];
  const api = createApiClient(async (url, options = {}) => {
    requests.push({ url: String(url), options });
    return Response.json({ template: { id: 'tool_audience_1' }, templates: [], deleted: true });
  });
  const body = { name: 'Nữ 23-45 HCM', content: { ageMin: 23, ageMax: 45 } };

  await api.loadAudienceTemplates();
  await api.createAudienceTemplate(body);
  await api.updateAudienceTemplate('tool_audience/1', body);
  await api.duplicateAudienceTemplate('tool_audience/1', { name: 'Bản sao' });
  await api.deleteAudienceTemplate('tool_audience/1');

  assert.deepEqual(requests.map(({ url }) => url), [
    '/api/audience-templates',
    '/api/audience-templates',
    '/api/audience-templates/tool_audience%2F1',
    '/api/audience-templates/tool_audience%2F1/duplicate',
    '/api/audience-templates/tool_audience%2F1'
  ]);
  assert.deepEqual(requests.map(({ options }) => options.method ?? 'GET'), [
    'GET', 'POST', 'PUT', 'POST', 'DELETE'
  ]);
  assert.deepEqual(JSON.parse(requests[4].options.body), {});
});

test('posts drafts as JSON for validation', async () => {
  const requests = [];
  const api = createApiClient(async (url, options) => {
    requests.push({ url, options });
    return Response.json({ valid: true, errors: [] });
  });
  const draft = { adAccountId: 'act_1', campaigns: [] };

  await api.validateDraft(draft);

  assert.deepEqual(requests.map(({ url }) => url), ['/api/drafts/validate']);
  assert.ok(requests.every(({ options }) => options.method === 'POST'));
  assert.ok(requests.every(({ options }) => options.headers['content-type'] === 'application/json'));
  assert.ok(requests.every(({ options }) => options.body === JSON.stringify(draft)));
});

test('refreshes missing Post IDs through the owner-scoped run route', async () => {
  let request;
  const api = createApiClient(async (url, options) => {
    request = { url, options };
    return Response.json({ run: { id: 'run/1' }, sync: { resolvedGroups: 1 } });
  });

  const result = await api.refreshRunPublications('run/1');

  assert.equal(request.url, '/api/runs/run%2F1/publications/refresh');
  assert.equal(request.options.method, 'POST');
  assert.equal(request.options.headers['content-type'], 'application/json');
  assert.deepEqual(JSON.parse(request.options.body), {});
  assert.equal(result.run.id, 'run/1');
});

test('uses encoded owner-scoped run seeding API routes and JSON methods', async () => {
  const requests = [];
  const api = createApiClient(async (url, options = {}) => {
    requests.push({ url: String(url), options });
    return Response.json({ seeding: { jobs: [] } });
  });

  await api.prepareRunSeeding('run/1');
  await api.processNextSeeding('run/1');
  await api.loadRunSeeding('run/1');
  await api.resolveSeedingConflict('run/1', { postId: 'page_1', campaignClientId: 'campaign-1' });
  await api.retrySeedingJob('run/1', 'job/1');
  await api.confirmSeedingJob('run/1', 'job/1');
  await api.cancelRunSeeding('run/1');
  await api.resumeRunSeeding('run/1');

  assert.deepEqual(requests.map(({ url }) => url), [
    '/api/runs/run%2F1/seeding/prepare',
    '/api/runs/run%2F1/seeding/next',
    '/api/runs/run%2F1/seeding',
    '/api/runs/run%2F1/seeding/conflicts/resolve',
    '/api/runs/run%2F1/seeding/jobs/job%2F1/retry',
    '/api/runs/run%2F1/seeding/jobs/job%2F1/confirm',
    '/api/runs/run%2F1/seeding/cancel',
    '/api/runs/run%2F1/seeding/resume'
  ]);
  assert.deepEqual(requests.map(({ options }) => options.method ?? 'GET'), [
    'POST', 'POST', 'GET', 'POST', 'POST', 'POST', 'POST', 'POST'
  ]);
  assert.deepEqual(JSON.parse(requests[3].options.body), {
    postId: 'page_1', campaignClientId: 'campaign-1'
  });
});

test('streams publish events split across arbitrary response chunks', async () => {
  const encoder = new TextEncoder();
  const chunks = [
    '{"type":"run_started","runId":"run-1","status":"creating","total":3}\n{"type":"node_',
    'updated","runId":"run-1","node":{"clientId":"campaign-1","type":"campaign","status":"created"}}\n',
    '{"type":"run_completed","runId":"run-1","status":"completed","nodes":[]}\n'
  ];
  const events = [];
  let request;
  const api = createApiClient(async (url, options) => {
    request = { url, options };
    return new Response(new ReadableStream({
      start(controller) {
        chunks.forEach((chunk) => controller.enqueue(encoder.encode(chunk)));
        controller.close();
      }
    }), { status: 201, headers: { 'content-type': 'application/x-ndjson; charset=utf-8' } });
  });

  const result = await api.publishDraft({ campaigns: [] }, { onEvent: (event) => events.push(event) });

  assert.equal(request.options.headers.accept, 'application/x-ndjson');
  assert.deepEqual(events.map((event) => event.type), ['run_started', 'node_updated', 'run_completed']);
  assert.deepEqual(result, { id: 'run-1', status: 'completed', nodes: [] });
});

test('marks a truncated known stream as recoverable without reposting', async () => {
  let requestCount = 0;
  const api = createApiClient(async () => {
    requestCount += 1;
    return new Response(
      '{"type":"run_started","runId":"run-9","status":"creating","total":3}\n',
      { status: 201, headers: { 'content-type': 'application/x-ndjson' } }
    );
  });
  await assert.rejects(
    api.publishDraft({ campaigns: [] }),
    (error) => error.recoverable === true && error.runId === 'run-9'
  );
  assert.equal(requestCount, 1);
});

test('marks a reader failure recoverable only after run_started', async () => {
  const encoder = new TextEncoder();
  const api = createApiClient(async () => new Response(new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(
        '{"type":"run_started","runId":"run-12","status":"creating","total":3}\n'
      ));
      setTimeout(() => controller.error(new Error('connection lost')), 0);
    }
  }), { status: 201, headers: { 'content-type': 'application/x-ndjson' } }));

  await assert.rejects(
    api.publishDraft({ campaigns: [] }),
    (error) => error.recoverable === true && error.runId === 'run-12'
  );
});

test('loads an encoded owner-scoped run snapshot', async () => {
  let url;
  const api = createApiClient(async (input) => {
    url = String(input);
    return Response.json({ id: 'run/1', status: 'creating', nodes: [] });
  });
  await api.loadRun('run/1');
  assert.equal(url, '/api/runs/run%2F1');
});

test('encodes activity-history date filters and pagination', async () => {
  let url;
  const api = createApiClient(async (input) => {
    url = String(input);
    return Response.json({ items: [], nextOffset: null });
  });

  await api.listRuns({ from: 1_000, to: 5_000, limit: 20, offset: 40 });

  assert.equal(url, '/api/runs?from=1000&to=5000&limit=20&offset=40');
});

test('normalizes pre-stream publish JSON errors', async () => {
  const api = createApiClient(async () => Response.json(
    { error: 'Publish denied' },
    { status: 403 }
  ));

  await assert.rejects(
    api.publishDraft({ campaigns: [] }),
    (error) => error.status === 403 && error.payload.error === 'Publish denied'
  );
});

test('marks malformed NDJSON as non-recoverable after a run starts', async () => {
  const api = createApiClient(async () => new Response(
    '{"type":"run_started","runId":"run-10","status":"creating","total":3}\nnot-json\n',
    { status: 201, headers: { 'content-type': 'application/x-ndjson' } }
  ));

  await assert.rejects(
    api.publishDraft({ campaigns: [] }),
    (error) => error.recoverable === false && error.runId === 'run-10'
  );
});

test('rejects structurally malformed NDJSON without dispatching it', async () => {
  const events = [];
  const api = createApiClient(async () => new Response(
    '{"type":"run_started","runId":"run-13","status":"creating","total":3}\nnull\n',
    { status: 201, headers: { 'content-type': 'application/x-ndjson' } }
  ));

  await assert.rejects(
    api.publishDraft({ campaigns: [] }, { onEvent: (event) => events.push(event) }),
    (error) => /cấu trúc/.test(error.message)
      && error.recoverable === false
      && error.runId === 'run-13'
  );
  assert.deepEqual(events.map((event) => event.type), ['run_started']);
});

test('rejects a stream event whose run id changes after run_started', async () => {
  const events = [];
  const api = createApiClient(async () => new Response(
    '{"type":"run_started","runId":"run-14","status":"creating","total":1}\n'
      + '{"type":"node_updated","runId":"run-other","node":{"clientId":"campaign-1","type":"campaign","status":"created"}}\n',
    { status: 201, headers: { 'content-type': 'application/x-ndjson' } }
  ));

  await assert.rejects(
    api.publishDraft({ campaigns: [] }, { onEvent: (event) => events.push(event) }),
    (error) => error.recoverable === false && error.runId === 'run-14'
  );
  assert.deepEqual(events.map((event) => event.type), ['run_started']);
});

test('rejects malformed completed snapshots before dispatching the terminal event', async () => {
  for (const invalidNode of [
    null,
    { clientId: 'campaign-1', type: 'campaign', status: 'creating' }
  ]) {
    const events = [];
    const api = createApiClient(async () => new Response(
      '{"type":"run_started","runId":"run-15","status":"creating","total":1}\n'
        + `${JSON.stringify({ type: 'run_completed', runId: 'run-15', status: 'completed', nodes: [invalidNode] })}\n`,
      { status: 201, headers: { 'content-type': 'application/x-ndjson' } }
    ));

    await assert.rejects(
      api.publishDraft({ campaigns: [] }, { onEvent: (event) => events.push(event) }),
      (error) => error.recoverable === false && error.runId === 'run-15'
    );
    assert.deepEqual(events.map((event) => event.type), ['run_started']);
  }
});

test('requires run_started before non-start stream events', async () => {
  const events = [];
  const api = createApiClient(async () => new Response(
    '{"type":"run_completed","runId":"run-16","status":"completed","nodes":[]}\n',
    { status: 201, headers: { 'content-type': 'application/x-ndjson' } }
  ));

  await assert.rejects(
    api.publishDraft({ campaigns: [] }, { onEvent: (event) => events.push(event) }),
    (error) => error.recoverable === false && error.runId === null
  );
  assert.deepEqual(events, []);
});

test('marks explicit run failure as non-recoverable', async () => {
  const api = createApiClient(async () => new Response(
    '{"type":"run_started","runId":"run-11","status":"creating","total":3}\n'
      + '{"type":"run_failed","runId":"run-11","status":"failed","error":{"message":"Meta rejected"}}\n',
    { status: 201, headers: { 'content-type': 'application/x-ndjson' } }
  ));

  await assert.rejects(
    api.publishDraft({ campaigns: [] }),
    (error) => error.message === 'Meta rejected'
      && error.recoverable === false
      && error.runId === 'run-11'
  );
});

test('returns successful JSON publish responses for compatibility', async () => {
  const api = createApiClient(async () => Response.json(
    { id: 'run-json', status: 'completed', nodes: [] },
    { status: 201 }
  ));

  assert.deepEqual(
    await api.publishDraft({ campaigns: [] }),
    { id: 'run-json', status: 'completed', nodes: [] }
  );
});

test('uploads a local File without overriding its multipart content type', async () => {
  let request;
  const api = createApiClient(async (url, options) => {
    request = { url, options };
    return Response.json({ mediaId: 'media-1', kind: 'image' }, { status: 201 });
  });
  const file = new File(['image'], 'image.jpg', { type: 'image/jpeg' });

  const result = await api.uploadMedia(file, { mode: 'local' });

  assert.deepEqual(result, { mediaId: 'media-1', kind: 'image' });
  assert.equal(request.url, '/api/media');
  assert.equal(request.options.method, 'POST');
  assert.equal(request.options.headers, undefined);
  assert.equal(request.options.body.get('file').name, 'image.jpg');
});

test('reports real local upload progress through XMLHttpRequest', async () => {
  const progress = [];
  const xhr = createUploadXhr({
    status: 201,
    response: { mediaId: 'media-1', kind: 'image' },
    progress: [{ loaded: 5, total: 10 }, { loaded: 10, total: 10 }]
  });
  const api = createApiClient();
  const file = new File(['image'], 'image.jpg', { type: 'image/jpeg' });

  const result = await api.uploadMedia(file, {
    mode: 'local',
    xhrFactory: () => xhr,
    onProgress: (event) => progress.push(event.percentage)
  });

  assert.deepEqual(progress, [50, 100]);
  assert.equal(xhr.requestHeaders['content-type'], undefined);
  assert.equal(xhr.method, 'POST');
  assert.equal(xhr.url, '/api/media');
  assert.equal(xhr.body.get('file').name, 'image.jpg');
  assert.equal(result.mediaId, 'media-1');
});

test('uploads media directly to R2 and registers the completed object', async () => {
  const requests = [];
  const xhr = createUploadXhr({ status: 200, response: {}, progress: [{ loaded: 5, total: 5 }] });
  const api = createApiClient(async (url, options) => {
    requests.push({ url, body: JSON.parse(options.body) });
    if (url === '/api/r2-media/presign') return Response.json({
      enabled: true,
      mediaId: 'media-r2',
      key: 'ads/owner/media-r2/image.jpg',
      uploadUrl: 'https://r2.example/upload'
    });
    return Response.json({ id: 'media-r2', kind: 'image' }, { status: 201 });
  });
  const file = new File(['image'], 'image.jpg', { type: 'image/jpeg' });

  const result = await api.uploadMedia(file, { mode: 'r2', xhrFactory: () => xhr });

  assert.deepEqual(requests.map(({ url }) => url), ['/api/r2-media/presign', '/api/r2-media/complete']);
  assert.equal(xhr.url, 'https://r2.example/upload');
  assert.equal(xhr.requestHeaders['content-type'], 'image/jpeg');
  assert.equal(requests[1].body.key, 'ads/owner/media-r2/image.jpg');
  assert.deepEqual(result, { id: 'media-r2', kind: 'image' });
});

test('uploads directly to Blob and completes metadata registration', async () => {
  const fetchCalls = [];
  const api = createApiClient(async (url, options) => {
    fetchCalls.push({ url, options });
    const body = JSON.parse(options.body);
    return Response.json({ id: body.mediaId, kind: 'image' }, { status: 201 });
  });
  const uploadImpl = async (pathname, file, options) => {
    uploadImpl.calls.push({ pathname, file, options, mediaId: options.clientPayload.mediaId });
    return {
      url: 'https://private.blob.vercel-storage.com/creative-random.jpg',
      downloadUrl: 'https://private.blob.vercel-storage.com/creative-random.jpg?download=1',
      pathname: 'meta-ads/media-id/creative-random.jpg',
      contentType: file.type
    };
  };
  uploadImpl.calls = [];
  const file = new File(['image'], 'Creative Image.jpg', { type: 'image/jpeg' });
  const onProgress = () => undefined;

  const result = await api.uploadMedia(file, {
    mode: 'vercel-blob',
    uploadImpl,
    onProgress
  });

  assert.equal(uploadImpl.calls[0].options.access, 'private');
  assert.equal(uploadImpl.calls[0].options.onProgress, onProgress);
  assert.match(uploadImpl.calls[0].pathname, /^meta-ads\/[a-f0-9-]+\/media\.jpg$/);
  assert.equal(fetchCalls.at(-1).url, '/api/media/complete');
  assert.equal(fetchCalls.at(-1).options.headers['content-type'], 'application/json');
  assert.equal(result.id, uploadImpl.calls[0].mediaId);
});

test('uses a fixed ASCII-only Blob pathname for Vietnamese and mojibaked file names', async () => {
  const api = createApiClient(async (_url, options) => {
    const body = JSON.parse(options.body);
    return Response.json({ id: body.mediaId, kind: 'image' }, { status: 201 });
  });
  const uploadImpl = async (pathname, file) => {
    uploadImpl.pathname = pathname;
    return {
      url: 'https://private.blob.vercel-storage.com/upload.jpg',
      downloadUrl: 'https://private.blob.vercel-storage.com/upload.jpg?download=1',
      pathname,
      contentType: file.type
    };
  };
  const file = new File(['image'], 'CÆ¡ sá»Ÿ váº­t cháº¥t ná»¯.JPG', { type: 'image/jpeg' });

  await api.uploadMedia(file, { mode: 'vercel-blob', uploadImpl });

  assert.match(uploadImpl.pathname, /^meta-ads\/[a-f0-9-]+\/media\.jpg$/);
  assert.doesNotMatch(uploadImpl.pathname, /[^\x00-\x7F]/);
});

test('requires R2 for ad video uploads and does not use Meta chunk fallback', async () => {
  const requests = [];
  const api = createApiClient(async (url, options = {}) => {
    requests.push({ url: String(url), options });
    if (String(url).endsWith('/start')) return Response.json({
      uploadSessionId: 'session-1',
      videoId: 'video-1',
      startOffset: 0,
      endOffset: 4
    });
    if (String(url).includes('/transfer?')) {
      const start = Number(options.headers['x-start-offset']);
      const next = start + options.body.size;
      return Response.json({ startOffset: next, endOffset: next < 8 ? 8 : next });
    }
    return Response.json({
      asset: { kind: 'video', accountId: 'act_1', videoId: 'video-1' }
    });
  });
  const file = new File(['abcdefgh'], 'creative.mp4', { type: 'video/mp4' });
  const progress = [];

  await assert.rejects(
    api.uploadAdMedia(file, 'act_1', {
      onProgress: ({ percentage }) => progress.push(percentage)
    }),
    /R2 chưa sẵn sàng/
  );
  assert.deepEqual(progress, []);
  assert.deepEqual(requests.map(({ url }) => url), ['/api/r2-media/presign']);
});

test('requires R2 for image uploads and does not use Meta fallback', async () => {
  const requests = [];
  const api = createApiClient(async (url, options = {}) => {
    requests.push({ url: String(url), options });
    return Response.json({ asset: { kind: 'image', imageHash: 'hash-1' } }, { status: 201 });
  });
  const file = new File(['image'], 'creative.jpg', { type: 'image/jpeg' });

  await assert.rejects(api.uploadAdMedia(file, 'act_1'), /R2 chưa sẵn sàng/);
  assert.deepEqual(requests.map(({ url }) => url), ['/api/r2-media/presign']);
});

test('forwards progress from the Blob entry to Vercel upload', () => {
  assert.match(blobUploadEntrySource, /onUploadProgress:\s*options\.onProgress/);
});

test('uses stable conversation-template CRUD routes and HTTP methods', async () => {
  const requests = [];
  const api = createApiClient(async (url, options = {}) => {
    requests.push({ url: String(url), options });
    return Response.json({ template: { id: 'template-1' }, templates: [], deleted: true });
  });
  const body = { adAccountId: 'act_1', pageId: 'page-1', name: 'Mẫu 1', template: conversationFixture };

  await api.loadConversationTemplates();
  await api.createConversationTemplate(body);
  await api.updateConversationTemplate('template-1', body);
  await api.duplicateConversationTemplate('template-1', { ...body, template: undefined });
  await api.setDefaultConversationTemplate('template-1');
  await api.deleteConversationTemplate('template-1');

  assert.deepEqual(requests.map(({ url }) => url), [
    '/api/conversation-templates',
    '/api/conversation-templates',
    '/api/conversation-templates/template-1',
    '/api/conversation-templates/template-1/duplicate',
    '/api/conversation-templates/template-1/default',
    '/api/conversation-templates/template-1'
  ]);
  assert.deepEqual(requests.map(({ options }) => options.method ?? 'GET'), [
    'GET', 'POST', 'PUT', 'POST', 'POST', 'DELETE'
  ]);
});

function createUploadXhr({ status, response, progress }) {
  const listeners = new Map();
  const uploadListeners = new Map();
  return {
    status,
    response,
    responseText: JSON.stringify(response),
    requestHeaders: {},
    upload: {
      addEventListener(type, listener) {
        uploadListeners.set(type, listener);
      }
    },
    addEventListener(type, listener) {
      listeners.set(type, listener);
    },
    open(method, url) {
      this.method = method;
      this.url = url;
    },
    setRequestHeader(name, value) {
      this.requestHeaders[name.toLowerCase()] = value;
    },
    send(body) {
      this.body = body;
      for (const event of progress) {
        const payload = { ...event, lengthComputable: true };
        uploadListeners.get('progress')?.(payload);
        this.upload.onprogress?.(payload);
      }
      listeners.get('load')?.();
      this.onload?.();
    }
  };
}

const conversationFixture = {
  sourceTemplateId: null,
  templateName: 'Mẫu 1',
  greeting: 'Chào bạn',
  quickReplies: [{ id: 'q1', title: 'Tư vấn', payload: 'reply_q1' }],
  showBusinessPhoneNumber: false,
  businessPhoneNumber: '',
  customerActions: []
};

test('serves resource GETs from browser cache until a CRUD call, user refresh, or clearCache', async () => {
  const store = new Map();
  const storage = {
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, value) => store.set(key, value),
    removeItem: (key) => store.delete(key),
    key: (index) => [...store.keys()][index] ?? null,
    get length() { return store.size; }
  };
  const fetched = [];
  const api = createApiClient(async (url, options) => {
    fetched.push(`${options?.method ?? 'GET'} ${url}`);
    return Response.json({ presets: [fetched.length] });
  }, { storage });

  assert.deepEqual(await api.loadCampaignPresets(), { presets: [1] });
  assert.deepEqual(await api.loadCampaignPresets(), { presets: [1] }); // từ cache, không fetch
  await api.loadSeedingTemplates();
  assert.deepEqual(fetched, ['GET /api/campaign-presets', 'GET /api/seeding-templates']);

  await api.createCampaignPreset({ name: 'x' }); // CRUD cùng prefix → xóa cache preset, giữ cache seeding
  await api.loadCampaignPresets();
  await api.loadSeedingTemplates();
  assert.deepEqual(fetched.slice(2), ['POST /api/campaign-presets', 'GET /api/campaign-presets']);

  api.clearCache();
  await api.loadSeedingTemplates();
  assert.equal(fetched.at(-1), 'GET /api/seeding-templates');

  await api.loadSession(); // endpoint ngoài danh sách không bị cache
  await api.loadSession();
  assert.equal(fetched.filter((entry) => entry.endsWith('/api/auth/session')).length, 2);
});

# Meta Publish Progress Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Display real-time, object-level Meta publishing progress in the existing run log, including recovery from an interrupted stream without resubmitting the publish request.

**Architecture:** Keep `POST /api/runs` open and stream persisted publisher updates as NDJSON when the browser requests `application/x-ndjson`; preserve the existing final JSON response for older callers. A focused browser progress module owns deterministic node merging and percentage calculation, while `app.js` only orchestrates streaming, rendering, and owner-scoped recovery through `GET /api/runs/:runId`.

**Tech Stack:** Node.js ESM, native HTTP `ServerResponse`, Fetch API streams, NDJSON, SQLite/Neon through the existing database interface, browser ES modules, CSS, Node test runner, Vercel Functions.

## Global Constraints

- Progress appears only inside `Nhật ký tạo quảng cáo Meta`, not inside the publish button.
- Progress is based on Campaign, Ad Set, and Ad terminal states; no timer-based or fabricated percentage is allowed.
- Use `completed === total ? 100 : floor(completed / total * 100)` so `100%` never appears early.
- `created`, `failed`, and `skipped` are terminal; `pending` and `creating` are not.
- The client must never automatically resend `POST /api/runs` after a network failure.
- Persist each node update before emitting it to the client.
- Run recovery must be owner-scoped and return `404` for both unknown and foreign run IDs.
- Existing Meta payloads, `PAUSED` behavior, creative sharing, targeting, budgets, and database schema remain unchanged.
- Closing the log hides it but does not cancel the active request or clear its progress state.
- Tests and smoke checks must use mocked Meta writes; do not create real Meta objects.
- The workspace is not a Git worktree and the user did not request commits, so commit steps are intentionally omitted.
- Three pre-existing conversation-related full-suite failures may remain; no new failures are acceptable.

---

### Task 1: Pure Publication Progress Model

**Files:**
- Create: `public/run-progress.js`
- Modify: `public/state.js:98`
- Create: `test/run-progress.test.js`

**Interfaces:**
- Consumes: a validated draft shaped as `{ campaigns: Campaign[] }` and stream events defined in Task 3.
- Produces: `createPublishProgress(draft)`, `applyPublishEvent(progress, event)`, `mergeRunSnapshot(progress, run)`, `markPublishFailure(progress, error)`, and `isTerminalRunStatus(status)`.
- Mutation rule: progress helpers mutate and return the supplied progress object, matching the current mutable browser-state style.

- [ ] **Step 1: Write failing tests for hierarchy flattening and honest percentage calculation**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyPublishEvent,
  createPublishProgress,
  mergeRunSnapshot
} from '../public/run-progress.js';

const draft = {
  campaigns: [{
    clientId: 'campaign-1',
    name: 'Chiến dịch Tin nhắn',
    adSets: [{
      clientId: 'adset-1',
      name: 'Nhóm Hồ Chí Minh',
      ads: [{ clientId: 'ad-1', name: 'Video 1' }]
    }]
  }]
};

test('creates ordered pending rows for every publishable object', () => {
  const progress = createPublishProgress(draft);
  assert.equal(progress.status, 'preparing');
  assert.equal(progress.total, 3);
  assert.equal(progress.percent, 0);
  assert.deepEqual(progress.nodes.map(({ clientId, type, status }) => [clientId, type, status]), [
    ['campaign-1', 'campaign', 'pending'],
    ['adset-1', 'adSet', 'pending'],
    ['ad-1', 'ad', 'pending']
  ]);
});

test('counts only terminal states and cannot reach 100 percent early', () => {
  const progress = createPublishProgress(draft);
  applyPublishEvent(progress, { type: 'node_updated', node: { clientId: 'campaign-1', type: 'campaign', status: 'creating' } });
  assert.deepEqual([progress.completed, progress.percent], [0, 0]);

  applyPublishEvent(progress, { type: 'node_updated', node: { clientId: 'campaign-1', type: 'campaign', status: 'created', remoteId: 'remote-campaign' } });
  applyPublishEvent(progress, { type: 'node_updated', node: { clientId: 'adset-1', type: 'adSet', status: 'failed', error: { message: 'Invalid Page' } } });
  assert.deepEqual([progress.completed, progress.percent], [2, 66]);

  applyPublishEvent(progress, { type: 'node_updated', node: { clientId: 'ad-1', type: 'ad', status: 'skipped' } });
  assert.deepEqual([progress.completed, progress.percent], [3, 100]);
});

test('merges repeated stream and recovery updates idempotently', () => {
  const progress = createPublishProgress(draft);
  const run = {
    id: 'run-1',
    status: 'completed_with_errors',
    nodes: [
      { clientId: 'campaign-1', type: 'campaign', status: 'created' },
      { clientId: 'adset-1', type: 'adSet', status: 'failed' },
      { clientId: 'ad-1', type: 'ad', status: 'skipped' }
    ]
  };
  mergeRunSnapshot(progress, run);
  mergeRunSnapshot(progress, run);
  assert.equal(progress.nodes.length, 3);
  assert.equal(progress.completed, 3);
  assert.equal(progress.percent, 100);
  assert.equal(progress.status, 'completed_with_errors');
});
```

- [ ] **Step 2: Run the progress-model tests and confirm the module is missing**

Run: `node --test test/run-progress.test.js`

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `public/run-progress.js`.

- [ ] **Step 3: Implement the focused progress model**

```js
const terminalNodeStatuses = new Set(['created', 'failed', 'skipped']);
const terminalRunStatuses = new Set(['completed', 'completed_with_errors', 'failed']);

export function createPublishProgress(draft) {
  const nodes = [];
  for (const campaign of draft.campaigns ?? []) {
    nodes.push(pendingNode(campaign, 'campaign', null));
    for (const adSet of campaign.adSets ?? []) {
      nodes.push(pendingNode(adSet, 'adSet', campaign.clientId));
      for (const ad of adSet.ads ?? []) {
        nodes.push(pendingNode(ad, 'ad', adSet.clientId));
      }
    }
  }
  return recalculate({
    runId: null,
    status: 'preparing',
    total: nodes.length,
    completed: 0,
    percent: 0,
    currentClientId: null,
    error: null,
    nodes
  });
}

export function applyPublishEvent(progress, event) {
  if (event.runId) progress.runId = event.runId;
  if (event.type === 'run_started') progress.status = 'creating';
  if (event.type === 'node_updated') mergeNode(progress, event.node);
  if (event.type === 'run_completed') mergeRunSnapshot(progress, event);
  if (event.type === 'run_failed') markPublishFailure(progress, event.error);
  return recalculate(progress);
}

export function mergeRunSnapshot(progress, run) {
  progress.runId = run.id ?? run.runId ?? progress.runId;
  progress.status = run.status ?? progress.status;
  for (const node of run.nodes ?? []) mergeNode(progress, node);
  return recalculate(progress);
}

export function markPublishFailure(progress, error) {
  progress.status = 'failed';
  progress.error = { message: error?.message ?? String(error ?? 'Không thể theo dõi lượt tạo') };
  progress.currentClientId = null;
  return recalculate(progress);
}

export function isTerminalRunStatus(status) {
  return terminalRunStatuses.has(status);
}
```

Implement private `pendingNode`, `mergeNode`, and `recalculate` helpers so merging keys on both `type` and `clientId`, preserves the draft `name`, updates `currentClientId` only for `creating`, and clamps non-terminal progress below 100.

- [ ] **Step 4: Add publication progress to initial workspace state**

In `createWorkspaceState`, replace the unused session-only `results` array with:

```js
publishProgress: null,
```

Add this UI visibility flag:

```js
resultsOpen: false,
```

- [ ] **Step 5: Run focused state tests**

Run: `node --test test/run-progress.test.js test/client-state.test.js`

Expected: PASS.

---

### Task 2: Streaming Browser API and Recovery Read

**Files:**
- Modify: `public/api.js:1`
- Modify: `test/client-api.test.js:36`

**Interfaces:**
- Consumes: NDJSON events from `POST /api/runs` and JSON snapshots from `GET /api/runs/:runId`.
- Produces: `api.publishDraft(draft, { onEvent }) -> Promise<Run>` and `api.loadRun(runId) -> Promise<Run>`.
- Error contract: an unexpectedly closed stream throws an error with `recoverable === true` and the last known `runId`; malformed NDJSON and explicit `run_failed` events are non-recoverable.

- [ ] **Step 1: Replace the old publish request test with streaming-contract tests**

```js
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
  const api = createApiClient(async () => new Response(
    '{"type":"run_started","runId":"run-9","status":"creating","total":3}\n',
    { status: 201, headers: { 'content-type': 'application/x-ndjson' } }
  ));
  await assert.rejects(
    api.publishDraft({ campaigns: [] }),
    (error) => error.recoverable === true && error.runId === 'run-9'
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
```

Also retain assertions that validation still posts ordinary JSON and that pre-stream JSON errors still use the existing `requestError` normalization.

- [ ] **Step 2: Run client API tests and confirm they fail against the JSON-only implementation**

Run: `node --test test/client-api.test.js`

Expected: FAIL because `publishDraft` does not send the NDJSON `Accept` header or parse stream events, and `loadRun` does not exist.

- [ ] **Step 3: Implement a chunk-safe NDJSON reader**

Add a private reader with this contract:

```js
async function readNdjson(response, onEvent = () => {}) {
  const reader = response.body?.getReader();
  if (!reader) throw new Error('Trình duyệt không hỗ trợ theo dõi tiến độ trực tiếp');
  const decoder = new TextDecoder();
  let buffer = '';
  let runId = null;
  let finalRun = null;

  try {
    while (true) {
      const { done, value } = await reader.read();
      buffer += decoder.decode(value ?? new Uint8Array(), { stream: !done });
      const lines = buffer.split('\n');
      buffer = done ? '' : lines.pop();
      for (const line of lines) {
        if (!line.trim()) continue;
        let event;
        try {
          event = JSON.parse(line);
        } catch {
          const error = new Error('Dữ liệu tiến độ từ máy chủ không hợp lệ');
          error.runId = runId;
          error.recoverable = false;
          throw error;
        }
        runId = event.runId ?? runId;
        onEvent(event);
        if (event.type === 'run_completed') {
          finalRun = { id: event.runId, status: event.status, nodes: event.nodes ?? [] };
        }
        if (event.type === 'run_failed') {
          const error = new Error(event.error?.message ?? 'Lượt tạo trên Meta thất bại');
          error.runId = runId;
          error.recoverable = false;
          throw error;
        }
      }
      if (done) break;
    }
  } catch (error) {
    if ('recoverable' in error) throw error;
    error.runId = runId;
    error.recoverable = Boolean(runId);
    throw error;
  }

  if (finalRun) return finalRun;
  const error = new Error('Kết nối theo dõi tiến độ đã bị gián đoạn');
  error.runId = runId;
  error.recoverable = Boolean(runId);
  throw error;
}
```

The explicit parse branch ensures malformed NDJSON receives `recoverable = false`, even when an earlier `run_started` event supplied a run ID. The outer catch marks only reader/network failures with a known run ID as recoverable.

- [ ] **Step 4: Expose publish and recovery methods**

Replace the old `publishDraft` member with a private `publishDraftStream` call:

```js
publishDraft: (draft, { onEvent } = {}) => publishDraftStream(draft, onEvent),
loadRun: (runId) => json(`/api/runs/${encodeURIComponent(runId)}`),
```

`publishDraftStream` must send both headers:

```js
{
  'content-type': 'application/json',
  accept: 'application/x-ndjson'
}
```

If the response is not OK, parse the conventional JSON body and throw `requestError`. If the successful response is not NDJSON, preserve compatibility by parsing and returning its JSON body.

- [ ] **Step 5: Run the client API tests**

Run: `node --test test/client-api.test.js`

Expected: PASS.

---

### Task 3: Server NDJSON Events and Owner-Scoped Run Recovery

**Files:**
- Create: `src/run-stream.js`
- Modify: `src/request-handler.js:15`
- Modify: `src/request-handler.js:132`
- Modify: `src/request-handler.js:552`
- Modify: `test/publish-routes.test.js:300`
- Modify: `test/http.test.js:60`

**Interfaces:**
- Consumes: publisher `onNodeUpdate(runId, node)` callbacks and existing `db.createRun`, `db.updateNodeResult`, `db.updateRunStatus`, and `db.getRun` methods.
- Produces: NDJSON event types `run_started`, `node_updated`, `run_completed`, and `run_failed`; `GET /api/runs/:runId` returns `{ id, status, nodes }` without `ownerMetaUserId`.
- Content negotiation: only requests whose `Accept` header contains `application/x-ndjson` receive a stream; all other callers retain the existing `201 application/json` result.

- [ ] **Step 1: Write route tests for immediate streaming and event order**

Add a deferred Campaign write so the first stream event can be observed before publication finishes:

```js
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
```

Refactor the existing successful publication fixture into these local helpers rather than changing the shared request helper:

```js
function createPublishRouteServer(context, { metaClient: metaOverrides = {}, getRun = () => null } = {}) {
  const config = testConfig();
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
    getRun
  };
  const metaClient = {
    listPageCatalog: async () => ({
      pages: [{ id: 'page_1', canAdvertise: true }],
      discovery: { requiresBusinessReconnect: false, warnings: [], counts: {} }
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
```

Add `import { once } from 'node:events';` to `test/publish-routes.test.js`.

- [ ] **Step 2: Write run recovery authorization tests**

```js
test('returns only the connected owner run snapshot', async (context) => {
  const { server, headers } = createPublishRouteServer(context, {
    getRun: () => ({ id: 'run-1', ownerMetaUserId: 'meta-user-1', status: 'creating', nodes: [] })
  });
  const response = await request(server, '/api/runs/run-1', { headers });
  assert.equal(response.status, 200);
  assert.deepEqual(response.body, { id: 'run-1', status: 'creating', nodes: [] });
});

test('hides missing and foreign run ids behind the same response', async (context) => {
  const foreign = createPublishRouteServer(context, {
    getRun: () => ({ id: 'run-2', ownerMetaUserId: 'meta-user-2', status: 'creating', nodes: [] })
  });
  const response = await request(foreign.server, '/api/runs/run-2', { headers: foreign.headers });
  assert.equal(response.status, 404);
  assert.deepEqual(response.body, { error: 'Không tìm thấy lượt tạo' });
});
```

Keep the existing legacy JSON publish test unchanged to prove backward compatibility.

- [ ] **Step 3: Run route tests and verify the new routes/protocol are absent**

Run: `node --test test/publish-routes.test.js test/http.test.js`

Expected: FAIL for the NDJSON response, run read route, and new public module serving assertion.

- [ ] **Step 4: Implement the isolated response-stream helpers**

Create `src/run-stream.js`:

```js
export const RUN_STREAM_CONTENT_TYPE = 'application/x-ndjson';

export function acceptsRunStream(request) {
  return String(request.headers.accept ?? '')
    .split(',')
    .some((value) => value.trim().split(';')[0] === RUN_STREAM_CONTENT_TYPE);
}

export function startRunStream(response, status = 201) {
  response.writeHead(status, {
    'content-type': `${RUN_STREAM_CONTENT_TYPE}; charset=utf-8`,
    'cache-control': 'no-store, no-transform',
    'x-accel-buffering': 'no'
  });
  response.flushHeaders?.();
}

export function writeRunEvent(response, event) {
  if (response.writableEnded || response.destroyed) return false;
  return response.write(`${JSON.stringify(event)}\n`);
}
```

- [ ] **Step 5: Add the recovery route and serve the new browser module**

Add `/run-progress.js` to `publicFiles`. Match `GET /api/runs/:runId` before the generic API 404 and call:

```js
async function handleRunRead({ response, session, db, runId }) {
  if (!session.metaUserId) {
    sendJson(response, 401, { error: 'Connect Meta first' });
    return;
  }
  const run = await db.getRun(runId);
  if (!run || run.ownerMetaUserId !== session.metaUserId) {
    sendJson(response, 404, { error: 'Không tìm thấy lượt tạo' });
    return;
  }
  sendJson(response, 200, { id: run.id, status: run.status, nodes: run.nodes });
}
```

Decode the route segment once and reject malformed percent encoding as a `404`, not a server error.

- [ ] **Step 6: Stream persisted node updates from `handleRunCreation`**

After all existing validation and authorization checks, branch on `acceptsRunStream(request)`:

```js
const run = await db.createRun({ ownerMetaUserId: session.metaUserId, status: 'creating' });
if (streaming) {
  startRunStream(response);
  writeRunEvent(response, {
    type: 'run_started',
    runId: run.id,
    status: 'creating',
    total: countDraftNodes(draft)
  });
}

const result = await publishDraft({
  // existing dependencies
  onNodeUpdate: async (runId, node) => {
    await db.updateNodeResult(runId, node);
    if (streaming) writeRunEvent(response, { type: 'node_updated', runId, node });
  }
});
const status = result.nodes.some((node) => node.status === 'failed')
  ? 'completed_with_errors'
  : 'completed';
await db.updateRunStatus(run.id, status);
```

Use this exact node counter for the `run_started` event:

```js
function countDraftNodes(draft) {
  return (draft.campaigns ?? []).reduce((total, campaign) => (
    total + 1 + (campaign.adSets ?? []).reduce((adSetTotal, adSet) => (
      adSetTotal + 1 + (adSet.ads ?? []).length
    ), 0)
  ), 0);
}
```

For streaming callers, emit `{ type: 'run_completed', runId, status, nodes: result.nodes }` and `response.end()`. For legacy callers, keep `sendJson(response, 201, result)`.

Wrap only the post-run-creation section in `try/catch`. On an unexpected error, best-effort update status to `failed`; if streaming has started, emit this normalized event and end the response:

```js
writeRunEvent(response, {
  type: 'run_failed',
  runId: run.id,
  status: 'failed',
  error: normalizeRunError(error)
});
response.end();

function normalizeRunError(error) {
  return error.meta ?? {
    message: error.expose ? error.message : 'Lượt tạo trên Meta bị gián đoạn',
    type: error.name ?? 'Error'
  };
}
```

If streaming has not started, rethrow to the existing outer API error handler. Guard the outer catch with `response.headersSent`; when headers were sent, end an unfinished response instead of calling `sendJson`.

- [ ] **Step 7: Update static module coverage and run route tests**

Add `/run-progress.js` to the module list in `test/http.test.js` and assert its status is `200`.

Run: `node --test test/publish-routes.test.js test/http.test.js test/vercel-runtime.test.js`

Expected: PASS, including legacy JSON publication and Vercel routing.

---

### Task 4: Accessible Progress Log Rendering

**Files:**
- Modify: `public/workspace.js:21`
- Modify: `public/workspace.js:777`
- Modify: `public/app.css:2110`
- Modify: `test/workspace.test.js:415`

**Interfaces:**
- Consumes: one publication progress object from Task 1.
- Produces: `renderResults(progress)` with a sticky progress summary and ordered result rows.
- Copy contract: `pending` is `Chờ xử lý`; the progress summary is `Đã xử lý X/Y đối tượng`.

- [ ] **Step 1: Write failing render tests for active and mixed-result runs**

```js
test('renders accessible live publication progress and pending rows', () => {
  const html = renderResults({
    status: 'creating',
    total: 3,
    completed: 1,
    percent: 33,
    currentClientId: 'adset-1',
    nodes: [
      { clientId: 'campaign-1', name: 'Tin nhắn', type: 'campaign', status: 'created' },
      { clientId: 'adset-1', name: 'Hồ Chí Minh', type: 'adSet', status: 'creating' },
      { clientId: 'ad-1', name: 'Video 1', type: 'ad', status: 'pending' }
    ]
  });
  assert.match(html, /role="progressbar"/);
  assert.match(html, /aria-valuenow="33"/);
  assert.match(html, /33%/);
  assert.match(html, /Đã xử lý 1\/3 đối tượng/);
  assert.match(html, /Đang tạo Nhóm quảng cáo: Hồ Chí Minh/);
  assert.match(html, /Chờ xử lý/);
});

test('keeps failed and skipped rows visible at 100 percent', () => {
  const html = renderResults({
    status: 'completed_with_errors', total: 2, completed: 2, percent: 100,
    currentClientId: null,
    nodes: [
      { clientId: 'adset-1', name: 'Nhóm lỗi', type: 'adSet', status: 'failed', error: { message: 'Invalid Page' } },
      { clientId: 'ad-1', name: 'Quảng cáo', type: 'ad', status: 'skipped' }
    ]
  });
  assert.match(html, /100%/);
  assert.match(html, /Hoàn tất với lỗi/);
  assert.match(html, /Invalid Page/);
  assert.match(html, /Đã bỏ qua/);
});
```

- [ ] **Step 2: Run workspace tests and verify the old array-only renderer fails**

Run: `node --test test/workspace.test.js`

Expected: FAIL because `renderResults` does not accept progress metadata or render the progress block.

- [ ] **Step 3: Refactor `renderResults` around a progress object**

Wrap the existing header and new progress section in one `.results-sticky` container so both remain fixed without a hard-coded top offset. Render this structure above the list:

```html
<div class="results-sticky">
  <div class="results-header">...</div>
  <section class="run-progress" aria-label="Tiến độ tạo quảng cáo Meta">
    <div class="run-progress-summary">
      <strong>33%</strong>
      <span>Đã xử lý 1/3 đối tượng</span>
    </div>
    <div class="run-progress-track" role="progressbar"
         aria-label="Tiến độ tạo quảng cáo Meta"
         aria-valuemin="0" aria-valuemax="100" aria-valuenow="33">
      <span class="run-progress-fill" style="width: 33%"></span>
    </div>
    <p class="run-progress-activity">Đang tạo Nhóm quảng cáo: Hồ Chí Minh</p>
  </section>
</div>
```

Use escaped values for names, status text, percentage, counts, errors, and IDs. Add `pending: 'Chờ xử lý'` to `renderResultNode`, display the draft node name beside its type, and keep existing remote ID/post ID/error output. Activity copy maps `preparing` to `Đang kiểm tra dữ liệu và quyền truy cập`, `recovering` to `Đang khôi phục trạng thái`, and terminal statuses to their final summary; otherwise it names `currentClientId`.

- [ ] **Step 4: Add compact sticky-progress styling**

Add styles for `.results-sticky`, `.run-progress`, `.run-progress-summary`, `.run-progress-track`, `.run-progress-fill`, `.run-progress-activity`, `.result-pending`, and `.result-creating`. Move `position: sticky; top: 0` from `.results-header` to `.results-sticky`. Use existing CSS variables for accent, border, muted text, success, and danger colors; add a subtle indeterminate pulse only to the `creating` status dot, not to the percentage bar.

Respect `@media (prefers-reduced-motion: reduce)` by disabling the pulse. Preserve the existing mobile drawer width rules.

- [ ] **Step 5: Run rendering tests**

Run: `node --test test/workspace.test.js`

Expected: PASS.

---

### Task 5: Publish Orchestration, Live Updates, and Recovery

**Files:**
- Modify: `public/app.js:1`
- Modify: `public/app.js:51`
- Modify: `public/app.js:277`
- Modify: `public/app.js:1010`
- Create: `test/publish-progress-interactions.test.js`

**Interfaces:**
- Consumes: Task 1 progress helpers, Task 2 `api.publishDraft`/`api.loadRun`, and Task 4 `renderResults(progress)`.
- Produces: immediate log opening, live progress rendering without workspace rerenders, duplicate-run prevention, and bounded recovery polling.
- Recovery constants: poll every `1000` ms, stop after `12` consecutive failed reads or `300000` ms total recovery time.

- [ ] **Step 1: Write source-level interaction tests matching the repo's existing browser test style**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const appSource = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');

test('opens pending progress before starting the Meta request', () => {
  assert.match(appSource, /state\.publishProgress = createPublishProgress\(state\.draft\);[\s\S]*?state\.ui\.resultsOpen = true;[\s\S]*?state\.running = true;[\s\S]*?render\(\);[\s\S]*?api\.publishDraft/);
});

test('applies streamed events without rerendering the workspace', () => {
  assert.match(appSource, /onEvent: \(event\) => \{[\s\S]*?applyPublishEvent\(state\.publishProgress, event\);[\s\S]*?renderResultsDrawer\(\{ preserveScroll: true \}\);/);
});

test('recovers a known interrupted run without reposting it', () => {
  assert.match(appSource, /if \(error\.recoverable && state\.publishProgress\?\.runId\)[\s\S]*?recoverPublishRun\(state\.publishProgress\.runId\)/);
  assert.match(appSource, /async function recoverPublishRun\(runId\)[\s\S]*?api\.loadRun\(runId\)/);
  assert.doesNotMatch(appSource, /recoverPublishRun[\s\S]*?api\.publishDraft/);
});

test('closing results preserves active progress state', () => {
  assert.match(appSource, /if \(action === 'close-results'\)[\s\S]*?state\.ui\.resultsOpen = false/);
  assert.doesNotMatch(appSource, /if \(action === 'close-results'\)[\s\S]*?state\.publishProgress = null/);
});
```

- [ ] **Step 2: Run interaction tests and verify orchestration is absent**

Run: `node --test test/publish-progress-interactions.test.js`

Expected: FAIL because `app.js` still waits for one final JSON result and clears `state.results`.

- [ ] **Step 3: Import progress helpers and isolate result rendering**

Import:

```js
import {
  applyPublishEvent,
  createPublishProgress,
  isTerminalRunStatus,
  markPublishFailure,
  mergeRunSnapshot
} from './run-progress.js';
```

Replace direct result drawer rendering with:

```js
function renderResultsDrawer({ preserveScroll = false } = {}) {
  const previousScrollTop = preserveScroll ? resultsDrawer.scrollTop : 0;
  resultsDrawer.innerHTML = state.ui.resultsOpen && state.publishProgress
    ? renderResults(state.publishProgress)
    : '';
  if (preserveScroll) resultsDrawer.scrollTop = previousScrollTop;
}
```

Call this from `render()`. Stream callbacks call only `renderResultsDrawer({ preserveScroll: true })`, so they do not replace the workspace DOM or alter editor scroll.

- [ ] **Step 4: Replace final-only publication with live orchestration**

After validation succeeds:

```js
state.publishProgress = createPublishProgress(state.draft);
state.ui.resultsOpen = true;
state.running = true;
render();

try {
  const result = await api.publishDraft(state.draft, {
    onEvent: (event) => {
      applyPublishEvent(state.publishProgress, event);
      renderResultsDrawer({ preserveScroll: true });
    }
  });
  mergeRunSnapshot(state.publishProgress, result);
  showToast(result.status === 'completed_with_errors'
    ? 'Đã hoàn tất lượt tạo với một số lỗi. Mọi đối tượng tạo được vẫn ở PAUSED.'
    : 'Đã hoàn tất lượt tạo. Mọi đối tượng vẫn ở PAUSED.');
} catch (error) {
  if (error.recoverable && state.publishProgress?.runId) {
    const recovered = await recoverPublishRun(state.publishProgress.runId);
    showPublishCompletion(recovered);
  } else {
    markPublishFailure(state.publishProgress, error);
    showToast(error.message);
  }
} finally {
  state.running = false;
  render();
}
```

Move completion copy into `showPublishCompletion(run)` and call it from both the normal stream path and successful recovery path. Keep the existing server validation error assignment to `state.issues` and `state.ui.reviewOpen`. Do not clear progress merely because one object failed; mixed outcomes come through `run_completed`.

- [ ] **Step 5: Implement bounded owner-scoped recovery**

```js
const publishRecoveryIntervalMs = 1000;
const publishRecoveryFailureLimit = 12;
const publishRecoveryTimeoutMs = 300000;

async function recoverPublishRun(runId) {
  state.publishProgress.status = 'recovering';
  renderResultsDrawer({ preserveScroll: true });
  const startedAt = Date.now();
  let consecutiveFailures = 0;

  while (Date.now() - startedAt < publishRecoveryTimeoutMs) {
    await wait(publishRecoveryIntervalMs);
    try {
      const run = await api.loadRun(runId);
      consecutiveFailures = 0;
      mergeRunSnapshot(state.publishProgress, run);
      if (!isTerminalRunStatus(run.status)) state.publishProgress.status = 'recovering';
      renderResultsDrawer({ preserveScroll: true });
      if (isTerminalRunStatus(run.status)) return run;
    } catch (error) {
      consecutiveFailures += 1;
      if (consecutiveFailures >= publishRecoveryFailureLimit) throw error;
    }
  }
  throw new Error('Đã quá thời gian khôi phục tiến độ. Không gửi lại lượt tạo để tránh trùng quảng cáo.');
}

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
```

If recovery throws, call `markPublishFailure` with copy that explicitly says tracking stopped and publication was not resent. Recovery success uses the same completion toast as the stream path.

- [ ] **Step 6: Preserve active state when the dialog closes**

Change the close action to:

```js
if (action === 'close-results') {
  state.ui.resultsOpen = false;
  renderResultsDrawer();
}
```

Every new validated publication sets `resultsOpen = true` and replaces the previous terminal progress with a fresh pending model.

- [ ] **Step 7: Run interaction and scroll tests**

Run: `node --test test/publish-progress-interactions.test.js test/tree-interactions.test.js test/workspace-scroll.test.js`

Expected: PASS.

---

### Task 6: Integrated Verification and Production Deployment

**Files:**
- Verify: `public/run-progress.js`
- Verify: `public/api.js`
- Verify: `public/app.js`
- Verify: `public/workspace.js`
- Verify: `public/app.css`
- Verify: `src/run-stream.js`
- Verify: `src/request-handler.js`
- Verify: `test/run-progress.test.js`
- Verify: `test/publish-progress-interactions.test.js`

**Interfaces:**
- Consumes: all previous task deliverables.
- Produces: a tested client build and a production Vercel deployment with a healthy public endpoint.

- [ ] **Step 1: Run the focused feature suite**

Run:

```powershell
node --test `
  test/run-progress.test.js `
  test/client-api.test.js `
  test/publish-routes.test.js `
  test/http.test.js `
  test/vercel-runtime.test.js `
  test/workspace.test.js `
  test/publish-progress-interactions.test.js `
  test/tree-interactions.test.js `
  test/workspace-scroll.test.js
```

Expected: PASS with zero failures.

- [ ] **Step 2: Build browser assets**

Run: `npm run build`

Expected: exit code `0`; generated browser modules compile without unresolved imports.

- [ ] **Step 3: Run the full test suite and compare against baseline**

Run: `npm test`

Expected: no new failures. If the three known conversation-related failures remain, report them separately and do not modify unrelated conversation behavior:

1. Visual Editor welcome-message string.
2. Required quick reply validation.
3. Prefixed quick reply path.

- [ ] **Step 4: Start locally and smoke-check non-destructive routes**

Run: `npm start`

In a second shell, run:

```powershell
Invoke-WebRequest -UseBasicParsing http://localhost:3001/health
Invoke-WebRequest -UseBasicParsing http://localhost:3001/run-progress.js
```

Expected: both return HTTP `200`. Open `http://localhost:3001/`, confirm the app loads, and do not click the Meta publish button with a real account during automated verification.

- [ ] **Step 5: Deploy the verified build to Vercel production**

Stop the local server, then run: `vercel --prod --yes`

Expected: deployment succeeds and aliases the existing production project.

- [ ] **Step 6: Verify production health and static module delivery**

Run:

```powershell
Invoke-WebRequest -UseBasicParsing https://creative-campaign-lgclinic.vercel.app/health
Invoke-WebRequest -UseBasicParsing https://creative-campaign-lgclinic.vercel.app/run-progress.js
```

Expected: HTTP `200` for both. Load the production app and confirm the current UI renders; leave the real Meta creation smoke test to the user because it creates billable account objects.

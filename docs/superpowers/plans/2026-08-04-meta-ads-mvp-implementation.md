# Meta Ads Campaign Builder Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a local web application that connects a Meta user through OAuth, loads their ad accounts and Pages, and creates a tree of paused conversation campaigns.

**Architecture:** A dependency-free Node.js server serves a vanilla JavaScript browser UI and owns every Meta API call. SQLite is provided by Node's `node:sqlite`; it persists encrypted Meta tokens, sessions, media uploads, drafts, creation runs, and per-node results. A narrow `meta-client` module isolates the versioned Graph API payloads from UI and route code.

**Tech Stack:** Node.js 24, `node:http`, Web Fetch APIs, `node:sqlite`, `node:crypto`, built-in `node:test`, HTML, CSS, vanilla JavaScript.

## Global Constraints

- Read `META_APP_ID`, `META_APP_SECRET`, `META_REDIRECT_URI`, `META_API_VERSION`, `TOKEN_ENCRYPTION_KEY`, and `SESSION_SECRET` only from environment variables.
- Never expose Meta access tokens, App Secret, encryption key, or raw Meta response headers to the browser or logs.
- OAuth `state` must be random, single-use, and expire in 10 minutes.
- Every created Campaign, Ad Set, Creative, and Ad must pass `status=PAUSED`; no `ACTIVE` action exists in the UI or server.
- Each Campaign contains zero or more Ad Sets; each Ad Set contains one or more Ads; the MVP only supports the **Cuộc trò chuyện** preset.
- `META_API_VERSION` is required; do not hard-code an API version in source code.
- Do not add external npm dependencies.
- The workspace is not a Git repository; do not include commit steps.

---

## File Structure

| File | Responsibility |
| --- | --- |
| `package.json` | Scripts for development and test execution, no dependencies. |
| `.env.example` | Exact required configuration keys with safe placeholder values. |
| `.gitignore` | Ignore runtime database, uploaded files, and local environment file. |
| `src/config.js` | Validate required environment values and create the runtime paths. |
| `src/db.js` | Create SQLite schema and expose focused persistence methods. |
| `src/crypto.js` | AES-256-GCM token encryption/decryption and signed session cookie helpers. |
| `src/http.js` | Request parsing, JSON responses, cookies, file responses, and route matching. |
| `src/meta-client.js` | OAuth requests, resource discovery, media upload, Graph calls, and error normalization. |
| `src/draft.js` | Draft type validation and isolated conversation payload builders. |
| `src/publisher.js` | Ordered create orchestration and persisted node/run progress. |
| `src/server.js` | Compose storage, routes, sessions, and static server. |
| `public/index.html` | Accessible application layout. |
| `public/app.css` | Responsive visual system and status styles. |
| `public/app.js` | Client state, editable campaign tree, OAuth UI, uploads, and progress rendering. |
| `test/*.test.js` | Unit and route tests using fake Meta client dependencies. |

### Task 1: Establish the runnable local application shell

**Files:**
- Create: `package.json`
- Create: `.env.example`
- Create: `.gitignore`
- Create: `src/config.js`
- Create: `src/http.js`
- Create: `src/server.js`
- Create: `public/index.html`
- Create: `public/app.css`
- Create: `public/app.js`
- Create: `test/config.test.js`
- Create: `test/http.test.js`

**Interfaces:**
- Consumes: environment variables described in `.env.example`.
- Produces: `loadConfig(env): AppConfig`, `createServer(dependencies): Server`, `sendJson(response, status, body): void`.

- [ ] **Step 1: Write failing tests for configuration and JSON responses**

```javascript
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig } from '../src/config.js';
import { createServer } from '../src/server.js';

test('loadConfig rejects a missing required secret', () => {
  assert.throws(() => loadConfig({ META_APP_ID: 'id' }), /META_APP_SECRET/);
});

test('unknown API routes return a JSON 404', async () => {
  const server = createServer({ config: testConfig(), metaClient: {}, db: {} });
  const response = await request(server, '/api/unknown');
  assert.deepEqual(response, { status: 404, body: { error: 'Not found' } });
  server.close();
});
```

- [ ] **Step 2: Run the focused tests and verify they fail**

Run: `node --test test/config.test.js test/http.test.js`

Expected: failure because the modules do not exist.

- [ ] **Step 3: Implement the minimal shell**

Create an ESM `package.json` with these scripts:

```json
{
  "name": "meta-ads-campaign-builder",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "node --watch src/server.js",
    "start": "node src/server.js",
    "test": "node --test"
  }
}
```

Implement `loadConfig` so it throws on each absent secret, decodes `TOKEN_ENCRYPTION_KEY` as a 32-byte Base64 value, validates `META_REDIRECT_URI` as an HTTPS URL except `http://localhost`, and returns normalized runtime paths under `data/`. Implement a `createServer` route table that serves `/`, `/app.css`, `/app.js`, `/health`, and returns `{ error: 'Not found' }` from unknown `/api/*` routes. The static layout must contain a connection panel, selected account/Page controls, a campaign builder root, and a results panel.

- [ ] **Step 4: Run focused tests and start the server**

Run: `node --test test/config.test.js test/http.test.js`

Expected: PASS.

Run: `node src/server.js`

Expected: server logs a localhost URL only after valid environment variables are available; stop the manual process after the smoke check.

### Task 2: Add encrypted SQLite persistence and authenticated sessions

**Files:**
- Create: `src/crypto.js`
- Create: `src/db.js`
- Create: `test/crypto.test.js`
- Create: `test/db.test.js`
- Modify: `src/server.js`
- Modify: `.gitignore`

**Interfaces:**
- Consumes: `config.tokenEncryptionKey`, `config.sessionSecret`, and `config.databasePath`.
- Produces: `encryptToken(token, key): string`, `decryptToken(value, key): string`, `signSession(id, secret): string`, `verifySession(value, secret): string | null`, `createDatabase(path): DatabaseStore`.
- `DatabaseStore` methods: `createSession()`, `getSession(id)`, `attachMetaUser(sessionId, metaUser)`, `upsertConnection(connection)`, `getConnection(metaUserId)`, `createOAuthState(sessionId, state)`, `consumeOAuthState(state)`, `saveMedia(media)`, `getMedia(id)`, `createRun(run)`, `updateNodeResult(runId, node)`, `getRun(runId)`.

- [ ] **Step 1: Write failing crypto and storage tests**

```javascript
test('encrypted token cannot be read without the encryption key', () => {
  const encrypted = encryptToken('EAAG-secret', key);
  assert.notEqual(encrypted, 'EAAG-secret');
  assert.equal(decryptToken(encrypted, key), 'EAAG-secret');
  assert.throws(() => decryptToken(encrypted, anotherKey));
});

test('OAuth state is single-use and bound to its session', () => {
  database.createOAuthState('session-a', 'state-a');
  assert.equal(database.consumeOAuthState('state-a').sessionId, 'session-a');
  assert.equal(database.consumeOAuthState('state-a'), null);
});
```

- [ ] **Step 2: Run the focused tests and verify they fail**

Run: `node --test test/crypto.test.js test/db.test.js`

Expected: failure because encryption and persistence modules do not exist.

- [ ] **Step 3: Implement encryption, database schema, and session middleware**

Use `createCipheriv('aes-256-gcm', key, iv)` with a unique 12-byte IV and persist Base64-encoded `{iv,ciphertext,tag}`. HMAC-SHA256-sign session IDs as `id.signature`; reject malformed or non-matching signatures with `null`.

Initialize SQLite with tables `sessions`, `oauth_states`, `connections`, `media`, `runs`, and `node_results`. Add expiry cleanup in startup and whenever an OAuth state is consumed. Use parameterized statements only. Store encrypted token in `connections.access_token_ciphertext`, never its plaintext. Add a `requireSession` route helper that creates a new anonymous session and sets `HttpOnly; SameSite=Lax` cookie before serving unauthenticated pages; API routes requiring Meta data must return `{ error: 'Connect Meta first' }` with status 401 if no Meta user is attached.

- [ ] **Step 4: Run focused tests**

Run: `node --test test/crypto.test.js test/db.test.js`

Expected: PASS.

### Task 3: Implement Meta OAuth and safe account/Page discovery

**Files:**
- Create: `src/meta-client.js`
- Create: `test/meta-client.test.js`
- Create: `test/auth-routes.test.js`
- Modify: `src/server.js`
- Modify: `public/index.html`
- Modify: `public/app.js`

**Interfaces:**
- Consumes: `AppConfig`, `DatabaseStore`, current authenticated session.
- Produces: `MetaClient.createAuthorizationUrl(state): string`, `exchangeCode(code): TokenResponse`, `getProfile(token): MetaProfile`, `listAdAccounts(token): AdAccount[]`, `listPages(token, adAccountId): Page[]`, `normalizeMetaError(response): MetaApiError`.
- API routes: `GET /api/auth/meta/start`, `GET /api/auth/meta/callback`, `GET /api/connection`, `GET /api/resources`.

- [ ] **Step 1: Write failing OAuth and discovery tests using a fake fetch**

```javascript
test('Meta OAuth authorisation URL contains state and minimum scopes', () => {
  const url = new URL(client.createAuthorizationUrl('state-123'));
  assert.equal(url.searchParams.get('state'), 'state-123');
  assert.match(url.searchParams.get('scope'), /ads_management/);
  assert.match(url.searchParams.get('scope'), /pages_show_list/);
});

test('resource discovery returns account and Page summaries without a token', async () => {
  const response = await request(server, '/api/resources', sessionCookie);
  assert.deepEqual(response.body, {
    adAccounts: [{ id: 'act_1', name: 'Demo account', currency: 'VND' }],
    pages: [{ id: '2', name: 'Demo Page' }]
  });
  assert.doesNotMatch(JSON.stringify(response.body), /EAAG/);
});
```

- [ ] **Step 2: Run the focused tests and verify they fail**

Run: `node --test test/meta-client.test.js test/auth-routes.test.js`

Expected: failure because Meta client and routes do not exist.

- [ ] **Step 3: Implement OAuth and discovery routes**

Generate a random 32-byte `state`, store it against the current session for 10 minutes, then redirect `/api/auth/meta/start` to the versioned Meta login dialog. Request only `ads_read`, `ads_management`, `pages_show_list`, `pages_read_engagement`, and `pages_manage_ads` scopes. In the callback, consume state once before exchanging `code`, get `/me?fields=id,name`, encrypt and upsert the token, attach the Meta profile to the current session, and redirect to `/?connected=1`.

Implement discovery with paginated Graph calls: `/me/adaccounts?fields=id,name,account_id,currency,account_status,permitted_tasks&limit=100` and `/me/accounts?fields=id,name,tasks&limit=100`; optionally intersect Pages with `/act_{id}?fields=promote_pages{id,name}` when Meta returns that field. Return only identifiers and display fields to the client. Convert non-2xx responses to `{ message, type, code, subcode, fbtraceId }` and redact token-bearing URLs.

- [ ] **Step 4: Run focused tests**

Run: `node --test test/meta-client.test.js test/auth-routes.test.js`

Expected: PASS.

### Task 4: Build the editable campaign tree and validate the conversation preset

**Files:**
- Create: `src/draft.js`
- Create: `test/draft.test.js`
- Modify: `src/server.js`
- Modify: `public/index.html`
- Modify: `public/app.css`
- Modify: `public/app.js`

**Interfaces:**
- Consumes: JSON draft `{ adAccountId, pageId, campaigns }` and optional uploaded media ID.
- Produces: `validateDraft(draft): ValidationIssue[]`, `buildCampaignParams(campaign): URLSearchParams`, `buildConversationAdSetParams(campaignId, pageId, adSet): URLSearchParams`, `buildImageCreativeParams(pageId, imageHash, ad): URLSearchParams`, `buildVideoCreativeParams(pageId, videoId, thumbnail, ad): URLSearchParams`.
- API routes: `POST /api/drafts/validate` and `POST /api/media`.

- [ ] **Step 1: Write failing validation and payload tests**

```javascript
test('a nested conversation draft accepts multiple campaigns, ad sets, and ads', () => {
  const issues = validateDraft(twoCampaignDraft);
  assert.deepEqual(issues, []);
});

test('a conversation ad set has fixed engagement/Messenger fields', () => {
  const params = buildConversationAdSetParams('campaign-1', 'page-1', adSet);
  assert.equal(params.get('optimization_goal'), 'CONVERSATIONS');
  assert.equal(params.get('destination_type'), 'MESSENGER');
  assert.equal(params.get('status'), 'PAUSED');
  assert.equal(JSON.parse(params.get('promoted_object')).page_id, 'page-1');
});

test('video creative uses an image hash or image URL, never thumbnail URI as a hash', () => {
  const params = buildVideoCreativeParams('page-1', 'video-1', { imageUrl: 'https://example.test/thumb.jpg' }, ad);
  assert.equal(JSON.parse(params.get('object_story_spec')).video_data.image_url, 'https://example.test/thumb.jpg');
});
```

- [ ] **Step 2: Run the focused tests and verify they fail**

Run: `node --test test/draft.test.js`

Expected: failure because draft utilities do not exist.

- [ ] **Step 3: Implement form state, upload, and server validation**

Define the draft model in `public/app.js` with `campaigns[].adSets[].ads[]`; provide visible buttons **Thêm chiến dịch**, **Thêm nhóm quảng cáo**, **Thêm quảng cáo**, and delete buttons at every level. Each Ad Set card displays fixed `Cuộc trò chuyện` preset and targeting fields for countries, ages, gender, daily budget, and optional dates. Each Ad card includes primary text, headline, file input, and fixed message CTA.

Reject empty arrays of campaigns/ad sets/ads, invalid account/Page IDs, non-positive integer budget, invalid ages, missing primary text, title, or media. Build conversation payloads in `src/draft.js`, setting `OUTCOME_ENGAGEMENT`, `CONVERSATIONS`, `MESSENGER`, `IMPRESSIONS`, `LOWEST_COST_WITHOUT_CAP`, `promoted_object.page_id`, special ad category `NONE`, and `PAUSED`. Keep these values in one preset builder, not in UI code.

Parse the multipart upload with the Web `Request.formData()` API, accept only image/jpeg, image/png, image/webp, and video/mp4 up to a documented 200 MB local limit; store blob/mime/name in SQLite and return opaque `{ mediaId, kind }`. Do not upload media to Meta until the user starts a creation run.

- [ ] **Step 4: Run focused tests and browser smoke test**

Run: `node --test test/draft.test.js`

Expected: PASS.

Manual check: open the local server, add two Campaign cards, add two Ad Sets to one Campaign, add two Ads to one Ad Set, then submit validation and confirm field errors appear on the correct card.

### Task 5: Publish campaign trees with granular progress and safe failures

**Files:**
- Create: `src/publisher.js`
- Create: `test/publisher.test.js`
- Create: `test/publish-routes.test.js`
- Modify: `src/meta-client.js`
- Modify: `src/server.js`
- Modify: `src/db.js`
- Modify: `public/index.html`
- Modify: `public/app.css`
- Modify: `public/app.js`

**Interfaces:**
- Consumes: validated draft, a database media ID, and `MetaClient` methods `createCampaign`, `createAdSet`, `uploadImage`, `uploadVideo`, `getVideoStatus`, `createCreative`, `createAd`.
- Produces: `publishDraft({draft, token, runId, onNodeUpdate}): Promise<RunResult>`.
- API routes: `POST /api/runs`, `GET /api/runs/:runId`.

- [ ] **Step 1: Write failing publisher tests with a fake Meta client**

```javascript
test('publisher creates parent objects before child objects and pauses every object', async () => {
  const result = await publishDraft({ draft: oneAdDraft, token: 'test', runId: 'run-1', metaClient });
  assert.deepEqual(metaClient.calls.map((call) => call.type), ['campaign', 'adSet', 'image', 'creative', 'ad']);
  assert.ok(metaClient.calls.filter((call) => call.type !== 'image').every((call) => call.params.status === 'PAUSED'));
  assert.equal(result.nodes.find((node) => node.type === 'ad').status, 'created');
});

test('publisher skips children of a failed parent but continues another campaign', async () => {
  const result = await publishDraft({ draft: twoCampaignDraft, token: 'test', runId: 'run-1', metaClient: failingFirstCampaignClient });
  assert.equal(result.nodes.find((node) => node.clientId === 'first-ad-set').status, 'skipped');
  assert.equal(result.nodes.find((node) => node.clientId === 'second-campaign').status, 'created');
});
```

- [ ] **Step 2: Run the focused tests and verify they fail**

Run: `node --test test/publisher.test.js test/publish-routes.test.js`

Expected: failure because publisher and run routes do not exist.

- [ ] **Step 3: Implement creation orchestration and result UI**

Implement explicit `for...of` loops: create one campaign; for each ad set create the preset; for each ad retrieve its media, upload it, create the corresponding creative, and create its ad. Set `status=PAUSED` in every campaign, ad set, creative, and ad request. For a video, poll `status.video_status` every three seconds for at most 120 seconds; return a node error on `error` or timeout.

Persist all node changes as `{clientId, parentClientId, type, status, remoteId, error}`. A parent failure creates `skipped` results for its descendants while later top-level Campaigns continue. `POST /api/runs` validates the draft, checks session ownership, creates a run, performs publication, and returns the final structured result. `GET /api/runs/:runId` verifies ownership then returns current node states. The browser disables the publish button while a run is active, renders each node as pending/creating/created/failed/skipped, and shows `code`, `subcode`, and `fbtraceId` for failures without revealing secrets.

- [ ] **Step 4: Run focused tests and complete regression suite**

Run: `node --test test/publisher.test.js test/publish-routes.test.js`

Expected: PASS.

Run: `node --test`

Expected: PASS for all test files.

### Task 6: Document setup and verify a safe local handoff

**Files:**
- Create: `README.md`
- Modify: `.env.example`
- Modify: `test/http.test.js`

**Interfaces:**
- Consumes: final server routes and environment configuration.
- Produces: documented local setup, OAuth redirect setup, test command, and Meta permission caveats.

- [ ] **Step 1: Write a failing health and static-shell test**

```javascript
test('health endpoint and application shell are available without Meta credentials', async () => {
  assert.deepEqual(await request(server, '/health'), { status: 200, body: { status: 'ok' } });
  const page = await textRequest(server, '/');
  assert.match(page.body, /Meta Ads Campaign Builder/);
});
```

- [ ] **Step 2: Run the focused test and verify its initial failure**

Run: `node --test test/http.test.js`

Expected: failure until the final shell title and health route match the contract.

- [ ] **Step 3: Finish the handoff documentation and exact smoke checklist**

Write `README.md` with: Node 24 requirement, command to produce a Base64 32-byte encryption key, exact `.env` key descriptions, Meta redirect URL configuration, required scopes and Standard versus Advanced access note, `npm.cmd run dev` command for Windows PowerShell, `npm.cmd test` command, and warning that every create call remains `PAUSED`.

Document the manual smoke sequence: configure `.env`; start the server; complete Meta connection; confirm account/Page selectors populate; add at least two Campaigns and nested Ad Sets/Ads; validate; run against a test ad account; verify all created objects are paused in Ads Manager. State that a valid Meta app, token permissions, Page/ad account access, and test account are required for the live smoke check.

- [ ] **Step 4: Run final verification**

Run: `node --test`

Expected: PASS.

Run: `npm.cmd run dev`

Expected: application serves locally and `/health` returns `{ "status": "ok" }`.

## Plan Self-Review

- **Spec coverage:** Tasks 2-3 cover secure OAuth/token persistence and resource loading; Task 4 covers the nested conversation builder and media; Task 5 covers creation, error status, and paused-only enforcement; Task 6 covers operating and testing the app.
- **Placeholder scan:** No TBD/TODO markers or unspecified validation/error-handling steps remain.
- **Type consistency:** The client-side `clientId` flows from draft validation into `publisher` node results; the server-only `runId` flows through database storage and run routes; `MetaApiError` consistently uses `message`, `type`, `code`, `subcode`, and `fbtraceId`.

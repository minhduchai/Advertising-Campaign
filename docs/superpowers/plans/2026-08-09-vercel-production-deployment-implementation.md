# Vercel Production Deployment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deploy Creative Campaign to a stable Vercel production URL with Meta OAuth, Neon Postgres persistence, private Vercel Blob media storage, and the existing campaign/ad set/ad workflow preserved.

**Architecture:** Serve the current static frontend from `public/`, route `/api/*` through one Vercel Node Function, and share the same asynchronous request handler with the local Node server. Keep SQLite and multipart uploads for local development, while production selects Neon Postgres and browser-to-Blob uploads through environment-driven adapters. Migrate only saved conversation templates after the first production OAuth login because Meta user IDs are app-scoped.

**Tech Stack:** Node.js ESM, Node test runner, Vercel Node Functions, Vercel Blob `2.7.0`, Neon Serverless Driver `1.1.0`, esbuild `0.28.2`, SQLite, vanilla browser JavaScript, Meta Graph API v24.0.

## Global Constraints

- Do not initialize Git or create commits; this workspace is not a Git repository.
- Never print `META_APP_SECRET`, `TOKEN_ENCRYPTION_KEY`, `SESSION_SECRET`, access tokens, `DATABASE_URL`, or `BLOB_READ_WRITE_TOKEN`.
- Keep local development on SQLite and local multipart media storage.
- Require Neon and private Vercel Blob in production; never silently fall back to ephemeral disk.
- Preserve all current campaign, ad set, ad, targeting, Page discovery, audience, and conversation-template behavior.
- Keep every created Meta campaign, ad set, and ad in `PAUSED` status.
- Do not migrate old OAuth sessions, access tokens, uploaded media, run history, or node results.
- Do not create a real Meta campaign during automated tests. The final live smoke creation requires the user's explicit confirmation and must use the Duck Tool test Page.
- Run focused tests after each task and the full suite before deployment.

---

## Task 1: Add Production Runtime Configuration

**Files:**
- Modify: `package.json`
- Modify: `.env.example`
- Modify: `.gitignore`
- Modify: `src/config.js`
- Modify: `test/config.test.js`
- Modify: `test/helpers.js`

**Interfaces:**
- Consumes: `NODE_ENV`, `DATABASE_URL`, `BLOB_READ_WRITE_TOKEN`, and the existing Meta/session environment variables.
- Produces: a config object containing `isProduction`, `databaseUrl`, `blobReadWriteToken`, `mediaUploadMode`, and the existing fields.
- Invariant: production startup fails before serving requests if either durable service is missing.

- [ ] Add failing production configuration tests to `test/config.test.js`.

```js
test('production requires Neon and Vercel Blob', () => {
  const environment = validEnvironment({
    NODE_ENV: 'production',
    DATABASE_URL: '',
    BLOB_READ_WRITE_TOKEN: '',
  });

  assert.throws(() => loadConfig(environment), /DATABASE_URL/);
  assert.throws(
    () => loadConfig({ ...environment, DATABASE_URL: 'postgresql://example.invalid/app' }),
    /BLOB_READ_WRITE_TOKEN/,
  );
});

test('local runtime keeps SQLite media uploads', () => {
  const config = loadConfig(validEnvironment({ NODE_ENV: 'development' }));

  assert.equal(config.isProduction, false);
  assert.equal(config.mediaUploadMode, 'local');
});
```

- [ ] Run the focused test and confirm it fails because the new fields and validation do not exist.

```powershell
node --test test/config.test.js
```

Expected: at least one assertion fails for missing production validation or `mediaUploadMode`.

- [ ] Add exact package versions to `package.json`; keep existing runnable scripts until their target files are created in Tasks 4 and 6.

```json
{
  "scripts": {
    "dev": "node --env-file=.env --watch src/server.js",
    "start": "node --env-file=.env src/server.js",
    "test": "node --test"
  },
  "dependencies": {
    "@neondatabase/serverless": "1.1.0",
    "@vercel/blob": "2.7.0"
  },
  "devDependencies": {
    "esbuild": "0.28.2"
  }
}
```

- [ ] Install dependencies and create the lockfile.

```powershell
npm install
```

Expected: `package-lock.json` is created and `npm audit` reports no unresolved install failure.

- [ ] Update `src/config.js` so filesystem setup only occurs for the SQLite runtime.

```js
const isProduction = environment.NODE_ENV === 'production';
const databaseUrl = environment.DATABASE_URL?.trim() ?? '';
const blobReadWriteToken = environment.BLOB_READ_WRITE_TOKEN?.trim() ?? '';

if (isProduction && !databaseUrl) {
  throw new Error('DATABASE_URL is required in production.');
}
if (isProduction && !blobReadWriteToken) {
  throw new Error('BLOB_READ_WRITE_TOKEN is required in production.');
}

if (!databaseUrl) {
  mkdirSync(runtimeDirectory, { recursive: true });
}

return {
  ...existingConfig,
  isProduction,
  databaseUrl,
  databasePath: databaseUrl ? null : databasePath,
  blobReadWriteToken,
  mediaUploadMode: blobReadWriteToken ? 'vercel-blob' : 'local',
};
```

- [ ] Add production variable names without values to `.env.example`, and ignore `.vercel/`, `.env.production.local`, and `data-migrations/` in `.gitignore`.

- [ ] Extend `test/helpers.js` test config with deterministic defaults.

```js
isProduction: false,
databaseUrl: '',
blobReadWriteToken: '',
mediaUploadMode: 'local',
```

- [ ] Re-run the focused test.

```powershell
node --test test/config.test.js
```

Expected: all configuration tests pass.

---

## Task 2: Introduce an Async Database Contract

**Files:**
- Create: `src/database.js`
- Create: `src/postgres-db.js`
- Create: `src/postgres-schema.js`
- Create: `scripts/migrate-postgres.js`
- Create: `test/database-contract.js`
- Create: `test/postgres-db.test.js`
- Modify: `src/db.js`
- Modify: `test/db.test.js`

**Interfaces:**
- Consumes: SQLite path locally or Neon `DATABASE_URL` in production.
- Produces: one logical database API whose methods may always be awaited.
- Required methods: `createSession`, `getSession`, `attachMetaUser`, `createOAuthState`, `consumeOAuthState`, `upsertConnection`, `getConnection`, `saveMedia`, `getMedia`, `listConversationTemplates`, `getConversationTemplate`, `createConversationTemplate`, `updateConversationTemplate`, `duplicateConversationTemplate`, `setDefaultConversationTemplate`, `deleteConversationTemplate`, `importConversationTemplate`, `createRun`, `updateRunStatus`, `updateNodeResult`, and `getRun`.
- Ownership invariant: every user-owned lookup includes `ownerMetaUserId`; no template or media is accessible across owners.

- [ ] Add a reusable database contract in `test/database-contract.js` that awaits every operation even when SQLite returns synchronously.

```js
export function registerDatabaseContract(name, createDatabase) {
  describe(name, () => {
    test('stores sessions, connections, templates, media metadata, and runs', async () => {
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
      assert.equal((await database.getMedia('media-1')).id, 'media-1');
      assert.equal((await database.getRun('run-1')).id, 'run-1');
    });
  });
}
```

- [ ] Add `test/postgres-db.test.js` with an injectable SQL query stub and verify Postgres snake_case rows map to the current camelCase objects.

```js
test('maps a Postgres session row', async () => {
  const sql = createSqlStub([
    [{ id: 'session-1', meta_user_id: null, created_at: 1, updated_at: 1 }],
  ]);
  const database = createPostgresDatabase(sql);

  const session = await database.createSession({ id: 'session-1', now: 1 });

  assert.deepEqual(session, {
    id: 'session-1',
    metaUserId: null,
    createdAt: 1,
    updatedAt: 1,
  });
});
```

- [ ] Run focused database tests and confirm the Postgres test fails because the adapter does not exist.

```powershell
node --test test/db.test.js test/postgres-db.test.js
```

Expected: SQLite tests pass and the Postgres module import fails.

- [ ] Extend the SQLite `media` table in `src/db.js` without deleting existing rows.

```sql
ALTER TABLE media ADD COLUMN blob_url TEXT;
ALTER TABLE media ADD COLUMN blob_download_url TEXT;
ALTER TABLE media ADD COLUMN blob_pathname TEXT;
ALTER TABLE media ADD COLUMN size_bytes INTEGER;
```

Implement these additions as guarded schema migrations using `PRAGMA table_info(media)` so existing local databases migrate once. Keep `content BLOB` nullable for Blob-backed rows. Update `saveMedia` and `getMedia` to map all metadata fields.

- [ ] Create `src/postgres-schema.js` with idempotent `CREATE TABLE IF NOT EXISTS` statements for all seven existing tables.

```sql
CREATE TABLE IF NOT EXISTS media (
  id TEXT PRIMARY KEY,
  owner_meta_user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  content BYTEA,
  blob_url TEXT,
  blob_download_url TEXT,
  blob_pathname TEXT,
  size_bytes BIGINT NOT NULL,
  created_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS media_owner_idx ON media(owner_meta_user_id);
```

Use the existing SQLite column semantics for `sessions`, `oauth_states`, `connections`, `runs`, `node_results`, and `conversation_templates`; translate JSON text columns to `JSONB` and keep timestamps as epoch milliseconds in `BIGINT` so returned objects remain unchanged.

- [ ] Create `src/postgres-db.js` using `neon(databaseUrl)` and safe tagged-template queries.

```js
export function createPostgresDatabase(sql) {
  return {
    createSession: async (options) => mapSession((await insertSession(sql, options))[0]),
    getSession: async (id) => mapOptionalSession((await selectSession(sql, id))[0]),
    attachMetaUser: async (sessionId, metaUserId) => mapSession((await attachUser(sql, sessionId, metaUserId))[0]),
    createOAuthState: async (record) => mapOAuthState((await insertOAuthState(sql, record))[0]),
    consumeOAuthState: async (state, now) => consumeState(sql, state, now),
    upsertConnection: async (metaUserId, connection) => upsertEncryptedConnection(sql, metaUserId, connection),
    getConnection: async (metaUserId) => mapOptionalConnection((await selectConnection(sql, metaUserId))[0]),
    saveMedia: async (media) => mapMedia((await insertMedia(sql, media))[0]),
    getMedia: async (id) => mapOptionalMedia((await selectMedia(sql, id))[0]),
    listConversationTemplates: async (ownerMetaUserId) => listTemplates(sql, ownerMetaUserId),
    getConversationTemplate: async (ownerMetaUserId, id) => getTemplate(sql, ownerMetaUserId, id),
    createConversationTemplate: async (ownerMetaUserId, input) => createTemplate(sql, ownerMetaUserId, input),
    updateConversationTemplate: async (ownerMetaUserId, id, input) => updateTemplate(sql, ownerMetaUserId, id, input),
    duplicateConversationTemplate: async (ownerMetaUserId, id) => duplicateTemplate(sql, ownerMetaUserId, id),
    setDefaultConversationTemplate: async (ownerMetaUserId, id) => setDefaultTemplate(sql, ownerMetaUserId, id),
    deleteConversationTemplate: async (ownerMetaUserId, id) => deleteTemplate(sql, ownerMetaUserId, id),
    importConversationTemplate: async (ownerMetaUserId, input) => importTemplate(sql, ownerMetaUserId, input),
    createRun: async (run) => createRun(sql, run),
    updateRunStatus: async (id, status) => updateRunStatus(sql, id, status),
    updateNodeResult: async (runId, node) => upsertNodeResult(sql, runId, node),
    getRun: async (id) => getRun(sql, id),
  };
}

export function createNeonDatabase(databaseUrl) {
  return createPostgresDatabase(neon(databaseUrl));
}
```

Use a single non-interactive Neon transaction to clear the old default and set the selected default. Use `ON CONFLICT` for connection, node-result, and imported-template upserts.

- [ ] Create `src/database.js` as the environment-based factory.

```js
export function createDatabaseForConfig(config) {
  return config.databaseUrl
    ? createNeonDatabase(config.databaseUrl)
    : createSqliteDatabase(config.databasePath);
}
```

- [ ] Create `scripts/migrate-postgres.js`; it loads config, rejects an empty `DATABASE_URL`, calls `applyPostgresSchema(sql)`, prints only applied table names, and never logs the connection string.

- [ ] Update `test/db.test.js` to await database calls and register the SQLite contract.

- [ ] Run focused database tests.

```powershell
node --test test/db.test.js test/postgres-db.test.js
```

Expected: both adapters satisfy their focused tests and SQLite preserves existing behavior.

---

## Task 3: Share an Async HTTP Handler

**Files:**
- Create: `src/request-handler.js`
- Modify: `src/server.js`
- Modify: `src/publisher.js`
- Modify: `test/auth-routes.test.js`
- Modify: `test/http.test.js`
- Modify: `test/publish-routes.test.js`
- Modify: `test/publisher.test.js`
- Modify: `test/helpers.js`

**Interfaces:**
- Consumes: Node-compatible request/response objects plus `{ config, metaClient, db }`; Task 4 adds the media-store dependency after that module exists.
- Produces: `createRequestHandler(dependencies)` for local Node and Vercel.
- Local compatibility: `createServer(dependencies)` remains exported for the current tests and local startup.
- Async invariant: all database writes and publisher callbacks settle before an HTTP response is sent.

- [ ] Add a route test proving an asynchronous database operation is awaited before the response closes.

```js
test('awaits the database before completing OAuth callback', async () => {
  let connectionPersisted = false;
  const db = createTestDatabase({
    async upsertConnection() {
      await new Promise((resolve) => setTimeout(resolve, 10));
      connectionPersisted = true;
    },
  });

  const response = await requestOAuthCallback({ db });

  assert.equal(response.status, 302);
  assert.equal(connectionPersisted, true);
});
```

- [ ] Add a publisher test proving asynchronous node-result reporting is awaited.

```js
test('awaits each node result report', async () => {
  const reported = [];
  await publishDraft(draftFixture, {
    ...publisherDependencies,
    async onNodeUpdate(node) {
      await Promise.resolve();
      reported.push(node.type);
    },
  });

  assert.deepEqual(reported, ['campaign', 'adset', 'ad']);
});
```

- [ ] Run focused tests and confirm at least one new async assertion fails.

```powershell
node --test test/auth-routes.test.js test/publish-routes.test.js test/publisher.test.js
```

- [ ] Move request parsing, route dispatch, session handling, and API handlers from `src/server.js` to `src/request-handler.js`.

```js
export function createRequestHandler({ config, metaClient, db }) {
  return async function handleRequest(request, response) {
    try {
      await dispatchRequest({ request, response, config, metaClient, db });
    } catch (error) {
      sendApiError(response, error);
    }
  };
}
```

Keep the current routes and response bodies stable. Add `mediaUploadMode` to `/api/resources` so the browser can choose local multipart or Vercel Blob upload.

- [ ] Convert every database call in the request path to `await`, including session creation, OAuth-state consumption, connection lookup, template CRUD, run creation, node-result updates, and run status updates.

- [ ] Set secure production cookies while preserving localhost behavior.

```js
const secureAttribute = config.isProduction ? '; Secure' : '';
response.setHeader(
  'Set-Cookie',
  `meta_ads_session=${sessionId}; Path=/; HttpOnly; SameSite=Lax${secureAttribute}`,
);
```

- [ ] Make `publishDraft` await `getMedia`, `onNodeUpdate`, and all final run-state writes.

```js
async function report(node) {
  await onNodeUpdate(node);
  return node;
}

const media = await getMedia(ad.mediaId);
```

- [ ] Reduce `src/server.js` to local composition and startup.

```js
export function createServer({ config, metaClient, db }) {
  const handler = createRequestHandler({ config, metaClient, db });
  return http.createServer(handler);
}
```

The local bootstrap creates the SQLite database only when `src/server.js` is the executed entry point. Task 4 adds and wires the local media store.

- [ ] Re-run focused HTTP and publisher tests.

```powershell
node --test test/auth-routes.test.js test/publish-routes.test.js test/publisher.test.js
```

Expected: all focused tests pass and response shapes remain unchanged.

---

## Task 4: Add Local and Private Blob Media Stores

**Files:**
- Modify: `package.json`
- Create: `src/media-store.js`
- Create: `src/blob-upload.js`
- Create: `src/client/blob-upload-entry.js`
- Create: `scripts/build-client.js`
- Create: `test/media-store.test.js`
- Modify: `src/request-handler.js`
- Modify: `src/server.js`
- Modify: `public/api.js`
- Modify: `public/app.js`
- Modify: `public/workspace.js`
- Modify: `test/client-api.test.js`
- Modify: `test/publish-routes.test.js`

**Interfaces:**
- Local media store: `saveUpload({ ownerMetaUserId, file })` and `getMedia({ ownerMetaUserId, id })` backed by SQLite BLOB content.
- Production media store: `completeUpload({ ownerMetaUserId, input })` and `getMedia({ ownerMetaUserId, id })` backed by private Vercel Blob.
- Token route: `POST /api/media/blob-token` uses `handleUpload` and authenticates the current Meta owner before issuing a client token.
- Completion route: `POST /api/media/complete` verifies Blob metadata with `head()` before inserting metadata in Neon.
- Existing local route: `POST /api/media` remains available only when `mediaUploadMode === 'local'`.

- [ ] Add media-store tests with injected Blob SDK functions.

```js
test('hydrates a private Blob into publisher media', async () => {
  const database = createTestDatabase({
    media: {
      id: 'media-1',
      ownerMetaUserId: 'meta-user-1',
      name: 'creative.jpg',
      mimeType: 'image/jpeg',
      blobUrl: 'https://private.blob.vercel-storage.com/creative.jpg',
    },
  });
  const store = createVercelBlobMediaStore({
    db: database,
    getBlob: async () => ({ statusCode: 200, stream: Readable.toWeb(Readable.from('image-bytes')) }),
  });

  const media = await store.getMedia({ ownerMetaUserId: 'meta-user-1', id: 'media-1' });

  assert.equal(media.content.toString(), 'image-bytes');
});
```

Also test owner mismatch rejection, unsupported MIME type rejection, the 200 MB limit, Blob `head()` mismatch rejection, and metadata persistence only after successful verification.

- [ ] Add a client API test for the two-step production upload.

```js
test('uploads directly to Blob and completes metadata registration', async () => {
  const result = await api.uploadMedia(fileFixture, {
    mode: 'vercel-blob',
    uploadImpl,
  });

  assert.equal(uploadImpl.calls[0].options.access, 'private');
  assert.equal(fetchCalls.at(-1).url, '/api/media/complete');
  assert.equal(result.id, uploadImpl.calls[0].mediaId);
});
```

- [ ] Run focused tests and confirm the new modules or routes are missing.

```powershell
node --test test/media-store.test.js test/client-api.test.js test/publish-routes.test.js
```

- [ ] Implement `src/media-store.js` with explicit local and production factories.

```js
export function createLocalMediaStore({ db }) {
  return {
    async saveUpload({ ownerMetaUserId, file }) {
      return db.saveMedia(toLocalMediaRecord(ownerMetaUserId, file));
    },
    async getMedia({ ownerMetaUserId, id }) {
      return requireOwnedMedia(await db.getMedia(id), ownerMetaUserId);
    },
  };
}

export function createVercelBlobMediaStore({ db, headBlob, getBlob }) {
  return {
    async completeUpload({ ownerMetaUserId, input }) {
      const verified = await verifyPrivateBlob(headBlob, ownerMetaUserId, input);
      return db.saveMedia(toBlobMediaRecord(ownerMetaUserId, input, verified));
    },
    async getMedia({ ownerMetaUserId, id }) {
      const metadata = requireOwnedMedia(await db.getMedia(id), ownerMetaUserId);
      const blob = await getBlob(metadata.blobUrl, { access: 'private' });
      return { ...metadata, content: await streamToBuffer(blob.stream) };
    },
  };
}
```

Reject media unless MIME type starts with `image/` or `video/`; reject declared or verified size above `200 * 1024 * 1024` bytes.

- [ ] Implement `src/blob-upload.js` around `handleUpload` from `@vercel/blob/client`.

```js
return handleUpload({
  request,
  token: config.blobReadWriteToken,
  onBeforeGenerateToken: async (pathname, clientPayload) => {
    const payload = parseAndValidateClientPayload(clientPayload, ownerMetaUserId);
    return {
      allowedContentTypes: ['image/*', 'video/*'],
      maximumSizeInBytes: 200 * 1024 * 1024,
      addRandomSuffix: true,
      tokenPayload: JSON.stringify(payload),
    };
  },
  onUploadCompleted: async () => {},
});
```

Use pathname `meta-ads/{ownerMetaUserId}/{mediaId}/{sanitizedName}`. Do not persist in `onUploadCompleted`; the authenticated completion route performs a deterministic `head()` verification and writes the database row.

- [ ] Add routes to `src/request-handler.js`.

```text
POST /api/media                 local multipart upload only
POST /api/media/blob-token      production client-token exchange
POST /api/media/complete        production Blob verification and metadata insert
```

All three routes require a connected session. The completion route verifies the opaque `mediaId` pathname prefix, URL, pathname, content type, and size against Blob `head()` output, then stores ownership from the authenticated Meta session.

- [ ] Create `src/client/blob-upload-entry.js` and bundle it for the raw-ESM frontend.

```js
import { upload } from '@vercel/blob/client';

export async function uploadPrivateBlob(pathname, file, options) {
  return upload(pathname, file, {
    access: 'private',
    handleUploadUrl: '/api/media/blob-token',
    clientPayload: JSON.stringify(options.clientPayload),
  });
}
```

`scripts/build-client.js` must use esbuild to bundle this entry to `public/blob-upload-client.js`, browser platform, ESM format, and production minification.

- [ ] Add the client-build scripts to `package.json` now that their target files exist.

```json
{
  "scripts": {
    "build:client": "node scripts/build-client.js",
    "build": "npm run build:client",
    "dev": "npm run build:client && node --env-file=.env --watch src/server.js",
    "start": "npm run build:client && node --env-file=.env src/server.js",
    "test": "npm run build:client && node --test"
  }
}
```

- [ ] Update `public/api.js` to keep the current FormData path locally and dynamically import `/blob-upload-client.js` in production.

```js
async function uploadMedia(file, { mode }) {
  if (mode === 'local') {
    const formData = new FormData();
    formData.set('file', file);
    return json('/api/media', { method: 'POST', body: formData });
  }

  const mediaId = crypto.randomUUID();
  const { uploadPrivateBlob } = await import('/blob-upload-client.js');
  const pathname = `meta-ads/${mediaId}/${sanitizeFileName(file.name)}`;
  const blob = await uploadPrivateBlob(pathname, file, {
    clientPayload: { mediaId, name: file.name, mimeType: file.type, size: file.size },
  });
  return json('/api/media/complete', {
    method: 'POST',
    body: JSON.stringify({ mediaId, name: file.name, mimeType: file.type, size: file.size, blob }),
  });
}
```

The server, not the client, injects the owner-specific pathname prefix when issuing the Blob token. Treat the browser pathname as a requested suffix only.

- [ ] Update `public/app.js` to read `resources.mediaUploadMode`, pass the `File` directly to `api.uploadMedia`, preserve the local preview URL, and leave workspace state unchanged until upload completion succeeds.

- [ ] Update the media help text in `public/workspace.js` to state that images and videos up to 200 MB upload directly to secure storage in production.

- [ ] Re-run focused media and publish tests.

```powershell
npm run build:client
node --test test/media-store.test.js test/client-api.test.js test/publish-routes.test.js
```

Expected: bundle builds, local uploads still pass, Blob flow passes with mocks, and publisher receives a Buffer.

---

## Task 5: Package the Vercel Function and Static App

**Files:**
- Create: `src/vercel-runtime.js`
- Create: `api/[...path].js`
- Create: `vercel.json`
- Create: `.vercelignore`
- Create: `test/vercel-runtime.test.js`
- Modify: `src/server.js`
- Modify: `test/helpers.js`
- Modify: `test/http.test.js`

**Interfaces:**
- Consumes: the production config and factories for Neon, Blob, and Meta API clients.
- Produces: a default Vercel Node Function for all `/api/*` requests.
- Health endpoint: both `/health` locally and `/api/health` on Vercel return status `200` with the existing JSON health payload.
- Static output: `public/` is the Vercel output directory.

- [ ] Add a runtime composition test with injected factories.

```js
test('composes production dependencies exactly once', async () => {
  const calls = [];
  const handler = createVercelHandler(productionEnvironment, {
    createDatabase: (config) => (calls.push(['database', config.databaseUrl]), fakeDatabase),
    createMediaStore: (options) => (calls.push(['media', options.config.mediaUploadMode]), fakeMediaStore),
    createMetaClient: () => fakeMetaClient,
  });

  await invoke(handler, '/api/health');
  assert.deepEqual(calls, [
    ['database', 'postgresql://example.invalid/app'],
    ['media', 'vercel-blob'],
  ]);
});
```

- [ ] Run the test and confirm the Vercel runtime module is missing.

```powershell
node --test test/vercel-runtime.test.js
```

- [ ] Implement `src/vercel-runtime.js` as the only production composition root.

```js
export function createVercelHandler(environment = process.env, factories = defaultFactories) {
  const config = loadConfig(environment);
  const db = factories.createDatabase(config);
  const metaClient = factories.createMetaClient(config);
  const mediaStore = factories.createMediaStore({ config, db });
  return createRequestHandler({ config, db, metaClient, mediaStore });
}
```

- [ ] Add the catch-all function in `api/[...path].js`.

```js
import { createVercelHandler } from '../src/vercel-runtime.js';

const handler = createVercelHandler();

export const maxDuration = 300;
export default handler;
```

- [ ] Add `vercel.json`.

```json
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "framework": null,
  "buildCommand": "npm run build",
  "outputDirectory": "public",
  "functions": {
    "api/[...path].js": {
      "maxDuration": 300
    }
  },
  "rewrites": [
    {
      "source": "/health",
      "destination": "/api/health"
    }
  ]
}
```

- [ ] Add `.vercelignore` entries for `.env`, `.env.*`, `.runtime/`, `data-migrations/`, screenshots, and local design artifacts that are not required at runtime. Do not ignore `public/`, `api/`, `src/`, `package.json`, or `package-lock.json`.

- [ ] Keep `src/server.js` as a local entry that uses `createDatabaseForConfig(config)` and `createLocalMediaStore({ db })`; assert that it rejects `mediaUploadMode === 'vercel-blob'` outside Vercel composition to prevent accidental mixed modes.

- [ ] Run the runtime test and a local health smoke test.

```powershell
node --test test/vercel-runtime.test.js
$process = Start-Process -FilePath node -ArgumentList '--env-file=.env','src/server.js' -WindowStyle Hidden -PassThru
try { Start-Sleep -Seconds 2; Invoke-RestMethod 'http://localhost:3001/health' } finally { Stop-Process -Id $process.Id }
```

Expected: the unit test passes and local health returns the existing success payload.

---

## Task 6: Migrate Conversation Templates Safely

**Files:**
- Modify: `package.json`
- Create: `scripts/export-conversation-templates.js`
- Create: `scripts/import-conversation-templates.js`
- Create: `scripts/list-production-connections.js`
- Create: `test/template-migration.test.js`
- Modify: `src/db.js`
- Modify: `src/postgres-db.js`
- Modify: `README.md`

**Interfaces:**
- Export input: local SQLite `conversation_templates` rows.
- Export output: `data-migrations/conversation-templates.json` with no OAuth token and no reusable old owner identity.
- Import input: exported JSON plus `--owner` set to the new app-scoped Meta user ID obtained after production OAuth.
- Import behavior: idempotent by template ID; preserve names, Page IDs, JSON payloads, timestamps, and one default template.

- [ ] Add migration tests using a temporary SQLite database and an in-memory destination adapter.

```js
test('export removes the old app-scoped owner and import assigns the new owner', async () => {
  const exported = await exportTemplates(sourceDatabase, 'old-meta-user');
  assert.equal('ownerMetaUserId' in exported.templates[0], false);

  await importTemplates(destinationDatabase, 'new-meta-user', exported);
  const imported = await destinationDatabase.listConversationTemplates('new-meta-user');

  assert.equal(imported.length, exported.templates.length);
  assert.equal(imported[0].ownerMetaUserId, 'new-meta-user');
});
```

Also assert that importing the same file twice does not duplicate rows and that exactly one template remains default.

- [ ] Run the focused test and confirm the migration modules are missing.

```powershell
node --test test/template-migration.test.js
```

- [ ] Implement the export format.

```json
{
  "schemaVersion": 1,
  "exportedAt": "2026-08-09T00:00:00.000Z",
  "templates": [
    {
      "id": "stable-template-id",
      "pageId": "page-id",
      "name": "Template name",
      "template": {},
      "isDefault": true,
      "createdAt": 0,
      "updatedAt": 0
    }
  ]
}
```

The timestamp shown is the schema example only; the exporter writes the actual current ISO time and actual stored timestamps. The exporter must require a connected local owner, export the current five templates, and print only the output path and count.

- [ ] Implement `importConversationTemplate` in both database adapters with owner reassignment and conflict-safe insertion.

- [ ] Implement the importer argument contract.

```powershell
node --env-file=.env.production.local scripts/import-conversation-templates.js --file data-migrations/conversation-templates.json --owner 1234567890
```

Reject missing files, schema versions other than `1`, malformed template JSON, an empty owner, and multiple defaults. After row upserts, call `setDefaultConversationTemplate` once for the exported default.

- [ ] Implement `scripts/list-production-connections.js` to print only Meta user IDs and connection update timestamps from Neon. It must not decrypt or print tokens.

- [ ] Add migration and template script commands to `package.json` now that every target file exists.

```json
{
  "scripts": {
    "db:migrate:postgres": "node scripts/migrate-postgres.js",
    "templates:export": "node --env-file=.env scripts/export-conversation-templates.js",
    "templates:import": "node scripts/import-conversation-templates.js"
  }
}
```

- [ ] Document local export, production OAuth, safe owner lookup, import, and verification in `README.md`.

- [ ] Run the migration test.

```powershell
node --test test/template-migration.test.js
```

Expected: export/import is idempotent, owner reassignment is correct, and no secret fields appear in the JSON.

---

## Task 7: Run Full Verification Before Cloud Changes

**Files:**
- Modify only if failures reveal regressions in files already listed above.

**Interfaces:**
- Consumes: completed production adapters and local compatibility path.
- Produces: a deployable project with no known automated-test regressions.

- [ ] Search for un-awaited database and publisher calls in runtime code.

```powershell
rg -n "db\.(create|get|attach|consume|upsert|save|list|update|delete|duplicate|setDefault|import)" src
rg -n "onNodeUpdate\(|getMedia\(" src/publisher.js
```

Expected: every asynchronous call in request/publisher paths is preceded by `await` or returned directly from an async function.

- [ ] Build the browser upload bundle.

```powershell
npm run build
```

Expected: `public/blob-upload-client.js` is generated with no unresolved bare imports.

- [ ] Run the complete test suite.

```powershell
npm test
```

Expected: all tests pass; no test sends a request to Meta, Neon, or Vercel.

- [ ] Validate the unlinked Vercel entry and project configuration without creating cloud state.

```powershell
node --check "api/[...path].js"
node -e "JSON.parse(require('node:fs').readFileSync('vercel.json', 'utf8')); console.log('vercel.json valid')"
```

Expected: the function entry parses and `vercel.json` is valid JSON. The actual Vercel production build runs in Task 8 after project link and production environment pull.

- [ ] Inspect generated artifacts for secret leakage.

```powershell
rg -n "META_APP_SECRET|TOKEN_ENCRYPTION_KEY|SESSION_SECRET|BLOB_READ_WRITE_TOKEN|postgresql://" public
```

Expected: no secret values or production connection strings appear in public client files. Task 8 repeats this scan against `.vercel\output` after the linked production build.

---

## Task 8: Provision Vercel, Neon, and Blob

**Files:**
- Generated locally: `.vercel/project.json`
- Generated locally: `.env.production.local`
- No source code changes expected.

**Interfaces:**
- Vercel project slug preference: `creative-campaign-lgclinic`.
- Deterministic fallback slug: `creative-campaign-lgclinic-ads`.
- Production callback preference: `https://creative-campaign-lgclinic.vercel.app/api/auth/meta/callback`.
- Production callback fallback: `https://creative-campaign-lgclinic-ads.vercel.app/api/auth/meta/callback`.

- [ ] Confirm the active Vercel identity.

```powershell
npx vercel whoami
```

Expected: `ducndna-5064`.

- [ ] Link the preferred project; use the exact fallback only if Vercel reports that the preferred slug is unavailable.

```powershell
npx vercel link --yes --project creative-campaign-lgclinic
```

Fallback command:

```powershell
npx vercel link --yes --project creative-campaign-lgclinic-ads
```

- [ ] Create and connect a private Blob store named `creative-campaign-media` in Singapore.

```powershell
npx vercel blob create-store creative-campaign-media --access private --region sin1
```

If the CLI requests a paid-plan confirmation, stop and obtain explicit user approval before accepting it. Confirm the connected project receives `BLOB_READ_WRITE_TOKEN`.

- [ ] Create a Neon Postgres project through the Vercel Marketplace, choose Singapore or the nearest available Southeast Asia region, connect it to this Vercel project, and confirm `DATABASE_URL` appears in Production environment variables.

- [ ] Add production environment variables through Vercel's protected environment-variable UI or interactive CLI. Use the new live Meta App ID `28368194146120768` and its matching secret; never copy values into command history.

```text
META_APP_ID
META_APP_SECRET
META_REDIRECT_URI
META_API_VERSION
TOKEN_ENCRYPTION_KEY
SESSION_SECRET
DATABASE_URL
BLOB_READ_WRITE_TOKEN
NODE_ENV
```

Set `META_API_VERSION` to `v24.0` and `NODE_ENV` to `production`. Set `META_REDIRECT_URI` to the exact preferred or fallback callback selected by the linked project.

- [ ] Pull production environment variables to the ignored local file and migrate Postgres.

```powershell
npx vercel env pull .env.production.local --environment=production
node --env-file=.env.production.local scripts/migrate-postgres.js
```

Expected: seven table names are reported and no URL, password, or token is printed.

- [ ] Run the linked Vercel production build and scan generated output for leaked values before deployment.

```powershell
npx vercel build --prod
rg -n "META_APP_SECRET|TOKEN_ENCRYPTION_KEY|SESSION_SECRET|BLOB_READ_WRITE_TOKEN|postgresql://" .vercel\output
```

Expected: static assets and `api/[...path].js` build successfully; no actual secret value or production connection string appears in generated client output.

- [ ] Deploy production.

```powershell
npx vercel --prod
```

Expected: deployment succeeds and Vercel assigns the selected stable production alias.

- [ ] Verify static and API health endpoints.

```powershell
$productionUrl = 'https://creative-campaign-lgclinic.vercel.app'
Invoke-WebRequest $productionUrl -UseBasicParsing | Select-Object StatusCode
Invoke-RestMethod "$productionUrl/api/health"
```

If the fallback project was used, set `$productionUrl` to `https://creative-campaign-lgclinic-ads.vercel.app` instead.

Expected: root returns `200`; health returns the existing success JSON.

---

## Task 9: Configure Meta for the Production Domain

**Files:**
- No repository files.
- External configuration: Meta App `28368194146120768`.

**Interfaces:**
- OAuth callback must exactly match `META_REDIRECT_URI`.
- App Domains must contain the selected Vercel hostname and `lgclinic.vn`.
- App remains published/live.

- [ ] In Meta App Settings > Basic, add the selected hostname without scheme or path:

```text
creative-campaign-lgclinic.vercel.app
```

Use `creative-campaign-lgclinic-ads.vercel.app` only if the fallback project was linked. Keep `lgclinic.vn`. Remove `localhost` from App Domains after production OAuth succeeds.

- [ ] In Facebook Login for Business, add the exact Valid OAuth Redirect URI:

```text
https://creative-campaign-lgclinic.vercel.app/api/auth/meta/callback
```

Use the exact fallback callback only when the fallback project is active.

- [ ] Confirm the requested scopes match the code and approved product configuration:

```text
ads_read
ads_management
pages_show_list
pages_read_engagement
pages_manage_ads
business_management
```

Do not add `pages_manage_posts`; the app's ad-creative flow must not require Page publishing permission.

- [ ] Save Meta settings, wait for propagation, open the production root in a fresh browser tab, and complete OAuth.

- [ ] Verify the callback returns to the selected production root with `?connected=1`, the secure session cookie is present, and `/api/resources` returns the logged-in user, ad accounts, Pages, and `mediaUploadMode: "vercel-blob"`.

- [ ] If OAuth still reports “Ứng dụng không hoạt động,” confirm the browser URL contains App ID `28368194146120768`, not the old App ID `2777559839266672`, then confirm the production deployment has the new environment values and redeploy.

---

## Task 10: Import Templates and Run Production Smoke Tests

**Files:**
- Generated locally: `data-migrations/conversation-templates.json`
- Modify: `README.md` only if actual production commands or aliases differ from the documented values.

**Interfaces:**
- Migration source: current local SQLite templates.
- Migration destination owner: the new app-scoped Meta user established by production OAuth.
- Live creation target: Duck Tool test Page only.
- Safety: live objects remain `PAUSED`.

- [ ] Export the five local conversation templates.

```powershell
npm run templates:export
```

Expected: `data-migrations/conversation-templates.json` contains five templates and no owner ID, token, secret, or connection record.

- [ ] Pull the latest production variables and list safe connection metadata.

```powershell
npx vercel env pull .env.production.local --environment=production
node --env-file=.env.production.local scripts/list-production-connections.js
```

Expected: exactly the newly connected production Meta user ID and timestamp are shown; no access token is shown.

- [ ] Import templates using the displayed owner ID.

```powershell
$ownerId = Read-Host 'Production Meta user ID'
node --env-file=.env.production.local scripts/import-conversation-templates.js --file data-migrations/conversation-templates.json --owner $ownerId
```

Expected: five templates are inserted or matched idempotently and one is default.

- [ ] Refresh the production app and verify, without creating Meta objects:
  - all expected ad accounts load;
  - the expanded Page discovery list loads;
  - custom audiences load;
  - all Vietnamese provinces/cities can be included or excluded;
  - campaign budget strategy toggles campaign versus ad-set budget fields;
  - ad sets expose conversion location, Page, performance goal, gender, included audiences, and excluded audiences;
  - multiple campaigns, multiple ad sets per campaign, and multiple ads per ad set remain editable;
  - conversation templates load, save, duplicate, set default, and populate the fixed conversation creative flow;
  - changing ad-set fields does not scroll the editor to the top.

- [ ] Upload one test image and one test video. Confirm browser network traffic sends media bytes directly to Vercel Blob, Neon stores metadata only, and the workspace receives a media ID after `/api/media/complete` succeeds.

- [ ] Validate a complete draft and confirm no automated operation changes status from `PAUSED`.

- [ ] Ask the user for explicit confirmation immediately before the one live creation smoke test.

- [ ] After confirmation, create one campaign, one ad set, and one ad on the Duck Tool Page. Use a new unpublished ad creative, the saved conversation JSON, and `PAUSED` status at every level.

- [ ] Record the returned Meta campaign, ad-set, and ad IDs in the user-facing handoff only. Do not store tokens or secrets in documentation.

- [ ] Confirm the run log reports all three nodes as successful. If Meta rejects the ad, preserve campaign/ad-set IDs, report the exact Meta code/subcode, and do not retry with broader permissions or public Page posting without a new review.

- [ ] Run final regression checks.

```powershell
npm test
npx vercel inspect --logs creative-campaign-lgclinic.vercel.app
```

If the fallback project was used, inspect `creative-campaign-lgclinic-ads.vercel.app` instead.

Expected: tests pass, production logs contain no unhandled exception, and no secret value appears in logs.

---

## Completion Criteria

- The app opens at a stable Vercel production URL.
- OAuth uses Meta App `28368194146120768` and returns to the production callback.
- Sessions, connections, templates, runs, and node results persist in Neon across deployments.
- Images and videos upload directly to private Vercel Blob and can be hydrated for Meta creative upload.
- The five saved conversation templates are available under the new app-scoped owner.
- Existing local SQLite development still works on port `3001`.
- All automated tests and the Vercel production build pass.
- One user-approved Duck Tool smoke campaign, ad set, and ad are created successfully in `PAUSED` state, or an exact Meta error is reported without unsafe retries.

## Official References

- Vercel Blob client uploads: https://vercel.com/docs/vercel-blob/client-upload
- Vercel Blob SDK and private `get()`: https://vercel.com/docs/vercel-blob/using-blob-sdk
- Vercel Blob CLI: https://vercel.com/docs/cli/blob
- Neon Serverless Driver: https://neon.com/docs/serverless/serverless-driver

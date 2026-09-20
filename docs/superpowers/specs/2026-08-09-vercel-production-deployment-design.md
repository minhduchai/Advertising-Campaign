# Vercel Production Deployment Design

**Date:** 2026-08-09  
**Status:** Approved architecture, pending written-spec review  
**Application:** Creative Campaign / Meta Ads Campaign Builder

## Objective

Deploy the complete Meta Ads Campaign Builder to a public HTTPS Vercel URL so external users can authenticate with the live Meta App, load their advertising resources, save conversation templates, upload ad media, and create Campaign -> Ad Set -> Ad structures in `PAUSED` status.

The production deployment must not depend on `localhost`, a long-running process, local SQLite persistence, or files stored on the developer computer.

## Chosen Architecture

### Vercel hosting

- Serve the existing files in `public/` as Vercel static assets.
- Add a catch-all Vercel Node Function for the existing `/api/*` routes.
- Refactor `src/server.js` so the request handler is reusable by both:
  - the current local Node HTTP server; and
  - the Vercel Function entry point.
- Keep `/health` available for local and production smoke checks.
- Use `creative-campaign-lgclinic` as the preferred Vercel project slug. If unavailable, use `creative-campaign-lgclinic-ads`; the production alias returned by Vercel becomes the canonical application URL.

### Database

- Keep SQLite for local development and automated tests.
- Use Neon Postgres in production through `DATABASE_URL`.
- Introduce one asynchronous database interface shared by SQLite and Postgres adapters.
- Convert all request handlers and publishing code to await database operations.
- Store these logical entities in both adapters:
  - sessions;
  - OAuth states;
  - encrypted Meta connections;
  - media metadata;
  - publish runs and node results;
  - conversation templates.
- Apply Postgres schema changes through an idempotent migration script before the first production deployment and on later schema releases.

### Media storage

- Use a private Vercel Blob store in production.
- Upload media directly from the browser to Blob through a server-authorized client-upload flow.
- Store only Blob identifiers, pathname, MIME type, original filename, size, owner Meta user ID, and timestamps in Postgres.
- Resolve the private Blob inside the server function when publishing to Meta; access tokens and Blob credentials never reach application JavaScript in the browser.
- Keep the current SQLite BLOB implementation for local development.
- Delete a Blob when its media record is explicitly deleted. Automated retention cleanup is deferred until a product requirement defines the desired retention period.

## Request and Data Flow

### OAuth

1. The browser requests `/api/auth/meta/start` on the production domain.
2. The API creates a short-lived OAuth state in Neon and sets a signed, `HttpOnly`, `Secure`, `SameSite=Lax` session cookie.
3. Meta redirects to `/api/auth/meta/callback` on the canonical production alias selected during deployment; that complete HTTPS URL is stored in `META_REDIRECT_URI` and copied exactly into Meta configuration.
4. The API consumes the state, exchanges the authorization code using the production App ID and App Secret, encrypts the token with `TOKEN_ENCRYPTION_KEY`, and stores the connection in Neon.
5. The browser is redirected to `/?connected=1` and automatically loads ad accounts.

Preview deployment URLs are not registered as OAuth callbacks. OAuth is tested only on the canonical production alias.

### Resource discovery

- Existing resource endpoints continue to call Meta server-side with the encrypted connection token.
- Page discovery continues to merge `promote_pages`, `/me/accounts`, and Business Portfolio owned/client pages.
- Custom Audiences remain scoped to the selected ad account.
- No Meta access token is returned to the browser.

### Media and publishing

1. The browser requests a scoped Blob upload token from the API.
2. The browser uploads the JPG, PNG, WEBP, or MP4 directly to private Vercel Blob.
3. The API validates and records the resulting Blob metadata in Postgres.
4. A publish request validates the full draft and verifies media ownership.
5. The publisher fetches the private Blob and sends it to Meta.
6. Campaigns, Ad Sets, Creatives, and Ads remain `PAUSED`.
7. Per-node results are saved in Postgres and returned to the result modal.

## Existing Data Migration

Current local SQLite data contains 4 sessions, 3 OAuth states, 1 encrypted connection, 13 media records, 18 runs, 54 node results, and 5 conversation templates.

- Do not migrate sessions, OAuth states, encrypted tokens, media, runs, or node results. They are local test data or are tied to the previous Meta App/session context.
- Export the 5 conversation templates to a versioned JSON migration file without reusing the old app-scoped owner ID.
- After the first successful production OAuth login, import those templates once for the new authenticated Meta user while preserving Page IDs, names, template JSON, and default status.
- Make the import idempotent so retrying it cannot create duplicates.

## Configuration

### Vercel environment variables

- `META_APP_ID`
- `META_APP_SECRET`
- `META_REDIRECT_URI`
- `META_API_VERSION`
- `TOKEN_ENCRYPTION_KEY`
- `SESSION_SECRET`
- `DATABASE_URL`
- `BLOB_READ_WRITE_TOKEN`
- `NODE_ENV=production`

Secrets are entered through Vercel environment management and must not be committed, logged, returned by an endpoint, or embedded in client assets.

### Meta App configuration

- Add the canonical Vercel hostname to App Domains.
- Keep `lgclinic.vn` because it hosts the privacy policy.
- Remove the invalid `localhost` App Domain entry after production OAuth succeeds.
- Add the exact production callback URL to the Facebook Login for Business configuration.
- Set `META_REDIRECT_URI` to exactly the same callback URL.
- Keep the Meta App in `Đã đăng` status.

## Error Handling

- Return structured JSON errors from all API routes.
- Treat invalid OAuth state, expired state, missing session, missing connection, ownership mismatch, Blob failure, Neon failure, and Meta Graph errors as distinct conditions.
- Keep Meta error code and subcode in safe server responses while excluding access tokens and secrets.
- Do not retry non-idempotent Meta object creation automatically.
- Preserve the existing parent-failure behavior: dependent Ad Sets or Ads are skipped when their parent fails.
- If Blob metadata creation fails after an upload, delete the newly uploaded Blob when possible and report cleanup failure separately.

## Security

- Encrypt Meta access tokens with AES-256-GCM before writing to Neon.
- Use production-only secure cookies.
- Validate ownership for templates, media, runs, and publish requests.
- Use private Blob access and server-authorized uploads.
- Reject unsupported MIME types and enforce upload-size limits before publishing.
- Avoid logging OAuth codes, access tokens, App Secret, database credentials, Blob credentials, or raw uploaded media.
- Do not migrate the previous App token to production; require a clean OAuth connection with App `28368194146120768`.

## Verification

### Automated

- Preserve the existing local test suite.
- Add database adapter contract tests covering SQLite and a mocked Postgres client.
- Add tests for the reusable request handler and Vercel catch-all entry point.
- Add tests for secure production cookies, Blob metadata ownership, upload authorization, and production configuration validation.
- Add a migration test that applies the Postgres schema twice successfully.

### Production smoke test

1. Confirm the production root and `/health` return success.
2. Complete OAuth with the live Meta App.
3. Confirm ad accounts load automatically.
4. Select an ad account and confirm Pages and Custom Audiences load.
5. Upload one image through Vercel Blob.
6. Load or create a conversation template.
7. Validate a draft containing one Campaign, one Ad Set, and one Ad.
8. With explicit user confirmation, create the structure against the Duck Tool test Page and verify every Meta object remains `PAUSED`.

## Deployment Sequence

1. Refactor the request handler and add deployment adapters.
2. Add Neon schema and migration tooling.
3. Add Vercel Blob client-upload flow.
4. Export the 5 local conversation templates.
5. Create and link the Vercel project.
6. Provision Neon and private Vercel Blob storage.
7. Configure production environment variables.
8. Deploy production and capture the canonical URL.
9. Update Meta App Domains and the OAuth redirect URI.
10. Complete production OAuth and import conversation templates.
11. Run the production smoke test.

## Out of Scope

- Automatically switching Meta objects to `ACTIVE`.
- Migrating old sessions, access tokens, media, or test run history.
- Supporting OAuth from arbitrary Vercel preview URLs.
- Adding billing, tenant administration, or role management beyond Meta authorization.
- Adding a custom domain during this deployment; it can replace the Vercel alias later without changing the application architecture.

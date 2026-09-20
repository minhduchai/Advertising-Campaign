# Code audit fixes — 2026-09-07

Status: deployed to `https://creative-campaign-lgclinic.vercel.app`. Production migration applied. Full Node suite: 749 passed, 0 failed.

Deployment: `dpl_FbJajaU7NsfzbXVwePBZppvC6c3x` (`creative-campaign-lgclinic-lz4v2z6ve-ducndna-5064s-projects.vercel.app`). Explicit public alias assignment succeeded. Public health, session, index, app/workspace JavaScript and CSS returned 200; delivered JavaScript matched local files. Session remained `private, no-store`; JavaScript/CSS returned `no-cache`; index required revalidation.

## Changes

- Browser modules use canonical URLs without mixed version query strings. Static assets require cache revalidation. Both normal and Launch Control pages were opened locally; request logs showed one request per module per page load and no JavaScript errors were captured.
- Single-part R2 uploads now use owner-scoped object keys and validate ownership on completion, consistent with multipart uploads. Uploads started with the old single-part key format must be restarted after deployment; completed legacy media remains readable.
- R2 cleanup protects every registered object, because local browser drafts cannot be inspected by the server. It only removes unregistered objects older than the configured grace period (default 72 hours), oldest first, until the target is reached. Missing registry access prevents deletion. Partial deletion errors are reported and only confirmed deletions count toward freed space. Protected objects may keep the bucket above its target size.
- Explicit media deletion removes the database row only after object deletion succeeds, with an owner/id/URL guard. Missing R2 objects produce an actionable 410 response before passing a media URL to Meta.
- Deployment exclusions cover backups, archives, local artifacts and unused runtime assets. The upload-agent source remains because interaction tests still import it; it is excluded from deployment.
- Vercel initializes lazily, returns a sanitized 503 if initialization fails, and retries initialization on the next request.
- Anonymous draft validation remains available for composing before login, with a 256 KiB request limit.
- Workflow replay protection uses an atomic database nonce claim shared across server instances. Signature validation precedes the claim. Invalid signatures do not consume nonces, and timestamp boundary behavior is covered.

## Validation

`npm test`: 749 tests passed, including module URL consistency, R2 ownership and cleanup, partial object deletion, missing media, anonymous payload limits, sanitized startup failure, and replay rejection across two server instances using separate SQLite connections.

The migration ran twice successfully on Neon branch `audit-workflow-nonces-20260907` (`br-jolly-resonance-azh0c384`), cloned with data and schema from production `main`. Eight simultaneous nonce claims produced exactly one acceptance; duplicate and expiry-boundary checks passed using the real Postgres adapter. The same migration was then applied successfully to production through its direct connection. The test branch uses Neon's default one-day expiry (September 8, 2026, 20:59 Asia/Bangkok). Local browser checks use test configuration and do not publish Meta ads or delete live R2 objects.

## Required deployment sequence

1. Sign into Neon and create an isolated branch of the existing production project.
2. Supply that branch's direct connection URL as `DATABASE_URL_UNPOOLED`, then run `node scripts/migrate-workflow-nonces.js`. Verify repeated migration is safe and concurrent claims allow only one acceptance for a nonce.
3. Apply the same migration using the production direct URL. It only creates `workflow_request_nonces` and its expiry index if absent.
4. Deploy with `vercel deploy --prod --yes --scope ducndna-5064s-projects`, then explicitly point `creative-campaign-lgclinic.vercel.app` at the new deployment using the same scope, per `docs/production-domain.md`.
5. Verify health, session behavior, static cache headers and the public domain's delivered JavaScript.

Do not deploy the nonce-dependent workflow code before applying the migration. The branch test and production migration prerequisites have been completed.

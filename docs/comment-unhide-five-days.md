# One-time comment unhide after five days

Status: implemented locally, activation requires database access and Meta permission verification.

- Opt-in scope: `COMMENT_UNHIDE_OWNER_ID` (Meta user ID) and `COMMENT_UNHIDE_ENABLED_AT` (ISO timestamp). Absent values disable processing.
- Only new tool runs after activation are discovered; reused older posts are excluded using Meta `created_time`.
- Cloudflare cron calls the HMAC-signed internal endpoint every minute. Jobs are unique per owner/post, with an atomic lease and persisted pagination.
- Due time is Meta post creation + 120 hours. One pass includes comments/replies created by the start of that pass. No recurring re-unhide after completion.
- Ten comments per request batch; queues/network/Meta limits can delay completion. Six failed attempts stop in `needs_review`. Restricted comments finish as `completed_with_errors`.
- Facebook Page auto-moderation rules are unchanged and may hide comments again.

## Activation

1. Resolve Neon quota error and verify production DB connectivity.
2. Run `node --env-file=.env.production.local scripts/migrate-comment-unhide.js` against the verified production database (additive table/index only).
3. Verify the opted-in owner's Page token can read comment visibility and manage comments. No existing comments should be unhidden merely for testing.
4. Set the two opt-in production variables, choosing an activation time at deployment.
5. Deploy application server first (new signed endpoint), then Cloudflare (cron).
6. Call the signed tick once and verify job discovery/read-only scheduling; no new post is due immediately.

## Operations

Inspect `comment_unhide_jobs` statuses, state counters, next_at, attempts and last_error. Error messages and tokens are not stored in logs. Disable by removing COMMENT_UNHIDE_OWNER_ID and redeploying. Existing completed jobs are never selected again.

# Seeding deadline and late campaign cleanup — 2026-10-19

## Approved scope

Journeys derived from the reported production failures and approved in chat:

1. A worker must not start a Facebook comment with only milliseconds left in its tick.
2. A successfully completed campaign must leave the draft even when seeding takes longer than three minutes.
3. Ambiguous comment results must remain `needs_review`; no automatic replay or removal of failed/review campaigns.

## RED → GREEN evidence

| Guarantee | Tests and observed RED | GREEN |
| --- | --- | --- |
| Require a full write timeout plus a finalization reserve before claiming and again after preparation | `node --test test/seeding-service.test.js`: 48 passed, 12 failed, including aggregate failures; near-deadline jobs were claimed/dispatched | Final service suite: 61 passed, zero failed |
| Archive after authoritative refresh, live success, and successful runner stop; monitor beyond three minutes | `node --test test/completed-campaign-cleanup.test.js`: 1 passed, 4 failed; draft retained completed campaigns and monitor stopped after three polls | Final cleanup suite: 7 passed, zero failed |
| Preserve mixed failed/review/pending/posting campaigns, replacement drafts, historical snapshots, and new runs during stale responses | Runtime callback tests use the actual callback/function bodies from `public/app.js`, with real state/progress/archive modules and stubbed DOM/API | Included in the 7 passing cleanup tests; repeated archival is idempotent and hidden-tab polling remains bounded |

The service now reserves `timeoutMs + 1,000 ms` before work and after read-only preparation. It never shortens a submitted write's timeout to the tick's remaining milliseconds. Preparation that consumes the budget defers the claimed job before submission. Real timeout/network ambiguity still becomes `needs_review`.

The UI archives only `completed` campaigns at 100%, using the existing archival policy. Background monitoring uses the existing one-hour recovery bound, pauses reads in hidden tabs, and is tied to the current run. Ordinary updates remain incremental; full rendering/persistence occurs only after actual removal.

## Verification

- `npm.cmd run build`: passed.
- `npm.cmd test`: 1,011 tests, 1,010 passed, zero failed, one existing PostgreSQL-environment-dependent skip.
- `node --test --experimental-test-coverage --test-coverage-include='src/seeding-service.js' test/seeding-service.test.js test/completed-campaign-cleanup.test.js`: 68 passed, zero failed; service coverage 95.85% lines, 86.90% branches, 95.83% functions.
- `node --check public/app.js`, `node --check src/seeding-service.js`, and `git diff --check`: passed. No separate TypeScript or lint script is configured.
- Independent ECC code and security reviews: no blocking findings.
- No credentials, payload logging, permission changes, or new automatic comment retries introduced.

## Deployment evidence

Applied only the task's two production-file diffs, preserving unrelated differences between the deployed frontend and local HEAD. A dry-run patch check passed first. Backups:

`/home/campaignadmin/seeding-fix-backup-20261019T110330969Z/`

Deployed SHA-256:

- `public/app.js`: `e196c9ae4aa9bfddce8068506adde14b46a114712ca63349452f172be594ed1c`
- `src/seeding-service.js`: `b782323b024a89fbb2f72c89439fc8929aa06338b8c71eca133a20d098f78afd`

Waited for `active_runs=0` before restarting the application service. The service returned healthy with new PID `210498`. Public asset verification confirmed the new cleanup helper and extended monitor; `/api/health` returned HTTP 200 and `ok: true`.

## Limits and follow-up

- No live comment was submitted or replayed for testing. Existing uncertain comments need Facebook-side verification before retry.
- Browser callback tests are deterministic VM integration tests, not a physical MacBook/browser E2E run. Their dynamically evaluated app source is not included in Node's per-file coverage totals.
- A prolonged database outage can still require manual reconciliation after a successful Facebook write; the reserve is not a transaction guarantee.
- Browser/CDN caching may require a hard refresh to receive the updated frontend.
- No checkpoint or final commits were created: the encompassing ECC workflow requires a separate pre-commit confirmation. RED/GREEN evidence is preserved here instead.

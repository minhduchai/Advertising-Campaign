# Fault simulation audit - 2026-09-28

Scope: local automated tests with fake Meta responses and fake persistence.
No live Meta writes, production changes, or deployment were performed.
This is a bounded fault audit, not a guarantee against every possible failure.

## Reproduced and fixed

- Interrupted Ad recovery: absent/ambiguous/failed lookup must not trigger a new
  Ad write. Missing run start metadata requires manual confirmation as well.
  Preserve the interrupted marker across a quota retry.
- DB failure after a successful Meta write: latch the persistence failure in
  the shared publisher report function. Do not overwrite a successful remote
  result with a retryable failed node. Stop subsequent reports/new work; already
  in-flight operations cannot be undone.
- Successful HTTP response without an Ad ID: classify as UncertainAdWriteError,
  with no automatic repeated write.
- Network diagnostics: persist an allowlisted connection error code and a
  reconciliation outcome, not raw errors, URLs, or credentials.

Tests: test/publisher-resilience.test.js, test/publisher.test.js,
test/meta-network-retry.test.js. New failure assertions were run before fixing
the interrupted recovery, DB persistence, and missing ID cases.

## Existing fault coverage rerun

| Area | Simulated cases | Test source |
| --- | --- | --- |
| Network | DNS/connect failure, reset, socket and header timeout; bounded retry | meta-network-retry.test.js |
| Publish | Quota, deadline, creative transient retry, video failure, shared media | publisher.test.js, publisher-resilience.test.js |
| Manual recovery | Missing confirmation, wrong account/ad set/name/creative, busy lease, stale node | publish-routes.test.js |
| Seeding | Missing permission, wrong Page, untrusted media, lost response, timeout, DB finish failure | seeding-service.test.js |
| Client | Broken stream, runtime failure, cache expiration/invalidation | client-api.test.js |

Paths in the table are relative to test/.

## Remaining limits / follow-up

- Campaign/ad-set interrupted-object adoption still uses the older fallback
  policy. Extending manual confirmation to those parent objects needs a separate
  end-to-end UI and API change; this audit changes the Ad recovery policy only.
- A persistence outage can still leave a run requiring manual investigation.
  Preventing a duplicate is not the same as automatically recovering its ID.
- Workflow dispatch acknowledgement loss and process-kill recovery need further
  fault injection; these are not certified by the new tests.
- No browser E2E, actual service termination, live quota exhaustion, or storage
  outage was induced. Provider policy/permission failures cannot be fixed by
  retries; they need actionable error handling or account changes.

# Meta Activity History Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a permanent, date-filterable, read-only history of Meta publication runs with Ad names and Reel permalinks.

**Architecture:** Extend the existing run persistence model with immutable report snapshots and permalink fields. Reuse the current owner-scoped run detail endpoint, add a paginated list endpoint, and render history in an independent client drawer. Resolve Meta permalinks after Ad creation as non-fatal reporting metadata.

**Tech Stack:** Node.js, SQLite, Neon Postgres, Meta Graph API, browser ES modules, Node test runner.

## Global Constraints

- Store reports indefinitely.
- Keep legacy runs visible and explicitly incomplete.
- Never expose Meta tokens or private media storage data.
- Never turn a successful Ad into a failure because permalink lookup failed.
- Do not create real Meta objects during verification.

---

### Task 1: Persist Historical Reports

**Files:**
- Modify: `src/db.js`
- Modify: `src/postgres-schema.js`
- Modify: `src/postgres-db.js`
- Modify: `test/database-contract.js`
- Test: `test/db.test.js`
- Test: `test/postgres-db.test.js`

- [ ] Add failing database tests for snapshots, node metadata, legacy rows, date filtering, owner isolation, and pagination.
- [ ] Run focused database tests and confirm the new assertions fail.
- [ ] Add nullable schema columns and safe migrations for existing databases.
- [ ] Implement `listRuns(ownerMetaUserId, options)` and enrich `createRun`, `updateRunStatus`, `updateNodeResult`, and `getRun`.
- [ ] Run focused database tests and confirm they pass.

### Task 2: Capture Names and Reel Links

**Files:**
- Modify: `src/meta-client.js`
- Modify: `src/publisher.js`
- Modify: `src/request-handler.js`
- Test: `test/meta-client.test.js`
- Test: `test/publisher.test.js`
- Test: `test/publish-routes.test.js`

- [ ] Add failing tests for Meta permalink lookup, node names, snapshot creation, shared links, and non-fatal lookup failures.
- [ ] Run focused publishing tests and confirm the new assertions fail.
- [ ] Add Meta story/permalink lookup and carry report metadata through publisher node updates.
- [ ] Persist a sanitized immutable snapshot when a run starts.
- [ ] Run focused publishing tests and confirm they pass.

### Task 3: Expose History APIs

**Files:**
- Modify: `src/request-handler.js`
- Modify: `public/api.js`
- Test: `test/publish-routes.test.js`
- Test: `test/api-client.test.js`

- [ ] Add failing tests for authenticated listing, validated filters, pagination, owner isolation, and client query encoding.
- [ ] Run focused route/client tests and confirm the new assertions fail.
- [ ] Implement `GET /api/runs` and extend owner-scoped run detail responses.
- [ ] Add `listRuns` to the browser API client.
- [ ] Run focused route/client tests and confirm they pass.

### Task 4: Render Activity History

**Files:**
- Create: `public/activity-history.js`
- Modify: `public/index.html`
- Modify: `public/state.js`
- Modify: `public/app.js`
- Modify: `public/app.css`
- Modify: `src/request-handler.js`
- Test: `test/activity-history.test.js`
- Test: `test/http.test.js`

- [ ] Add failing render/state/interaction tests for filters, summaries, detail hierarchy, Reel links, legacy labels, and load-more behavior.
- [ ] Run focused UI tests and confirm the new assertions fail.
- [ ] Implement the independent history drawer and its state transitions.
- [ ] Register the new browser module and responsive styles.
- [ ] Run focused UI tests and confirm they pass.

### Task 5: Verify and Deploy

**Files:**
- Verify only.

- [ ] Run all focused history and publication tests.
- [ ] Run the production build.
- [ ] Run the full test suite and report unrelated baseline failures separately.
- [ ] Deploy to Vercel production.
- [ ] Verify deployment readiness and `/health` without publishing Meta objects.


# Realtime Post ID Seeding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Start seeding each Post ID as soon as it becomes available during an active Meta publication run.

**Architecture:** Reuse the existing idempotent seeding preparation loop. Start that loop on the first `run_started` stream event instead of waiting for terminal publication, and keep terminal completion limited to final state synchronization.

**Tech Stack:** Browser JavaScript, NDJSON publish events, Node test runner.

## Global Constraints

- Keep one seeding loop per `runId`.
- Do not duplicate jobs or comments for shared Post IDs.
- Preserve the existing 3–5 second sequential comment delay.
- Do not resend a Meta publication run during recovery.

---

### Task 1: Start realtime seeding from publish events

**Files:**
- Modify: `public/app.js`
- Test: `test/publish-progress-interactions.test.js`

**Interfaces:**
- Consumes: publish stream event `{ type: 'run_started', runId: string }`
- Produces: one `seedingRunner.resume(runId)` call while publication continues

- [ ] Add a failing source-contract test for starting seeding on `run_started`.
- [ ] Run `node --test test/publish-progress-interactions.test.js` and confirm failure.
- [ ] Add a helper that starts the runner only when `event.runId` exists.
- [ ] Remove the redundant terminal-only resume call.
- [ ] Run the focused test and confirm success.

### Task 2: Verify incremental queue behavior

**Files:**
- Test: `test/seeding-runner.test.js`

**Interfaces:**
- Consumes: repeated `prepareRunSeeding(runId)` responses with waiting posts and later pending jobs
- Produces: processing order where the first available Post ID is handled before later Post IDs

- [ ] Add a runner test whose first prepare response exposes Post A while Post B waits.
- [ ] Make a later prepare response expose Post B.
- [ ] Assert Post A is processed before Post B and both finish in one loop.
- [ ] Run `node --test test/seeding-runner.test.js`.

### Task 3: Regression and production deployment

**Files:**
- Verify only

**Interfaces:**
- Consumes: completed Tasks 1–2
- Produces: tested production deployment

- [ ] Run `npm test`.
- [ ] Deploy with `npx vercel deploy --prod --yes --scope ducndna-5064s-projects --project creative-campaign-lgclinic`.
- [ ] Confirm the production alias is ready.

# Shared Ad Creative Duplication Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Ad Set and Ad duplication actions that preserve one shared Meta creative/Post ID until creative content changes.

**Architecture:** Client state assigns every Ad a stable `creativeGroupId`; duplicate helpers deep-copy nodes while preserving that group. Creative-defining edits detach only the affected Ad, while the server publisher uses a per-run cache keyed by group plus a defensive content signature to create one creative and reuse it across multiple Meta Ads.

**Tech Stack:** Browser ES modules, Node.js 24, native `node:test`, Meta Marketing API client, esbuild, Vercel.

## Global Constraints

- Keep existing Campaign add/delete/collapse behavior unchanged.
- Duplicate Ad Sets include every child Ad and create new local `clientId` values.
- Duplicate Ads initially preserve the source `creativeGroupId`.
- Creative edits and Page changes detach; targeting, budget, schedule, and internal names do not.
- Never send `creativeGroupId` to Meta.
- Continue creating all Meta Campaign, Ad Set, and Ad objects as `PAUSED`.
- Do not create real Meta objects during automated or browser verification.
- This workspace is not a Git repository, so commit steps are intentionally omitted.

---

### Task 1: Creative Groups and Deep Duplication

**Files:**
- Modify: `public/state.js:1-270`
- Test: `test/client-state.test.js`

**Interfaces:**
- Produces: `duplicateAdSet(state, sourceAdSetId, randomId) -> AdSet | null`
- Produces: `duplicateAd(state, sourceAdId, randomId) -> Ad | null`
- Produces: `detachAdCreative(ad, randomId) -> string`
- Produces: `sharedCreativeCount(state, adId) -> number`
- Extends: every new Ad has `creativeGroupId: clientId`

- [ ] **Step 1: Write failing state tests**

Add tests proving:

```js
const copy = duplicateAd(state, 'ad-1', idSequence('ad-2'));
assert.equal(copy.clientId, 'ad-2');
assert.equal(copy.creativeGroupId, 'ad-1');
assert.notEqual(copy.conversation, source.conversation);
assert.deepEqual(state.selection, { clientId: 'ad-2', type: 'ad' });
```

Also cover deep Ad Set duplication, sibling insertion, copy-name numbering, source deletion safety, Page detachment, creative-field detachment, and non-detaching name/budget updates.

- [ ] **Step 2: Run focused tests and verify RED**

Run: `node --test test/client-state.test.js`

Expected: FAIL because duplication/detachment exports and `creativeGroupId` do not exist.

- [ ] **Step 3: Implement minimal state behavior**

Use the existing `clientId` as the initial creative group to avoid consuming extra IDs:

```js
export function createAd(randomId = defaultRandomId) {
  const clientId = randomId();
  return { clientId, creativeGroupId: clientId, /* existing fields */ };
}
```

Deep-copy nodes with `structuredClone`, replace local IDs, preserve source creative groups, insert immediately after the source, select the copy, expand the parent Campaign, and close the open menu. Add a copy-name helper that produces ` - Bản sao`, ` - Bản sao 2`, and later suffixes without mutating source names.

Extend `updateNodeField(state, clientId, field, value, randomId)` so changed Ad fields in `primaryText`, `headline`, `mediaId`, and `publicationMode` detach before assignment. A changed Ad Set `pageId` detaches every child Ad. No-op assignments must not detach.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run: `node --test test/client-state.test.js`

Expected: PASS with all state tests green.

---

### Task 2: Duplicate Menus, Detachment Routing, and Shared Badge

**Files:**
- Modify: `public/workspace.js:89-150`
- Modify: `public/workspace.js` Ad editor section
- Modify: `public/app.js:1-360`
- Modify: `public/app.js:620-893`
- Modify: `public/app.css`
- Test: `test/workspace.test.js`
- Test: `test/tree-interactions.test.js`

**Interfaces:**
- Consumes: `duplicateAdSet`, `duplicateAd`, `detachAdCreative`, `sharedCreativeCount`
- Produces actions: `duplicate-adset` and `duplicate-ad`

- [ ] **Step 1: Write failing render and routing tests**

Assert that Ad Set and Ad menus render exact actions with the source node ID:

```js
assert.match(adSetHtml, /data-action="duplicate-adset"[^>]*data-client-id="adset-1"/);
assert.match(adHtml, /data-action="duplicate-ad"[^>]*data-client-id="ad-1"/);
assert.match(sharedAdHtml, /Đang dùng chung bài quảng cáo với 2 quảng cáo/);
```

Add source tests proving app actions call the duplicate helpers, close menus, render, focus the copied row, and validate. Add assertions that conversation mutation paths invoke detachment.

- [ ] **Step 2: Run focused tests and verify RED**

Run: `node --test test/workspace.test.js test/tree-interactions.test.js`

Expected: FAIL because the duplicate menu actions, badge, and routing are absent.

- [ ] **Step 3: Render and route duplicate actions**

Keep existing add/delete items and insert the new similar actions before delete. Route actions by the clicked source `clientId`:

```js
if (action === 'duplicate-adset') {
  const copy = duplicateAdSet(state, clientId);
  closeNodeMenu(state);
  render();
  if (!copy) return;
  focusNodeMain(copy.clientId);
  await validateCurrentDraft();
  return;
}
```

Apply the equivalent flow to Ads. Do not apply default Page or conversation templates to copies because they already contain complete snapshots.

- [ ] **Step 4: Detach every creative mutation path**

Call `detachAdCreative` before actual changes to conversation JSON, form fields, quick replies, customer actions, template application, and media upload. Reuse a small app helper so each path does not duplicate group logic. Let `updateNodeField` handle primary text, headline, publication mode, and Page changes.

Render the shared badge only when `sharedCreativeCount(state, ad.clientId) > 1`; include the linked count in text and add restrained badge styling with existing colors and focus-safe layout.

- [ ] **Step 5: Run focused tests and verify GREEN**

Run: `node --test test/workspace.test.js test/tree-interactions.test.js test/client-state.test.js`

Expected: PASS.

---

### Task 3: Per-Run Shared Creative Publisher Cache

**Files:**
- Modify: `src/publisher.js:10-177`
- Test: `test/publisher.test.js`

**Interfaces:**
- Consumes: `ad.creativeGroupId`, Page ID, media ID, visible creative fields, and conversation snapshot
- Produces: one cached `{ creativeId, sourceAdId?, postId?, pageAccessToken?, successfulAds }` artifact per compatible group

- [ ] **Step 1: Write failing publisher reuse tests**

Create a draft with four Ad Sets whose Ads share `creativeGroupId: 'shared-1'`. Record calls and assert:

```js
assert.equal(calls.filter(({ type }) => type === 'image').length, 1);
assert.equal(calls.filter(({ type }) => type === 'creative').length, 1);
assert.equal(calls.filter(({ type }) => type === 'ad').length, 4);
```

Add tests proving different Page/content signatures create separate creatives, an individual Ad creation failure does not block later linked Ads, and a rejected shared creative is attempted once but reported against every linked Ad.

Add Public Test coverage proving one public post/creative is reused and cleanup occurs only when no linked Ad succeeds.

- [ ] **Step 2: Run publisher tests and verify RED**

Run: `node --test test/publisher.test.js`

Expected: FAIL because current publishing uploads media and creates a creative once per Ad.

- [ ] **Step 3: Introduce the artifact cache**

Create the cache once inside `publishDraft` and pass it into Ad publishing. Build a deterministic key from explicit visible fields rather than arbitrary object order:

```js
function creativeArtifactKey(accountId, pageId, ad) {
  return JSON.stringify({
    accountId,
    groupId: ad.creativeGroupId || ad.clientId,
    pageId,
    publicationMode: ad.publicationMode || 'DARK',
    mediaId: ad.mediaId,
    primaryText: ad.primaryText,
    headline: ad.headline,
    conversation: visibleConversationSignature(ad.conversation)
  });
}
```

Cache the creation promise immediately so sequential or future concurrent callers share successes and failures. The artifact creator loads media, uploads it, and creates the creative exactly once. The first successful Ad becomes the source; later compatible Ads call Meta's Ad copy edge with their target Ad Set and remain paused. Never fall back to a fresh Ad creation when copying fails because that would create a separate effective post.

- [ ] **Step 4: Preserve Public Test cleanup semantics**

Track successful Meta Ad count on each public artifact. After all hierarchy attempts, delete a public post only when its artifact exists and `successfulAds === 0`. Append cleanup errors to all affected failed Ad results without deleting a post used by any successful Ad.

- [ ] **Step 5: Run publisher tests and verify GREEN**

Run: `node --test test/publisher.test.js test/publish-routes.test.js`

Expected: PASS.

---

### Task 4: Full Regression, Build, Production Deploy, and Smoke Check

**Files:**
- Verify all modified files
- Update plan checkboxes in this document

**Interfaces:**
- Consumes: completed client and publisher behavior
- Produces: deployed production bundle with no real Meta publish calls during verification

- [ ] **Step 1: Run syntax checks**

Run:

```powershell
node --check public/state.js
node --check public/workspace.js
node --check public/app.js
node --check src/publisher.js
```

Expected: every command exits `0`.

- [ ] **Step 2: Run the complete test suite**

Run: `npm test`

Expected: all tests pass with zero failures. If an unrelated pre-existing failure appears, isolate and report it without altering unrelated behavior.

- [ ] **Step 3: Build the production client**

Run: `npm run build`

Expected: esbuild exits `0` and refreshes the production bundle.

- [ ] **Step 4: Deploy with the authenticated pinned CLI**

Run: `npx --yes vercel@58.9.0 --prod --yes`

Expected: deployment reaches `Ready` and aliases `https://creative-campaign-lgclinic.vercel.app`.

- [ ] **Step 5: Verify production without Meta writes**

Check `/health`, confirm the served bundle contains `duplicate-adset`, `duplicate-ad`, and `creativeGroupId`, then use the in-app browser only for local hierarchy duplication. Verify the copied Ad Set contains copied Ads, the shared badge count changes, editing primary text detaches the selected copy, and no publish button is pressed.

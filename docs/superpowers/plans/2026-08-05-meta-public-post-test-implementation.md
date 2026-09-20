# Meta Public Post Test Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an explicit image-only Public Test mode that publishes a Page photo post, attaches the Messenger welcome message to an Ad Creative, and creates the Ad as `PAUSED` while the Meta App is unpublished.

**Architecture:** Keep the existing dark-post path unchanged. Public Test preflights OAuth/Page publishing access before any Campaign write, publishes the selected image with a Page token, creates a Creative from `object_story_id`, and deletes the Page post if Creative or Ad creation fails.

**Tech Stack:** Node.js 24, native `fetch`/`FormData`, `node:sqlite`, browser ES modules, Meta Graph API v24.0.

## Global Constraints

- Public Test is selected per Ad and defaults to `DARK`.
- Public Test supports images only in this iteration.
- Public Page posts are intentional external side effects and remain published only after a successful Ad creation.
- Campaign, Ad Set, and Ad remain `PAUSED`.
- Add no dependencies.
- Do not run the full test suite per user request; run JavaScript syntax checks and the local health check only.
- This workspace has no Git repository, so no commit steps are possible.

---

### Task 1: Add Public Test draft state and UI

**Files:**
- Modify: `public/state.js:24`
- Modify: `public/workspace.js:310`
- Modify: `public/workspace.js:680`
- Modify: `public/app.css:714`
- Modify: `src/draft.js:10`

**Interfaces:**
- Produces: `ad.publicationMode: "DARK" | "PUBLIC_TEST"`.
- Produces: `buildPublicPostCreativeParams(postId, ad): URLSearchParams` for Task 3.
- Consumes: existing generic `data-field` change handling in `public/app.js`.

- [ ] **Step 1: Add the draft field**

Add `publicationMode: 'DARK'` to `createAd()` so existing behavior remains safe by default.

- [ ] **Step 2: Render the publication choices**

Use the existing `choiceCard()` helper in the Ad editor:

```js
choiceCard({
  name: `publication-${ad.clientId}`,
  clientId: ad.clientId,
  field: 'publicationMode',
  value: 'PUBLIC_TEST',
  checked: ad.publicationMode === 'PUBLIC_TEST',
  title: 'Bài công khai để thử App Dev',
  description: 'Đăng ảnh thật lên Facebook Page trước khi tạo quảng cáo.'
})
```

Show a warning when Public Test is selected: the post is public, image-only, and may require reconnecting Meta.

- [ ] **Step 3: Validate the mode client/server-side**

In `validateDraft()`:

```js
const publicationMode = ad.publicationMode ?? 'DARK';
if (!['DARK', 'PUBLIC_TEST'].includes(publicationMode)) {
  issues.push(issue(`${adPath}.publicationMode`, 'Chọn chế độ bài viết hợp lệ'));
}
if (publicationMode === 'PUBLIC_TEST' && ad.mediaKind === 'video') {
  issues.push(issue(`${adPath}.mediaId`, 'Public Test hiện chỉ hỗ trợ ảnh; video cần Meta App Live'));
}
```

- [ ] **Step 4: Build Creative params for an existing public post**

Export:

```js
export function buildPublicPostCreativeParams(postId, ad) {
  return createParams({
    name: ad.name,
    object_story_id: postId,
    call_to_action_type: 'MESSAGE_PAGE',
    page_welcome_message: buildPageWelcomeMessage(ad.conversation, 'image')
  });
}
```

- [ ] **Step 5: Show Page post IDs in results**

Extend `renderResultNode()` with:

```js
${node.postId ? `<small>ID bài viết công khai: ${escapeHtml(node.postId)}</small>` : ''}
```

Add only focused warning/result styling; reuse current cards and color variables.

- [ ] **Step 6: Syntax-check the browser and draft modules**

Run:

```powershell
node --check public/state.js
node --check public/workspace.js
node --check src/draft.js
```

Expected: all commands exit `0`.

---

### Task 2: Add Meta publishing access and Page post APIs

**Files:**
- Modify: `src/meta-client.js:3`
- Modify: `src/server.js:490`

**Interfaces:**
- Produces: `metaClient.getPagePublishingContext(userToken, pageIds)` returning `{ permissionGranted, pages: Map<string, { accessToken, tasks, name }> }`.
- Produces: `metaClient.createPublicPhotoPost(pageToken, pageId, media, message)` returning `{ postId, photoId }`.
- Produces: `metaClient.deletePagePost(pageToken, postId)` returning `boolean`.
- Produces: `pagePublishingContexts: Map<string, { accessToken, tasks, name }>` passed to `publishDraft()`.

- [ ] **Step 1: Request the publishing permission**

Add `pages_manage_posts` to the OAuth `scopes` array. Existing tokens require **Kết nối lại Meta**.

- [ ] **Step 2: Load granted permissions and Page tokens**

Implement `getPagePublishingContext()` by requesting:

```text
/me/permissions?fields=permission,status
/me/accounts?fields=id,name,tasks,access_token&limit=100
```

Never return Page tokens to the browser; the method is server-only.

- [ ] **Step 3: Add public photo creation**

POST multipart data to `/{page_id}/photos` with:

```js
formData.set('source', new Blob([media.content], { type: media.mimeType }), media.name);
formData.set('caption', message);
formData.set('published', 'true');
```

Use `payload.post_id` when present. Otherwise read `/{photo_id}?fields=page_story_id` and require a non-empty `page_story_id`.

- [ ] **Step 4: Add Page post deletion**

Send `DELETE /{post_id}` with the Page token and accept `success === true`.

- [ ] **Step 5: Preflight every Public Test Ad**

Before `db.createRun()`:

1. Collect distinct Page IDs from Ads where `publicationMode === 'PUBLIC_TEST'`.
2. Verify actual stored media MIME starts with `image/`.
3. Verify `pages_manage_posts` is granted.
4. Verify each Page exists in `/me/accounts`, has an access token, and contains task `CREATE_CONTENT`.
5. Return path-specific `400`/`403` issues before any Campaign write if a check fails.

- [ ] **Step 6: Pass publishing contexts to the publisher**

Call:

```js
publishDraft({
  ...existing,
  pagePublishingContexts
});
```

- [ ] **Step 7: Syntax-check Meta and server modules**

Run:

```powershell
node --check src/meta-client.js
node --check src/server.js
```

Expected: both commands exit `0`.

---

### Task 3: Publish, clean up, and persist Public Test results

**Files:**
- Modify: `src/publisher.js:9`
- Modify: `src/db.js:5`

**Interfaces:**
- Consumes: `buildPublicPostCreativeParams(postId, ad)` from Task 1.
- Consumes: Page publishing methods and `pagePublishingContexts` from Task 2.
- Produces: Ad result nodes with optional `postId`.

- [ ] **Step 1: Migrate the result table**

After creating tables, inspect `PRAGMA table_info(node_results)`. If `post_id` is absent, run:

```sql
ALTER TABLE node_results ADD COLUMN post_id TEXT;
```

Update result insert/update/select mapping to persist `node.postId`.

- [ ] **Step 2: Branch the Ad publishing flow**

For `PUBLIC_TEST`:

1. Resolve the Page publishing context.
2. Create the public photo post from the stored media.
3. Create the Creative with `buildPublicPostCreativeParams()`.
4. Create the `PAUSED` Ad with existing `buildAdParams()`.
5. Report `{ status: 'created', remoteId, postId }`.

For `DARK`, retain the existing image/video behavior unchanged.

- [ ] **Step 3: Clean up failed public posts**

Track the created `postId`. If Creative or Ad creation fails:

```js
try {
  await metaClient.deletePagePost(pageAccessToken, postId);
} catch (cleanupError) {
  normalizedError.message += ` | Không xóa được bài công khai ${postId}: ${cleanupMessage}`;
  failedNode.postId = postId;
}
```

If cleanup succeeds, omit `postId` from the failed result because the post no longer exists.

- [ ] **Step 4: Preserve exact Meta diagnostics**

Keep `code`, `subcode`, and `fbtraceId` from `normalizeError()`. Append cleanup diagnostics without replacing the original Meta message.

- [ ] **Step 5: Syntax-check publishing and database modules**

Run:

```powershell
node --check src/publisher.js
node --check src/db.js
```

Expected: both commands exit `0`.

---

### Task 4: Document, restart, and hand off Duck Tool testing

**Files:**
- Modify: `README.md:40`
- Modify: `docs/superpowers/specs/2026-08-05-meta-public-post-test-design.md:1` only if implementation constraints differ from the approved design.

**Interfaces:**
- Consumes: completed Public Test flow from Tasks 1-3.
- Produces: running local app at `http://localhost:3001/` and manual Duck Tool test instructions.

- [ ] **Step 1: Update README permissions and behavior**

Document `pages_manage_posts`, reconnect requirement, image-only limitation, public Page side effect, cleanup behavior, and App Live recommendation.

- [ ] **Step 2: Run all requested lightweight checks**

Run `node --check` for every changed JavaScript file. Do not run `npm test`.

- [ ] **Step 3: Restart local server**

Stop the existing process listening on port `3001`, start:

```powershell
node --env-file=.env src/server.js
```

with hidden-window/background logging consistent with the current workspace.

- [ ] **Step 4: Verify health**

Request:

```text
http://localhost:3001/api/health
```

Expected response: `{ "ok": true }`.

- [ ] **Step 5: Hand off the Duck Tool test**

Tell the user to:

1. Click **Kết nối lại Meta** and grant `pages_manage_posts`.
2. Select Page **Duck Tool**.
3. Upload an image.
4. Select **Bài công khai để thử App Dev**.
5. Create the Ad and verify both `ID Meta` and `ID bài viết công khai` in the log.

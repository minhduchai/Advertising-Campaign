# Media Upload Progress and Preview Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add real upload percentages, image thumbnails, playable MP4 previews, and reliable success/failure feedback to each Ad media uploader.

**Architecture:** Keep transport progress inside `public/api.js` and the Vercel Blob entry, keep upload lifecycle state keyed by Ad client ID, and keep media rendering inside `public/workspace.js`. Progress callbacks update only the active uploader DOM while start, success, and failure transitions use the existing scroll-preserving workspace render.

**Tech Stack:** Browser ES modules, Node test runner, XMLHttpRequest upload events, Vercel Blob client `onUploadProgress`, HTML5 image/video/progress semantics, CSS.

## Global Constraints

- Preserve the existing 200 MB limit and accepted JPEG, PNG, WebP, and MP4 types.
- Display real transport progress; do not simulate percentages.
- Render MP4 with playable native controls.
- Do not let the file input cover video controls.
- Preserve previous media when a replacement upload fails.
- Detach shared creative content only after upload success.
- Do not create or publish Meta objects during verification.
- This workspace is not a Git repository; replace commit steps with verified checkpoints.

---

### Task 1: Upload Progress Transport

**Files:**
- Modify: `public/api.js`
- Modify: `src/client/blob-upload-entry.js`
- Test: `test/client-api.test.js`

**Interfaces:**
- Consumes: `api.uploadMedia(file, options)` and Vercel Blob `upload()`.
- Produces: `uploadMedia(file, { mode, uploadImpl, onProgress, xhrFactory })`, where `onProgress({ loaded, total, percentage })` receives real transport events.

- [ ] **Step 1: Write failing local progress test**

Add a fake XHR implementation to `test/client-api.test.js` and assert that local upload progress is forwarded without manually setting a multipart content type:

```js
test('reports real local upload progress through XMLHttpRequest', async () => {
  const progress = [];
  const xhr = createUploadXhr({
    status: 201,
    response: { mediaId: 'media-1', kind: 'image' },
    progress: [{ loaded: 5, total: 10 }, { loaded: 10, total: 10 }]
  });
  const api = createApiClient();
  const file = new File(['image'], 'image.jpg', { type: 'image/jpeg' });

  const result = await api.uploadMedia(file, {
    mode: 'local',
    xhrFactory: () => xhr,
    onProgress: (event) => progress.push(event.percentage)
  });

  assert.deepEqual(progress, [50, 100]);
  assert.equal(xhr.requestHeaders['content-type'], undefined);
  assert.equal(result.mediaId, 'media-1');
});
```

- [ ] **Step 2: Write failing Blob progress forwarding test**

Extend the existing Blob upload test:

```js
const onProgress = () => undefined;
await api.uploadMedia(file, { mode: 'vercel-blob', uploadImpl, onProgress });
assert.equal(uploadImpl.calls[0].options.onProgress, onProgress);
```

Also assert `src/client/blob-upload-entry.js` forwards `options.onProgress` as `onUploadProgress`.

- [ ] **Step 3: Run transport tests red**

Run: `node --test test/client-api.test.js`

Expected: the local progress test fails because local mode still uses fetch, and the Blob option assertion fails because no progress callback is forwarded.

- [ ] **Step 4: Implement local XHR transport**

In `public/api.js`, retain the fetch/FormData path when no progress callback is provided. When `onProgress` exists, send the same FormData with an XHR created by `xhrFactory ?? (() => new XMLHttpRequest())`, listen to `xhr.upload` progress events, normalize the percentage, parse JSON, and reject with the same server message precedence used by `json()`.

```js
async function uploadLocalMedia(file, { onProgress, xhrFactory }) {
  const formData = new FormData();
  formData.set('file', file);
  return new Promise((resolve, reject) => {
    const xhr = (xhrFactory ?? (() => new XMLHttpRequest()))();
    xhr.open('POST', '/api/media');
    xhr.responseType = 'json';
    xhr.upload.addEventListener('progress', ({ loaded, total, lengthComputable }) => {
      if (!lengthComputable || total <= 0) return;
      onProgress(progressEvent(loaded, total));
    });
    xhr.addEventListener('load', () => settleUploadXhr(xhr, resolve, reject));
    xhr.addEventListener('error', () => reject(new Error('Không thể tải tệp lên')));
    xhr.send(formData);
  });
}
```

- [ ] **Step 5: Forward Vercel Blob progress**

Pass `onProgress` from `public/api.js` to the dynamically loaded client and map it in `src/client/blob-upload-entry.js`:

```js
return upload(pathname, file, {
  access: 'private',
  handleUploadUrl: '/api/media/blob-token',
  clientPayload: JSON.stringify(options.clientPayload),
  onUploadProgress: options.onProgress
});
```

- [ ] **Step 6: Run transport tests green**

Run: `node --test test/client-api.test.js`

Expected: all client API tests pass with local percentages `[50, 100]` and Blob callback identity preserved.

- [ ] **Step 7: Record verified checkpoint**

Record the passing test count. No commit is possible because `D:\Advertising-Campaign` has no `.git` directory.

---

### Task 2: Media State and Rendering

**Files:**
- Modify: `public/state.js`
- Modify: `public/workspace.js`
- Modify: `public/app.css`
- Test: `test/client-state.test.js`
- Test: `test/workspace.test.js`

**Interfaces:**
- Consumes: Ad media fields and `state.ui.mediaUploads[ad.clientId]`.
- Produces: stable `mediaFileName`, `mediaFileSize`, and accessible image/video/progress markup.

- [ ] **Step 1: Write failing state default test**

Extend the approved nested-default test:

```js
assert.equal(ad.mediaFileName, '');
assert.equal(ad.mediaFileSize, 0);
assert.deepEqual(state.ui.mediaUploads, {});
```

- [ ] **Step 2: Write failing renderer tests**

Add three cases to `test/workspace.test.js`:

```js
test('renders an uploaded image thumbnail and success metadata', () => {
  ad.mediaId = 'media-1';
  ad.mediaKind = 'image';
  ad.mediaPreviewUrl = 'blob:image';
  ad.mediaFileName = 'banner.webp';
  ad.mediaFileSize = 2048;
  const html = renderWorkspace(state);
  assert.match(html, /<img[^>]+blob:image/);
  assert.match(html, /Đã tải lên/);
  assert.match(html, /banner\.webp/);
  assert.match(html, /2 KB/);
});

test('renders a playable uploaded video without covering its controls', () => {
  ad.mediaId = 'media-2';
  ad.mediaKind = 'video';
  ad.mediaPreviewUrl = 'blob:video';
  const html = renderWorkspace(state);
  assert.match(html, /<video[^>]+controls[^>]+muted[^>]+playsinline/);
  assert.doesNotMatch(html, /media-file-input[^>]+inset:\s*0/);
});

test('renders upload percentage and disables replacement while uploading', () => {
  state.ui.mediaUploads[ad.clientId] = {
    status: 'uploading', progress: 42, previewUrl: 'blob:pending',
    kind: 'image', fileName: 'banner.jpg', fileSize: 4096
  };
  const html = renderWorkspace(state);
  assert.match(html, /role="progressbar"/);
  assert.match(html, /aria-valuenow="42"/);
  assert.match(html, />42%</);
  assert.match(html, /data-action="upload-media"[^>]+disabled/);
});
```

- [ ] **Step 3: Run rendering tests red**

Run: `node --test test/client-state.test.js test/workspace.test.js`

Expected: failures for missing media metadata, media upload state, video markup, and progress markup.

- [ ] **Step 4: Add state defaults**

Add `mediaFileName: ''` and `mediaFileSize: 0` to `createAd()`, and `mediaUploads: {}` to `createWorkspaceState().ui`.

- [ ] **Step 5: Replace media panel renderer**

Extract focused helpers in `public/workspace.js`:

```js
function mediaUploader(state, ad) {
  const upload = state.ui.mediaUploads?.[ad.clientId];
  const media = upload ?? {
    kind: ad.mediaKind,
    previewUrl: ad.mediaPreviewUrl,
    fileName: ad.mediaFileName,
    fileSize: ad.mediaFileSize
  };
  const inputId = `media-${ad.clientId}`;
  return `<div class="media-dropzone">
    <input id="${escapeHtml(inputId)}" class="media-file-input" type="file"
      accept="image/jpeg,image/png,image/webp,video/mp4"
      data-action="upload-media" data-client-id="${escapeHtml(ad.clientId)}"
      ${upload ? 'disabled' : ''} />
    ${media.previewUrl ? mediaPreview(media.kind, media.previewUrl, media.fileName) : emptyMediaPrompt(inputId)}
    ${upload ? uploadProgress(upload, ad.clientId) : uploadedMediaStatus(ad, inputId)}
  </div>`;
}

function mediaPreview(kind, url, alt) {
  return kind === 'video'
    ? `<video src="${escapeHtml(url)}" controls muted playsinline preload="metadata"></video>`
    : `<img src="${escapeHtml(url)}" alt="${escapeHtml(alt || 'Xem trước banner quảng cáo')}" />`;
}

function formatFileSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
```

Render a hidden input with a dedicated associated label. Use a full empty-state label only when no preview exists. Render the upload overlay from transient state and the success footer from stable Ad metadata.

- [ ] **Step 6: Style preview, progress, and success states**

Update `public/app.css` so the panel reserves its current 250px minimum height, video and image use `object-fit: contain`, progress overlays remain readable, and the replacement button sits outside the media viewport. Ensure the hidden input never overlays the video.

- [ ] **Step 7: Run rendering tests green**

Run: `node --test test/client-state.test.js test/workspace.test.js`

Expected: all state and workspace tests pass.

- [ ] **Step 8: Record verified checkpoint**

Record the passing test count; do not commit in the non-Git workspace.

---

### Task 3: Upload Lifecycle Interaction

**Files:**
- Modify: `public/app.js`
- Test: `test/tree-interactions.test.js`

**Interfaces:**
- Consumes: transport progress callback and `state.ui.mediaUploads` rendering contract.
- Produces: `beginMediaUpload`, `updateMediaUploadProgress`, `completeMediaUpload`, and `failMediaUpload` behavior around the existing `uploadMedia(control)` event.

- [ ] **Step 1: Write failing lifecycle wiring test**

Add source interaction assertions to `test/tree-interactions.test.js`:

```js
test('tracks upload progress and commits media only after success', () => {
  assert.match(appSource, /state\.ui\.mediaUploads\[match\.node\.clientId\] =/);
  assert.match(appSource, /onProgress:[\s\S]*?updateMediaUploadProgress/);
  assert.match(appSource, /await api\.uploadMedia[\s\S]*?detachCreativeForAd\(match\.node\)[\s\S]*?mediaId =/);
  assert.match(appSource, /catch \(error\)[\s\S]*?URL\.revokeObjectURL\(previewUrl\)[\s\S]*?delete state\.ui\.mediaUploads/);
});
```

- [ ] **Step 2: Run interaction test red**

Run: `node --test test/tree-interactions.test.js`

Expected: failure because upload lifecycle state and progress callbacks are absent.

- [ ] **Step 3: Begin transient upload before the request**

Infer `kind` from `file.type`, create `previewUrl`, write the keyed transient entry with `progress: 0`, and call the existing scroll-preserving `render()` before awaiting the API.

- [ ] **Step 4: Update progress without full rerender**

Implement `updateMediaUploadProgress(clientId, requestId, event)` to clamp and round `event.percentage`, update only the matching state entry, progress fill, percentage label, and `aria-valuenow` element.

- [ ] **Step 5: Commit successful media atomically**

After API completion, verify the request is still current, revoke the previous stable Blob URL, call `detachCreativeForAd`, assign media ID, kind, preview URL, file name, and size, then delete transient state and render.

- [ ] **Step 6: Roll back failed replacements**

On failure, revoke only the new preview URL, delete only the matching transient entry, render the unchanged stable Ad media, and show the existing toast error.

- [ ] **Step 7: Run interaction tests green**

Run: `node --test test/tree-interactions.test.js test/client-api.test.js test/client-state.test.js test/workspace.test.js`

Expected: all focused interaction, API, state, and rendering tests pass.

- [ ] **Step 8: Record verified checkpoint**

Record the passing test count; no Git commit is available.

---

### Task 4: Build, Regression, and Production Verification

**Files:**
- Generated: `public/blob-upload-client.js`
- Verify: all modified source and test files

**Interfaces:**
- Consumes: completed browser feature.
- Produces: production deployment on `https://creative-campaign-lgclinic.vercel.app`.

- [ ] **Step 1: Rebuild generated Blob client**

Run: `npm run build`

Expected: exit code `0`; `public/blob-upload-client.js` contains the bundled progress callback support.

- [ ] **Step 2: Run syntax and focused verification**

Run:

```powershell
node --check public/api.js
node --check public/app.js
node --check public/state.js
node --check public/workspace.js
node --test test/client-api.test.js test/client-state.test.js test/tree-interactions.test.js test/workspace.test.js
```

Expected: zero focused failures.

- [ ] **Step 3: Run the full suite**

Run: `npm test`

Expected: no new failures. If the three pre-existing conversation assertions remain, report them separately rather than changing unrelated behavior.

- [ ] **Step 4: Deploy production**

Run: `npx --yes vercel@58.9.0 --prod --yes`

Expected: deployment state `READY` and alias `https://creative-campaign-lgclinic.vercel.app`.

- [ ] **Step 5: Verify production assets and health**

Confirm `/health` returns `{ "ok": true }`, `app.js` contains `updateMediaUploadProgress`, and the rebuilt Blob client contains upload-progress logic.

- [ ] **Step 6: Smoke-test without Meta publishing**

In an isolated browser tab, select an image and an MP4 using a connected session. Verify progress status markup, final thumbnail/playable video, filename, size, replacement control, and clean browser console. Do not press the publish button and do not create Meta objects.

- [ ] **Step 7: Final handoff**

Report changed files, deployment URL, focused/full test outcomes, and any unchanged pre-existing failures.

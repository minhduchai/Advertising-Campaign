# Facebook Page Ad Seeding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `subagent-driven-development` (recommended) or `executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Thêm thư viện mẫu seeding riêng từng tài khoản Meta và tự đăng chuỗi bình luận bằng Facebook Page lên từng Post ID quảng cáo duy nhất sau khi lượt tạo Ads hoàn tất.

**Architecture:** Vercel tiếp tục xử lý từng request ngắn; Neon/SQLite lưu mẫu, snapshot và hàng đợi bền vững. Trình duyệt điều phối từng comment nhưng database khóa nguyên tử một job, ngăn hai thiết bị gửi trùng và áp dụng khoảng nghỉ 3–5 giây ở phía server. Page access token chỉ được lấy trong request xử lý comment; ảnh nằm trong private Vercel Blob và chỉ cấp URL đọc ngắn hạn cho Meta.

**Tech Stack:** Node.js ES modules, Node test runner, SQLite `node:sqlite`, Neon Postgres qua `@neondatabase/serverless`, Vercel Functions, private Vercel Blob, Meta Graph API, HTML template strings và JavaScript trình duyệt thuần.

## Global Constraints

- Mỗi chiến dịch chọn tối đa một mẫu; mỗi mẫu có 1–10 comment theo thứ tự cố định.
- Mỗi comment có văn bản tối đa 8.000 ký tự, một ảnh tùy chọn hoặc cả hai.
- Ảnh seeding chỉ chấp nhận JPEG/PNG và tối đa 10 MB.
- Trong một chiến dịch, mỗi Post ID duy nhất chỉ nhận bộ comment đúng một lần.
- Nếu cùng Post ID xuất hiện trong nhiều chiến dịch của cùng run, không đăng cho tới khi người dùng chọn một chiến dịch/mẫu.
- Chỉ seed Post ID lấy từ Ad `created` của run hiện tại; không nhận Post ID tùy ý từ trình duyệt.
- Mỗi request chỉ đăng tối đa một comment; khoảng nghỉ toàn run luôn từ 3.000 đến 5.000 ms kể cả khi hai thiết bị cùng mở.
- Timeout hoặc mất kết nối sau khi request có thể đã tới Meta phải chuyển `needs_review` và không tự retry.
- Lỗi seeding không đổi trạng thái Campaign, Ad Set hoặc Ad.
- Không gửi User token, Page token, Blob URL, signed URL hoặc nội dung file về trình duyệt hay log.
- Mọi template, media, run và job phải kiểm tra `owner_meta_user_id`; tài nguyên của owner khác trả cùng phản hồi 404 như tài nguyên không tồn tại.
- Toàn bộ đối tượng Ads vẫn được tạo ở trạng thái `PAUSED`.
- Workspace hiện không phải Git repository; không chạy `git commit` trong kế hoạch này.

---

### Task 1: Mô hình seeding và snapshot v3

**Files:**
- Create: `src/seeding-template.js`
- Create: `public/seeding.js`
- Modify: `src/draft.js`
- Modify: `src/run-report.js`
- Modify: `public/state.js`
- Test: `test/seeding-template.test.js`
- Test: `test/draft.test.js`
- Test: `test/run-report.test.js`
- Test: `test/client-state.test.js`

**Interfaces:**
- Produces: `normalizeSeedingTemplateInput(input)` trả `{ name, items, errors }`.
- Produces: `validateSeedingConfig(seeding, path)` trả mảng `{ path, message }`.
- Produces: `createEmptySeeding(randomId)`, `applySeedingTemplate(campaign, template)`, `seedingContent(seeding)` và `isSeedingModified(seeding, template)`.
- Changes: `createRunSnapshot({ draft, selectedMedia, selectedSeedingMedia, pages })` tạo snapshot `version: 3`.

- [ ] **Step 1: Viết test RED cho chuẩn hóa mẫu và cấu hình Campaign**

```js
test('normalizes one to ten seeding comments without Blob URLs', () => {
  const result = normalizeSeedingTemplateInput({
    name: 'Triệt nách nữ',
    items: [{ id: 'item-1', message: 'Đăng ký tại https://lgclinic.vn', imageMediaId: 'media-1' }]
  });
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.items, [{ id: 'item-1', message: 'Đăng ký tại https://lgclinic.vn', imageMediaId: 'media-1' }]);
});

test('requires a selected template when campaign seeding is enabled', () => {
  const input = structuredClone(validDraft);
  input.campaigns[0].seeding = createEmptySeeding(() => 'item-1');
  input.campaigns[0].seeding.enabled = true;
  assert.ok(validateDraft(input).some(({ path }) => path === 'campaigns.0.seeding.templateId'));
});
```

- [ ] **Step 2: Chạy test để xác nhận RED**

Run: `node --test test/seeding-template.test.js test/draft.test.js test/client-state.test.js`

Expected: FAIL vì module và trường `seeding` chưa tồn tại.

- [ ] **Step 3: Cài mô hình dữ liệu thuần**

```js
export const MAX_SEEDING_ITEMS = 10;
export const MAX_SEEDING_MESSAGE_LENGTH = 8_000;
export const MAX_SEEDING_IMAGE_BYTES = 10 * 1024 * 1024;
export const SEEDING_IMAGE_TYPES = new Set(['image/jpeg', 'image/png']);

export function createEmptySeeding(randomId = () => globalThis.crypto.randomUUID()) {
  return {
    enabled: false,
    templateId: null,
    templateName: '',
    items: [{ id: randomId(), message: '', imageMediaId: null, imageName: '', imageSize: 0, imagePreviewUrl: '' }]
  };
}
```

`normalizeSeedingTemplateInput` phải trim tên, giữ nguyên khoảng trắng bên trong message, tạo ID khi item chưa có ID, loại mọi trường URL/blob/token lạ và trả lỗi cụ thể cho: tên rỗng hoặc quá 120 ký tự, 0 hoặc hơn 10 item, message quá 8.000 ký tự, item không có cả message lẫn ảnh, ID item trùng.

- [ ] **Step 4: Gắn seeding vào Campaign và draft validation**

`createCampaign` thêm `seeding: createEmptySeeding(randomId)`. `validateDraft` gọi:

```js
issues.push(...validateSeedingConfig(campaign.seeding, `${campaignPath}.seeding`));
```

Khi `enabled === false`, nội dung rỗng không chặn tạo Ads. Khi `enabled === true`, bắt buộc `templateId`, `templateName` và 1–10 item hợp lệ.

- [ ] **Step 5: Tạo snapshot v3 bất biến**

```js
{
  version: 3,
  campaigns: [{
    seeding: {
      enabled: true,
      templateId: 'template-1',
      templateName: 'Triệt nách nữ',
      items: [{
        id: 'item-1',
        message: 'Nội dung comment',
        imageMediaId: 'media-1',
        imageName: 'before-after.jpg'
      }]
    }
  }]
}
```

`selectedSeedingMedia` là `Map<mediaId, mediaMetadata>`. Snapshot không chứa `content`, `blobUrl`, `blobDownloadUrl`, `blobPathname`, `sourceUrl` hoặc `imagePreviewUrl`.

- [ ] **Step 6: Chạy test GREEN**

Run: `node --test test/seeding-template.test.js test/draft.test.js test/run-report.test.js test/client-state.test.js`

Expected: PASS và snapshot hiện tại đổi từ version 2 sang version 3.

---

### Task 2: Schema và database queue nguyên tử

**Files:**
- Modify: `src/db.js`
- Modify: `src/postgres-schema.js`
- Modify: `src/postgres-db.js`
- Modify: `test/database-contract.js`
- Modify: `test/db.test.js`
- Modify: `test/postgres-schema.test.js`
- Modify: `test/postgres-db.test.js`

**Interfaces:**
- Produces template methods: `listSeedingTemplates`, `getSeedingTemplate`, `createSeedingTemplate`, `updateSeedingTemplate`, `duplicateSeedingTemplate`, `deleteSeedingTemplate`.
- Produces queue methods: `insertSeedingJobs`, `listSeedingJobs`, `claimNextSeedingJob`, `finishSeedingJob`, `retrySeedingJob`, `confirmSeedingJob`, `cancelSeedingJobs`, `resumeSeedingJobs`.
- All methods accept `ownerMetaUserId` explicitly and never infer ownership from `runId` alone.

- [ ] **Step 1: Viết database contract RED**

```js
const template = await database.createSeedingTemplate({
  id: 'seed-template-1',
  ownerMetaUserId: 'meta-user-1',
  name: 'Triệt nách nữ',
  items: [{ id: 'item-1', message: 'Comment 1', imageMediaId: null }],
  now: 1_000
});
assert.equal((await database.getSeedingTemplate('meta-user-1', template.id)).name, 'Triệt nách nữ');
assert.equal(await database.getSeedingTemplate('meta-user-2', template.id), null);

await database.insertSeedingJobs('meta-user-1', [jobFixture]);
await database.insertSeedingJobs('meta-user-1', [jobFixture]);
assert.equal((await database.listSeedingJobs('meta-user-1', 'run-1')).length, 1);
```

- [ ] **Step 2: Chạy test để xác nhận RED**

Run: `node --test test/db.test.js test/postgres-schema.test.js test/postgres-db.test.js`

Expected: FAIL vì bảng và methods chưa tồn tại.

- [ ] **Step 3: Thêm schema SQLite và Postgres**

```sql
CREATE TABLE IF NOT EXISTS seeding_templates (
  id TEXT PRIMARY KEY,
  owner_meta_user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  items_json JSONB NOT NULL,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS seeding_jobs (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  owner_meta_user_id TEXT NOT NULL,
  campaign_client_id TEXT NOT NULL,
  page_id TEXT NOT NULL,
  post_id TEXT NOT NULL,
  item_id TEXT NOT NULL,
  position INTEGER NOT NULL,
  sequence INTEGER NOT NULL,
  message TEXT NOT NULL,
  image_media_id TEXT,
  status TEXT NOT NULL,
  meta_comment_id TEXT,
  error_json JSONB,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  available_at BIGINT NOT NULL,
  started_at BIGINT,
  completed_at BIGINT,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL,
  UNIQUE (run_id, campaign_client_id, post_id, item_id)
);
```

SQLite dùng `TEXT` cho JSON và `INTEGER` cho timestamp; `migrateSqliteSchema` tạo bảng/index idempotently. Thêm index `seeding_templates_owner_updated_idx` và `seeding_jobs_owner_run_status_idx`.

- [ ] **Step 4: Cài CRUD mẫu giống nhau trên hai database adapter**

Mapper công khai chỉ trả:

```js
{
  id,
  ownerMetaUserId,
  name,
  items,
  createdAt,
  updatedAt
}
```

`duplicateSeedingTemplate` tạo ID mới, tên do caller cung cấp, giữ item IDs để nội dung ổn định nhưng không sao chép bất kỳ URL/token nào.

- [ ] **Step 5: Cài insert và claim job nguyên tử**

`insertSeedingJobs` dùng `ON CONFLICT ... DO NOTHING`. `claimNextSeedingJob({ ownerMetaUserId, runId, now, staleBefore })` phải thực hiện trong một transaction/CTE:

1. Chuyển `posting` có `started_at < staleBefore` sang `needs_review`.
2. Không claim nếu run đang có job `posting` khác.
3. Chỉ claim `pending` với `available_at <= now`.
4. Không claim comment vị trí sau nếu comment trước trên cùng Campaign/Post chưa `created`.
5. Chọn theo `sequence, position, id`, tăng `attempt_count`, đặt `posting`, `started_at` và `updated_at`, rồi trả đúng row đã claim.

Postgres dùng `FOR UPDATE SKIP LOCKED`; SQLite dùng `BEGIN IMMEDIATE`.

- [ ] **Step 6: Cài kết thúc, retry, xác nhận, dừng và tiếp tục**

`finishSeedingJob` nhận:

```js
{
  ownerMetaUserId,
  runId,
  jobId,
  status: 'created' | 'failed' | 'needs_review',
  metaCommentId: null,
  error: null,
  now: 2_000,
  nextAvailableAt: 5_500
}
```

Khi status `created`, cùng transaction phải nâng `available_at` của mọi job `pending` còn lại trong run lên ít nhất `nextAvailableAt`. `retrySeedingJob` chỉ đổi `failed|needs_review -> pending`; `confirmSeedingJob` chỉ đổi `needs_review -> created` và lưu `{ manualConfirmation: true }`; `cancelSeedingJobs` đổi `pending -> cancelled`; `resumeSeedingJobs` đổi `cancelled -> pending` với `available_at = now`.

- [ ] **Step 7: Chạy database tests GREEN**

Run: `node --test test/database-contract.js test/db.test.js test/postgres-schema.test.js test/postgres-db.test.js`

Expected: PASS, bao gồm hai claim đồng thời không trả cùng một job và owner khác không đọc/đổi được job.

---

### Task 3: Ảnh riêng tư cho preview và Meta fetch

**Files:**
- Modify: `src/media-store.js`
- Modify: `src/request-handler.js`
- Modify: `public/api.js`
- Modify: `test/media-store.test.js`
- Modify: `test/publish-routes.test.js`
- Modify: `test/client-api.test.js`

**Interfaces:**
- Produces: `mediaStore.getMetaFetchUrl({ ownerMetaUserId, id })` trả signed HTTPS URL ở production hoặc `null` ở local.
- Produces: `GET /api/media/:mediaId/preview` stream ảnh owner-scoped với `Cache-Control: private, max-age=300`.

- [ ] **Step 1: Viết test RED cho signed URL ảnh và preview owner scope**

```js
const url = await store.getMetaFetchUrl({ ownerMetaUserId: 'meta-user-1', id: 'media-image' });
assert.equal(url, 'https://private.blob.vercel-storage.com/image.jpg?signed=1');
assert.equal(getBlobCalls, 0);

const foreign = await request(server, '/api/media/media-image/preview', { headers: { cookie: ownerTwoCookie } });
assert.equal(foreign.status, 404);
```

- [ ] **Step 2: Chạy test để xác nhận RED**

Run: `node --test test/media-store.test.js test/publish-routes.test.js test/client-api.test.js`

Expected: FAIL vì method và route chưa có.

- [ ] **Step 3: Tách helper ký URL private Blob**

`createVercelBlobMediaStore` dùng một helper chung để ký URL cho cả video và ảnh. `getMetaFetchUrl` kiểm tra ownership qua `db.getMedia`, yêu cầu `blobPathname`, cấp URL đọc hiệu lực 10 phút và không tải bytes vào Vercel Function. `createLocalMediaStore.getMetaFetchUrl` trả `null` sau khi xác nhận media thuộc owner.

- [ ] **Step 4: Thêm route preview an toàn**

Matcher chỉ chấp nhận `/api/media/:id/preview`. Handler dùng `mediaStore.getMedia`, từ chối MIME không phải JPEG/PNG, trả bytes cùng `X-Content-Type-Options: nosniff`. Không redirect sang Blob URL và không ghi URL ký vào response.

- [ ] **Step 5: Thêm client helper và chạy GREEN**

```js
mediaPreviewUrl: (mediaId) => `/api/media/${encodeURIComponent(mediaId)}/preview`
```

Run: `node --test test/media-store.test.js test/publish-routes.test.js test/client-api.test.js`

Expected: PASS.

---

### Task 4: Thư viện mẫu seeding owner-scoped

**Files:**
- Modify: `src/request-handler.js`
- Modify: `public/api.js`
- Create: `test/seeding-template-routes.test.js`
- Modify: `test/client-api.test.js`

**Interfaces:**
- Produces: `GET|POST /api/seeding-templates`.
- Produces: `PUT|DELETE /api/seeding-templates/:id`.
- Produces: `POST /api/seeding-templates/:id/duplicate`.
- Public item shape: `{ id, message, imageMediaId, imageName, imageSize, imagePreviewUrl }`.

- [ ] **Step 1: Viết route tests RED**

```js
const created = await request(server, '/api/seeding-templates', jsonOptions(ownerOneCookie, 'POST', {
  name: 'Triệt nách nữ',
  items: [{ id: 'item-1', message: 'Comment 1', imageMediaId: 'image-1' }]
}));
assert.equal(created.status, 201);
assert.equal(created.body.template.items[0].imagePreviewUrl, '/api/media/image-1/preview');

const hidden = await request(server, `/api/seeding-templates/${created.body.template.id}`, {
  method: 'DELETE', headers: { cookie: ownerTwoCookie }
});
assert.equal(hidden.status, 404);
```

- [ ] **Step 2: Chạy test để xác nhận RED**

Run: `node --test test/seeding-template-routes.test.js test/client-api.test.js`

Expected: FAIL với 404 route.

- [ ] **Step 3: Cài validation media server-side**

Mỗi create/update phải gọi `normalizeSeedingTemplateInput`, sau đó tải metadata bằng `db.getMedia(ownerMetaUserId, imageMediaId)` cho từng ID duy nhất. Trả 422 nếu media thiếu, khác owner, MIME ngoài JPEG/PNG hoặc lớn hơn 10 MB. Không dùng dữ liệu MIME/size do trình duyệt gửi để quyết định.

- [ ] **Step 4: Cài CRUD và public serializer**

`GET` chỉ gọi `db.listSeedingTemplates(session.metaUserId)`. Serializer hydrate tên/kích thước ảnh từ DB và tạo preview path nội bộ; không trả `ownerMetaUserId`, Blob metadata hoặc content. DELETE không xóa media vì một ảnh có thể được nhiều mẫu dùng lại.

- [ ] **Step 5: Thêm API client và chạy GREEN**

```js
loadSeedingTemplates: () => json('/api/seeding-templates'),
createSeedingTemplate: (body) => json('/api/seeding-templates', postJson(body)),
updateSeedingTemplate: (id, body) => json(`/api/seeding-templates/${encodeURIComponent(id)}`, methodJson('PUT', body)),
duplicateSeedingTemplate: (id, body) => json(`/api/seeding-templates/${encodeURIComponent(id)}/duplicate`, postJson(body)),
deleteSeedingTemplate: (id) => json(`/api/seeding-templates/${encodeURIComponent(id)}`, methodJson('DELETE', {}))
```

Run: `node --test test/seeding-template-routes.test.js test/client-api.test.js`

Expected: PASS.

---

### Task 5: Quyền Page và Meta comment API

**Files:**
- Modify: `src/meta-client.js`
- Modify: `src/request-handler.js`
- Modify: `test/meta-client.test.js`
- Modify: `test/auth-routes.test.js`

**Interfaces:**
- Produces: `getPermissionStatus(token, permissionNames)` trả object boolean theo tên quyền.
- Produces: `getPageEngagementContext(token, pageIds)` trả `{ permissionGranted, pages: Map<pageId, { name, tasks, accessToken }> }`.
- Produces: `createPageComment(pageToken, postId, { message, attachmentUrl }, options)` trả Meta Comment ID.
- Changes: `/api/resources` trả `capabilities.pagesManageEngagement`.

- [ ] **Step 1: Viết Meta client tests RED**

```js
const commentId = await client.createPageComment('PAGE-TOKEN', '123_456', {
  message: 'Xem ưu đãi https://lgclinic.vn',
  attachmentUrl: 'https://blob.example/image.jpg?signed=1'
});
assert.equal(commentId, 'comment-1');
assert.equal(request.options.headers.authorization, 'Bearer PAGE-TOKEN');
assert.equal(new URLSearchParams(request.options.body).get('attachment_url'), 'https://blob.example/image.jpg?signed=1');
```

Thêm case text-only, image-only, Meta không trả ID và lỗi Graph được chuẩn hóa.

- [ ] **Step 2: Chạy test để xác nhận RED**

Run: `node --test test/meta-client.test.js test/auth-routes.test.js`

Expected: FAIL vì methods/capability chưa tồn tại.

- [ ] **Step 3: Cài permission/context methods**

`getPermissionStatus` gọi `/me/permissions?fields=permission,status&limit=100`. `getPageEngagementContext` gọi song song permission và `/me/accounts?fields=id,name,tasks,access_token&limit=100`, chỉ giữ Page IDs được yêu cầu và không bao giờ serialize Map này ra browser.

- [ ] **Step 4: Cài createPageComment**

```js
async createPageComment(pageToken, postId, { message, attachmentUrl }, options = {}) {
  const params = new URLSearchParams();
  if (String(message ?? '').trim()) params.set('message', String(message));
  if (attachmentUrl) params.set('attachment_url', attachmentUrl);
  const payload = await postParams(fetchImpl, `${graphBaseUrl}/${postId}/comments`, pageToken, params, options);
  if (!payload.id) throw new Error('Meta không trả về Comment ID');
  return String(payload.id);
}
```

- [ ] **Step 5: Trả capability cho frontend và chạy GREEN**

`handleResourceDiscovery` tải ad accounts và `pages_manage_engagement` song song. Response chỉ có boolean capability.

Run: `node --test test/meta-client.test.js test/auth-routes.test.js`

Expected: PASS và không response nào chứa access token.

---

### Task 6: Service chuẩn bị và xử lý queue

**Files:**
- Create: `src/seeding-service.js`
- Create: `test/seeding-service.test.js`

**Interfaces:**
- Produces: `buildSeedingPreparation(run, existingJobs, options)` trả `{ jobs, conflicts, waitingPostCount, invalidTargets }`.
- Produces: `prepareRunSeeding({ run, ownerMetaUserId, existingJobs, insertJobs, now })`.
- Produces: `resolveSeedingConflict({ run, ownerMetaUserId, postId, campaignClientId, existingJobs, insertJobs, now })`.
- Produces: `processNextSeedingJob({ runId, ownerMetaUserId, db, metaClient, mediaStore, token, now, random, timeoutMs })`.
- Produces: `createSeedingState(run, jobs)` trả public summary không có token/Blob URL.

- [ ] **Step 1: Viết preparation tests RED**

```js
const prepared = buildSeedingPreparation(runWithSharedPostInsideCampaign, [], { now: 1_000 });
assert.equal(prepared.jobs.length, 2);
assert.deepEqual(prepared.jobs.map(({ postId, position }) => [postId, position]), [
  ['page-1_100', 0],
  ['page-1_100', 1]
]);

const conflict = buildSeedingPreparation(runWithSamePostAcrossCampaigns, [], { now: 1_000 });
assert.equal(conflict.jobs.length, 0);
assert.deepEqual(conflict.conflicts[0].campaignClientIds, ['campaign-1', 'campaign-2']);
```

Thêm cases: Post IDs khác nhau, prepare hai lần, Ad failed/skipped, campaign seeding tắt, Page prefix không khớp, Post ID chưa có, template item thứ tự 0–9.

- [ ] **Step 2: Viết processing tests RED**

```js
const result = await processNextSeedingJob(fixture);
assert.equal(result.job.status, 'created');
assert.equal(result.job.metaCommentId, 'comment-1');
assert.ok(result.retryAfterMs >= 3_000 && result.retryAfterMs <= 5_000);
```

Thêm cases: thiếu `pages_manage_engagement`, Page không có `MODERATE`, ảnh local không có HTTPS, lỗi Meta rõ ràng -> `failed`, Abort/network -> `needs_review`, database save lỗi sau Meta -> job vẫn `posting`, không có job khả dụng -> `retryAfterMs` từ `available_at`.

- [ ] **Step 3: Chạy test để xác nhận RED**

Run: `node --test test/seeding-service.test.js`

Expected: FAIL vì service chưa tồn tại.

- [ ] **Step 4: Cài dedupe, conflict và trình tự job**

Service xây map `adClientId -> campaign`, chỉ đọc node `type === 'ad' && status === 'created' && postId`. Trong một Campaign/Post, tạo đúng một job cho mỗi item. `sequence` tăng theo thứ tự Campaign, lần xuất hiện đầu của Post ID và vị trí comment. Existing unique keys làm prepare idempotent.

Nếu một Post ID thuộc nhiều Campaign có seeding bật và chưa có job chọn trước, trả conflict, không insert. `resolveSeedingConflict` chỉ chấp nhận Campaign thực sự chứa Post ID đó trong run và insert bộ job của Campaign được chọn.

- [ ] **Step 5: Cài xử lý một comment an toàn**

1. Claim job nguyên tử với stale threshold 2 phút.
2. Lấy Page context bằng User token; yêu cầu permission và task `MODERATE`.
3. Nếu Post ID dạng `PAGE_ID_POST_ID`, xác nhận prefix bằng `job.pageId`.
4. Nếu có ảnh, kiểm tra metadata owner/MIME/10 MB và lấy URL bằng `mediaStore.getMetaFetchUrl`.
5. Dùng `AbortController` với timeout 20 giây để gọi `createPageComment`.
6. Meta trả ID: chọn delay `3000 + Math.floor(random() * 2001)`, lưu `created` và đẩy `available_at` của job tiếp theo.
7. Error có `meta`: lưu `failed`; `AbortError`, `TypeError` mạng hoặc kết nối đóng: lưu `needs_review`.
8. Không retry tự động `failed` hoặc `needs_review`.

- [ ] **Step 6: Cài public state và chạy GREEN**

```js
{
  summary: { posts: 1, total: 2, pending: 1, posting: 0, created: 1, failed: 0, needsReview: 0, cancelled: 0 },
  jobs: [{ id, campaignClientId, pageId, postId, position, message, imageMediaId, status, metaCommentId, error }],
  conflicts: [],
  waitingPostCount: 0
}
```

Run: `node --test test/seeding-service.test.js`

Expected: PASS.

---

### Task 7: API queue và tích hợp run

**Files:**
- Modify: `src/request-handler.js`
- Modify: `public/api.js`
- Modify: `public/run-progress.js`
- Create: `test/seeding-routes.test.js`
- Modify: `test/publish-routes.test.js`
- Modify: `test/client-api.test.js`
- Modify: `test/run-progress.test.js`

**Interfaces:**
- Produces: `POST /api/runs/:runId/seeding/prepare`.
- Produces: `POST /api/runs/:runId/seeding/next`.
- Produces: `GET /api/runs/:runId/seeding`.
- Produces: `POST /api/runs/:runId/seeding/conflicts/resolve` body `{ postId, campaignClientId }`.
- Produces: `POST /api/runs/:runId/seeding/jobs/:jobId/retry|confirm`.
- Produces: `POST /api/runs/:runId/seeding/cancel|resume`.
- Changes: owner-scoped run detail response thêm `seeding`.

- [ ] **Step 1: Viết route tests RED**

```js
const prepared = await request(server, '/api/runs/run-1/seeding/prepare', jsonOptions(ownerCookie, 'POST'));
assert.equal(prepared.status, 200);
assert.equal(prepared.body.seeding.summary.total, 2);

const foreign = await request(server, '/api/runs/run-1/seeding/next', jsonOptions(foreignCookie, 'POST'));
assert.equal(foreign.status, 404);
assert.doesNotMatch(JSON.stringify(prepared.body), /PAGE-TOKEN|signed=1|access_token/);
```

Thêm tests cho method sai, malformed ID, conflict resolution, retry/confirm chỉ đúng trạng thái, cancel/resume và GET history.

- [ ] **Step 2: Chạy test để xác nhận RED**

Run: `node --test test/seeding-routes.test.js test/publish-routes.test.js test/client-api.test.js test/run-progress.test.js`

Expected: FAIL với 404 và thiếu snapshot seeding.

- [ ] **Step 3: Xác thực template/media trước mọi Meta write của run**

Trong `handleRunCreation`, sau `validateDraft` nhưng trước `listPageCatalog` và `db.createRun`:

- Với mỗi Campaign seeding bật, tải `db.getSeedingTemplate(session.metaUserId, templateId)` để xác nhận template còn thuộc owner.
- Chuẩn hóa chính copy đang nằm trong Campaign; nội dung Campaign được dùng cho run dù thư viện vừa được sửa ở tab khác.
- Tải metadata của mọi `imageMediaId`, kiểm tra owner/MIME/size.
- Trả 400/422 và không gọi bất kỳ Meta write nếu có lỗi.
- Truyền map metadata vào `createRunSnapshot` version 3.

- [ ] **Step 4: Cài route matcher và handlers**

Mọi handler gọi một helper chung `getOwnedRunOrRespond`. `prepare` gọi `syncRunPublications` trước, đọc lại run, rồi tạo jobs idempotently. `next` giải mã User token server-side và gọi service một job. Run detail tải `db.listSeedingJobs` và gắn `createSeedingState`.

- [ ] **Step 5: Thêm API client methods**

```js
prepareRunSeeding: (runId) => json(`/api/runs/${encodeURIComponent(runId)}/seeding/prepare`, postJson({})),
processNextSeeding: (runId) => json(`/api/runs/${encodeURIComponent(runId)}/seeding/next`, postJson({})),
loadRunSeeding: (runId) => json(`/api/runs/${encodeURIComponent(runId)}/seeding`),
resolveSeedingConflict: (runId, body) => json(`/api/runs/${encodeURIComponent(runId)}/seeding/conflicts/resolve`, postJson(body)),
retrySeedingJob: (runId, jobId) => json(`/api/runs/${encodeURIComponent(runId)}/seeding/jobs/${encodeURIComponent(jobId)}/retry`, postJson({})),
confirmSeedingJob: (runId, jobId) => json(`/api/runs/${encodeURIComponent(runId)}/seeding/jobs/${encodeURIComponent(jobId)}/confirm`, postJson({})),
cancelRunSeeding: (runId) => json(`/api/runs/${encodeURIComponent(runId)}/seeding/cancel`, postJson({})),
resumeRunSeeding: (runId) => json(`/api/runs/${encodeURIComponent(runId)}/seeding/resume`, postJson({}))
```

- [ ] **Step 6: Chạy route tests GREEN**

Run: `node --test test/seeding-routes.test.js test/publish-routes.test.js test/client-api.test.js test/run-progress.test.js`

Expected: PASS; publish NDJSON kết thúc trước seeding và không giữ Vercel request dài.

---

### Task 8: Editor mẫu seeding trong Campaign

**Files:**
- Modify: `public/state.js`
- Modify: `public/workspace.js`
- Modify: `public/app.js`
- Modify: `public/app.css`
- Create: `test/seeding-editor.test.js`
- Modify: `test/workspace.test.js`
- Modify: `test/tree-interactions.test.js`

**Interfaces:**
- Campaign editor có công tắc, template picker, CRUD và tối đa 10 comment cards.
- Upload ảnh dùng `api.uploadMedia`; item chỉ nhận kết quả sau khi upload thành công.

- [ ] **Step 1: Viết renderer/state tests RED**

```js
const html = renderWorkspace(stateWithCampaignSeeding);
assert.match(html, /Tự động seeding sau khi có Post ID/);
assert.match(html, /data-action="select-seeding-template"/);
assert.match(html, /data-action="upload-seeding-image"/);
assert.match(html, /Mỗi Post ID duy nhất nhận bộ comment này một lần/);
```

Thêm tests cho 10-item cap, add/remove/move giữ thứ tự, chọn template tạo deep copy và thay Campaign/Page không làm mất mẫu đã chọn.

- [ ] **Step 2: Chạy test để xác nhận RED**

Run: `node --test test/seeding-editor.test.js test/workspace.test.js test/tree-interactions.test.js test/client-state.test.js`

Expected: FAIL vì editor/actions chưa tồn tại.

- [ ] **Step 3: Mở rộng resource và UI state**

```js
resources: {
  seedingTemplates: [],
  seedingTemplatesLoaded: false
},
ui: {
  loadingSeedingTemplates: false,
  seedingUploads: {}
}
```

`loadResources` gọi `loadSeedingTemplates`; đăng nhập tài khoản Meta khác thay toàn bộ library trong state, không dùng cache của owner cũ.

- [ ] **Step 4: Render Campaign seeding section**

Phần mới nằm sau `Tài khoản và Page`, gồm:

- Toggle mặc định tắt.
- Cảnh báo/link `Kết nối lại Meta` khi `capabilities.pagesManageEngagement !== true`.
- Select mẫu, `Mẫu mới`, `Lưu thay đổi`, `Nhân bản`, `Xóa mẫu`.
- 1–10 cards có textarea, upload JPEG/PNG, progress, thumbnail, thay/xóa ảnh, lên/xuống.
- Preview link vẫn là text; không tự fetch URL bên ngoài.
- Khi seeding tắt, giữ nội dung nhưng không gửi jobs.

- [ ] **Step 5: Cài event handlers và upload ảnh**

`handleSeedingClick` xử lý CRUD/item actions. `change` xử lý select/toggle/upload. Trước upload:

```js
if (!['image/jpeg', 'image/png'].includes(file.type)) throw new Error('Ảnh seeding chỉ hỗ trợ JPEG hoặc PNG');
if (file.size > 10 * 1024 * 1024) throw new Error('Ảnh seeding tối đa 10 MB');
```

Upload thành công mới gán `imageMediaId`, `imageName`, `imageSize`, `imagePreviewUrl`; upload lỗi giữ nguyên ảnh cũ. Mọi thay đổi gọi `validateCurrentDraft` nhưng không làm tách `creativeGroupId` vì seeding không thay creative Ads.

- [ ] **Step 6: Thêm CSS responsive và chạy GREEN**

Giữ card gọn ở desktop, một cột dưới 760 px, thumbnail tối đa 160 px, progress dùng component media hiện có. Các nút icon có `aria-label`; thứ tự DOM khớp thứ tự gửi.

Run: `node --test test/seeding-editor.test.js test/workspace.test.js test/tree-interactions.test.js test/client-state.test.js`

Expected: PASS.

---

### Task 9: Worker trình duyệt, kết quả và lịch sử

**Files:**
- Create: `public/seeding-runner.js`
- Modify: `src/request-handler.js`
- Modify: `public/run-progress.js`
- Modify: `public/workspace.js`
- Modify: `public/activity-history.js`
- Modify: `public/app.js`
- Modify: `public/app.css`
- Create: `test/seeding-runner.test.js`
- Create: `test/seeding-interactions.test.js`
- Modify: `test/activity-history.test.js`
- Modify: `test/activity-history-interactions.test.js`

**Interfaces:**
- Produces: `createSeedingRunner({ api, wait, onUpdate, onStop })` với `resume(runId)`, `pause(runId)` và `isRunning(runId)`.
- Result/history hiển thị summary, unique Post IDs, comment status, Meta Comment ID và conflict actions.

- [ ] **Step 1: Viết runner tests RED với fake clock**

```js
const runner = createSeedingRunner({
  api,
  wait: async (milliseconds) => waits.push(milliseconds),
  onUpdate: (state) => updates.push(state)
});
await runner.resume('run-1');
assert.deepEqual(waits, [3_421]);
assert.equal(api.processCalls, 2);
assert.equal(updates.at(-1).summary.created, 2);
```

Thêm cases: không tạo hai loop cùng run, dừng khi `failed|needs_review|conflict`, tôn trọng server `retryAfterMs`, resume sau refresh, pause/cancel và resume endpoint.

- [ ] **Step 2: Chạy test để xác nhận RED**

Run: `node --test test/seeding-runner.test.js test/seeding-interactions.test.js test/activity-history.test.js test/activity-history-interactions.test.js`

Expected: FAIL vì runner và UI chưa tồn tại.

- [ ] **Step 3: Cài runner không giữ request dài**

`resume(runId)` gọi `prepareRunSeeding`, sau đó lặp `processNextSeeding`. Mỗi response cập nhật UI rồi chờ đúng `retryAfterMs`; mỗi vòng là một HTTP request độc lập. Khi browser đóng, không có request nền; jobs vẫn ở DB. Map promise theo run ngăn loop trùng trong cùng tab.

- [ ] **Step 4: Tự khởi động sau publish và khi mở lịch sử**

`showPublishCompletion(run)` gọi `void seedingRunner.resume(run.id)` sau khi Ads đạt terminal state. `loadActivityHistoryDetail` nhận run kèm seeding; nếu có `pending` và không có `cancelled/conflict/needsReview`, gọi resume. Không tự retry `needs_review`.

- [ ] **Step 5: Render kết quả seeding compact**

Trong results drawer và history detail, thêm:

- Thanh tổng quan `đã đăng/tổng`, số Post ID và trạng thái.
- Nhóm theo Campaign rồi Post ID; nút `Mở bài Facebook` dùng permalink đã lưu trong run.
- Mỗi comment chỉ hiển thị preview một dòng, mở bằng `<details>`.
- Badge `Chờ`, `Đang đăng`, `Đã đăng`, `Thất bại`, `Cần kiểm tra`, `Đã dừng`.
- Meta Comment ID chỉ hiển thị khi có.
- Nút `Dừng phần còn lại`, `Tiếp tục`, `Thử lại`, `Đánh dấu đã có` theo đúng trạng thái.
- Conflict hiển thị radio Campaign/mẫu và nút `Dùng mẫu này`; không tự chọn.

- [ ] **Step 6: Cài tương tác an toàn**

Tất cả actions đọc `runId/jobId/postId/campaignClientId` từ dataset nhưng server vẫn xác thực lại. Khi `retry`, hiển thị xác nhận rằng comment có thể đã tồn tại. Khi `confirm`, yêu cầu người dùng đã mở bài và kiểm tra. Không render `innerHTML` từ message chưa escape.

- [ ] **Step 7: Chạy UI tests GREEN**

Run: `node --test test/seeding-runner.test.js test/seeding-interactions.test.js test/activity-history.test.js test/activity-history-interactions.test.js test/workspace.test.js`

Expected: PASS, scroll của results/history vẫn được giữ khi worker cập nhật.

---

### Task 10: Quyền Meta, migration và phát hành

**Files:**
- Modify: `README.md`
- Modify: `.env.example` only if a new non-secret runtime variable is introduced; otherwise leave unchanged.

**Interfaces:**
- Documents: Business Login permission `pages_manage_engagement`, reconnect flow, Page task `MODERATE`, local image limitation và queue recovery.

- [ ] **Step 1: Cập nhật README bằng tiếng Việt**

Ghi rõ:

1. Thêm `pages_manage_engagement` vào Facebook Login for Business configuration gắn với `META_LOGIN_CONFIG_ID`.
2. Xin Advanced Access/App Review cho người dùng ngoài vai trò ứng dụng.
3. Người dùng cũ bấm `Kết nối lại Meta` để token mới có quyền.
4. Page phải xuất hiện trong `/me/accounts` với Page access token và task `MODERATE`.
5. Page chỉ có quyền quảng cáo vẫn tạo Ads được nhưng không comment bằng Page.
6. Local lưu được mẫu/ảnh nhưng comment ảnh cần production HTTPS.
7. `needs_review` không tự retry để tránh comment trùng.

- [ ] **Step 2: Chạy test tập trung rồi toàn bộ**

Run:

```powershell
node --test test/seeding-template.test.js test/seeding-service.test.js test/seeding-routes.test.js test/seeding-runner.test.js
npm.cmd test
```

Expected: tất cả test PASS; `npm.cmd test` đồng thời build lại `public/blob-upload-client.js`.

- [ ] **Step 3: Smoke test local không gọi Meta write**

Khởi động server local bằng `.env`, kiểm tra `GET /health`, CRUD mẫu, upload/preview ảnh và owner scope. Không bấm xử lý seeding thật ở local vì Meta không tải được URL ảnh localhost.

- [ ] **Step 4: Chạy migration Neon bằng connection trực tiếp**

Sử dụng connection không có hậu tố `-pooler` cho migration:

```powershell
$env:DATABASE_URL=$env:DATABASE_URL_UNPOOLED
npm.cmd run db:migrate:postgres
```

Expected output có `seeding_templates` và `seeding_jobs`. Sau migration, trả `DATABASE_URL` runtime về pooled connection hiện tại.

- [ ] **Step 5: Deploy production Vercel**

Run: `npx.cmd --yes vercel --prod --yes`

Expected: deployment thành công; `/health`, `/seeding.js` hoặc `/seeding-runner.js`, CRUD template và seeding route không trả 404.

- [ ] **Step 6: Kiểm tra khả năng comment trên Page Duck Tool**

Sau khi người dùng thêm quyền và kết nối lại:

1. Tạo một Campaign test `PAUSED` trên Page `Duck Tool` với một Ads.
2. Chọn mẫu gồm một comment văn bản và xác nhận Meta trả Comment ID.
3. Chọn mẫu gồm một comment ảnh JPEG/PNG nhỏ và xác nhận Meta chấp nhận `attachment_url` rồi trả Comment ID.
4. Nếu Graph API hiện hành từ chối `attachment_url`, giữ text seeding hoạt động, hiển thị lỗi riêng cho image job và không đăng text của item đó khi thiếu ảnh.
5. Mở lịch sử trên thiết bị khác bằng cùng tài khoản Meta, xác nhận mẫu, thumbnail, jobs và Comment IDs vẫn còn.

- [ ] **Step 7: Xác minh chống trùng và phục hồi**

Gọi `prepare` hai lần, mở cùng run ở hai tab và refresh giữa chuỗi comment. Xác nhận mỗi unique key `(runId, campaignClientId, postId, itemId)` chỉ có một row `created`, hai comment liên tiếp cách nhau ít nhất 3 giây, và job timeout nằm `needs_review` cho tới khi người dùng xử lý thủ công.

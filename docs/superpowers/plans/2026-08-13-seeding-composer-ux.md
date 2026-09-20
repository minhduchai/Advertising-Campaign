# Seeding Composer UX Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Đưa nơi nhập nội dung bình luận và tải ảnh lên đầu workspace Seeding sau Ads để người dùng thấy và thao tác ngay.

**Architecture:** Giữ nguyên model, API, upload và queue seeding hiện có. Chỉ sắp xếp lại HTML renderer trong `public/workspace.js`, giữ nguyên các `data-action`/`data-seeding-field` để `public/app.js` tiếp tục xử lý upload, tiến độ và lưu mẫu. CSS mới biến card bình luận thành composer ưu tiên, còn thư viện mẫu thành một `<details>` tùy chọn phía sau danh sách.

**Tech Stack:** Vanilla ES modules, HTML string rendering, CSS, Node.js test runner.

## Global Constraints

- Không thay đổi API, model seeding, queue, quyền Meta hoặc lịch sử báo cáo.
- Giữ nguyên upload JPEG/PNG tối đa 10 MB, thumbnail và tiến độ tải ảnh hiện có.
- Giữ nguyên tất cả `data-action`, `data-client-id`, `data-item-id` và `data-seeding-field` mà `public/app.js` đang dùng.
- Composer phải hiển thị trước thư viện mẫu, kể cả khi chưa có mẫu lưu.
- Không tạo Git commit vì workspace hiện không có Git metadata.

---

### Task 1: Đưa composer lên đầu Seeding workspace

**Files:**
- Modify: `public/workspace.js:18-50,605-708`
- Modify: `public/app.css:996-1205`
- Modify: `test/seeding-editor.test.js:52-78`

**Interfaces:**
- Consumes: `campaign.seeding.items`, `state.ui.seedingUploads`, `isSeedingUploadTargetCurrent()`.
- Preserves: `upload-seeding-image`, `choose-seeding-image`, `remove-seeding-image`, `add-seeding-item`, `move-seeding-item`, `remove-seeding-item`, `select-seeding-template`, `save-seeding-template`, `duplicate-seeding-template`, `delete-seeding-template`.
- Produces: `renderSeedingWorkspace(state)` with `data-seeding-composer` before `data-seeding-template-library` and a visible text/image composer for every item.

- [ ] **Step 1: Write the failing renderer test**

Add a test to `test/seeding-editor.test.js` that renders a Campaign with an empty unsaved seeding item and asserts:

```js
const html = renderSeedingWorkspace(state);
assert.ok(html.indexOf('data-seeding-composer') < html.indexOf('data-seeding-template-library'));
assert.match(html, /Nội dung bình luận/);
assert.match(html, /data-seeding-field="message"/);
assert.match(html, /Thêm ảnh vào bình luận/);
assert.match(html, /data-action="choose-seeding-image"/);
assert.match(html, /Mẫu seeding \(tùy chọn\)/);
```

The test protects the user-visible contract: a blank Campaign must still expose text and image inputs before any optional template UI.

- [ ] **Step 2: Verify the test fails**

Run:

```powershell
node --test test/seeding-editor.test.js
```

Expected: FAIL because the existing renderer places `seeding-template-library` before the cards and has no composer/template markers.

- [ ] **Step 3: Render the primary composer first**

In `public/workspace.js`:

```js
<div class="seeding-composer" data-seeding-composer>
  <!-- enable row, capability warning, ordered cards, add-comment action -->
</div>
<details class="seeding-template-library" data-seeding-template-library>
  <summary>Mẫu seeding (tùy chọn)</summary>
  <!-- existing template select, template-name input, save/duplicate/delete actions -->
</details>
```

For each card retain the existing textarea and file input, but make labels explicit: `Nội dung bình luận` and `Thêm ảnh vào bình luận`. The empty image state must display `Ảnh không bắt buộc · JPEG hoặc PNG · tối đa 10 MB`; a successful upload retains thumbnail, filename and the existing progress overlay.

Replace the large hero/link-card stack with a compact context strip containing Campaign name, ad count and the existing `Mở Campaign` action. Do not change any API or state operation.

- [ ] **Step 4: Add focused visual hierarchy styles**

In `public/app.css`:

```css
.seeding-composer { display: grid; gap: 16px; }
.seeding-card { display: grid; gap: 16px; }
.seeding-card-content { grid-template-columns: minmax(0, 1fr) minmax(220px, 280px); }
.seeding-image-control { min-height: 156px; border-style: dashed; }
@media (max-width: 760px) {
  .seeding-card-content { grid-template-columns: 1fr; }
}
```

Use the existing design tokens. Make the textarea large enough to compose, the upload target visually distinct, and the optional template `<details>` quiet but discoverable. Keep touch targets at least 44px and preserve keyboard access through the existing file input/button association.

- [ ] **Step 5: Verify the focused suite passes**

Run:

```powershell
node --test test/seeding-editor.test.js test/workspace.test.js
```

Expected: PASS; existing upload, template, image preview and mobile layout tests remain green.

---

### Task 2: Kiểm tra tích hợp và phát hành giao diện

**Files:**
- Verify: `public/app.js:601-651,952-1140`
- Verify: `src/request-handler.js:34`
- Test: `test/http.test.js`, `test/seeding-editor.test.js`, `test/workspace.test.js`

**Interfaces:**
- Consumes: renderer markers from Task 1 and existing delegated `workspace` click/change/input handlers.
- Verifies: composer controls continue to reach current upload/template/state paths without server changes.

- [ ] **Step 1: Run integration-oriented tests**

Run:

```powershell
node --test test/http.test.js test/seeding-editor.test.js test/workspace.test.js
```

Expected: PASS, including the static module check and editor rendering tests.

- [ ] **Step 2: Run full regression suite**

Run:

```powershell
npm.cmd test
```

Expected: all tests PASS; client bundle is rebuilt.

- [ ] **Step 3: Build and deploy only after green validation**

Run:

```powershell
npx.cmd --yes vercel --prod --yes
```

Expected: production deployment is `READY`. Verify `GET /`, `/seeding.js` and `/seeding-runner.js` return `200`; do not create Meta Ads or comments during smoke testing.

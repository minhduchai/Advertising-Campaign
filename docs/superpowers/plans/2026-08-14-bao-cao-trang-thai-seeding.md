# Báo cáo trạng thái seeding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Hiển thị trạng thái seeding theo từng Post ID trong bảng Chi tiết lượt tạo.

**Architecture:** Tái sử dụng snapshot `run.seeding.jobs` đã có trong API chi tiết lượt tạo. `public/activity-history.js` tạo chỉ mục job theo Post ID, tổng hợp một trạng thái báo cáo ổn định và render badge cùng lỗi ngắn; CSS chỉ bổ sung kiểu hiển thị cho cột mới.

**Tech Stack:** Node.js ES modules, HTML renderer thuần JavaScript, CSS, `node:test`.

## Global Constraints

- Không gọi Meta khi mở báo cáo.
- Không tạo bảng hoặc migration dữ liệu mới.
- Quảng cáo chung Post ID phải có cùng trạng thái.
- Dữ liệu lịch sử thiếu seeding phải hiển thị `Chưa seeding`.

---

### Task 1: Tổng hợp trạng thái theo Post ID

**Files:**
- Modify: `public/activity-history.js`
- Test: `test/activity-history.test.js`

**Interfaces:**
- Consumes: `run.seeding.jobs[]` với `postId`, `status`, `error`.
- Produces: `buildSeedingStatusByPost(run): Map<string, { status: string, label: string, errorMessage: string }>`.

- [ ] **Step 1: Viết test thất bại cho quy tắc tổng hợp**

Thêm fixture gồm hai Ads chung Post ID và các job `succeeded`, `pending`, `failed`, `needs_review`; xác nhận HTML dùng cùng badge cho cùng Post ID và ưu tiên `failed > needs_review > pending/posting > succeeded > none`.

- [ ] **Step 2: Chạy test để xác nhận thất bại**

Run: `node --test test/activity-history.test.js`

Expected: FAIL vì bảng chưa có cột và badge seeding.

- [ ] **Step 3: Viết bộ tổng hợp tối thiểu**

Trong `public/activity-history.js`, nhóm job bằng `String(job.postId)`, chuẩn hóa trạng thái và lấy lỗi đầu tiên của trạng thái thất bại/cần kiểm tra. Không thay đổi dữ liệu đầu vào.

- [ ] **Step 4: Chạy test để xác nhận đạt**

Run: `node --test test/activity-history.test.js`

Expected: PASS.

### Task 2: Render cột trạng thái seeding

**Files:**
- Modify: `public/activity-history.js`
- Modify: `public/app.css`
- Test: `test/activity-history.test.js`

**Interfaces:**
- Consumes: `buildSeedingStatusByPost(run)` từ Task 1.
- Produces: cột `Trạng thái seeding` với badge và lỗi rút gọn.

- [ ] **Step 1: Viết test HTML cho cột mới**

Xác nhận header chứa `Trạng thái seeding`; các nhãn gồm `Thành công`, `Đang xử lý`, `Thất bại`, `Cần kiểm tra`, `Chưa seeding`; thông báo lỗi được escape.

- [ ] **Step 2: Chạy test để xác nhận thất bại**

Run: `node --test test/activity-history.test.js`

Expected: FAIL tại assertion cột hoặc badge.

- [ ] **Step 3: Render badge và lỗi**

Thêm `<th>Trạng thái seeding</th>` trước `Link Post`. Mỗi row lấy trạng thái bằng Post ID; nếu không có Post ID hoặc job thì dùng `Chưa seeding`. Cắt lỗi hiển thị ở 160 ký tự và giữ nội dung đầy đủ trong thuộc tính `title` đã escape.

- [ ] **Step 4: Thêm CSS gọn và đồng bộ dark theme**

Thêm các class `.history-seeding-status`, `.history-seeding-status-success`, `.history-seeding-status-progress`, `.history-seeding-status-error`, `.history-seeding-status-review`, `.history-seeding-status-empty` và `.history-seeding-error` trong `public/app.css`.

- [ ] **Step 5: Chạy test mục tiêu**

Run: `node --test test/activity-history.test.js test/activity-history-interactions.test.js`

Expected: PASS.

### Task 3: Build và deploy production

**Files:**
- Generated: `public/dist/*` qua script build hiện có.

**Interfaces:**
- Consumes: renderer và CSS đã cập nhật.
- Produces: deployment production tại alias `https://creative-campaign-lgclinic.vercel.app`.

- [ ] **Step 1: Build client**

Run: `npm run build`

Expected: build hoàn tất không lỗi.

- [ ] **Step 2: Deploy Vercel production**

Run: `npx vercel --prod --yes`

Expected: deployment `READY` và alias production được cập nhật.

- [ ] **Step 3: Kiểm tra thủ công**

Mở một lượt tạo có seeding, xác nhận cột mới hiển thị đúng; các Ads dùng chung Post ID có cùng badge; lượt cũ không có job hiển thị `Chưa seeding`.

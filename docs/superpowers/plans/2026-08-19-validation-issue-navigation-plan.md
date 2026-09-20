# Validation Issue Navigation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cho phép bấm từng cảnh báo validation để chuyển đúng node, cuộn tới đúng trường và tô sáng nơi cần sửa.

**Architecture:** Giữ nguyên dữ liệu validation từ server. Lớp render bổ sung metadata đường dẫn vào từng cảnh báo và từng trường nhập; lớp interaction giải quyết path thành node/field, render node tương ứng, cuộn, focus và highlight tạm thời.

**Tech Stack:** JavaScript ES modules, HTML template strings, CSS, Node test runner.

## Global Constraints

- Không thay đổi schema draft hoặc payload Meta.
- Không render lại ngoài thao tác chuyển node cần thiết.
- Highlight kéo dài khoảng 3 giây.
- Tôn trọng `prefers-reduced-motion`.
- Lỗi chung không có đích phải hiển thị toast thay vì gây crash.

---

### Task 1: Render metadata điều hướng cho lỗi

**Files:**
- Modify: `public/workspace.js`
- Test: `test/workspace-review.test.js`

**Interfaces:**
- Consumes: validation issue `{ path, message }` và draft campaigns.
- Produces: nút `[data-action="jump-to-validation-issue"]` có `data-client-id`, `data-validation-path`, `data-validation-field`.

- [ ] **Step 1: Viết test thất bại** kiểm tra mỗi issue giữ nguyên path và render thành button có metadata điều hướng.
- [ ] **Step 2: Chạy test đích** bằng `node --test test/workspace-review.test.js` và xác nhận thất bại.
- [ ] **Step 3: Bổ sung metadata** trong `groupIssuesByNode`, `describeIssuePath` và `renderIssueGroups`.
- [ ] **Step 4: Chạy lại test đích** và xác nhận đạt.

### Task 2: Đánh dấu đích validation trong form

**Files:**
- Modify: `public/workspace.js`
- Test: `test/workspace-validation-targets.test.js`

**Interfaces:**
- Consumes: field path rút gọn như `name`, `dailyBudget`, `conversation.greeting`, `seeding.templateId`.
- Produces: phần tử `[data-validation-field="..."]` trên input hoặc card gần nhất.

- [ ] **Step 1: Viết test thất bại** cho trường chiến dịch, nhóm quảng cáo, quảng cáo, conversation và seeding.
- [ ] **Step 2: Chạy test đích** bằng `node --test test/workspace-validation-targets.test.js`.
- [ ] **Step 3: Thêm thuộc tính đích ổn định** cho các trường bắt buộc và card dự phòng.
- [ ] **Step 4: Chạy lại test đích** và xác nhận đạt.

### Task 3: Điều hướng, focus và highlight

**Files:**
- Modify: `public/app.js`
- Modify: `public/app.css`
- Test: `test/validation-issue-navigation.test.js`

**Interfaces:**
- Consumes: button dataset từ Task 1 và target từ Task 2.
- Produces: `jumpToValidationIssue(control)`, class `.is-validation-highlight` và toast dự phòng.

- [ ] **Step 1: Viết test thất bại** kiểm tra click action, chọn node, cuộn, focus, highlight và fallback.
- [ ] **Step 2: Chạy test đích** bằng `node --test test/validation-issue-navigation.test.js`.
- [ ] **Step 3: Cài đặt interaction tối thiểu**: chọn node, render, tìm field chính xác rồi card gần nhất, `scrollIntoView`, focus và hẹn xóa highlight.
- [ ] **Step 4: Thêm CSS** cho hover/focus của issue và highlight đỏ nhạt có reduced-motion.
- [ ] **Step 5: Chạy lại test đích** và xác nhận đạt.

### Task 4: Hồi quy và triển khai

**Files:**
- Verify: `public/app.js`
- Verify: `public/workspace.js`
- Verify: `public/app.css`

- [ ] **Step 1: Chạy nhóm test liên quan** bằng `node --test test/workspace-review.test.js test/workspace-validation-targets.test.js test/validation-issue-navigation.test.js`.
- [ ] **Step 2: Chạy toàn bộ test** bằng `npm test`.
- [ ] **Step 3: Kiểm tra local** trên panel Kiểm tra với lỗi ở cả ba cấp node.
- [ ] **Step 4: Deploy production** bằng `npx vercel deploy --prod --yes --scope ducndna-5064s-projects --project creative-campaign-lgclinic`.

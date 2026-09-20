# Direct Meta Media Upload Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tải media quảng cáo thẳng vào Meta và không ghi media quảng cáo vào Vercel Blob.

**Architecture:** API máy chủ quản lý token và phiên upload Meta. Trình duyệt gửi ảnh một lần hoặc chia video thành các gói nhỏ; publisher dùng `image_hash`/`video_id` đã có.

**Tech Stack:** Node.js, Web Fetch/FormData, Meta Marketing API, browser JavaScript.

## Global Constraints

- Không đưa access token Meta xuống trình duyệt.
- Không thay đổi luồng lưu ảnh seeding.
- Video gửi theo gói nhỏ hơn giới hạn request Vercel.

### Task 1: Meta resumable upload primitives

**Files:** `src/meta-client.js`, `test/meta-client.test.js`

- [ ] Viết test thất bại cho start, transfer và finish video upload.
- [ ] Chạy test và xác nhận thất bại do thiếu API.
- [ ] Thêm các primitive upload resumable tối thiểu.
- [ ] Chạy test và xác nhận đạt.

### Task 2: Authenticated direct-upload routes

**Files:** `src/request-handler.js`, `test/publish-routes.test.js`

- [ ] Viết test thất bại cho upload ảnh và ba bước upload video.
- [ ] Chạy test và xác nhận thất bại đúng lý do.
- [ ] Thêm route, kiểm tra session, tài khoản và kích thước gói.
- [ ] Chạy test và xác nhận đạt.

### Task 3: Draft and publisher Meta assets

**Files:** `src/draft.js`, `src/publisher.js`, `src/run-report.js`, `test/publisher.test.js`, `test/draft.test.js`

- [ ] Viết test thất bại cho creative dùng asset Meta có sẵn.
- [ ] Chạy test và xác nhận publisher còn gọi media store.
- [ ] Cho phép draft lưu asset và publisher bỏ qua upload lại.
- [ ] Chạy test và xác nhận đạt.

### Task 4: Browser chunk uploader

**Files:** `public/api.js`, `public/app.js`, `public/state.js`, `public/workspace.js`, `test/client-api.test.js`, `test/tree-interactions.test.js`

- [ ] Viết test thất bại cho upload trực tiếp và xóa media khi đổi tài khoản.
- [ ] Chạy test và xác nhận thất bại đúng lý do.
- [ ] Thêm upload ảnh, video theo gói và cập nhật tiến độ.
- [ ] Chạy test và xác nhận đạt.

### Task 5: Verification

**Files:** `README.md`

- [ ] Cập nhật mô tả Blob chỉ dùng cho ảnh seeding.
- [ ] Chạy `npm test`.
- [ ] Chạy `npm run build`.


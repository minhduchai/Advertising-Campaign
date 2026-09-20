# Meta Account Disconnect Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Thêm menu tài khoản Meta với kết nối lại, đổi tài khoản và ngắt kết nối mà không xóa lịch sử.

**Architecture:** Database cung cấp thao tác tách Meta user khỏi session và xóa connection token. Request handler mở endpoint POST idempotent để ngắt phiên, xóa cache Meta, rồi client cập nhật state và bản nháp sau hộp thoại xác nhận.

**Tech Stack:** Node.js ESM, SQLite/Postgres adapters, HTML/CSS/JavaScript thuần, Node test runner.

## Global Constraints

- Không xóa lịch sử hoạt động hoặc thư viện mẫu.
- Bỏ chọn tài khoản quảng cáo và Facebook Page trong mọi campaign draft sau khi ngắt kết nối.
- Endpoint ngắt kết nối phải idempotent.
- Không triển khai hoặc commit ngoài phạm vi tính năng.

---

### Task 1: Database disconnect contract

**Files:**
- Modify: `src/db.js`
- Modify: `src/postgres-db.js`
- Test: `test/db.test.js`

**Interfaces:**
- Produces: `disconnectMetaUser(sessionId, metaUserId): void | Promise<void>`

- [ ] Viết test xác nhận session mất `metaUserId/metaUserName` và connection token bị xóa.
- [ ] Thêm implementation SQLite trong transaction.
- [ ] Thêm implementation Postgres tương đương.
- [ ] Chạy `node --test test/db.test.js`.

### Task 2: Disconnect API route

**Files:**
- Modify: `src/request-handler.js`
- Test: `test/auth-routes.test.js`

**Interfaces:**
- Consumes: `db.disconnectMetaUser(session.id, session.metaUserId)`
- Produces: `POST /api/auth/meta/disconnect` trả `{ connected: false }`

- [ ] Viết test cho phiên đã kết nối và phiên đã ngắt.
- [ ] Thêm route POST trước các route tài nguyên Meta.
- [ ] Xóa cache Meta sau khi database hoàn tất.
- [ ] Chạy `node --test test/auth-routes.test.js`.

### Task 3: Account menu and confirmation UI

**Files:**
- Modify: `public/index.html`
- Modify: `public/app.css`
- Modify: `public/app.js`
- Test: `test/theme.test.js`

**Interfaces:**
- Consumes: `POST /api/auth/meta/disconnect`
- Produces: menu tài khoản và dialog `disconnect-meta-confirmation`

- [ ] Thêm menu ba hành động vào header khi đã kết nối.
- [ ] Thêm dialog xác nhận giữ nguyên lịch sử.
- [ ] Thêm style light/dark, focus, responsive và trạng thái loading.
- [ ] Thêm handler đóng menu khi click ra ngoài hoặc nhấn Escape.
- [ ] Sau thành công, reset resources và bỏ account/page trong mọi draft.
- [ ] Chạy `npm run build:client` và `node --test test/theme.test.js`.

### Task 4: Focused validation

**Files:**
- Verify only

- [ ] Chạy test route, database và theme liên quan.
- [ ] Khởi động local và xác nhận menu, popup, ngắt kết nối, lịch sử còn nguyên.
- [ ] Không deploy cho đến khi người dùng duyệt giao diện local.

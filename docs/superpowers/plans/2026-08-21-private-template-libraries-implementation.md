# Private Template Libraries Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tách thư viện Đối tượng, Cuộc trò chuyện và Seeding theo tài khoản Meta đăng nhập.

**Architecture:** Server lấy `metaUserId` từ session và truyền xuống database cho mọi thao tác CRUD. Database dùng khóa kép chủ sở hữu và ID; migration chuyển dữ liệu dùng chung cũ sang tài khoản quản trị cấu hình mà không nhân đôi dữ liệu.

**Tech Stack:** Node.js, SQLite, Neon Postgres, JavaScript, Node test runner, Vercel.

## Global Constraints

- Không tin `ownerMetaUserId` do client gửi lên.
- Truy cập mẫu của tài khoản khác trả `404`.
- Không làm mất hoặc nhân đôi mẫu cũ.
- Seeding đang tách chủ sở hữu phải tiếp tục hoạt động như cũ.

---

### Task 1: Khóa mẫu Đối tượng theo chủ sở hữu

**Files:**
- Modify: `src/db.js`
- Modify: `src/postgres-db.js`
- Modify: `src/postgres-schema.js`
- Modify: `src/request-handler.js`
- Test: `test/auth-routes.test.js`
- Test: `test/postgres-db.test.js`
- Test: `test/postgres-schema.test.js`

- [ ] Viết test hai tài khoản không đọc hoặc thay đổi mẫu Đối tượng của nhau.
- [ ] Chạy test mục tiêu và xác nhận test thất bại.
- [ ] Bổ sung `owner_meta_user_id`, index và chữ ký CRUD nhận chủ sở hữu.
- [ ] Lấy chủ sở hữu từ session trong toàn bộ route Đối tượng.
- [ ] Chạy lại test mục tiêu.

### Task 2: Tách thư viện Cuộc trò chuyện

**Files:**
- Modify: `src/request-handler.js`
- Modify: `src/db.js`
- Modify: `src/postgres-schema.js`
- Test: `test/conversation-template-routes.test.js`
- Test: `test/template-migration.test.js`

- [ ] Đổi test thư viện chung thành test cô lập hai tài khoản.
- [ ] Chạy test mục tiêu và xác nhận test thất bại.
- [ ] Thay owner dùng chung bằng `session.metaUserId` trong collection và item routes.
- [ ] Thêm migration một lần cho dữ liệu Cuộc trò chuyện dùng chung cũ.
- [ ] Chạy lại test mục tiêu.

### Task 3: Đồng bộ giao diện thư viện riêng

**Files:**
- Modify: `public/workspace.js`
- Modify: `public/app.js`
- Test: `test/workspace.test.js`
- Test: `test/tree-interactions.test.js`

- [ ] Viết test nhãn `Thư viện của tôi` và reset state khi đổi tài khoản.
- [ ] Chạy test mục tiêu và xác nhận test thất bại.
- [ ] Cập nhật nhãn và luồng xóa/tải lại resources theo kết nối Meta.
- [ ] Chạy lại test giao diện.

### Task 4: Xác minh và deploy

**Files:**
- Verify: `package.json`
- Deploy: Vercel project `creative-campaign-lgclinic`

- [ ] Chạy toàn bộ test.
- [ ] Chạy production build.
- [ ] Deploy bằng `npx vercel deploy --prod --yes --scope ducndna-5064s-projects --project creative-campaign-lgclinic`.
- [ ] Xác nhận alias production và báo kết quả.


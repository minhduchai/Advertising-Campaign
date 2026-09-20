# Thư viện đối tượng dùng chung Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cho phép lưu, cập nhật, nhân bản, xóa và dùng lại cấu hình targeting trong thư viện chung của tool.

**Architecture:** Thêm bảng `audience_templates` không gắn owner, triển khai cùng contract ở SQLite và Postgres, expose CRUD qua request handler, rồi nối UI targeting hiện có với thư viện tool song song Saved Audience chỉ đọc từ Meta. Client dùng namespace ID để phân biệt hai nguồn.

**Tech Stack:** Node.js ES modules, SQLite, Neon Postgres, HTML/CSS/JavaScript thuần, `node:test`.

## Global Constraints

- Mọi người dùng tool dùng chung thư viện.
- Không tạo hoặc sửa Saved Audience trên Meta.
- Không làm mất targeting đang nhập khi API lỗi.
- ID mẫu tool không xung đột ID Meta.
- Dữ liệu cũ tiếp tục hoạt động.

---

### Task 1: Persistence và validation mẫu đối tượng

**Files:**
- Create: `src/audience-template.js`
- Modify: `src/db.js`
- Modify: `src/postgres-db.js`
- Modify: `src/postgres-schema.js`
- Test: `test/db.test.js`
- Test: `test/postgres-db.test.js`
- Test: `test/postgres-schema.test.js`

**Interfaces:**
- Produces: `validateAudienceTemplate(input)`, `listAudienceTemplates()`, `createAudienceTemplate(input)`, `updateAudienceTemplate(id, input)`, `deleteAudienceTemplate(id)`, `duplicateAudienceTemplate(id, name)`.

- [ ] Viết test thất bại cho CRUD dùng chung, validation và schema.
- [ ] Thêm bảng `audience_templates` với `id`, `name`, `content_json`, `created_at`, `updated_at` và unique index tên không phân biệt hoa thường.
- [ ] Triển khai cùng contract cho SQLite/Postgres và namespace ID `tool_audience_`.
- [ ] Chạy test database mục tiêu và xác nhận đạt.

### Task 2: API CRUD thư viện đối tượng

**Files:**
- Modify: `src/request-handler.js`
- Modify: `public/api.js`
- Test: `test/auth-routes.test.js`
- Test: `test/client-api.test.js`

**Interfaces:**
- Consumes: database contract từ Task 1.
- Produces: `GET/POST /api/audience-templates`, `PUT/DELETE /api/audience-templates/:id`, `POST /api/audience-templates/:id/duplicate`.

- [ ] Viết test thất bại cho CRUD, lỗi validation và ID không tồn tại.
- [ ] Thêm route JSON không phụ thuộc kết nối Meta nhưng vẫn yêu cầu phiên ứng dụng hợp lệ.
- [ ] Chuẩn hóa response `{ templates }` hoặc `{ template }` và status 400/404.
- [ ] Chạy test route/client API mục tiêu và xác nhận đạt.

### Task 3: Giao diện lưu và quản lý đối tượng

**Files:**
- Modify: `public/state.js`
- Modify: `public/workspace.js`
- Modify: `public/app.js`
- Modify: `public/app.css`
- Test: `test/client-state.test.js`
- Test: `test/workspace.test.js`
- Test: `test/activity-history-interactions.test.js`

**Interfaces:**
- Consumes: API CRUD Task 2 và Saved Audience Meta hiện có.
- Produces: picker phân nhóm `Thư viện của tool` / `Meta Ads`, nút lưu/cập nhật/nhân bản/xóa và trạng thái khóa targeting.

- [ ] Viết test thất bại cho tạo mới, áp dụng mẫu, cập nhật, nhân bản, xóa và khóa trường.
- [ ] Tải thư viện tool khi khởi tạo workspace; lỗi tải chỉ hiển thị cảnh báo và thử lại.
- [ ] Render ô tên cùng các hành động ở cuối targeting; giữ picker Meta chỉ đọc.
- [ ] Áp dụng đầy đủ targeting và tách mẫu khi chọn `Tạo đối tượng mới`.
- [ ] Thêm CSS đồng bộ giao diện hiện tại và chạy test mục tiêu.

### Task 4: Build, kiểm tra và deploy

**Files:**
- Generated: client bundle qua build script hiện có.

**Interfaces:**
- Produces: production deployment tại `https://creative-campaign-lgclinic.vercel.app`.

- [ ] Chạy test mục tiêu cho database, API, state và workspace.
- [ ] Chạy `npm run build`.
- [ ] Deploy bằng `npx vercel --prod --yes`.
- [ ] Kiểm tra thủ công tạo mẫu, F5, chọn lại mẫu và áp dụng sang nhóm quảng cáo khác.

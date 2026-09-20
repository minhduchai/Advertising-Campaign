# History Tab and Seeding Diagnostics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tạo tab lịch sử dạng bảng tối giản, đồng bộ màu Saved Audience và bảo đảm lỗi seeding được phát hiện, lưu và hiển thị rõ.

**Architecture:** Dùng `activeWorkspace` hiện có để thêm workspace lịch sử thay vì drawer. Chuẩn hóa dữ liệu lịch sử thành từng dòng quảng cáo ở client. Giữ seeding runner hiện có nhưng bổ sung kiểm tra capability và bằng chứng lỗi ở từng ranh giới API.

**Tech Stack:** Node.js, JavaScript ES modules, HTML/CSS, Meta Graph API, Node test runner.

## Global Constraints

- Lịch sử chỉ hiển thị sáu trường đã duyệt.
- Mỗi quảng cáo là một dòng.
- Không báo comment thành công khi chưa có Meta Comment ID.
- Không thêm dependency mới.

---

### Task 1: Đồng bộ màu Saved Audience

**Files:**
- Modify: `public/app.css`
- Test: `test/workspace.test.js`

- [ ] Viết assertion CSS dùng biến màu giao diện thay vì màu trắng cố định.
- [ ] Chạy test để xác nhận assertion thất bại.
- [ ] Thay màu nền, viền, chữ và chip bằng biến theme hiện có.
- [ ] Chạy lại test và build client.

### Task 2: Chuyển lịch sử thành workspace

**Files:**
- Modify: `public/index.html`
- Modify: `public/app.js`
- Modify: `public/activity-history.js`
- Modify: `public/app.css`
- Test: `test/activity-history-interactions.test.js`
- Test: `test/activity-history.test.js`

- [ ] Viết test yêu cầu tab thứ ba và loại bỏ drawer.
- [ ] Viết test bảng gồm thời gian, tài khoản, chiến dịch, nhóm, quảng cáo, link Post.
- [ ] Chuyển điều hướng lịch sử sang `activeWorkspace = 'history'`.
- [ ] Render bảng lịch sử toàn trang và giữ bộ lọc ngày/tải thêm.
- [ ] Chạy test lịch sử và build client.

### Task 3: Chẩn đoán và sửa seeding

**Files:**
- Modify: `src/seeding-service.js`
- Modify: `src/request-handler.js`
- Modify: `public/seeding-runner.js`
- Modify: `public/workspace.js`
- Test: `test/seeding-service.test.js`
- Test: `test/seeding-runner.test.js`

- [ ] Tạo test tái hiện trường hợp thiếu capability hoặc Comment ID.
- [ ] Theo dấu dữ liệu từ Post ID đến `createPageComment` và xác định điểm dừng.
- [ ] Bổ sung kiểm tra quyền/token trước khi tạo job hoặc gửi comment.
- [ ] Lưu lỗi Meta cụ thể vào job và hiển thị trong kết quả.
- [ ] Chạy toàn bộ test seeding.

### Task 4: Xác minh và deploy

**Files:**
- Verify: toàn bộ file thay đổi

- [ ] Chạy test liên quan và `npm run build`.
- [ ] Deploy production bằng Vercel.
- [ ] Kiểm tra `/health` và trang chủ trả HTTP 200.

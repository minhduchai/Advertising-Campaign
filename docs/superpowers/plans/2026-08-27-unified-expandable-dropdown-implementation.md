# Unified Expandable Dropdown Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Thống nhất các dropdown lựa chọn dữ liệu bằng một component mở rộng liền khối, có tìm kiếm, bàn phím và dark/light.

**Architecture:** `public/workspace.js` cung cấp renderer dùng chung và chuyển các field hiện tại sang cấu trúc mới. `public/app.js` quản lý mở/đóng, tìm kiếm, chọn và bàn phím bằng event delegation; `public/app.css` cung cấp giao diện và animation thống nhất.

**Tech Stack:** JavaScript ES modules, HTML template strings, CSS, Node test runner.

## Global Constraints

- Giữ nguyên API, dữ liệu, validation và nghiệp vụ hiện tại.
- Không thay menu ba chấm, bộ chọn ngày, accordion báo cáo và JSON kỹ thuật.
- Chỉ một dropdown mở tại một thời điểm.
- Không làm trang nhảy vị trí khi mở, chọn hoặc đóng.
- Hỗ trợ light/dark và bàn phím.

---

### Task 1: Hợp đồng renderer dropdown

**Files:**
- Modify: `test/workspace.test.js`
- Modify: `public/workspace.js`

**Interfaces:**
- Produces: markup `data-expand-select`, `data-expand-select-trigger`, `data-expand-select-option`, `data-expand-select-search`.

- [ ] Viết test thất bại cho cấu trúc dropdown chung, trạng thái selected/restricted và chế độ có hoặc không có tìm kiếm.
- [ ] Chạy `node --test test/workspace.test.js` và xác nhận test mới thất bại.
- [ ] Tạo renderer chung và chuyển tài khoản quảng cáo, Page, hạng mục đặc biệt, đối tượng đã lưu, Custom Audience và tuổi sang renderer.
- [ ] Chạy lại `node --test test/workspace.test.js`.

### Task 2: Tương tác dropdown

**Files:**
- Modify: `test/workspace.test.js`
- Modify: `public/app.js`

**Interfaces:**
- Consumes: các data attribute từ Task 1.
- Produces: mở/đóng, lọc, chọn, Escape và điều hướng bàn phím.

- [ ] Viết test thất bại cho việc chỉ mở một dropdown, lọc danh sách và đóng sau khi chọn.
- [ ] Chạy test và xác nhận thất bại đúng hành vi thiếu.
- [ ] Thêm event delegation, giữ focus và cập nhật field/action cũ.
- [ ] Chạy lại test tương tác.

### Task 3: Mẫu trò chuyện và seeding

**Files:**
- Modify: `test/workspace.test.js`
- Modify: `public/workspace.js`
- Modify: `public/app.js`

**Interfaces:**
- Consumes: renderer và controller dropdown dùng chung.
- Produces: template picker cùng UX với các dropdown còn lại nhưng giữ tạo/xóa/lưu mẫu.

- [ ] Viết test thất bại cho template picker mới.
- [ ] Chuyển hai thư viện mẫu sang cấu trúc dùng chung.
- [ ] Xác minh chọn, tạo và xóa mẫu không reload trang.

### Task 4: CSS và xác minh local

**Files:**
- Modify: `public/app.css`
- Test: `test/workspace.test.js`
- Test: `test/theme.test.js`

**Interfaces:**
- Consumes: markup hoàn chỉnh từ ba task trước.
- Produces: giao diện kéo dài liền khối và animation 150–300 ms.

- [ ] Viết assertion CSS cho animation, focus, restricted và reduced-motion.
- [ ] Thêm CSS light/dark responsive, vùng bấm tối thiểu 44 px và cuộn nội bộ.
- [ ] Chạy `node --test test/workspace.test.js test/theme.test.js`.
- [ ] Chạy `npm run build`.
- [ ] Khởi động server local tại `http://localhost:3001`.


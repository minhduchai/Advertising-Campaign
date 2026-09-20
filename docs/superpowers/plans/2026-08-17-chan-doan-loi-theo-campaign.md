# Chẩn Đoán Lỗi Theo Campaign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cho phép mở và đọc lỗi theo từng Campaign trong tiến độ hiện tại và Lịch sử hoạt động.

**Architecture:** Dùng `campaignClientId` làm bộ lọc hiển thị, không thay đổi dữ liệu run. Một helper thu thập node theo quan hệ `parentClientId`; Activity History lọc snapshot và dựng khối chẩn đoán từ node/seeding hiện có.

**Tech Stack:** JavaScript ES modules, CSS, Node.js built-in test runner.

## Global Constraints

- Không thay đổi dữ liệu run hoặc snapshot đã lưu.
- Escape toàn bộ nội dung lỗi từ Meta.
- Tương thích action lịch sử cũ `open-history-run`.
- Hoạt động bằng chuột và bàn phím.

---

### Task 1: Sửa click lịch sử

**Files:** `public/app.js`, `public/activity-history.js`, `test/activity-history-interactions.test.js`

- [ ] Viết test action mới và campaign filter.
- [ ] Xử lý `open-history-report` cùng action cũ.
- [ ] Lưu/xóa `selectedCampaignClientId` đúng lúc.

### Task 2: Chẩn đoán lịch sử

**Files:** `public/activity-history.js`, `public/app.css`, `test/activity-history.test.js`

- [ ] Lọc bảng theo Campaign được chọn.
- [ ] Dựng khối lỗi theo node và seeding.
- [ ] Thêm nút xem toàn bộ và style responsive/light-dark.

### Task 3: Click tiến độ Campaign

**Files:** `public/workspace.js`, `public/app.js`, `public/app.css`, `test/workspace.test.js`, `test/publish-progress-interactions.test.js`

- [ ] Biến dòng Campaign thành button có action.
- [ ] Mở Results Drawer lọc đúng Campaign.
- [ ] Hiển thị số lỗi và nút bỏ lọc.

### Task 4: Xác minh và deploy

- [ ] Chạy build và toàn bộ test suite.
- [ ] Deploy production project `creative-campaign-lgclinic`.
- [ ] Kiểm tra production HTTP 200.

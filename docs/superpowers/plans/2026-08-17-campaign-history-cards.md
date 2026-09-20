# Campaign History Cards Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Hiển thị mỗi Campaign thành một card có thể click để mở báo cáo Campaign.

**Architecture:** SQLite và Postgres dựng Campaign summary nhỏ gọn ngay khi liệt kê lịch sử. `activity-history.js` render summary thành card; luồng tải báo cáo hiện có tiếp tục nhận `runId` và `campaignClientId`.

**Tech Stack:** JavaScript ES modules, HTML template strings, CSS, Node test runner.

## Global Constraints

- Không thay đổi dữ liệu lưu trữ hoặc quy trình tạo Ads.
- Hỗ trợ click, bàn phím, light/dark mode và mobile.
- Dữ liệu lịch sử cũ vẫn xem được.

---

### Task 1: Campaign cards

**Files:**
- Modify: `public/activity-history.js`
- Modify: `public/app.css`
- Test: `test/activity-history.test.js`

- [ ] Viết test cho card Campaign có thể click toàn bộ.
- [ ] Chạy test để xác nhận thất bại.
- [ ] Thay wrapper Campaign bằng nút semantic và bỏ card tổng lượt tạo dư thừa.
- [ ] Đồng bộ CSS desktop, mobile, light và dark.
- [ ] Chạy test tập trung và toàn bộ test.
- [ ] Deploy production và kiểm tra HTTP 200.

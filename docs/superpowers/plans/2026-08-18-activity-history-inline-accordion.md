# Activity History Inline Accordion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mở báo cáo Campaign trực tiếp trong card Lịch sử hoạt động bằng accordion một-card-mở.

**Architecture:** Giữ API lịch sử hiện tại và dùng cặp `selectedRunId`/`selectedCampaignClientId` làm trạng thái accordion. Renderer danh sách chèn báo cáo chi tiết ngay sau card đang chọn; trình xử lý click tải hoặc đóng chi tiết mà không đổi workspace.

**Tech Stack:** JavaScript ES modules, HTML/CSS, Node test runner.

## Global Constraints

- Không chuyển sang màn hình chi tiết riêng.
- Chỉ một Campaign mở tại một thời điểm.
- Giữ nguyên dữ liệu báo cáo Ads, seeding và link Post.

---

### Task 1: Hành vi accordion

**Files:**
- Modify: `public/activity-history.js`
- Modify: `public/app.js`
- Test: `test/activity-history.test.js`
- Test: `test/activity-history-interactions.test.js`

**Interfaces:**
- Consumes: `selectedRunId`, `selectedCampaignClientId`, `detail`, `detailLoading`, `loadActivityHistoryDetail(runId)`.
- Produces: card Campaign có `data-action="toggle-history-campaign"`, `aria-expanded`, và nội dung báo cáo nội tuyến.

- [ ] Viết kiểm thử renderer cho Campaign đóng và Campaign đang mở.
- [ ] Chạy kiểm thử để xác nhận hành vi mới chưa tồn tại.
- [ ] Đổi click Campaign sang đóng/mở tại chỗ và tải chi tiết khi cần.
- [ ] Chạy kiểm thử renderer và interaction.

### Task 2: Trình bày accordion

**Files:**
- Modify: `public/app.css`

**Interfaces:**
- Consumes: `.history-campaign-card`, `.history-campaign-inline-detail`, trạng thái `.is-expanded`.
- Produces: chuyển động mũi tên, viền card đang mở, bảng báo cáo không tràn chiều ngang.

- [ ] Thêm CSS card mở, vùng tải/lỗi và báo cáo nội tuyến.
- [ ] Kiểm tra giao diện light/dark và responsive tại local.
- [ ] Chạy toàn bộ kiểm thử liên quan lịch sử.


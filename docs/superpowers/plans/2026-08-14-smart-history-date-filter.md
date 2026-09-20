# Smart History Date Filter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Thay hai input ngày bằng date-range picker hai tháng và hiển thị tên tài khoản quảng cáo.

**Architecture:** Lưu trạng thái popup/bản nháp trong activity history state; render lịch bằng hàm thuần; xử lý sự kiện tại app; truyền catalog tài khoản vào renderer.

### Task 1
- [ ] Thêm state và hàm render lịch hai tháng.
- [ ] Thêm preset, chọn range, chuyển tháng, Hủy/Áp dụng.
- [ ] Ánh xạ ID tài khoản sang tên.
- [ ] Kiểm thử, build và deploy.

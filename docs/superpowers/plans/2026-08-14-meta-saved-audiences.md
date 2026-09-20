# Meta Saved Audiences Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dùng Saved Audiences thật từ Meta trong từng nhóm quảng cáo.

**Architecture:** Meta client đọc Saved Audiences theo ad account, server chuẩn hóa dữ liệu, UI áp dụng targeting vào Ad Set.

**Tech Stack:** Node.js, Meta Marketing API, browser JavaScript.

## Global Constraints

- Không lộ access token.
- Chỉ đọc Saved Audiences.
- Không âm thầm làm sai cấu trúc targeting phức tạp.

### Task 1: Meta Saved Audience API
- [ ] Viết test thất bại cho phân trang và chuẩn hóa targeting.
- [ ] Thêm `listSavedAudiences` vào Meta client.
- [ ] Chạy test đạt.

### Task 2: Account resources
- [ ] Viết test route thất bại khi chưa trả Saved Audiences.
- [ ] Trả Saved Audiences trong tài nguyên từng ad account.
- [ ] Chạy test đạt.

### Task 3: Browser selector
- [ ] Viết test trạng thái và render thất bại.
- [ ] Thay thư viện CRUD bằng selector Meta chỉ đọc.
- [ ] Áp dụng targeting và hiển thị lỗi không tương thích.
- [ ] Chạy test đạt.

### Task 4: Verification and deploy
- [ ] Chạy build và test liên quan.
- [ ] Deploy production và kiểm tra health.


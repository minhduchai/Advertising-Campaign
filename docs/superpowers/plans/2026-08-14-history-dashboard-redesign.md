# History Dashboard Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Biến danh sách lịch sử dạng text thành dashboard card dễ quét.

**Architecture:** Giữ nguyên API và dữ liệu; chỉ cải thiện semantic markup trong `activity-history.js` và stylesheet responsive trong `app.css`.

**Tech Stack:** HTML template strings, CSS variables, Node test runner.

### Task 1: Dashboard markup và style

- [ ] Thêm tổng số lượt tạo và nhãn hành động vào markup.
- [ ] Tạo layout filter card, history card, badge và responsive CSS.
- [ ] Cập nhật test render để kiểm tra các thành phần mới.
- [ ] Build, deploy và kiểm tra production.

# Tiến độ tổng tạo quảng cáo và seeding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Hiển thị một vòng tiến độ tổng cho lượt chạy và phần trăm riêng của từng chiến dịch trong panel Kiểm tra.

**Architecture:** Mở rộng `run-progress.js` thành bộ tổng hợp thuần dữ liệu từ draft, publish nodes và seeding jobs. `workspace.js` chỉ render model thành vòng SVG cùng danh sách campaign; app tiếp tục cập nhật cùng progress object nên không thêm request hoặc persistence.

**Tech Stack:** JavaScript ES modules, SVG/CSS, `node:test`.

## Global Constraints

- Một vòng tổng duy nhất cho cả tạo Ads và seeding.
- Mỗi Post ID chỉ tính một bước trong campaign tương ứng.
- Không gọi thêm API hoặc tạo migration.
- Hỗ trợ dark theme và `prefers-reduced-motion`.

---

### Task 1: Progress model tổng và theo campaign

**Files:**
- Modify: `public/run-progress.js`
- Test: `test/run-progress.test.js`

**Interfaces:**
- Produces: `progress.overall` và `progress.campaigns[]` gồm `clientId`, `name`, `completed`, `total`, `percent`, `phase`, `status`.

- [ ] Viết test nhiều campaign, seeding job, Post ID trùng và lỗi terminal.
- [ ] Nhóm publish nodes về campaign bằng parent chain.
- [ ] Nhóm seeding jobs theo campaign/Post ID và chỉ tính mỗi Post ID một lần.
- [ ] Tính phase/status tổng và theo campaign, giữ tương thích các field cũ.
- [ ] Chạy `node --test test/run-progress.test.js`.

### Task 2: Vòng tiến độ và danh sách campaign

**Files:**
- Modify: `public/workspace.js`
- Modify: `public/app.css`
- Test: `test/workspace.test.js`

**Interfaces:**
- Consumes: progress model Task 1.
- Produces: SVG progress ring, trạng thái tổng, campaign rows và progress bars.

- [ ] Viết test HTML/ARIA cho vòng tổng và campaign rows.
- [ ] Render vòng SVG bằng `stroke-dashoffset` từ phần trăm chuẩn hóa.
- [ ] Render nhãn trạng thái và số bước hoàn tất.
- [ ] Render mỗi campaign với phần trăm, phase và thanh tiến độ.
- [ ] Thêm animation tiết chế, trạng thái lỗi và reduced-motion CSS.
- [ ] Chạy `node --test test/workspace.test.js test/run-progress.test.js`.

### Task 3: Tích hợp cập nhật seeding và deploy

**Files:**
- Modify: `public/app.js` nếu cần.
- Test: `test/seeding-interactions.test.js`
- Test: `test/activity-history-interactions.test.js`

**Interfaces:**
- Consumes: snapshot seeding cập nhật từ runner hiện có.
- Produces: vòng và campaign progress cập nhật trong lúc tạo/seeding mà không reset scroll/focus.

- [ ] Viết test tương tác cho cập nhật sau publish và mỗi bước seeding.
- [ ] Bảo đảm merge snapshot gọi recalculation trước render.
- [ ] Chạy test mục tiêu và `npm run build`.
- [ ] Deploy bằng `npx vercel --prod --yes`.
- [ ] Kiểm tra một lượt nhiều campaign trong panel Kiểm tra.

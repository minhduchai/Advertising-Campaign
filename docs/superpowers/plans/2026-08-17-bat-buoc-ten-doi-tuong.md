# Bắt Buộc Tên Đối Tượng Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mọi Campaign, Ad Set và Ad mới phải được người dùng nhập tên trước khi tạo trên Meta.

**Architecture:** Giữ nguyên validation server hiện có vì đã chặn chuỗi rỗng và khoảng trắng đúng path. Thay đổi factory phía client để tên mặc định rỗng, giữ nhãn dự phòng trong cây cấu trúc và thêm placeholder rõ ràng ở editor.

**Tech Stack:** JavaScript ES modules, HTML rendering, Node.js built-in test runner.

## Global Constraints

- Không sửa dữ liệu hoặc lịch sử cũ.
- Không thêm hậu tố khi tạo đối tượng tương tự.
- Không thay đổi payload Meta khi tên hợp lệ.
- Không thêm dependency.

---

### Task 1: Khóa hành vi bằng kiểm thử

**Files:**
- Modify: `test/client-state.test.js`
- Modify: `test/draft.test.js`
- Modify: `test/workspace.test.js`

- [ ] Kiểm tra factory tạo ba tên rỗng.
- [ ] Kiểm tra validation chặn tên rỗng và chỉ có khoảng trắng ở đúng path.
- [ ] Kiểm tra editor có placeholder và cây vẫn hiển thị nhãn dự phòng.
- [ ] Chạy kiểm thử tập trung và xác nhận thất bại vì factory còn tự điền tên.

### Task 2: Sửa default và giao diện

**Files:**
- Modify: `public/state.js`
- Modify: `public/workspace.js`

- [ ] Đổi `createCampaign`, `createAdSet`, `createAd` sang `name: ''`.
- [ ] Truyền placeholder tiếng Việt vào ba trường tên.
- [ ] Giữ nguyên fallback `nodeLabels` trong tree và heading.
- [ ] Chạy lại kiểm thử tập trung và xác nhận đạt.

### Task 3: Xác minh và phát hành

**Files:**
- Không tạo thêm file production.

- [ ] Chạy build và toàn bộ test suite.
- [ ] Deploy production vào project `creative-campaign-lgclinic`, scope `ducndna-5064s-projects`.
- [ ] Xác nhận URL production và trạng thái deployment.

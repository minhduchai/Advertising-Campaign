# Upload Agent Installer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Phát hành một bộ cài Windows tự chứa và biến nút **Chọn qua Agent** thành luồng tự phát hiện, xin phép tải, chờ cài, ghép nối và chọn file.

**Architecture:** Bundle toàn bộ Local Upload Agent thành một entry JavaScript duy nhất bằng esbuild, đóng gói với Node Single Executable Application và trình cài Windows. Website gọi health loopback; khi không thấy Agent, một modal có xác nhận rõ ràng mới cho phép tải bộ cài. Sau khi tải, website polling health và tiếp tục ghép nối mà không cần tải lại trang.

**Tech Stack:** Node.js SEA, esbuild, PowerShell, Windows Task Scheduler, HTML/CSS/JavaScript hiện có, Node test runner, Vercel.

## Global Constraints

- Không tải bộ cài trước khi người dùng bấm **Đồng ý tải Agent**.
- Trình duyệt không tự chạy file tải xuống.
- Windows UAC vẫn là bước xác nhận bắt buộc của người dùng.
- Agent chỉ lắng nghe tại `127.0.0.1:47831`.
- Máy khách không cần cài Node.js.
- Nếu người dùng hủy, không phát sinh download.
- Nếu Agent không dùng được, luôn cho phép chọn file bằng trình duyệt.
- Không tạo commit vì workspace hiện tại không được yêu cầu commit.

---

### Task 1: Đóng gói Agent thành executable tự chứa

**Files:**
- Create: `upload-agent/src/sea-entry.js`
- Create: `upload-agent/sea-config.json`
- Create: `upload-agent/scripts/build-windows-installer.ps1`
- Create: `upload-agent/installer/MetaCampaignUploadAgent.iss`
- Modify: `upload-agent/package.json`
- Test: `upload-agent/test/installer-build.test.js`

**Interfaces:**
- Produces: `dist/upload-agent/MetaCampaignUploadAgentSetup.exe` và `dist/upload-agent/version.json`.
- Consumes: server hiện tại từ `upload-agent/src/server.js` và cấu hình mặc định production.

- [ ] **Step 1: Viết test thất bại cho hợp đồng build**

Test phải xác nhận script build tồn tại, SEA entry khởi động server, installer tạo Scheduled Task khi đăng nhập, và manifest có `version`, `fileName`, `sha256`.

- [ ] **Step 2: Chạy test để xác nhận thất bại**

Run: `node --test upload-agent/test/installer-build.test.js`

Expected: FAIL vì các file build chưa tồn tại.

- [ ] **Step 3: Bundle server Agent thành một file**

`sea-entry.js` gọi đúng bootstrap server hiện tại; script PowerShell chạy esbuild với `platform=node`, tạo SEA blob bằng Node, inject blob vào bản sao `node.exe`, sau đó tạo installer Windows.

- [ ] **Step 4: Tạo installer**

Installer cài executable và file cấu hình vào `%LOCALAPPDATA%\MetaCampaignUploadAgent`, đăng ký tự chạy ở logon, khởi động Agent sau khi cài, cung cấp uninstall và không yêu cầu Node.js.

- [ ] **Step 5: Sinh manifest phát hành**

Script tính SHA-256 của installer và ghi:

```json
{
  "version": "1.0.0",
  "fileName": "MetaCampaignUploadAgentSetup.exe",
  "sha256": "<64 ký tự hex>"
}
```

- [ ] **Step 6: Chạy test Agent và test installer**

Run: `npm test --prefix upload-agent`

Expected: PASS toàn bộ.

---

### Task 2: Phát hành installer qua website

**Files:**
- Create: `src/upload-agent-installer.js`
- Modify: `src/request-handler.js`
- Modify: `vercel.json`
- Test: `test/upload-agent-installer-route.test.js`

**Interfaces:**
- Produces: `GET /api/upload-agent/installer`, trả file download; `GET /api/upload-agent/installer/version`, trả manifest công khai.
- Consumes: artifact và manifest từ Task 1.

- [ ] **Step 1: Viết test route thất bại**

Test yêu cầu route version trả JSON không chứa secret; route installer trả `application/vnd.microsoft.portable-executable`, `Content-Disposition: attachment`, và stream đúng artifact.

- [ ] **Step 2: Chạy test để xác nhận thất bại**

Run: `node --test test/upload-agent-installer-route.test.js`

Expected: FAIL với route chưa tồn tại.

- [ ] **Step 3: Thêm module phân phối installer**

Module chỉ chấp nhận file name cố định từ manifest, kiểm tra SHA-256 khi bootstrap, không nhận path từ request và không cho directory traversal.

- [ ] **Step 4: Đăng ký route**

Thêm hai route trước fallback `/api/*`; download chỉ dùng `GET`, các method khác trả `405`.

- [ ] **Step 5: Chạy test route và publish route**

Run: `node --test test/upload-agent-installer-route.test.js test/publish-routes.test.js`

Expected: PASS.

---

### Task 3: Luồng phát hiện và xác nhận cài Agent trên giao diện

**Files:**
- Modify: `public/upload-agent-client.js`
- Modify: `public/app.js`
- Modify: `public/workspace.js`
- Modify: `public/app.css`
- Test: `test/upload-agent-interactions.test.js`
- Test: `test/workspace.test.js`

**Interfaces:**
- Produces: `ensureInstalled({ onConsentRequired, onWaiting })` và modal trạng thái cài đặt.
- Consumes: `detect()`, `pair()`, endpoint installer/version từ Task 2.

- [ ] **Step 1: Viết test hành vi thất bại**

Các test phải chứng minh:
- Agent có sẵn thì không hiện modal và không download.
- Agent vắng mặt thì hiện modal xác nhận.
- Bấm hủy không tạo navigation/download.
- Bấm đồng ý mới mở `/api/upload-agent/installer`.
- Trạng thái chờ cài polling health, có nút **Kiểm tra lại**.
- Agent xuất hiện thì tự ghép nối và mở chọn file.
- Có nút **Dùng bộ chọn file trình duyệt**.

- [ ] **Step 2: Chạy test để xác nhận thất bại**

Run: `node --test test/upload-agent-interactions.test.js test/workspace.test.js`

Expected: FAIL vì chưa có modal và installer flow.

- [ ] **Step 3: Mở rộng Upload Agent client**

Phân biệt rõ `UPLOAD_AGENT_UNAVAILABLE`, `UPLOAD_AGENT_UNPAIRED`, và lỗi job; thêm polling có giới hạn, hủy polling khi modal đóng và không tạo nhiều health request đồng thời.

- [ ] **Step 4: Tạo modal xác nhận**

Modal có tiêu đề **Cần cài Upload Agent**, mô tả quyền truy cập ổ mạng, phiên bản, checksum rút gọn, nút **Đồng ý tải Agent**, **Hủy**, **Kiểm tra lại**, và **Dùng bộ chọn file trình duyệt** theo từng trạng thái.

- [ ] **Step 5: Tích hợp với nút Chọn qua Agent**

Một lần bấm chạy detect; có Agent thì chọn file, chưa có thì mở modal. Sau khi polling thấy Agent, tiếp tục chính thao tác upload đang chờ.

- [ ] **Step 6: Hoàn thiện CSS sáng/tối và responsive**

Modal không tràn viewport, focus rõ ràng, nút tối thiểu 44 px, hỗ trợ reduced motion và cả theme sáng/tối.

- [ ] **Step 7: Chạy test giao diện**

Run: `node --test test/upload-agent-interactions.test.js test/workspace.test.js`

Expected: PASS.

---

### Task 4: Kiểm thử tích hợp và phát hành production

**Files:**
- Modify: `upload-agent/README.md`
- Modify: `docs/superpowers/specs/2026-08-17-upload-agent-installer-design.md` nếu artifact thực tế cần ghi rõ phiên bản.

**Interfaces:**
- Consumes: installer, route download và UI hoàn chỉnh.
- Produces: production website và installer có thể tải trên máy Windows mới.

- [ ] **Step 1: Build installer sạch**

Run: `powershell -ExecutionPolicy Bypass -File upload-agent/scripts/build-windows-installer.ps1`

Expected: installer và manifest được tạo, checksum khớp.

- [ ] **Step 2: Chạy toàn bộ test**

Run: `npm test`

Expected: PASS toàn bộ test.

- [ ] **Step 3: Kiểm tra thủ công trên máy chưa chạy Agent**

Dừng Agent hiện tại, bấm **Chọn qua Agent**, xác nhận modal xuất hiện và bấm **Hủy** không tải file.

- [ ] **Step 4: Kiểm tra tải và cài**

Bấm đồng ý tải, tự mở installer, chấp thuận UAC, xác nhận `http://127.0.0.1:47831/health` trả `{"ok":true}` và website tự tiếp tục ghép nối.

- [ ] **Step 5: Kiểm tra tự khởi động**

Khởi động lại tác vụ đăng nhập hoặc chạy Scheduled Task, xác nhận Agent hoạt động mà không cần cài lại.

- [ ] **Step 6: Deploy Vercel production**

Run:

```powershell
npx vercel deploy --prod --yes --scope ducndna-5064s-projects --project creative-campaign-lgclinic
```

Expected: alias `https://creative-campaign-lgclinic.vercel.app/` trả HTTP 200.

## Self-review

- Mọi yêu cầu trong đặc tả đều có task tương ứng.
- Không có placeholder hoặc hành vi cài đặt im lặng.
- Tên endpoint, artifact và hàm giao diện nhất quán giữa các task.
- Luồng fallback trình duyệt được giữ lại khi Agent không thể cài hoặc chạy.

# Local Upload Agent Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Xây dựng Agent Windows đọc video từ `\\192.168.1.6\marketing`, upload multipart song song lên R2 và trả Media ID cho Meta Campaign Builder.

**Architecture:** Agent HTTP loopback quản lý hàng đợi và đọc file UNC. Vercel giữ toàn bộ khóa R2, phát hành presigned URL cho từng part và hoàn tất multipart; website ghép cặp, giao việc và theo dõi Agent, đồng thời giữ fallback upload trình duyệt.

**Tech Stack:** Node.js ESM, Windows Task Scheduler, AWS SDK S3 multipart, Vercel Node runtime, Cloudflare R2, HTML/CSS/JavaScript hiện có.

## Global Constraints

- Agent chỉ bind `127.0.0.1`.
- Chỉ đọc file dưới `\\192.168.1.6\marketing` sau khi chuẩn hóa đường dẫn.
- Part size 32 MB; concurrency mặc định 4; retry tối đa 5.
- Không lưu khóa R2 hoặc Meta token trong Agent và trình duyệt.
- Đóng tab không dừng upload; Agent phục hồi hàng đợi sau restart.
- Nếu Agent không chạy, upload trình duyệt hiện tại vẫn hoạt động.

---

### Task 1: Hợp đồng multipart R2 phía server

**Files:**
- Modify: `src/r2-media.js`
- Modify: `src/request-handler.js`
- Modify: `public/api.js`
- Test: `test/r2-media.test.js`
- Test: `test/publish-routes.test.js`

**Interfaces:**
- Produces: `createMultipartUpload`, `presignMultipartPart`, `completeMultipartUpload`, `abortMultipartUpload`.
- Produces HTTP routes dưới `/api/r2-media/multipart/*` trả `mediaId`, `uploadId`, `key`, `partNumber`, `uploadUrl` và kết quả complete.

- [ ] Viết test thất bại cho create, ký part, complete, abort và kiểm tra owner/path/size.
- [ ] Chạy test và xác nhận thất bại vì API chưa tồn tại.
- [ ] Thêm AWS SDK commands và implementation tối thiểu trong `src/r2-media.js`.
- [ ] Thêm routes có session Meta hiện tại và validation chặt trong `src/request-handler.js`.
- [ ] Thêm client methods trong `public/api.js`.
- [ ] Chạy test mục tiêu và xác nhận pass.

### Task 2: Token thiết bị và ghép cặp Agent

**Files:**
- Create: `src/upload-agent-auth.js`
- Modify: `src/postgres-schema.js`
- Modify: `src/postgres-db.js`
- Modify: `src/db.js`
- Modify: `src/request-handler.js`
- Test: `test/upload-agent-auth.test.js`
- Test: `test/database-contract.js`

**Interfaces:**
- Produces: `createPairingCode(ownerId)`, `exchangePairingCode(code, device)`, `authenticateAgentToken(token)`.
- Produces routes `/api/upload-agent/pair`, `/api/upload-agent/exchange`, `/api/upload-agent/session`.

- [ ] Viết test thất bại cho mã một lần, hết hạn, token thu hồi và owner isolation.
- [ ] Thêm schema/bộ nhớ lưu hash token thiết bị, không lưu plaintext.
- [ ] Implement HMAC token và pairing code có TTL 10 phút.
- [ ] Thêm routes và validation origin/owner.
- [ ] Chạy database contract và auth tests.

### Task 3: Agent loopback và hàng đợi bền vững

**Files:**
- Create: `upload-agent/package.json`
- Create: `upload-agent/src/server.js`
- Create: `upload-agent/src/config.js`
- Create: `upload-agent/src/path-policy.js`
- Create: `upload-agent/src/job-store.js`
- Create: `upload-agent/src/api-client.js`
- Test: `upload-agent/test/path-policy.test.js`
- Test: `upload-agent/test/job-store.test.js`

**Interfaces:**
- Produces localhost endpoints `/health`, `/pair`, `/jobs`, `/jobs/:id`, `/jobs/:id/pause`, `/resume`, `/cancel`.
- Produces persistent job shape `{id,path,name,size,status,uploadedBytes,speedBps,etaSeconds,mediaId,error}`.

- [ ] Viết test path allowlist, traversal, UNC normalization và file ngoài root.
- [ ] Viết test atomic persistence và phục hồi job sau restart.
- [ ] Implement server chỉ bind loopback và CORS allowlist production/local.
- [ ] Implement pairing storage bằng Windows user data directory.
- [ ] Chạy toàn bộ agent unit tests.

### Task 4: Multipart uploader song song có resume

**Files:**
- Create: `upload-agent/src/multipart-uploader.js`
- Create: `upload-agent/src/job-runner.js`
- Test: `upload-agent/test/multipart-uploader.test.js`
- Test: `upload-agent/test/job-runner.test.js`

**Interfaces:**
- Consumes multipart server API Task 1 và token thiết bị Task 2.
- Produces `runUploadJob(job, {concurrency:4, partSize:33554432, retryLimit:5})`.

- [ ] Viết test file nhiều part, tối đa bốn request đồng thời và ETag đúng thứ tự.
- [ ] Viết test retry riêng part lỗi và resume không gửi lại part hoàn tất.
- [ ] Implement đọc range bằng `fs.createReadStream({start,end})` và PUT presigned URL.
- [ ] Persist ETag sau từng part; tính tốc độ rolling và ETA.
- [ ] Implement pause/cancel/restart recovery và complete/abort.
- [ ] Chạy agent tests và xác nhận tiến độ không giảm.

### Task 5: Tích hợp website và giao diện tiến độ

**Files:**
- Create: `public/upload-agent-client.js`
- Modify: `public/api.js`
- Modify: `public/app.js`
- Modify: `public/workspace.js`
- Modify: `public/app.css`
- Modify: `scripts/build-client.js`
- Test: `test/upload-agent-interactions.test.js`

**Interfaces:**
- Consumes localhost Agent endpoints Task 3.
- Produces UI trạng thái Agent và adapter trả cùng media result mà `uploadMediaFile` đang dùng.

- [ ] Viết interaction tests cho detection, pairing, progress, reattach và fallback.
- [ ] Implement client có timeout ngắn và không chặn trang khi Agent tắt.
- [ ] Thêm nút `Chọn file qua Agent` và card tiến độ gồm %, MB/s, ETA.
- [ ] Gắn Media ID hoàn tất vào ad state hiện tại.
- [ ] Chạy build và interaction tests.

### Task 6: Cài đặt Windows và tài liệu vận hành

**Files:**
- Create: `upload-agent/scripts/install.ps1`
- Create: `upload-agent/scripts/uninstall.ps1`
- Create: `upload-agent/README.md`
- Modify: `.env.example`
- Test: `test/upload-agent-install.test.js`

**Interfaces:**
- Produces Task Scheduler job `MetaCampaignUploadAgent` chạy khi đăng nhập.

- [ ] Viết static tests kiểm tra loopback, thư mục root và command Task Scheduler.
- [ ] Implement installer kiểm tra Node, cài dependency và tạo task theo user hiện tại.
- [ ] Implement uninstaller có lựa chọn giữ dữ liệu hàng đợi.
- [ ] Viết hướng dẫn ghép cặp, chạy foreground và đọc log.
- [ ] Chạy static tests.

### Task 7: Xác minh tích hợp và triển khai

**Files:**
- Modify: `docs/cloudflare-workflow-deployment.md`

**Interfaces:**
- Consumes toàn bộ Tasks 1–6.

- [ ] Chạy `npm test` tại root.
- [ ] Chạy `npm test` trong `upload-agent`.
- [ ] Chạy `npm run build`.
- [ ] Cài Agent local và upload thử một file nhỏ từ share vào R2.
- [ ] Deploy Vercel production theo scope/project hiện tại.
- [ ] Xác minh website fallback khi Agent dừng và reattach khi Agent chạy lại.

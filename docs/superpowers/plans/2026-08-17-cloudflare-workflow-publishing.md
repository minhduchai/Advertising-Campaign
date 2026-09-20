# Cloudflare Workflow Publishing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Chuyển quy trình Campaign → Post ID → seeding sang job nền có thể tiếp tục và retry mà không bị giới hạn 300 giây của Vercel.

**Architecture:** Vercel giữ OAuth, Meta client và Neon. Cloudflare Workflow điều phối bằng các request HMAC tới endpoint nội bộ ngắn, còn trình duyệt theo dõi trạng thái đã lưu trong Neon.

**Tech Stack:** Node.js ESM, Cloudflare Workers/Workflows, Vercel Functions, Neon Postgres, Web Crypto/HMAC, Meta Graph API.

## Global Constraints

- Bắt đầu bằng Cloudflare Workers Free.
- Cloudflare không lưu Meta access token.
- Mỗi bước phải idempotent và không tự tạo lại kết quả chưa xác định.
- Progress chỉ tăng.
- Giữ luồng Vercel cũ sau cờ `WORKFLOW_ENABLED` để rollback.

---

### Task 1: Hợp đồng và chữ ký Workflow

**Files:**
- Create: `src/workflow-auth.js`
- Create: `test/workflow-auth.test.js`
- Modify: `src/config.js`

**Interfaces:**
- Produces: `signWorkflowRequest(input, secret)` và `verifyWorkflowRequest(input, secret, options)`.
- Produces: cấu hình `workflowEnabled`, `workflowUrl`, `workflowSharedSecret`.

- [ ] Viết test HMAC hợp lệ, body bị sửa, timestamp hết hạn và nonce lặp.
- [ ] Chạy `node --test test/workflow-auth.test.js` và xác nhận test thất bại.
- [ ] Cài đặt canonical request và HMAC-SHA256 timing-safe.
- [ ] Chạy lại test và xác nhận pass.

### Task 2: Mô hình kế hoạch bước bền vững

**Files:**
- Create: `src/workflow-plan.js`
- Create: `test/workflow-plan.test.js`
- Modify: `src/run-report.js`

**Interfaces:**
- Produces: `createWorkflowPlan(snapshot)` với step key ổn định.
- Produces: `calculateMonotonicProgress(previous, steps)`.

- [ ] Viết test thứ tự Campaign/Ad Set/Ad/Post ID/seeding và dedupe Post ID.
- [ ] Chạy test để xác nhận thất bại.
- [ ] Cài đặt plan và progress không giảm.
- [ ] Chạy lại test.

### Task 3: API nội bộ Vercel theo bước

**Files:**
- Create: `src/workflow-step-service.js`
- Create: `test/workflow-step-service.test.js`
- Modify: `src/request-handler.js`
- Modify: `src/postgres-db.js`
- Modify: `src/db.js`
- Modify: `src/postgres-schema.js`

**Interfaces:**
- Consumes: chữ ký từ Task 1 và kế hoạch từ Task 2.
- Produces: `POST /api/internal/workflow/runs/:runId/steps/:stepKey`.
- Produces: lưu trạng thái step `pending|running|succeeded|failed|skipped|needs_review`.

- [ ] Viết test endpoint từ chối chữ ký sai và trả lại kết quả của step đã thành công.
- [ ] Viết migration bảng `run_workflow_steps` có unique `(run_id, step_key)`.
- [ ] Cài đặt claim/finalize step nguyên tử.
- [ ] Tách thao tác publisher thành hàm xử lý một node/artifact/Post ID/seeding.
- [ ] Chạy test mục tiêu.

### Task 4: Dispatch Workflow từ Vercel

**Files:**
- Create: `src/workflow-dispatcher.js`
- Create: `test/workflow-dispatcher.test.js`
- Modify: `src/request-handler.js`

**Interfaces:**
- Produces: `dispatchWorkflowRun({runId})` gọi Cloudflare có HMAC.
- Khi `WORKFLOW_ENABLED=false`, giữ nguyên publisher đồng bộ.

- [ ] Viết test dispatch thành công, timeout và gửi lại cùng `runId`.
- [ ] Cài đặt dispatcher và trạng thái `dispatching|creating|dispatch_failed`.
- [ ] Đổi endpoint tạo run để trả `202` khi Cloudflare nhận job.
- [ ] Chạy test mục tiêu.

### Task 5: Cloudflare Workflow

**Files:**
- Create: `cloudflare/wrangler.jsonc`
- Create: `cloudflare/src/index.js`
- Create: `cloudflare/src/campaign-workflow.js`
- Create: `cloudflare/test/campaign-workflow.test.js`
- Create: `cloudflare/package.json`

**Interfaces:**
- Consumes: `VERCEL_INTERNAL_BASE_URL`, `WORKFLOW_SHARED_SECRET`.
- Exposes: `POST /runs` với khóa idempotency là `runId`.

- [ ] Viết test Workflow gọi step đúng thứ tự và tiếp tục sau network retry.
- [ ] Cấu hình Workflow Free và secrets.
- [ ] Cài đặt orchestration, sleep/poll và retry giới hạn.
- [ ] Chạy test Cloudflare.

### Task 6: UI tiến độ và lỗi

**Files:**
- Modify: `public/run-progress.js`
- Modify: `public/app.js`
- Modify: `public/app.css`
- Modify: `test/run-progress.test.js`

**Interfaces:**
- Consumes: run response có `workflow.steps`, `progress`, `latestError`.
- Hiển thị giai đoạn và đối tượng lỗi theo Campaign.

- [ ] Viết test progress không giảm và mapping lỗi đúng node.
- [ ] Cài polling sau phản hồi `202` và resume sau F5.
- [ ] Cài card lỗi có giai đoạn, tên, Meta code và nút retry khi hợp lệ.
- [ ] Chạy test mục tiêu.

### Task 7: Dọn media và rollout

**Files:**
- Modify: `src/request-handler.js`
- Modify: `src/r2-media.js`
- Modify: `vercel.json`
- Modify: `.env.example`
- Create: `docs/cloudflare-workflow-deployment.md`

**Interfaces:**
- Xóa media tạm chỉ khi run terminal.
- Ghi cấu hình Cloudflare/Vercel và quy trình rollback.

- [ ] Viết test media không bị xóa khi workflow còn chạy.
- [ ] Cài cleanup khi terminal và endpoint retry dispatch.
- [ ] Chạy toàn bộ `npm test`.
- [ ] Deploy Worker, đặt secrets và test smoke bằng một campaign nhỏ.
- [ ] Bật `WORKFLOW_ENABLED=true` trên Vercel rồi deploy production.

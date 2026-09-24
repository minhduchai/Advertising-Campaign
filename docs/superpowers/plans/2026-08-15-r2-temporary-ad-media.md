# Cloudflare R2 Temporary Ad Media Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tải banner/video quảng cáo trực tiếp lên R2, để Meta lấy file bằng URL tạm và xóa object sau khi Meta nhận thành công.

**Architecture:** Application server chỉ ký URL và xác minh metadata; byte của file đi thẳng từ trình duyệt tới bucket R2 private. Media seeding vẫn dùng kho media riêng. Production yêu cầu R2; Meta nhận media quảng cáo qua URL GET tạm.

**Tech Stack:** Node.js ESM, Cloudflare R2 S3 API, AWS SDK v3 presigner, Vercel Functions, Meta Marketing API.

## Global Constraints

- Media quảng cáo tối đa 200 MB.
- Bucket R2 private và credential chỉ có quyền trên bucket media tạm.
- Không đưa secret R2 hoặc Meta xuống trình duyệt.
- Không thay đổi luồng seeding media hiện tại.
- Object key chỉ dùng ID ASCII ngẫu nhiên.

---

### Task 1: Cấu hình và client R2

**Files:**
- Create: `src/r2-media.js`
- Modify: `src/config.js`
- Modify: `package.json`
- Test: `test/r2-media.test.js`

- [ ] Viết test cấu hình R2 chỉ bật khi đủ account ID, bucket, access key và secret.
- [ ] Viết test ký PUT/GET cho đúng bucket, object key, MIME và thời hạn.
- [ ] Cài `@aws-sdk/client-s3` và `@aws-sdk/s3-request-presigner`.
- [ ] Cài đặt `createR2MediaClient(config)` với `presignPut`, `presignGet`, `headObject`, `deleteObject`.
- [ ] Chạy `node --test test/r2-media.test.js`.

### Task 2: API upload trực tiếp

**Files:**
- Modify: `src/request-handler.js`
- Modify: `public/api.js`
- Test: `test/publish-routes.test.js`
- Test: `test/client-api.test.js`

- [ ] Viết test endpoint tạo URL PUT yêu cầu phiên Meta và metadata hợp lệ.
- [ ] Viết test endpoint hoàn tất xác minh owner, key, MIME và kích thước trước khi lưu DB.
- [ ] Thêm `POST /api/r2-media/presign` và `POST /api/r2-media/complete`.
- [ ] Thêm upload XHR trực tiếp tới URL PUT để giữ phần trăm tiến độ.
- [ ] Không giữ fallback upload quảng cáo trực tiếp lên Meta; khi R2 chưa cấu hình phải báo lỗi rõ ràng.
- [ ] Chạy hai file test API liên quan.

### Task 3: Meta fetch và cleanup

**Files:**
- Modify: `src/media-store.js`
- Modify: `src/request-handler.js`
- Modify: `src/vercel-runtime.js`
- Test: `test/media-store.test.js`
- Test: `test/publish-routes.test.js`

- [ ] Viết test media R2 trả URL GET ngắn hạn mà không tải file vào Function.
- [ ] Viết test object chỉ bị xóa sau khi lượt publish kết thúc và không xóa ảnh seeding.
- [ ] Mở rộng media store để nhận metadata provider `r2` và cấp URL Meta fetch.
- [ ] Thu thập media quảng cáo R2 trong lượt chạy và cleanup idempotent ở `finally`.
- [ ] Thêm lỗi cleanup vào log server nhưng không đổi kết quả Ads đã tạo.
- [ ] Chạy test media và publish route.

### Task 4: Giao diện trạng thái và triển khai

**Files:**
- Modify: `public/app.js`
- Modify: `public/workspace.js`
- Modify: `.env.example`
- Test: `test/workspace.test.js`

- [ ] Hiển thị riêng “Đang tải lên R2” và “Meta đang xử lý video”.
- [ ] Thêm cấu hình mẫu R2 không chứa secret.
- [ ] Chạy `npm test` và xác nhận toàn bộ test qua.
- [ ] Gắn biến môi trường production trên Vercel.
- [ ] Deploy production và kiểm tra upload một video thử nghiệm.

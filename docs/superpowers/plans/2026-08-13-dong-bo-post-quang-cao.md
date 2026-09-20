# Kế hoạch triển khai đồng bộ Post ID và link bài quảng cáo

> **Dành cho tác nhân triển khai:** BẮT BUỘC dùng `subagent-driven-development` hoặc `executing-plans` để thực hiện từng task theo TDD.

**Mục tiêu:** Lưu và đồng bộ lại Post ID/link Facebook cho Ads mới và cũ, đồng thời thiết kế lại báo cáo lịch sử gọn hơn.

**Kiến trúc:** Giữ nguyên các cột `post_id` và `permalink_url` hiện có. Bổ sung một service owner-scoped để nhóm Ads theo `creativeGroupId`, truy vấn Meta bằng Ad ID đại diện, cập nhật kết quả vào database, rồi trả snapshot mới. Frontend tự gọi service khi mở báo cáo còn thiếu link và cho phép thử lại thủ công.

**Công nghệ:** Node.js ES modules, Meta Graph API v24, SQLite/Neon Postgres, HTML template strings, Node test runner, Vercel.

## Ràng buộc chung

- Không gửi access token Meta về trình duyệt.
- Không làm Ad thành công chuyển thành thất bại vì thiếu permalink.
- Không tạo lại đối tượng Meta để lấy link.
- Không triển khai hành động seeding trong đợt này.
- Không tạo git commit nếu người dùng chưa yêu cầu.

---

### Task 1: Resolver Post ID an toàn

**Files:**
- Modify: `src/meta-client.js`
- Test: `test/meta-client.test.js`

**Produces:** `getAdPublication(token, adId, options)` trả `{ postId, permalinkUrl }`; nếu đã có Post ID nhưng đọc permalink lỗi thì vẫn trả Post ID và link Facebook dự phòng.

- [ ] Viết test thất bại cho `effective_object_story_id`, `object_story_id`, permalink chính thức và link dự phòng.
- [ ] Chạy `node --test test/meta-client.test.js` để xác nhận RED.
- [ ] Tách helper chuẩn hóa Post ID và tạo URL dự phòng `PAGE_ID/posts/POST_ID`.
- [ ] Không nuốt lỗi của truy vấn Ad/Creative; chỉ hạ cấp lỗi truy vấn permalink khi đã có Post ID.
- [ ] Chạy lại test để xác nhận GREEN.

### Task 2: Service đồng bộ và API owner-scoped

**Files:**
- Create: `src/publication-sync.js`
- Modify: `src/request-handler.js`
- Modify: `public/api.js`
- Test: `test/publication-sync.test.js`
- Test: `test/publish-routes.test.js`
- Test: `test/client-api.test.js`

**Produces:** `POST /api/runs/:runId/publications/refresh` trả `{ run, sync }`.

- [ ] Viết test thất bại: nhóm snapshot theo `creativeGroupId`, truy vấn một đại diện, cập nhật tất cả Ads trong nhóm và giữ nguyên trạng thái Ad.
- [ ] Viết test route thất bại cho auth, owner isolation và token giải mã server-side.
- [ ] Viết test API client thất bại cho method/path ổn định.
- [ ] Cài service với giới hạn số nhóm mỗi lượt gọi và kết quả `resolved/pending/errors`.
- [ ] Thêm route POST trước matcher đọc run hiện tại; tải connection, giải mã token, gọi service, trả run mới.
- [ ] Chạy ba file test để xác nhận GREEN.

### Task 3: Báo cáo gọn và tự đồng bộ

**Files:**
- Modify: `public/activity-history.js`
- Modify: `public/app.js`
- Modify: `public/app.css`
- Test: `test/activity-history.test.js`
- Test: `test/activity-history-interactions.test.js`

**Produces:** báo cáo compact, văn bản hai dòng có thể mở, nút mở/copy Post ID và cơ chế retry khi chi tiết đang mở.

- [ ] Viết test thất bại cho khối thu/mở, preview hai dòng, `Mở bài Facebook`, `Sao chép link`, `Sao chép Post ID` và trạng thái chờ Meta.
- [ ] Viết test tương tác thất bại cho tự refresh, manual refresh, copy clipboard và hủy timer khi đóng/quay lại.
- [ ] Refactor renderer dùng `details/summary`, thẻ Ads compact và publication actions.
- [ ] Thêm state đồng bộ, timer backoff `0s, 5s, 15s, 30s, 60s`, giới hạn mỗi lần mở nhưng tiếp tục được khi mở lại.
- [ ] Chạy test UI để xác nhận GREEN.

### Task 4: Xác minh dữ liệu thật và production

**Files:**
- Modify: `README.md`

- [ ] Cập nhật hướng dẫn về Post ID/link bài quảng cáo và trạng thái đồng bộ.
- [ ] Chạy `npm.cmd test` và yêu cầu toàn bộ test pass.
- [ ] Chạy `npx.cmd --yes vercel --prod --yes`.
- [ ] Kiểm tra `/health`, asset mới và route production.
- [ ] Mở lại lượt `33e5c824-a21f-41c5-ba79-03ba2ca326bf` để API production backfill Post ID/link nếu Meta đã trả dữ liệu.

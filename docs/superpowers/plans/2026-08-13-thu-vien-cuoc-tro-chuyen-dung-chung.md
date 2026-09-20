# Kế hoạch triển khai thư viện Cuộc trò chuyện dùng chung

> **Dành cho agent thực thi:** REQUIRED SUB-SKILL: Dùng superpowers:subagent-driven-development (khuyên dùng) hoặc superpowers:executing-plans để thực hiện từng task. Các bước dùng checkbox (`- [ ]`) để theo dõi.

**Mục tiêu:** Tạo thư viện mẫu Cuộc trò chuyện dùng chung toàn tool và biểu mẫu tự sinh Messenger button-template JSON.

**Kiến trúc:** Tái sử dụng bảng `conversation_templates` với namespace owner/Page nội bộ cố định, thêm `app_migrations` để seed đúng một lần. API CRUD không còn phụ thuộc Page hoặc ad account; browser tải một thư viện chung và lưu snapshot nội bộ vào từng quảng cáo.

**Công nghệ:** Node.js 24, node:test, SQLite, Neon Postgres, JavaScript ES modules, HTML/CSS render chuỗi.

## Ràng buộc toàn cục

- Thư viện chỉ khả dụng cho phiên đã kết nối Meta.
- Mọi người dùng tool được đọc, tạo, sửa, nhân bản, đặt mặc định và xóa mọi mẫu chung.
- Mẫu seed chỉ tạo một lần và sau khi xóa không được tự tái tạo.
- Không xóa hoặc chuyển đổi dữ liệu mẫu cũ theo Page.
- JSON tạo ra chỉ có nội dung và 1–3 nút `web_url` HTTPS.

---

### Task 1: Chuẩn hóa button-template và mẫu mặc định

**Tệp:**
- Sửa: `public/conversation.js`
- Sửa: `src/conversation.js`
- Kiểm thử: `test/conversation.test.js`

**Giao diện:**
- Sinh: `createDefaultConversation(randomId)` trả về mẫu `Dịch vụ triệt nách nữ`.
- Sinh: `conversationToMessageDocument(conversation)` trả về object `{ message }` chỉ chứa button template.

- [ ] Viết kiểm thử thất bại cho nội dung seed, một nút đăng ký và JSON đích.
- [ ] Chạy `node --test test/conversation.test.js` và xác nhận lỗi đúng kỳ vọng.
- [ ] Cập nhật mặc định và validation bắt buộc 1–3 nút `OPEN_URL`.
- [ ] Chạy lại kiểm thử và xác nhận đạt.

### Task 2: Seed namespace dùng chung đúng một lần

**Tệp:**
- Tạo: `src/shared-conversation-library.js`
- Sửa: `src/db.js`
- Sửa: `src/postgres-schema.js`
- Sửa: `src/postgres-db.js`
- Kiểm thử: `test/db.test.js`
- Kiểm thử: `test/postgres-schema.test.js`
- Kiểm thử: `test/postgres-db.test.js`

**Giao diện:**
- Sinh: các hằng `SHARED_CONVERSATION_OWNER_ID`, `SHARED_CONVERSATION_PAGE_ID`.
- Sinh: `sharedConversationSeed()` trả dữ liệu seed ổn định.
- Database CRUD giữ chữ ký hiện tại nhưng hỗ trợ xóa mẫu mặc định và tự chọn mẫu thay thế.

- [ ] Viết kiểm thử thất bại cho seed một lần và xóa không tái tạo.
- [ ] Viết kiểm thử thất bại cho xóa mặc định và chọn mẫu thay thế.
- [ ] Chạy các kiểm thử database để xác nhận đỏ.
- [ ] Thêm migration marker và seed cho SQLite/Postgres.
- [ ] Cập nhật thao tác xóa mặc định trong SQLite/Postgres.
- [ ] Chạy lại các kiểm thử database và xác nhận đạt.

### Task 3: Chuyển API sang thư viện chung

**Tệp:**
- Sửa: `src/request-handler.js`
- Sửa: `public/api.js`
- Kiểm thử: `test/conversation-template-routes.test.js`
- Kiểm thử: `test/client-api.test.js`

**Giao diện:**
- `loadConversationTemplates()` không nhận tham số.
- CRUD body chỉ mang `name` và `template` khi cần.

- [ ] Viết kiểm thử thất bại cho hai Meta user dùng chung mẫu và không gọi Graph API.
- [ ] Viết kiểm thử thất bại cho request không còn `adAccountId`/`pageId`.
- [ ] Chạy kiểm thử route/client để xác nhận đỏ.
- [ ] Chuyển handler sang namespace dùng chung và giữ yêu cầu kết nối Meta.
- [ ] Chuyển API client sang payload mới.
- [ ] Chạy lại kiểm thử route/client và xác nhận đạt.

### Task 4: Thay UI bằng biểu mẫu sinh JSON

**Tệp:**
- Sửa: `public/state.js`
- Sửa: `public/app.js`
- Sửa: `public/workspace.js`
- Sửa: `public/app.css`
- Kiểm thử: `test/client-state.test.js`
- Kiểm thử: `test/workspace.test.js`
- Kiểm thử: `test/tree-interactions.test.js`

**Giao diện:**
- `state.resources.conversationTemplates` chứa thư viện chung.
- Form hiển thị tên, nội dung và 1–3 nút tiêu đề/URL.

- [ ] Viết kiểm thử thất bại xác nhận UI không còn tab JSON, quick reply và số điện thoại.
- [ ] Viết kiểm thử thất bại xác nhận thư viện chung áp dụng mặc định cho quảng cáo mới.
- [ ] Chạy kiểm thử browser module để xác nhận đỏ.
- [ ] Đơn giản hóa state, loader, CRUD handler và renderer.
- [ ] Giữ preview Messenger và trạng thái lưu mẫu.
- [ ] Chạy lại kiểm thử browser module và xác nhận đạt.

### Task 5: Migration production và xác minh

**Tệp:**
- Sửa: `README.md`

- [ ] Cập nhật tài liệu thư viện chung và cấu trúc JSON tự sinh.
- [ ] Chạy các kiểm thử tập trung của bốn task.
- [ ] Chạy `npm.cmd test` và ghi nhận mọi lỗi có sẵn không liên quan.
- [ ] Chạy `npm.cmd run db:migrate:postgres` với môi trường production để seed một lần.
- [ ] Deploy bằng `npx.cmd --yes vercel --prod --yes`.
- [ ] Kiểm tra production tải được thư viện chung và mẫu mặc định.


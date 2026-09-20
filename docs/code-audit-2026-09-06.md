# Kiểm tra code ngày 06/09/2026

## Lỗi đã tái hiện và sửa

1. **Cookie sai mã hóa gây HTTP 500** (`src/request-handler.js`, `getOrCreateSession`). Trước đây `decodeURIComponent` ném lỗi khi một cookie chứa `%ZZ`, kể cả cookie không liên quan tới ứng dụng. Trang chính không tải được. Hiện cookie không giải mã được được xem như giá trị rỗng; phiên hợp lệ khác vẫn được giữ, cookie phiên hỏng được thay bằng phiên ẩn danh.
2. **JSON sai cú pháp bị phân loại thành lỗi máy chủ** (`src/http.js`, `readJson`). Các route dùng trực tiếp hàm này trước đây nhận `SyntaxError` không có HTTP status và trả 500. Hiện trả lỗi 400 với thông báo cố định, không đưa nội dung request vào thông báo lỗi. Giới hạn body 413 được giữ nguyên.

Đã thêm ba kiểm thử trong `test/http.test.js`: cả ba thất bại trước khi sửa và đạt sau khi sửa.

## Kết quả xác minh

- `npm.cmd test`: 719/719 đạt, bao gồm bước build client. Log: `data/code-audit-tests.log`.
- `npm.cmd test` trong `cloudflare`: 3/3 đạt (các test này cũng được bộ test gốc phát hiện).
- `..\.audit-venv\Scripts\python.exe -m pytest tests -q` trong `telegram-file-bot`: 57/57 đạt.
- `node --check`: 120 file JavaScript trong src, public, api, scripts, test, cloudflare/src, cloudflare/test và design-concepts đều hợp lệ về cú pháp.
- Môi trường Python kiểm thử riêng: `.audit-venv`, cài đúng `telegram-file-bot/requirements.txt`.

## Phạm vi và giới hạn

Đã chạy toàn bộ bộ kiểm thử hiện có và rà thủ công các đường xử lý HTTP/session, cấu hình, chữ ký workflow, điều phối workflow, media và bot upload. Đây không phải bằng chứng mọi nhánh logic đều không có lỗi; chưa đọc thủ công từng dòng của toàn dự án.

Không gọi tạo quảng cáo/bình luận thật, không triển khai, không chạy migration hoặc xác minh kết nối production với Meta, Neon, R2, Vercel, Telegram. Chưa kiểm thử tương tác trình duyệt thực tế trong đợt này. Thư viện cài sẵn, bản build, bản sao lưu và dữ liệu runtime không thuộc phạm vi sửa code.

Bộ test có cảnh báo SQLite experimental và MaxListenersExceededWarning ở helper khởi động server khi nhiều request kiểm thử chạy đồng thời. Chưa có bằng chứng đây là rò rỉ listener của ứng dụng production.

Thư mục hiện tại không có Git repository, nên không có git diff để so sánh với commit gốc. Các file sửa chủ động: `src/http.js`, `src/request-handler.js`, `test/http.test.js`; build cũng tái tạo bundle client theo script hiện có.

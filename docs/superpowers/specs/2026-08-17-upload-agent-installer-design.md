# Thiết kế bộ cài Local Upload Agent

## Mục tiêu

Cho phép người dùng mới chỉ cần mở website và bấm **Chọn qua Agent**. Website tự phát hiện Agent trên máy; nếu chưa có, website xin phép người dùng trước khi tải bộ cài Windows.

## Luồng người dùng

1. Người dùng bấm **Chọn qua Agent**.
2. Website gọi `http://127.0.0.1:47831/health` với thời gian chờ ngắn.
3. Nếu Agent đang chạy, website tiếp tục ghép nối hoặc mở bộ chọn file ngay.
4. Nếu Agent không phản hồi, website mở hộp thoại xác nhận:
   - Tiêu đề: **Cần cài Upload Agent**.
   - Nội dung: giải thích Agent chỉ chạy trên máy hiện tại và dùng để đọc file từ ổ mạng nội bộ.
   - Nút chính: **Đồng ý tải Agent**.
   - Nút phụ: **Hủy**.
5. Chỉ sau khi người dùng bấm đồng ý, website mới tải bộ cài Windows.
6. Người dùng tự mở bộ cài; Windows hiển thị xác nhận UAC trước khi cài.
7. Website hiển thị hướng dẫn ba bước và tự kiểm tra Agent định kỳ.
8. Khi Agent hoạt động, website đóng trạng thái hướng dẫn, ghép nối và mở bộ chọn file.

## Bộ cài Windows

- Định dạng phát hành: một file cài đặt `.exe` tự chứa.
- Không yêu cầu khách hàng cài Node.js hoặc chép source code.
- Cài Agent vào thư mục ứng dụng cục bộ của người dùng.
- Tạo tác vụ tự khởi động khi người dùng đăng nhập Windows.
- Chỉ lắng nghe trên `127.0.0.1:47831`.
- Chỉ chấp nhận origin production và localhost đã cho phép.
- Có mục gỡ cài đặt rõ ràng.

## Phân phối

- Bộ cài được phát hành cùng phiên bản website và có URL tải ổn định.
- Website không tự chạy bộ cài sau khi tải vì trình duyệt không cho phép.
- Website không tải file trước khi có sự đồng ý rõ ràng của người dùng.
- Phiên bản bộ cài được hiển thị trong hộp hướng dẫn để hỗ trợ cập nhật sau này.

## Trạng thái giao diện

- **Đang kiểm tra**: khóa thao tác lặp và hiển thị spinner.
- **Đã sẵn sàng**: mở chọn file ngay.
- **Chưa cài**: hiển thị hộp xác nhận tải.
- **Đang chờ cài**: hiển thị tiến trình ba bước và nút **Kiểm tra lại**.
- **Đã cài nhưng chưa ghép nối**: tự thực hiện ghép nối.
- **Lỗi**: hiển thị lỗi ngắn gọn, nút thử lại và lựa chọn dùng bộ chọn file trình duyệt.

## Bảo mật

- Không cài đặt im lặng.
- Không tự chạy file tải xuống.
- Người dùng phải xác nhận trên website và xác nhận UAC của Windows.
- Agent không mở cổng mạng LAN và không nhận file path ngoài vùng cho phép.
- Token ghép nối được lưu riêng trên từng máy và có thể thu hồi.

## Kiểm thử chấp nhận

- Máy có Agent: một lần bấm mở được bộ chọn file.
- Máy chưa có Agent: luôn hỏi trước khi tải.
- Bấm **Hủy**: không phát sinh download.
- Bấm đồng ý: tải đúng bộ cài production.
- Sau khi cài: website tự phát hiện, ghép nối và tiếp tục thao tác.
- Agent không chạy: có thể kiểm tra lại hoặc dùng bộ chọn file trình duyệt.
- Khởi động lại Windows: Agent tự chạy và không yêu cầu cài lại.

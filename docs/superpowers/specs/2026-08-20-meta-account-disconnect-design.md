# Thiết kế ngắt kết nối tài khoản Meta

## Mục tiêu

Cho phép người dùng chủ động kết nối lại, đổi tài khoản Facebook hoặc ngắt tài khoản Meta hiện tại ngay tại khu vực tài khoản trên header. Luồng ngắt kết nối không xóa lịch sử tạo quảng cáo.

## Giao diện

- Khi chưa kết nối, header chỉ hiển thị nút `Kết nối Meta`.
- Khi đã kết nối, bấm vào tên tài khoản mở menu thả xuống gồm:
  - `Kết nối lại Meta`
  - `Đổi tài khoản Facebook`
  - `Ngắt kết nối`
- `Ngắt kết nối` mở hộp thoại xác nhận riêng, nêu rõ lịch sử không bị xóa.
- Sau khi thành công, menu đóng và header trở về trạng thái chưa kết nối.

## Luồng dữ liệu

1. Client gửi yêu cầu `POST /api/auth/meta/disconnect`.
2. Server xác thực session hiện tại và xóa token Meta gắn với session/người dùng.
3. Server xóa cache tài nguyên Meta của phiên và trả `{ connected: false }`.
4. Client đặt lại trạng thái kết nối, danh sách tài khoản quảng cáo và Page.
5. Các bản nháp được bỏ lựa chọn tài khoản quảng cáo và Page để tránh tạo nhầm bằng dữ liệu cũ.

## Phạm vi dữ liệu

- Xóa: token Meta, thông tin kết nối và cache tài nguyên của phiên.
- Giữ nguyên: lịch sử hoạt động, mẫu cuộc trò chuyện, mẫu seeding, mẫu đối tượng và báo cáo cũ.

## Xử lý lỗi

- Nếu yêu cầu thất bại, giữ nguyên trạng thái kết nối và hiển thị thông báo lỗi trong giao diện.
- Endpoint hỗ trợ gọi lặp: phiên đã ngắt kết nối vẫn trả thành công.

## Kiểm thử

- Ngắt kết nối khi đang kết nối.
- Gọi ngắt kết nối khi phiên đã ngắt.
- Xác nhận token không còn dùng được qua session ứng dụng.
- Xác nhận lịch sử và thư viện mẫu không bị xóa.
- Xác nhận tài khoản quảng cáo và Page trong bản nháp được bỏ chọn.

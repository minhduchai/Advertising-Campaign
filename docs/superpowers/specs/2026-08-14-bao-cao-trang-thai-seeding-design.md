# Báo cáo trạng thái seeding

## Mục tiêu

Bổ sung trạng thái seeding vào bảng **Chi tiết lượt tạo** để người dùng biết từng Post ID đã được bình luận thành công hay chưa.

## Giao diện

Thêm cột **Trạng thái seeding** trước cột **Link Post**. Mỗi dòng hiển thị một badge:

- **Thành công**: mọi seeding job của Post ID đã hoàn tất.
- **Đang xử lý**: có job đang chờ hoặc đang đăng.
- **Thất bại**: có job thất bại; hiển thị thông báo lỗi ngắn bên dưới badge.
- **Cần kiểm tra**: có job không xác định chắc chắn kết quả.
- **Chưa seeding**: không bật seeding, chưa có Post ID hoặc chưa tạo job.

Các quảng cáo dùng chung Post ID dùng chung một trạng thái, tránh báo cáo sai do lặp dữ liệu.

## Dữ liệu và xử lý

API chi tiết lượt tạo tiếp tục trả snapshot seeding hiện có. Frontend lập chỉ mục job theo Post ID, tổng hợp trạng thái theo mức ưu tiên: thất bại, cần kiểm tra, đang xử lý, thành công, chưa seeding.

Không tạo thêm bảng dữ liệu và không gọi Meta khi mở báo cáo. Báo cáo chỉ đọc trạng thái đã được lưu trong hệ thống.

## Xử lý lỗi

Nếu dữ liệu seeding cũ bị thiếu, giao diện hiển thị **Chưa seeding** thay vì lỗi trang. Thông báo lỗi được rút gọn và escape trước khi hiển thị.

## Kiểm tra

Kiểm tra bộ tổng hợp trạng thái với Post ID dùng chung, job thành công, đang chờ, thất bại, cần kiểm tra và dữ liệu lịch sử không có seeding.

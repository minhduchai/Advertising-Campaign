# Thiết kế seeding Post ID theo thời gian thực

## Mục tiêu

Trong khi một lượt tạo quảng cáo vẫn đang chạy, Post ID nào xuất hiện trước phải được đưa ngay vào hàng đợi seeding. Các Post ID xuất hiện sau được nối tiếp vào cùng runner, không chờ seeding đợt trước kết thúc và không tạo bình luận trùng.

## Luồng xử lý

1. Client nhận sự kiện `run_started` và lưu `runId`.
2. Client khởi động duy nhất một seeding runner cho `runId` ngay lập tức.
3. Runner gọi `prepareRunSeeding()` lặp lại. Hàm chuẩn bị chỉ tạo job cho Post ID mới nhờ khóa idempotent hiện có.
4. Nếu có job pending, runner đăng bình luận tuần tự với khoảng nghỉ hiện hành.
5. Nếu chưa có Post ID nhưng còn bài đang chờ, runner poll mỗi 3 giây và tiếp tục khi Post ID mới xuất hiện.
6. Sự kiện `run_completed` chỉ đồng bộ trạng thái cuối; không khởi động một runner thứ hai.

## An toàn

- Mỗi `runId` chỉ có một loop chạy trong `createSeedingRunner()`.
- Post ID trùng dùng chung một bộ job, không seeding lặp.
- Quảng cáo chưa có Post ID không chặn Post ID đã sẵn sàng.
- Lỗi của một job giữ nguyên cơ chế dừng/cần kiểm tra hiện tại.
- Tiến độ tổng tiếp tục lấy từ publish, publication và seeding jobs hiện có.

## Kiểm thử

- Runner khởi động khi nhận `run_started`.
- Nhiều sự kiện cùng `runId` không tạo loop thứ hai.
- Hoàn tất lượt tạo không gọi resume trùng.
- Runner poll khi chờ Post ID và xử lý job mới khi Post ID xuất hiện.

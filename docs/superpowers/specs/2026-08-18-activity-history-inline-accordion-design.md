# Lịch sử hoạt động dạng accordion

## Mục tiêu

Hiển thị báo cáo Campaign ngay trong danh sách Lịch sử hoạt động, không chuyển sang màn hình chi tiết riêng.

## Hành vi

- Mỗi Campaign là một card có thể thu/mở.
- Bấm toàn bộ card hoặc biểu tượng mũi tên để mở báo cáo ngay bên dưới card.
- Chỉ một Campaign được mở tại một thời điểm; mở card mới sẽ thu card cũ.
- Card đang tải hiển thị trạng thái tải tại chỗ.
- Card lỗi hiển thị thông báo lỗi tại chỗ và vẫn có thể đóng lại.
- Báo cáo giữ nguyên các cột Ads, trạng thái seeding và link Post.
- Không hiển thị nút “Xem báo cáo” hoặc màn hình “Chi tiết lượt tạo”.

## Dữ liệu

Trạng thái `selectedRunId` và `selectedCampaignClientId` xác định card đang mở. Chi tiết lượt tạo chỉ được tải khi người dùng mở một card và được tái sử dụng khi render nội dung accordion.

## Kiểm thử

- Danh sách render card Campaign có thuộc tính `aria-expanded` và vùng nội dung liên kết bằng `aria-controls`.
- Mở Campaign tải đúng lượt tạo và chỉ hiển thị báo cáo của Campaign đó.
- Bấm lại Campaign đang mở sẽ thu card.
- Mở Campaign khác thay thế card đang mở.


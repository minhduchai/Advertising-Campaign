# Thiết kế card Campaign trong Lịch sử hoạt động

## Mục tiêu

Thay danh sách lượt tạo khó đọc bằng danh sách Campaign độc lập, gọn và có thể click toàn bộ để mở đúng báo cáo Campaign.

## Bố cục

- Mỗi lượt tạo là một card lớn có header tóm tắt và có thể thu gọn/mở rộng.
- Lượt tạo mới nhất mở mặc định; các lượt cũ thu gọn để giảm chiều dài trang.
- Header dùng icon tròn chứa chevron SVG, xoay 180 độ khi mở.
- Mỗi Campaign là một card nhỏ riêng trong lưới responsive bên trong card lớn.
- Mỗi Campaign chiếm một dòng; tên được xuống dòng đầy đủ và không tràn card.
- Card hiển thị trạng thái, tên Campaign, tài khoản quảng cáo, thời gian tạo, số nhóm quảng cáo, số quảng cáo và số bước hoàn tất.
- Campaign lỗi hiển thị lỗi gần nhất ở dạng rút gọn.
- Toàn bộ card là nút tương tác; click, Enter hoặc Space mở báo cáo đã lọc đúng Campaign.
- Dữ liệu cũ không có snapshot Campaign tiếp tục dùng card lượt tạo tương thích.

## Dữ liệu

- API danh sách lịch sử trả thêm `campaigns`, là summary nhỏ gọn được dựng từ snapshot và kết quả node.
- Summary chỉ gồm tên, tài khoản, trạng thái, số nhóm, số Ads, tiến độ và lỗi gần nhất; không trả nội dung quảng cáo hay media.

## Giới hạn

- Không thay đổi dữ liệu lưu trữ hoặc quy trình tạo Ads.
- Giữ bộ lọc ngày và phân trang hiện tại.
- Hỗ trợ light/dark mode và màn hình nhỏ.

## Kiểm thử

- Kiểm tra mỗi Campaign sinh một card có action và đúng ID.
- Kiểm tra nội dung người dùng được escape.
- Chạy toàn bộ bộ kiểm thử trước khi deploy production.

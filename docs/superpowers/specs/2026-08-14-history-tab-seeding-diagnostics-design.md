# Thiết kế tab Lịch sử và chẩn đoán Seeding

## Mục tiêu

- Đồng bộ màu khối “Đối tượng đã lưu” với giao diện tối/sáng hiện tại.
- Chuyển “Lịch sử hoạt động” từ drawer sang tab workspace độc lập.
- Rút gọn báo cáo còn đúng sáu trường: thời gian tạo, tài khoản quảng cáo, chiến dịch, nhóm quảng cáo, quảng cáo và link Post.
- Làm rõ và sửa nguyên nhân bình luận seeding không xuất hiện trên bài quảng cáo.

## Giao diện

Thanh điều hướng workspace có ba tab: **Chiến dịch**, **Seeding sau Ads**, **Lịch sử hoạt động**. Tab lịch sử dùng toàn bộ vùng nội dung, có bộ lọc ngày và bảng; mỗi quảng cáo là một dòng. Tên chiến dịch và nhóm quảng cáo được lặp lại trên từng dòng để người dùng kiểm tra nhanh. Link Post có nút mở bài và sao chép.

Khối “Đối tượng đã lưu” dùng cùng biến màu nền, viền, chữ và control với các card khác; không dùng nền trắng cố định trong dark mode.

## Luồng Seeding

Sau khi quảng cáo có Post ID, hệ thống chuẩn bị công việc theo từng Post ID duy nhất rồi gửi tuần tự. Mỗi bình luận phải lưu trạng thái: chờ, đang gửi, thành công hoặc thất bại. Khi thất bại, giao diện hiển thị nguyên văn lỗi Meta, Page, Post ID và nút thử lại.

Trước khi gửi, hệ thống kiểm tra:

1. Chiến dịch đã bật seeding và có nội dung hợp lệ.
2. Post ID thuộc đúng Page của chiến dịch.
3. Token Page tồn tại và Page có thể quảng cáo.
4. Quyền `pages_manage_engagement` đã được cấp.

Không báo seeding thành công nếu Meta chưa trả Comment ID.

## Kiểm thử

- Render đúng ba tab và không còn drawer lịch sử.
- Bảng lịch sử chỉ có sáu cột yêu cầu.
- Dark mode không còn nền trắng tại Saved Audience.
- Seeding tạo đúng một chuỗi job cho mỗi Post ID, gửi comment và lưu lỗi cụ thể khi thiếu quyền hoặc token.

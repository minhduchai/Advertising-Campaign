# Thiết kế tải media quảng cáo tạm qua Cloudflare R2

## Mục tiêu

Tăng tốc tải banner và video quảng cáo bằng cách tải trực tiếp từ trình duyệt lên Cloudflare R2, không chuyển nội dung file qua Vercel Function. Không thay đổi luồng Campaign, Ad Set, Ad, Post ID, seeding hoặc báo cáo.

## Phạm vi

- Chỉ media của quảng cáo dùng R2 tạm thời.
- Ảnh seeding tiếp tục dùng kho hiện tại vì cần tái sử dụng lâu dài.
- Giữ giới hạn file hiện tại là 200 MB.
- Dùng presigned PUT/GET với thời hạn ngắn và bucket private.

## Luồng dữ liệu

1. Trình duyệt yêu cầu URL PUT đã ký cho một media ID ngẫu nhiên.
2. Trình duyệt PUT file trực tiếp lên R2 và hiển thị tiến độ thực.
3. Server xác minh object bằng HEAD rồi lưu metadata thuộc người dùng Meta hiện tại.
4. Khi tạo Ads, server cấp URL GET tạm để Meta lấy media từ R2.
5. Sau khi Meta đã nhận và xử lý media, server xóa object R2; metadata được giữ để báo cáo nhưng không còn dùng lại.

## An toàn

- Credential R2 chỉ nằm trong biến môi trường server.
- URL ký chỉ cho phép một thao tác trên một object và hết hạn nhanh.
- Object key dùng ID ngẫu nhiên, không dùng tên file tiếng Việt.
- Hoàn tất upload phải kiểm tra owner, key, MIME và kích thước.
- Credential Cloudflare chỉ có quyền đọc/ghi bucket media tạm.

## Lỗi và khôi phục

- Upload lỗi không ghi metadata.
- Meta chưa nhận được media thì chưa xóa object.
- Object bỏ dở được dọn theo tuổi bằng lifecycle rule của bucket.
- Nếu R2 chưa cấu hình, production dùng lại upload trực tiếp Meta hiện tại.

## Kiểm thử

- Kiểm thử ký PUT/GET, xác minh HEAD, owner scope và cleanup.
- Kiểm thử client upload trực tiếp và tiến độ.
- Kiểm thử fallback upload Meta khi thiếu cấu hình R2.
- Chạy toàn bộ test trước khi deploy.

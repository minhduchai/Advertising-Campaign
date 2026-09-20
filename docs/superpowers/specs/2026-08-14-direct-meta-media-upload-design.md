# Thiết kế tải media trực tiếp lên Meta

## Mục tiêu

Ảnh và video dùng để tạo quảng cáo không được lưu vào Vercel Blob. Blob chỉ tiếp tục lưu ảnh seeding cần dùng lại.

## Luồng dữ liệu

- Ảnh quảng cáo được gửi qua API đã xác thực và tải ngay vào thư viện ảnh của tài khoản quảng cáo. Bản nháp lưu `image_hash`.
- Video quảng cáo được chia thành các phần nhỏ ở trình duyệt. API khởi tạo, chuyển tiếp từng phần và hoàn tất phiên upload resumable của Meta. Bản nháp lưu `video_id`.
- Token Meta luôn nằm ở máy chủ; trình duyệt không nhận token.
- Khi tạo quảng cáo, publisher dùng asset Meta có sẵn và không upload media lần thứ hai.
- Ảnh seeding tiếp tục dùng media store hiện tại vì phải tồn tại để đăng bình luận sau này.

## Ràng buộc

- Asset Meta gắn với tài khoản quảng cáo đã chọn. Đổi tài khoản quảng cáo sẽ xóa lựa chọn media quảng cáo trong chiến dịch đó.
- Video dùng các gói nhỏ để không vượt giới hạn request của Vercel.
- Ảnh vượt giới hạn request an toàn sẽ bị từ chối với thông báo yêu cầu tối ưu ảnh.
- Các quảng cáo tương tự dùng chung asset Meta khi `creativeGroupId` và nội dung sáng tạo giống nhau.

## Lỗi và phục hồi

- Lỗi upload giữ nguyên file trong trình duyệt để người dùng chọn tải lại.
- Phiên video lỗi không được ghi vào bản nháp.
- F5 sau khi upload thành công vẫn dùng được asset vì bản nháp lưu ID Meta và URL thumbnail.


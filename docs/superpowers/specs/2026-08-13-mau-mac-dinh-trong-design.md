# Thiết kế mẫu Cuộc trò chuyện mặc định trống

## Mục tiêu

Quảng cáo mới không tự nhận nội dung từ một mẫu dùng chung. Trạng thái ban đầu luôn rỗng để người dùng tự nhập nội dung hoặc chủ động chọn một mẫu đã lưu.

## Hành vi giao diện

- Bộ chọn mẫu có lựa chọn đầu tiên là `Mặc định (trống)`.
- Khi tạo quảng cáo mới, `Mặc định (trống)` được chọn và các trường tên mẫu, nội dung tin nhắn, tiêu đề nút và URL đều rỗng.
- Khi chọn `Mặc định (trống)` từ một mẫu đã lưu, trình soạn được đặt lại về nội dung rỗng.
- Các mẫu đã lưu như `Dịch vụ trị sẹo` vẫn nằm trong thư viện và chỉ được áp dụng khi người dùng chủ động chọn.
- Bỏ nhãn `Mặc định`, hậu tố `· Mặc định` và nút `Đặt mặc định` khỏi giao diện thư viện.
- Nút `Tạo mẫu`, `Lưu thay đổi`, `Nhân bản` và `Xóa mẫu` giữ nguyên hành vi hiện tại.

## Luồng dữ liệu

- `createDefaultConversation` tạo một cuộc trò chuyện rỗng thay vì nội dung mẫu ưu đãi.
- Sau khi tải thư viện, ứng dụng không tự tìm hoặc áp mẫu có cờ `isDefault`.
- Khi thêm chiến dịch, nhóm quảng cáo hoặc quảng cáo, nội dung cuộc trò chuyện mới giữ trạng thái rỗng.
- Dữ liệu mẫu hiện có trong cơ sở dữ liệu không bị xóa hoặc sửa; trường `isDefault` được giữ để tương thích dữ liệu cũ nhưng không còn chi phối giao diện.

## Kiểm tra

- Xác nhận quảng cáo mới có cuộc trò chuyện rỗng.
- Xác nhận tải thư viện không tự áp mẫu mặc định cũ.
- Xác nhận giao diện không còn nhãn hoặc thao tác đặt mặc định.
- Xác nhận chọn `Mặc định (trống)` đặt lại toàn bộ trường soạn thảo.
- Xác nhận các mẫu đã lưu vẫn chọn, sửa, nhân bản và xóa được.

## Không thuộc phạm vi

- Không xóa các mẫu hiện có trong thư viện dùng chung.
- Không thay đổi cấu trúc bảng hoặc chạy migration cơ sở dữ liệu.
- Không tự động lưu nội dung khi người dùng đang nhập.

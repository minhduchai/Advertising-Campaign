# Thư viện đối tượng dùng chung

## Mục tiêu

Cho phép người dùng lưu cấu hình targeting đang nhập thành một mẫu trong tool, sau đó sử dụng lại trên mọi máy và mọi nhóm quảng cáo.

## Phạm vi

- Lưu mẫu trong cơ sở dữ liệu của tool, không tạo Saved Audience trên Meta.
- Tất cả người dùng tool dùng chung một thư viện.
- Hỗ trợ tạo mới, cập nhật, nhân bản và xóa mẫu.
- Mẫu lưu vị trí bao gồm/loại trừ, tuổi, giới tính, đối tượng tùy chỉnh, nhắm mục tiêu chi tiết, ngôn ngữ và trạng thái Advantage+.

## Giao diện

Phần **Đối tượng đã lưu** có danh sách mẫu của tool và các Saved Audience lấy từ Meta được phân nhóm rõ ràng.

Khi đang tạo đối tượng thủ công, cuối phần targeting hiển thị:

- Ô **Tên đối tượng**.
- Nút **Lưu đối tượng**.
- Khi đang dùng mẫu của tool: **Lưu thay đổi**, **Nhân bản**, **Xóa mẫu**.

Khi chọn mẫu, toàn bộ trường targeting vẫn hiển thị để kiểm tra nhưng bị khóa. Chọn **Tạo đối tượng mới** sẽ tách khỏi mẫu và mở lại chỉnh sửa.

## Dữ liệu và API

Tạo API CRUD `/api/audience-templates`. Bản ghi gồm ID, tên, nội dung targeting, thời gian tạo và cập nhật. Không gắn owner Meta để mọi người dùng chung thư viện.

Payload được chuẩn hóa và kiểm tra tên không rỗng, giới hạn 120 ký tự, mảng ID không trùng và nội dung targeting thuộc các trường được hỗ trợ.

## Tương thích

Saved Audience từ Meta tiếp tục chỉ đọc. Mẫu của tool dùng ID namespace riêng để không xung đột ID Meta. Dữ liệu cũ không có thư viện vẫn hoạt động bình thường.

## Xử lý lỗi

Lỗi tải hoặc lưu mẫu không làm mất targeting đang nhập. Giao diện hiển thị thông báo và nút thử lại. Xóa mẫu cần xác nhận.

## Kiểm tra

Kiểm tra CRUD dùng chung, validation, áp dụng đầy đủ targeting, khóa trường khi chọn mẫu, tách mẫu để tạo mới và không xung đột với Saved Audience Meta.

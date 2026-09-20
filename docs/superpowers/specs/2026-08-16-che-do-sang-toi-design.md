# Chế độ sáng và tối

## Mục tiêu

Bổ sung nút chuyển chế độ sáng/tối trong header. Lần đầu truy cập, giao diện theo thiết lập sáng/tối của hệ điều hành. Sau khi người dùng chủ động chuyển, lựa chọn được lưu trên trình duyệt và được dùng cho các lần truy cập sau.

## Trải nghiệm người dùng

- Nút chuyển giao diện nằm trong nhóm hành động bên phải của header, trước trạng thái kết nối Meta.
- Nút dùng biểu tượng mặt trời hoặc mặt trăng, có nhãn truy cập mô tả chế độ sẽ chuyển sang.
- Khi chưa có lựa chọn đã lưu, giao diện theo `prefers-color-scheme` của hệ thống.
- Khi người dùng bấm nút, ứng dụng chuyển trực tiếp giữa `light` và `dark`, đồng thời lưu lựa chọn vào `localStorage`.
- Nếu người dùng chưa từng bấm nút và hệ thống đổi giao diện khi ứng dụng đang mở, ứng dụng cập nhật theo hệ thống.

## Kiến trúc

Tạo module giao diện nhỏ chịu trách nhiệm:

- Đọc và kiểm tra giá trị đã lưu.
- Tính giao diện hiệu lực từ lựa chọn đã lưu hoặc thiết lập hệ thống.
- Gắn `data-theme="light|dark"` lên phần tử `html`.
- Cập nhật biểu tượng, `title` và `aria-label` của nút chuyển.
- Theo dõi thay đổi `prefers-color-scheme` khi chưa có lựa chọn thủ công.

Một đoạn khởi tạo nội tuyến trong `<head>` áp dụng giao diện trước khi CSS và nội dung chính hiển thị, tránh nháy màu khi tải trang.

## Hệ màu

- Giữ bộ biến tối hiện tại làm giá trị mặc định cho `dark`.
- Bổ sung giá trị tương ứng cho `light` trên `html[data-theme="light"]`.
- Các thành phần tiếp tục dùng biến CSS chung; không tạo hai bộ CSS bố cục riêng.
- Màu trạng thái thành công, cảnh báo, thất bại và màu thương hiệu giữ ý nghĩa hiện tại, nhưng điều chỉnh nền và độ tương phản cho chế độ sáng.
- `color-scheme` và `theme-color` được đồng bộ theo giao diện đang dùng.

## Lưu trữ và lỗi

- Khóa lưu trữ: `meta-campaign-theme`.
- Chỉ chấp nhận `light` hoặc `dark`; giá trị khác được bỏ qua và quay về thiết lập hệ thống.
- Nếu `localStorage` bị trình duyệt chặn, chuyển giao diện vẫn hoạt động trong phiên hiện tại.

## Kiểm thử

- Lần đầu truy cập dùng giao diện hệ thống.
- Lựa chọn thủ công được lưu và ưu tiên hơn hệ thống.
- Nút chuyển cập nhật đúng giao diện, icon và nhãn truy cập.
- Thay đổi hệ thống chỉ tác động khi chưa có lựa chọn thủ công.
- HTML áp dụng giao diện trước khi tải ứng dụng.
- Các màn hình chiến dịch, seeding và lịch sử đều dùng chung biến màu và vẫn đạt độ tương phản đọc được.

## Ngoài phạm vi

- Không thêm lựa chọn trạng thái thứ ba “Hệ thống” vào header.
- Không đồng bộ lựa chọn giao diện giữa nhiều thiết bị hoặc tài khoản.
- Không thay đổi bố cục, luồng tạo quảng cáo hoặc dữ liệu Meta.

# Bắt Buộc Đặt Tên Đối Tượng Meta Ads

## Mục tiêu

Không cho phép tạo quảng cáo nếu Chiến dịch, Nhóm quảng cáo hoặc Quảng cáo chưa được người dùng đặt tên.

## Hành vi giao diện

- Đối tượng mới có trường `name` rỗng thay vì dùng `Chiến dịch mới`, `Nhóm quảng cáo mới` hoặc `Quảng cáo mới` làm dữ liệu thật.
- Cây cấu trúc vẫn hiển thị nhãn dự phòng theo loại đối tượng để người dùng nhận biết node khi tên đang rỗng.
- Trình chỉnh sửa hiển thị placeholder tương ứng: `Nhập tên chiến dịch`, `Nhập tên nhóm quảng cáo`, `Nhập tên quảng cáo`.
- Bảng Kiểm tra thiết lập hiển thị lỗi chính xác tại từng đối tượng thiếu tên.
- Nút tạo quảng cáo bị chặn đến khi toàn bộ tên hợp lệ.

## Quy tắc validation

- `name` phải là chuỗi có ít nhất một ký tự sau khi `trim()`.
- Chuỗi chỉ chứa khoảng trắng không hợp lệ.
- Validation áp dụng độc lập cho mọi Campaign, Ad Set và Ad trong bản nháp.
- Giữ nguyên thông báo hiện có: `Nhập tên chiến dịch`, `Nhập tên nhóm quảng cáo`, `Nhập tên quảng cáo`.

## Tương thích

- Không sửa tên của dữ liệu cũ đã lưu hoặc lịch sử các lượt tạo trước.
- Không thay đổi payload Meta khi tên đã hợp lệ.
- Khi nhân bản đối tượng tương tự, tên nguồn tiếp tục được giữ nguyên theo yêu cầu trước đó và không thêm hậu tố `Bản sao`.

## Kiểm thử

- Default mới ở cả ba cấp có tên rỗng.
- Draft tên rỗng hoặc chỉ có khoảng trắng sinh lỗi đúng path.
- Draft có đủ ba tên hợp lệ vượt qua nhóm validation tên.
- Cây cấu trúc và tiêu đề editor vẫn có nhãn dự phòng khi tên rỗng.

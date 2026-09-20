# Thiết kế dropdown mở rộng thống nhất

## Mục tiêu

Thay các dropdown lựa chọn dữ liệu hiện tại bằng một kiểu điều khiển mở rộng liền khối theo mẫu người dùng cung cấp, đồng thời giữ nguyên dữ liệu, API, validation và nghiệp vụ hiện có.

## Phạm vi

Áp dụng cho:

- Tài khoản quảng cáo.
- Facebook Page.
- Hạng mục quảng cáo đặc biệt.
- Đối tượng đã lưu.
- Custom Audience Bao gồm và Loại trừ.
- Tuổi tối thiểu và tối đa.
- Mẫu cuộc trò chuyện.
- Mẫu seeding.

Không áp dụng cho menu dấu ba chấm, bộ chọn ngày lịch sử, accordion báo cáo và phần JSON kỹ thuật.

## Kiến trúc

Tạo một renderer dropdown dùng chung trong `public/workspace.js`. Renderer nhận nhãn, giá trị hiện tại, danh sách lựa chọn, chức năng tìm kiếm, trạng thái hạn chế và action khi chọn. Các dropdown tài nguyên có nhiều dữ liệu dùng ô tìm kiếm; dropdown ngắn như tuổi và hạng mục đặc biệt không hiển thị tìm kiếm.

Mọi dropdown dùng chung cùng cấu trúc DOM, CSS animation bằng `grid-template-rows`, trạng thái mở được quản lý ở client và chỉ một dropdown được mở tại một thời điểm. Các action nghiệp vụ hiện tại tiếp tục cập nhật đúng field và client ID cũ.

## Tương tác

- Bấm trigger để mở hoặc đóng ngay trong luồng tài liệu.
- Khi mở, nội dung kéo dài xuống dưới thay vì nổi thành panel tách rời.
- Sau khi chọn, dropdown đóng và focus quay về trigger.
- Bấm ngoài hoặc nhấn Escape để đóng.
- Hỗ trợ Arrow Up, Arrow Down, Home, End và Enter.
- Danh sách dài cuộn nội bộ, không làm trang nhảy vị trí.
- Trạng thái hạn chế vẫn hiển thị màu đỏ và không cho chọn.
- Light/dark dùng token màu hiện có.

## Kiểm thử

- Kiểm tra renderer chung có trigger, danh sách, lựa chọn hiện tại và tìm kiếm tùy chọn.
- Kiểm tra các field cũ được chuyển sang renderer mới.
- Kiểm tra tìm kiếm, đóng sau khi chọn, Escape và điều hướng bàn phím.
- Chạy bộ test workspace, interactions, theme và build client.


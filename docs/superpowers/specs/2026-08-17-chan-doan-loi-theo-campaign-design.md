# Chẩn Đoán Lỗi Theo Campaign

## Mục tiêu

Khi một lượt tạo hoàn tất có lỗi, người dùng có thể bấm trực tiếp vào Campaign để biết đối tượng nào lỗi, lỗi gì và cần sửa ở đâu.

## Tiến độ theo chiến dịch

- Mỗi dòng trong khu vực `Theo chiến dịch` trở thành một nút có thể dùng bằng chuột và bàn phím.
- Campaign bình thường hiển thị hành động `Xem tiến độ`.
- Campaign có lỗi hiển thị hành động `Xem lỗi`, trạng thái màu đỏ và số đối tượng lỗi.
- Bấm dòng Campaign mở Nhật ký tạo quảng cáo và chỉ hiển thị các node thuộc Campaign đó.
- Nhật ký có tiêu đề Campaign đang xem và nút `Xem toàn bộ lượt tạo` để bỏ bộ lọc.

## Nội dung chẩn đoán

- Liệt kê theo đúng thứ tự Campaign → Ad Set → Ad.
- Mỗi lỗi hiển thị loại đối tượng, tên, ID cục bộ, ID Meta nếu có và thông báo lỗi Meta đầy đủ.
- Node bị bỏ qua vẫn xuất hiện để giải thích hậu quả của lỗi ở node cha.
- Lỗi seeding của Campaign được hiển thị cùng khu vực nếu có.

## Lịch sử hoạt động

- Chuẩn hóa action click về `open-history-report` và vẫn chấp nhận action cũ để tương thích.
- `Xem toàn bộ lượt tạo` mở toàn bộ báo cáo.
- `Xem lỗi & xử lý` hoặc `Xem chi tiết` trên card Campaign mở báo cáo đã lọc đúng Campaign.
- Phần đầu báo cáo có khối `Vấn đề cần xử lý`, nhóm lỗi theo Campaign / Nhóm quảng cáo / Quảng cáo / Seeding.
- Bảng quảng cáo phía dưới chỉ hiển thị Campaign được chọn; có nút `Xem toàn bộ lượt tạo` để xóa bộ lọc.

## Trạng thái và dữ liệu

- Thêm `selectedCampaignClientId` cho Activity History.
- Thêm `resultsCampaignClientId` cho UI của lượt chạy hiện tại.
- Việc lọc chỉ ảnh hưởng hiển thị, không sửa snapshot, node hoặc dữ liệu đã lưu.
- Quan hệ node được xác định bằng `parentClientId` và snapshot Campaign.

## UX/UI

- Dòng Campaign có hover/focus rõ ràng, không đổi sang nền dark trong light mode.
- Tên dài được rút gọn nhưng giữ tooltip đầy đủ.
- Lỗi dùng card đỏ nhạt, thông báo có thể xuống dòng và sao chép được.
- Trạng thái đang chạy vẫn mở được để theo dõi node hiện tại.

## Kiểm thử

- Nút lịch sử `open-history-report` gọi API tải chi tiết.
- Campaign card truyền đúng `campaignClientId` và báo cáo lọc đúng Campaign.
- Dòng tiến độ Campaign phát action mở nhật ký lọc.
- Bộ lọc node giữ Campaign, Ad Set và Ad đúng quan hệ cha con.
- Khối chẩn đoán hiển thị lỗi node và lỗi seeding an toàn, đã escape HTML.
- Nút xem toàn bộ xóa bộ lọc mà không tải lại lượt chạy.

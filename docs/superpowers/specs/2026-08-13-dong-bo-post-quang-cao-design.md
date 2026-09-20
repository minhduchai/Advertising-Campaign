# Thiết kế đồng bộ Post ID và link bài quảng cáo

## Mục tiêu

Mỗi quảng cáo Meta tạo thành công phải được theo dõi thêm dữ liệu bài quảng cáo gồm Post ID và link Facebook. Dữ liệu này được lưu trong lịch sử để mở bài, sao chép và làm nguồn cho chức năng seeding sau này.

## Khái niệm dữ liệu

- `remoteId`: ID quảng cáo Meta (Ad ID).
- `postId`: ID bài quảng cáo lấy từ `effective_object_story_id` hoặc `object_story_id`, thường có dạng `PAGE_ID_POST_ID`.
- `permalinkUrl`: link Facebook chính xác của bài quảng cáo.
- Link Facebook được ưu tiên từ trường `permalink_url` của Meta. Khi Meta trả Post ID nhưng không cho đọc `permalink_url`, tool tạo link dự phòng dạng `https://www.facebook.com/PAGE_ID/posts/POST_ID`.
- Chức năng seeding tương lai phải dùng cả Post ID và permalink, không phụ thuộc duy nhất vào URL hiển thị.

## Cơ chế đồng bộ

1. Sau khi tạo Ad, tool tiếp tục thử lấy Post ID như hiện tại.
2. Việc không lấy được Post ID không đổi trạng thái Ad từ thành công sang thất bại.
3. Khi người dùng mở chi tiết lịch sử, nếu Ad thành công còn thiếu Post ID hoặc permalink, trình duyệt gọi API đồng bộ lại.
4. API dùng token Meta đang được mã hóa trên server, không gửi token về trình duyệt.
5. API truy vấn `Ad ID -> Creative -> effective_object_story_id/object_story_id -> permalink_url`.
6. Những Ads có cùng `creativeGroupId` chỉ cần truy vấn một Ads đại diện; kết quả Post ID và permalink được cập nhật cho toàn bộ Ads dùng chung creative.
7. Trình duyệt tự thử lại theo nhịp tăng dần khi báo cáo vẫn đang mở. Người dùng có thể bấm `Lấy lại link bài` để thử ngay.
8. Các lượt tạo cũ có Ad ID vẫn được đồng bộ lại khi mở báo cáo.
9. Kết quả thành công được lưu vào `node_results.post_id` và `node_results.permalink_url`; lần mở sau không cần gọi Meta lại.

## Trạng thái giao diện

- `Đã có bài`: có Post ID và link mở bài.
- `Đang chờ Meta`: Ad thành công nhưng Meta chưa trả Post ID.
- `Cần kết nối lại`: token hết hạn hoặc thiếu quyền đọc đối tượng.
- Mỗi Ads có các hành động `Mở bài Facebook`, `Sao chép link`, `Sao chép Post ID` khi dữ liệu tương ứng tồn tại.

## Thiết kế báo cáo gọn

- Phần tóm tắt lượt tạo dùng một hàng thông tin gọn, ID có nút sao chép.
- Campaign và nhóm quảng cáo dùng khối thu/mở để nhiều đối tượng không kéo dài trang.
- Mỗi Ads là một thẻ gọn chứa tên, trạng thái, Meta ID, tên media và tiêu đề.
- Văn bản chính chỉ hiện tối đa hai dòng; `Xem nội dung` mở toàn bộ khi cần.
- Link bài và Post ID nằm trong vùng hành động, không chiếm cột nội dung lớn.

## Bảo mật và lỗi

- Chỉ chủ sở hữu lượt tạo đã kết nối Meta mới được đọc hoặc đồng bộ lượt đó.
- API không trả token, ciphertext hoặc lỗi thô có dữ liệu nhạy cảm.
- Lỗi đồng bộ link không sửa trạng thái Campaign, Ad Set hoặc Ad đã tạo.
- Nếu Meta chưa tạo bài hoặc không cho đọc bài, báo cáo giữ trạng thái chờ/lỗi có thể thử lại; không tạo URL giả khi chưa có Post ID.

## Ngoài phạm vi

- Chưa triển khai hành động seeding, bình luận hoặc tương tác tự động.
- Không thay đổi trạng thái Ads trên Meta.
- Không tạo lại Campaign, Ad Set, Ad hoặc Creative để lấy link.

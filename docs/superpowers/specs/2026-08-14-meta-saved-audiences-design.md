# Thiết kế Đối tượng đã lưu từ Meta

## Mục tiêu

Thay thư viện đối tượng tự lưu trong tool bằng Saved Audiences thuộc tài khoản quảng cáo đang chọn.

## Luồng

- Khi tải tài nguyên của một tài khoản quảng cáo, server gọi `/{ad-account-id}/saved_audiences` bằng token máy chủ.
- Trình duyệt chỉ nhận ID, tên, mô tả và targeting đã chuẩn hóa; không nhận token.
- Chọn một mẫu sẽ thay thế vị trí, tuổi, giới tính, Custom Audience và detailed targeting của nhóm quảng cáo.
- Đổi tài khoản quảng cáo sẽ tải danh sách Saved Audiences khác và xóa mẫu đang chọn.

## Giới hạn an toàn

- Tool chỉ nhận tỉnh/thành phố Việt Nam dạng `region`; mẫu có quốc gia, thành phố hoặc loại vị trí khác sẽ bị đánh dấu không tương thích.
- Tool hỗ trợ một nhóm `flexible_spec`. Mẫu có nhiều nhóm AND, exclusions hoặc trường targeting chưa hỗ trợ sẽ không được áp dụng âm thầm.
- Đây là bộ chọn chỉ đọc. Việc tạo, sửa hoặc xóa Saved Audience thực hiện trong Meta Ads Manager.


# Thư viện mẫu riêng theo tài khoản Meta

## Mục tiêu

Tách ba thư viện mẫu của tool theo tài khoản Meta đang đăng nhập để người dùng không thể xem, sửa hoặc xóa mẫu của nhau:

- Đối tượng
- Cuộc trò chuyện
- Seeding

## Phạm vi sở hữu

Khóa sở hữu là `metaUserId` của phiên Meta hiện tại. Một người dùng đăng nhập cùng tài khoản Meta trên máy khác vẫn nhìn thấy toàn bộ mẫu của mình. Đổi sang tài khoản Meta khác sẽ tải một thư viện riêng.

Mọi thao tác đọc, tạo, sửa, nhân bản và xóa đều phải lọc theo `ownerMetaUserId` ở phía server. Client không được truyền hoặc tự quyết định chủ sở hữu.

## Dữ liệu hiện có

Seeding đã được lưu theo chủ sở hữu và giữ nguyên.

Các mẫu Đối tượng và Cuộc trò chuyện dùng chung hiện có được chuyển một lần cho tài khoản quản trị hiện tại. Người dùng mới bắt đầu với thư viện trống và tự tạo mẫu riêng.

Migration phải chạy an toàn nhiều lần, không nhân đôi mẫu và không ghi đè mẫu riêng đã tồn tại.

## Giao diện

- Đổi nhãn `Thư viện của tool` hoặc nội dung mang nghĩa dùng chung thành `Thư viện của tôi`.
- Khi chưa kết nối Meta, không tải thư viện riêng và khóa các thao tác thay đổi mẫu.
- Khi đổi tài khoản Meta, xóa dữ liệu mẫu cũ khỏi state trước rồi tải thư viện của tài khoản mới.

## API và dữ liệu

- Bổ sung `owner_meta_user_id` cho bảng mẫu Đối tượng nếu chưa có.
- Route Đối tượng và Cuộc trò chuyện lấy chủ sở hữu từ session đã xác thực.
- Truy vấn cập nhật, nhân bản và xóa phải kết hợp cả `id` và `owner_meta_user_id`.
- Trả `404` khi người dùng truy cập ID mẫu thuộc tài khoản khác để không làm lộ sự tồn tại của mẫu.

## Kiểm thử

- Hai tài khoản Meta không nhìn thấy mẫu của nhau.
- Tài khoản khác không sửa, nhân bản hoặc xóa được mẫu.
- Cùng tài khoản Meta trên phiên khác vẫn nhìn thấy mẫu.
- Migration mẫu cũ không nhân đôi khi chạy lại.
- Giao diện xóa thư viện cũ khỏi state khi đổi hoặc ngắt kết nối Meta.


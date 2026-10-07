# Nhật ký lỗi

Mở **Lịch sử hoạt động → Nhật ký lỗi** để đọc các lỗi của tài khoản Meta đang đăng nhập. Trong từng lượt có liên kết **Nhật ký lỗi lượt này**. Trang hiển thị 200 bản ghi mới nhất; **Tải toàn bộ nhật ký JSONL** tải tất cả bản ghi còn được giữ trong phạm vi đang xem.

Mỗi bản ghi có mã riêng, thời điểm, lượt chạy/đối tượng khi biết, bước đang thực hiện, yêu cầu HTTP, tổng thời gian đến lúc đọc xong nội dung hoặc gặp lỗi, thời gian nhận header (`headersDurationMs`), lần gọi và quyết định thử lại. Chi tiết giữ mã mạng, chuỗi `cause`/`AggregateError`, stack, mã HTTP, mã/subcode Meta và fbtrace ID nếu có. Lỗi từng gặp vẫn còn sau khi thử lại thành công.

Nhật ký ghi lỗi kết nối và phản hồi Meta, lỗi tạo đối tượng/lưu kết quả, API, seeding, đồng bộ Post ID, tác vụ nền và lỗi process chưa xử lý. Lỗi chưa gắn được với tài khoản được lưu riêng trong `system.jsonl` để quản trị viên đọc trên máy chủ, không hiển thị cho tài khoản khác.

Không lưu body yêu cầu, header Authorization, token hoặc cấu hình môi trường. Các giá trị bí mật đã biết, Bearer token, URL và trường mật khẩu trong thông báo/stack được che. Trang và file tải xuống đều kiểm tra phiên đăng nhập; đọc một lượt còn phải kiểm tra quyền sở hữu lượt đó.

Production bật mặc định. `ERROR_JOURNAL_DIRECTORY` đặt thư mục lưu riêng nếu cần; mặc định là `data/error-journal` dưới thư mục ứng dụng. Máy chủ hiện tại dùng `/home/campaignadmin/.local/state/campaignbuilder/error-journal`. File JSONL được ghi nối tiếp, quyền 600, thư mục mới quyền 700. Khởi động lại hoặc deploy không xóa nhật ký. Mỗi tài khoản và log hệ thống giữ một file hiện tại cùng tối đa 3 file xoay vòng, mỗi file khoảng 10 MB; file cũ nhất bị thay thế khi đầy. Trang xem và tải xuống đọc cả các file này. Cần sao lưu riêng nếu muốn lưu lâu dài. Lỗi phản hồi API 4xx được giới hạn chung 60 bản ghi/phút/process; số bị bỏ qua được ghi vào bản ghi 4xx đầu tiên của phút tiếp theo. Lỗi Meta và lỗi máy chủ không chịu giới hạn 4xx này.

Nếu ghi file thất bại, bản ghi đã che thông tin nhạy cảm được gửi vào log dịch vụ với nhãn `[error-journal-write-failed]`; lỗi ghi nhật ký không đổi kết quả lệnh Meta và không làm gửi lại lệnh. Kiểm tra bằng `journalctl --user -u campaignbuilder` và các log worker trong thư mục state.

Đây là dữ liệu quan sát được, không bảo đảm mọi lỗi đều xác định được nguyên nhân ngay. Lỗi xảy ra trước khi bật cơ chế này không thể khôi phục mã nguyên nhân đã bị bỏ mất. Trang ghi rõ khi chưa có bản ghi hoặc phát hiện dòng nhật ký bị hỏng.

Máy chủ hiện chạy bằng user service `campaignbuilder` của `campaignadmin`: dùng `systemctl --user status/restart campaignbuilder`. Service đã enable và `Linger=yes` để chạy sau logout và khởi động máy. System service cũ đang inactive.

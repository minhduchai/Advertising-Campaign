# Đặc tả Local Upload Agent

## Mục tiêu

Tăng tốc và tăng độ ổn định khi người dùng chọn video từ thư mục mạng `\\192.168.1.6\marketing` mà không cần quyền quản trị NAS. Việc upload phải tiếp tục độc lập với tab trình duyệt, có thể phục hồi sau gián đoạn và không thay đổi quy trình tạo quảng cáo hiện có sau khi file đã nằm trên Cloudflare R2.

## Phạm vi

- Xây dựng một Local Upload Agent chạy trên máy Windows của người dùng.
- Website tự phát hiện Agent và ưu tiên giao việc upload cho Agent.
- Agent đọc file trực tiếp từ thư mục mạng được cho phép và upload multipart lên R2.
- Hiển thị phần trăm, tốc độ, dung lượng đã tải, thời gian ước tính và trạng thái lỗi.
- Hỗ trợ tạm dừng, tiếp tục, tự thử lại và phục hồi hàng đợi sau khi Agent khởi động lại.
- Giữ nguyên Cloudflare Workflow, Media ID và luồng tạo quảng cáo sau khi upload hoàn tất.

Không thuộc phạm vi:

- Cài phần mềm hoặc thay đổi cấu hình trên NAS.
- Đồng bộ toàn bộ thư mục NAS về máy người dùng.
- Cho phép Agent đọc tùy ý mọi file trên máy.
- Điều khiển Agent từ thiết bị khác trong mạng LAN.

## Kiến trúc

### Local Upload Agent

- Chạy bằng Node.js trên Windows.
- Chỉ lắng nghe tại `127.0.0.1`; không bind `0.0.0.0` và không mở cổng ra LAN.
- Khởi động cùng Windows bằng Task Scheduler.
- Lưu hàng đợi và trạng thái multipart trong thư mục dữ liệu ứng dụng của người dùng.
- Chỉ chấp nhận đường dẫn chuẩn hóa nằm dưới `\\192.168.1.6\marketing`.

### Website

- Gọi endpoint health của Agent khi mở trang và trước khi upload.
- Nếu Agent sẵn sàng, gửi yêu cầu chọn/giao file cho Agent và theo dõi tiến độ bằng polling cục bộ.
- Nếu Agent không chạy, quay về luồng upload trực tiếp từ trình duyệt hiện tại.
- Không gửi khóa R2 dài hạn xuống website hoặc lưu trong localStorage.

### API production

- Vercel tạo phiên multipart R2 và ký URL riêng cho từng part.
- Agent xác thực với Vercel bằng token thiết bị có thể thu hồi.
- Vercel hoàn tất multipart, kiểm tra metadata rồi lưu Media ID theo owner Meta đang đăng nhập.
- Token thiết bị không có quyền đọc Meta token hoặc gọi API tạo quảng cáo.

## Luồng dữ liệu

1. Người dùng chọn file từ Agent hoặc cung cấp đường dẫn trong thư mục mạng được cho phép.
2. Agent kiểm tra file, kích thước, MIME và quyền đọc.
3. Agent yêu cầu Vercel tạo multipart upload cho R2.
4. File được chia thành part 32 MB; tối đa 4 part được upload song song.
5. Mỗi part lỗi được thử lại tối đa 5 lần với thời gian chờ tăng dần.
6. Agent lưu `uploadId`, danh sách ETag và offset sau mỗi part thành công.
7. Khi đủ part, Agent yêu cầu Vercel hoàn tất multipart và nhận Media ID.
8. Website nhận Media ID rồi tiếp tục quy trình tạo Ads hiện tại.
9. Media tạm vẫn được xóa theo chính sách hiện tại sau khi quy trình tạo quảng cáo kết thúc.

## Giao diện và trạng thái

Khu vực upload hiển thị:

- Nguồn file: `Ổ mạng` hoặc `Máy hiện tại`.
- Trạng thái Agent: sẵn sàng, không chạy, mất kết nối hoặc cần kết nối lại.
- Tên file, dung lượng, phần trăm, MB/s và thời gian còn lại.
- Các trạng thái: chờ, đang đọc file, đang upload, tạm dừng, thử lại, hoàn tất, thất bại.
- Nút tạm dừng, tiếp tục và hủy khi phù hợp.

Đóng hoặc tải lại tab không hủy upload. Khi mở lại, website truy vấn Agent và gắn lại vào công việc đang chạy.

## Bảo mật

- Agent chỉ lắng nghe loopback.
- Website production được Agent cho phép bằng danh sách origin chính xác.
- Ghép cặp Agent bằng mã dùng một lần; Vercel phát hành token thiết bị có thể thu hồi.
- Mọi yêu cầu thay đổi trạng thái sử dụng nonce và chữ ký phiên.
- Chuẩn hóa đường dẫn trước khi kiểm tra allowlist; từ chối path traversal và symlink/reparse point thoát khỏi thư mục cho phép.
- Không ghi khóa R2, Meta access token hoặc nội dung bí mật vào log.
- URL upload từng part có thời hạn ngắn và chỉ dùng cho đúng object/part.

## Xử lý lỗi

- Mất mạng: giữ hàng đợi và tự tiếp tục khi có kết nối.
- NAS tạm mất kết nối: chuyển sang chờ nguồn file, không đánh dấu upload hoàn tất giả.
- File bị thay đổi trong lúc upload: dừng công việc và yêu cầu người dùng chọn lại.
- Part upload lỗi: thử lại riêng part đó, không tải lại toàn bộ file.
- Token thiết bị hết hạn: yêu cầu ghép cặp lại, giữ nguyên hàng đợi.
- Agent bị tắt: website hiển thị hướng dẫn mở Agent và có thể chuyển sang upload trình duyệt.

## Cài đặt và vận hành

- Cung cấp script PowerShell cài Agent, tạo thư mục dữ liệu và Task Scheduler.
- Cung cấp script gỡ cài đặt, không tự xóa dữ liệu hàng đợi nếu người dùng chưa xác nhận.
- Có lệnh chạy foreground để chẩn đoán.
- Agent ghi log xoay vòng với giới hạn dung lượng.
- Phiên bản đầu hỗ trợ một máy Windows và một thư mục gốc `\\192.168.1.6\marketing`; cấu hình có thể mở rộng sau.

## Kiểm thử chấp nhận

- Upload thành công file MP4 từ thư mục mạng và nhận đúng Media ID.
- Bốn part chạy song song, tiến độ không giảm và đạt 100% đúng một lần.
- Ngắt mạng giữa chừng rồi kết nối lại không tải lại các part đã hoàn tất.
- Đóng tab rồi mở lại vẫn thấy đúng công việc và tiến độ.
- Khởi động lại Agent có thể phục hồi hàng đợi.
- Đường dẫn ngoài thư mục được phép bị từ chối.
- Origin không hợp lệ và token thiết bị sai bị từ chối.
- Luồng fallback trình duyệt vẫn hoạt động khi Agent không chạy.
- Quy trình tạo Ads dùng Media ID từ Agent mà không cần thay đổi payload nghiệp vụ.

## Tiêu chí hoàn thành

- Agent được cài và tự chạy trên máy Windows của người dùng.
- Website production phát hiện và sử dụng Agent.
- Upload file mạng lớn ổn định, có resume và multipart song song.
- Không cần quyền quản trị NAS và không mở dịch vụ Agent ra mạng LAN.
- Vercel, Cloudflare Workflow và quy trình tạo Ads production hoạt động đồng bộ.

# Đặc tả bot Telegram gửi file từ ổ mạng

## Mục tiêu

Chạy một bot Telegram riêng tư trên máy Windows tại công ty. Bot nhận lệnh của một tài khoản Telegram được cấp quyền, đọc file từ ổ mạng nội bộ và gửi file về Telegram. File dung lượng lớn được gửi qua Telegram Bot API Server đang chạy cục bộ trên máy công ty.

## Phạm vi

- Trong chat riêng, chỉ Telegram User ID `1643641244` được phép.
- Trong group/supergroup có Chat ID nằm trong `ALLOWED_GROUP_IDS`, mọi thành viên hiện có của group đều được sử dụng bot.
- Group khác bị từ chối. Lệnh `/whoami` vẫn được phép để quản trị viên lấy User ID và Chat ID trước khi thêm group vào danh sách.
- Thư mục gốc được phép truy cập: `\\192.168.1.6\marketing`.
- Chỉ đọc, kiểm tra và gửi file.
- Chấp nhận mọi loại file không quá 2.000 MB.
- Chỉ gửi một file tại một thời điểm; các yêu cầu hợp lệ khác được xếp vào hàng đợi FIFO dùng chung cho chat riêng và mọi group.
- Bot báo vị trí hàng đợi ngay khi nhận yêu cầu, chặn cùng một người xếp trùng cùng đường dẫn, và tiếp tục mục kế tiếp nếu một lượt gửi lỗi.
- Trước khi gửi file, bot tag người yêu cầu bằng `@username`; nếu không có username thì dùng liên kết nhắc theo Telegram User ID.
- Hàng đợi nằm trong RAM và được xóa khi bot hoặc máy khởi động lại.
- Không xóa, đổi tên, di chuyển, sửa hoặc ghi file lên ổ mạng.

## Cách sử dụng

Bot nhận các lệnh sau trong cuộc trò chuyện riêng:

- `/start` — hiển thị hướng dẫn ngắn.
- `/whoami` — hiển thị User ID, Chat ID và loại chat.
- `/status` — kiểm tra Local Bot API và ổ mạng.
- `/ls [đường-dẫn]` — liệt kê thư mục; nếu bỏ trống thì liệt kê thư mục gốc.
- `/get <đường-dẫn>` — gửi một file có đường dẫn chính xác.

Người dùng cũng có thể dán trực tiếp một đường dẫn đầy đủ. Nếu đường dẫn trỏ tới file, bot tự gửi file; nếu trỏ tới thư mục, bot tự liệt kê nội dung. Tin nhắn thông thường không phải đường dẫn vẫn hiển thị hướng dẫn.

Khi liệt kê, bot kèm bàn phím nút: thư mục có nút mở, file có nút tải, cùng nút quay lại và phân trang 10 mục. Đường dẫn thật chỉ lưu trên máy công ty; callback Telegram dùng mã ngắn có hiệu lực 60 phút. Nút cũ hết hiệu lực sau khi bot khởi động lại.

Lệnh `/ls` và `/get` chấp nhận:

- Đường dẫn tương đối tính từ thư mục gốc, ví dụ `CHUNG\THIET KE\Danh\THÁNG 8`.
- Đường dẫn UNC đầy đủ bắt đầu bằng `\\192.168.1.6\marketing`.

Không bắt buộc đặt đường dẫn trong dấu ngoặc kép. Toàn bộ nội dung phía sau tên lệnh và dấu cách đầu tiên được xem là đường dẫn, nên tên có khoảng trắng và ký tự tiếng Việt được giữ nguyên.

Danh sách thư mục được trả về dưới dạng văn bản và giới hạn ở độ dài an toàn cho Telegram. Nếu có quá nhiều mục, bot thông báo danh sách đã bị rút gọn và yêu cầu nhập đường dẫn cụ thể hơn.

## Kiến trúc

- Telegram Bot API Server chạy trong Docker, bật chế độ local và chỉ lắng nghe tại `127.0.0.1:8081`.
- Bot chạy bằng Python 3.12 và nhận tin nhắn bằng long polling qua Local Bot API.
- Cấu hình nằm tại `C:\TelegramFileBot\.env`, gồm bot token, User ID được phép, thư mục gốc và địa chỉ Local Bot API.
- Python chạy bằng đúng tài khoản Windows đang có quyền đọc ổ mạng SMB.
- Docker và Python tự khởi động cùng Windows; Docker dùng chính sách restart hiện có và Python dùng Task Scheduler.

## Bảo mật

- Chat riêng từ chối mọi User ID khác `1643641244`.
- Group chỉ hoạt động khi Chat ID nằm trong `ALLOWED_GROUP_IDS`; mọi thành viên trong group đó có thể yêu cầu và bấm nút tải file.
- Khi Privacy Mode của BotFather được bật, thành viên trong group dùng các lệnh `/ls`, `/get`, `/status` và nút bấm; đường dẫn dán trực tiếp không kèm lệnh có thể không được Telegram chuyển tới bot.
- Để hỗ trợ dán trực tiếp đường dẫn trong group, Privacy Mode phải được tắt. Khi đó bot chỉ xử lý lệnh và đường dẫn tuyệt đối hợp lệ; mọi tin nhắn trò chuyện thông thường trong group được bỏ qua hoàn toàn.
- Trong group, chỉ User ID quản trị `1643641244` được dùng các lệnh bắt đầu bằng `/`. Lệnh của thành viên khác bị bỏ qua; họ chỉ được dán đường dẫn tuyệt đối và dùng các nút duyệt/tải file.
- Chuẩn hóa đường dẫn tương đối và đầy đủ trước khi truy cập.
- So sánh đường dẫn không phân biệt hoa thường theo quy tắc Windows.
- Chỉ cho phép thư mục gốc hoặc thư mục con thực sự nằm bên dưới nó.
- Từ chối `..`, đường dẫn thiết bị, ổ mạng khác và mọi đường dẫn sau chuẩn hóa nằm ngoài phạm vi.
- Kiểm tra lại đường dẫn ngay trước khi liệt kê hoặc mở file.
- Không ghi bot token, API hash, thông tin đăng nhập hoặc toàn bộ lỗi kỹ thuật vào Telegram hay nhật ký thông thường.
- Mở file chỉ đọc và gửi theo luồng, không nạp toàn bộ file vào RAM.

## Xử lý lỗi

- Mất ổ mạng: báo ổ mạng công ty không khả dụng.
- Không tìm thấy đường dẫn: báo file hoặc thư mục không tồn tại.
- Sai loại: `/ls` chỉ nhận thư mục, `/get` chỉ nhận file.
- File quá lớn: từ chối trước khi tải và báo giới hạn 2.000 MB.
- Đang gửi file: đưa yêu cầu hợp lệ vào hàng đợi và báo vị trí.
- Gửi thất bại: báo lỗi ngắn gọn, giải phóng trạng thái bận và tiếp tục nhận lệnh.
- Lệnh không hỗ trợ: hiển thị hướng dẫn.

## Kiểm thử

Kiểm thử tự động bao gồm:

- User ID hợp lệ và không hợp lệ.
- Đường dẫn tương đối và UNC đầy đủ.
- Khoảng trắng và ký tự tiếng Việt.
- Thư mục gốc và thư mục con hợp lệ.
- Các cách thoát khỏi thư mục gốc bằng `..`, tiền tố gần giống, ổ mạng khác và đường dẫn thiết bị.
- Đường dẫn không tồn tại và nhầm file với thư mục.
- Giới hạn dung lượng file.
- Khóa không cho gửi hai file cùng lúc.
- Cấu trúc yêu cầu Telegram bằng HTTP giả lập; kiểm thử không kết nối Telegram hoặc ổ mạng thật.

Nghiệm thu thực tế:

1. `/status` báo Local Bot API và ổ mạng hoạt động.
2. `/ls` liệt kê được thư mục có tên tiếng Việt.
3. `/get` gửi thành công file PNG nhỏ.
4. `/get` gửi thành công file PSD khoảng 251 MB.
5. Tài khoản Telegram thứ hai bị từ chối.
6. Đường dẫn ngoài `\\192.168.1.6\marketing` bị từ chối.

## Tiêu chí hoàn thành

Khi ở nhà, người dùng được cấp quyền có thể gửi đường dẫn tương đối hoặc UNC đầy đủ cho bot và nhận đúng file từ máy công ty. Bot tiếp tục hoạt động sau lỗi thông thường, không truy cập được đường dẫn ngoài ổ `marketing` và tự chạy lại sau khi máy công ty khởi động lại.

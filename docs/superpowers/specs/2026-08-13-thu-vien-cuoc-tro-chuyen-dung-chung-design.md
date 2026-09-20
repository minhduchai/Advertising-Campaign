# Đặc tả thư viện Cuộc trò chuyện dùng chung

## Mục tiêu

Thay trình chỉnh sửa Cuộc trò chuyện hiện tại bằng một biểu mẫu đơn giản tự sinh Messenger button-template JSON. Toàn bộ người dùng đã kết nối Meta dùng chung một thư viện mẫu trong tool, không phụ thuộc Facebook Page, BM hay tài khoản quảng cáo.

## Trải nghiệm người dùng

- Khu vực Cuộc trò chuyện hiển thị thư viện mẫu dùng chung.
- Biểu mẫu chỉ gồm tên mẫu, nội dung tin nhắn và từ 1 đến 3 nút.
- Mỗi nút gồm tiêu đề và URL HTTPS.
- Tool tự sinh object `{ message }` đúng cấu trúc `attachment → payload → buttons` khi tạo quảng cáo; người dùng không chỉnh JSON trực tiếp.
- Mọi người dùng đã kết nối Meta có thể tạo, sửa, nhân bản, đặt mặc định và xóa mọi mẫu trong thư viện.
- Khi xóa mẫu mặc định, mẫu còn lại mới nhất trở thành mặc định. Nếu thư viện trống thì không có mẫu mặc định.
- Thay đổi dùng cơ chế “ghi sau cùng thắng”; không khóa mẫu theo người dùng.

## Mẫu khởi tạo

Hệ thống tạo đúng một lần mẫu `Dịch vụ triệt nách nữ` với nội dung và URL do người dùng cung cấp. Mẫu có thể sửa hoặc xóa như mọi mẫu khác. Một bản ghi migration bảo đảm mẫu đã xóa không tự xuất hiện lại sau khi server khởi động hoặc chạy migration lần nữa.

## Dữ liệu và tương thích

- Tiếp tục dùng bảng `conversation_templates` hiện có.
- Mẫu dùng chung được lưu trong một namespace nội bộ cố định, tách biệt với owner/Page cũ.
- Thêm bảng `app_migrations` để ghi nhận seed một lần.
- Dữ liệu mẫu cũ theo Page vẫn giữ nguyên trong database nhưng không hiển thị trong thư viện chung.
- Snapshot Cuộc trò chuyện trong quảng cáo và báo cáo lịch sử vẫn dùng cấu trúc nội bộ hiện tại để tránh migration dữ liệu quảng cáo.

## API

- Giữ các đường dẫn CRUD `/api/conversation-templates` hiện có.
- Bỏ `adAccountId` và `pageId` khỏi request thư viện mẫu.
- API vẫn yêu cầu phiên đã kết nối Meta nhưng không gọi Graph API để đọc hoặc sửa thư viện.
- Mọi thao tác CRUD chạy trên namespace dùng chung.

## Quy tắc hợp lệ

- Tên mẫu: bắt buộc, tối đa 120 ký tự.
- Nội dung: bắt buộc, tối đa 640 ký tự.
- Nút: từ 1 đến 3 nút.
- Tiêu đề nút: bắt buộc, tối đa 20 ký tự.
- Chỉ hỗ trợ nút `web_url`.
- URL phải là URL HTTPS tuyệt đối; tool có thể tự thêm `https://` khi người dùng bỏ giao thức.
- Không tạo `quick_replies`, số điện thoại hoặc `postback` trong mẫu mới.

## Kiểm thử

- Kiểm thử chuyển cấu trúc nội bộ thành đúng JSON mẫu.
- Kiểm thử validation 1–3 nút HTTPS.
- Kiểm thử hai người dùng cùng đọc, sửa và xóa một mẫu chung mà không gọi Meta.
- Kiểm thử seed chỉ chạy một lần và không tái tạo sau khi xóa.
- Kiểm thử xóa mẫu mặc định tự chọn mẫu thay thế.
- Kiểm thử UI không còn tab JSON, câu trả lời nhanh hoặc số điện thoại.
- Kiểm thử API client không còn truyền tài khoản quảng cáo/Page.


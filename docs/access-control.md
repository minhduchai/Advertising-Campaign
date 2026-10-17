# Giới hạn người dùng Meta

Quyền được bật khi `ACCESS_ADMIN_META_USER_IDS` có ít nhất một Meta User ID hợp lệ.
Không cấu hình biến này sẽ giữ hành vi cũ, không hạn chế người dùng.

Tài khoản quản trị ban đầu đã được chủ dự án xác nhận: Bùi Diễm Thu,
Meta User ID `1034343082727070`.

## Kích hoạt trên Ubuntu

Sau khi kiểm tra không có lượt tạo đang chạy, sao lưu code và file env, triển khai
`src/access-control.js`, `src/config.js`, `src/request-handler.js` và ba file
`public/access-login.html`, `public/access-admin.html`, `public/access-admin.js`.
Đối chiếu code hiện tại trên server trước khi ghi đè, vì các sửa đổi khác trong
working tree không thuộc bản thay đổi này.

Thêm vào `/home/campaignadmin/.config/campaignbuilder/app.env`:

```dotenv
ACCESS_ADMIN_META_USER_IDS=1034343082727070
ACCESS_CONTROL_FILE=/home/campaignadmin/.local/state/campaignbuilder/access-users.json
```

Kiểm tra đúng service đang giữ port 3000 (system hoặc user), rồi restart đúng
service đó. Không chạy hai bản cùng port và không bật lại service đang restart
vì `EADDRINUSE`.

## Sử dụng

- Mục Chờ cấp quyền trên trang quản trị tự cập nhật mỗi 15 giây khi tab đang hiển
  thị, kèm tên Meta, thời điểm đăng nhập và nút Cho phép cho từng tài khoản. Tiêu
  đề tab hiện số tài khoản chưa được duyệt. Không cần nhập ID hoặc mở form thủ công.
- Danh sách gồm các tài khoản đã đăng nhập chưa có quyền (kể cả tài khoản từng
  bị khóa); không phải cơ chế gửi thông báo ngoài trình duyệt. Mở lại tab sẽ tải
  lại ngay; tab ẩn tạm dừng polling.
- Đăng nhập tài khoản quản trị rồi mở `https://setads.click/admin/access`.
- Chọn tài khoản theo tên trong danh sách đã đăng nhập rồi cấp quyền; bấm Khóa để
  thu hồi; có thể cấp lại cùng tài khoản. Bấm Tải lại danh sách khi có người mới.
- Có thể nhập tên gợi nhớ và link/ID hồ sơ Facebook để nhận diện, hoặc bấm Sửa
  thông tin ở tài khoản đã cấp quyền. Link do admin ghi chú, không tự xác minh
  chủ hồ sơ và không thay ID dùng để xác thực. Danh sách luôn kèm tên Meta và ID app.
- Thông tin nhận diện nằm tại `ACCESS_CONTROL_FILE` + `.labels.json`, quyền 0600,
  tách khỏi danh sách quyền gốc. Backup cả hai file; cập nhật ghi chú không tự cấp
  quyền cho ID trên link Facebook. Chỉ nhận link HTTPS facebook.com hợp lệ.
- Không thể khóa quản trị viên từ trang này. Đổi quản trị viên qua env trên server.
- ID cần là ID do ứng dụng Meta nhận qua đăng nhập, không phải Ad Account ID,
  Page ID, số điện thoại hay tên Facebook.
- ID số trong URL Facebook cũng không phải ID đăng nhập của app. Giao diện không
  còn yêu cầu nhập ID thủ công. API từ chối cấp mới cho ID chưa có trong danh sách
  200 tài khoản đăng nhập gần nhất; khóa các quyền cũ vẫn hoạt động.
- Người dùng chưa có kết nối Meta cũ cần đăng nhập Meta lại sau khi được duyệt
  vì token của lần bị từ chối không được lưu. Nếu đã có kết nối cũ thì chỉ cần tải lại trang.
- Trang gốc khi chưa đăng nhập chỉ có liên kết đăng nhập Meta. Người đã đăng nhập
  nhưng chưa được duyệt nhận HTTP 404, không được lưu token mới vào connections.
- Mỗi request API người dùng đều kiểm tra lại quyền; cookie cũ không vượt được.
  Khóa quyền không hủy tác vụ đã chạy hoặc URL media đã ký trước đó.
- Registry dùng file riêng, quyền 0600, cập nhật atomic và được đọc lại mỗi request.
  Backup file này cùng file env; không xóa nó khi deploy. File hỏng sẽ chặn người
  dùng thông thường, không tự mở quyền. Khi chưa có file, chỉ admin có quyền.
- Các endpoint worker vẫn cần khóa/chữ ký riêng. Workflow theo run và Telegram
  multipart còn kiểm tra quyền của owner; worker đã nhận job có thể hoàn tất job đó.

## Xác minh khi deploy

1. Health và Tunnel trả 200.
2. Admin truy cập app và `/admin/access` được.
3. Phiên chưa được duyệt gọi root/API nhận 404; phiên anonymous thấy trang đăng nhập.
4. Cấp quyền, kiểm tra app rồi khóa lại: cùng cookie cũ phải nhận 404.
5. Restart service, quyền đã cấp vẫn tồn tại.

Test: `node --test test/access-control.test.js test/auth-routes.test.js test/config.test.js`.

## Trạng thái 17/10/2026

Đã kích hoạt production sau khi Ubuntu lên mạng lại. Đã xác minh bằng session
admin và một session kiểm thử tạm: admin vào app/trang quản trị được; người chưa
duyệt nhận 404; cấp quyền rồi thu hồi có hiệu lực ngay với cùng cookie. Session
kiểm thử và quyền tạm được dọn sau kiểm tra. Health public trả 200.

Service hệ thống `campaignbuilder` là bản chính. Đã disable/stop service user cùng
tên để không còn tranh cổng 3000. Không có run đang chạy tại lúc chuyển service.
Code cũ được backup tại `/home/campaignadmin/access-code-before-20261017.tar.gz`;
env cũ tại `/home/campaignadmin/.config/campaignbuilder/app.env.before-access-20261017-1792200354409`.

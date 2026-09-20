# Thiết kế MVP Meta Ads Campaign Builder

## Mục tiêu

Xây dựng ứng dụng web nhiều người dùng để kết nối Meta bằng OAuth, tự tải các tài khoản quảng cáo và Page mà người dùng được cấp quyền, sau đó tạo cấu trúc quảng cáo theo cây:

`Campaign -> Ad Set -> Ad`.

Mọi đối tượng do ứng dụng tạo phải ở trạng thái `PAUSED`. Ứng dụng không có chức năng bật quảng cáo `ACTIVE`.

## Phạm vi MVP

- Đăng nhập Meta OAuth bằng App đã được cấu hình qua các biến môi trường.
- Lưu token phía server dưới dạng mã hóa và không gửi App Secret hoặc token cho trình duyệt.
- Tải ad account khả dụng từ Meta sau khi người dùng đăng nhập.
- Tải Page khả dụng cho ad account đã chọn.
- Cho phép thêm và xóa nhiều Campaign; mỗi Campaign có nhiều Ad Set; mỗi Ad Set có nhiều Ad.
- Mỗi Ad Set của MVP dùng mục tiêu **Cuộc trò chuyện** và cấu hình gửi tin nhắn.
- Mỗi Ad cho phép nhập văn bản chính, tiêu đề, ảnh hoặc video và CTA nhắn tin.
- Upload media, tạo asset quảng cáo và trả tiến độ/kết quả cho từng node trong cây.
- Hiển thị lỗi Meta gồm `code`, `error_subcode` (nếu có) và `fbtrace_id`.

## Không thuộc MVP

- Kích hoạt, tắt hoặc chỉnh sửa quảng cáo đã tạo.
- Báo cáo Insights, thanh toán, phân quyền workspace, lịch chạy và retry nền.
- Các objective/destination khác ngoài Cuộc trò chuyện.
- Quản lý token System User hoặc yêu cầu quyền Meta tự động.

## Kiến trúc

Ứng dụng dùng kiến trúc web client/server:

1. **Client** hiển thị wizard, quản lý form cây và upload file qua endpoint server.
2. **Server** sở hữu OAuth callback, phiên đăng nhập, mã hóa token, validation và toàn bộ lệnh gọi Meta Marketing API.
3. **Database** lưu người dùng, kết nối Meta đã mã hóa, bản nháp cấu hình và lịch sử lần tạo.
4. **Media storage** lưu tạm file upload trong lúc tạo; server chuyển file sang Meta và xóa file tạm khi job hoàn tất.

Mọi request Marketing API đi qua lớp `MetaAdsClient`. Lớp này chuẩn hóa API version bằng một biến cấu hình, gắn access token server-side, có timeout, và chuyển lỗi Meta sang lỗi ứng dụng có cấu trúc.

## Luồng dữ liệu

1. Người dùng chọn **Kết nối Meta**.
2. Server tạo `state` chống CSRF, chuyển người dùng đến Meta OAuth và đổi `code` lấy token tại callback.
3. Server kiểm tra token, mã hóa rồi lưu connection; client nhận phiên ứng dụng, không nhận raw token.
4. Client gọi server để lấy danh sách ad account và Page được phép dùng.
5. Người dùng tạo form cây Campaign/Ad Set/Ad và chọn ad account, Page.
6. Client gửi draft tới server để validate trước khi tạo.
7. Server tạo tuần tự trong từng nhánh: Campaign, Ad Set, upload media, Creative, Ad.
8. Server lưu ID và trạng thái từng object, rồi trả kết quả ngay theo từng node cho client.

Nếu một node thất bại, server không tạo các node con của node đó. Các nhánh độc lập tiếp tục để người dùng nhận được kết quả đầy đủ. Đối tượng đã tạo không bị xóa tự động; chúng vẫn ở `PAUSED` để tránh side effect khó kiểm soát.

## Mô hình form

### Campaign

- Tên campaign.
- `objective` cố định là `OUTCOME_ENGAGEMENT` trong MVP.
- Special ad category: chọn rõ `NONE` hoặc category hợp lệ thay vì gửi mảng rỗng mặc định.
- Cấu hình ngân sách campaign hoặc ngân sách ad set, không cho phép đồng thời cả hai.

### Ad Set: Cuộc trò chuyện

- Tên ad set, ngân sách, lịch chạy và targeting cơ bản.
- Page và Messenger destination đã chọn.
- Server tạo payload với `optimization_goal`, `billing_event`, `destination_type` và `promoted_object` phù hợp với account/destination thực tế.
- Không hard-code một cặp field cho mọi tài khoản; phần validate kiểm tra response Meta trước khi tạo creative/ad.

### Ad

- Tên ad, văn bản chính, tiêu đề, CTA nhắn tin.
- Chọn một ảnh hoặc một video.
- Ảnh: upload `adimages`, lấy `image_hash`, sau đó tạo `object_story_spec.link_data`.
- Video: upload `advideos`, poll trạng thái xử lý, sau đó tạo `object_story_spec.video_data`; dùng `image_hash` hoặc `image_url` hợp lệ cho thumbnail, không dùng thumbnail URI như image hash.
- Tạo Creative trước rồi tạo Ad trỏ tới `creative_id`.

## Bảo mật

- `FB_APP_ID`, `FB_APP_SECRET`, callback URL, encryption key và API version chỉ có trong biến môi trường server.
- OAuth dùng `state` có hạn, HttpOnly secure session cookie và redirect URI allowlist.
- Token được mã hóa khi lưu; log che token, App Secret và dữ liệu nhạy cảm.
- API server xác thực user sở hữu connection trước mọi thao tác.
- Upload kiểm tra MIME type, kích thước và tên file; file tạm bị xóa sau job.

## Xử lý lỗi và trạng thái

- Form chặn thiếu tên, Page/ad account, ngân sách, nội dung, media hoặc targeting trước khi submit.
- Kết quả create ghi theo từng node: `pending`, `creating`, `created`, `failed`, `skipped`.
- Lỗi Meta được giữ `message`, `type`, `code`, `error_subcode` và `fbtrace_id`.
- Một token hết hạn hiển thị yêu cầu kết nối lại, không retry vô hạn.
- Video không ready trước timeout thì Ad của video đó `failed`, các ad khác vẫn tiếp tục.

## Kiểm thử

- Unit test mapping Campaign/Ad Set/Creative/Ad form sang request Meta.
- Unit test validation: cấu trúc nhiều cấp, ngân sách xung đột, thiếu media, field messenger không hợp lệ.
- Unit test orchestration: tạo thành công theo thứ tự, dừng node con khi node cha lỗi, nhánh khác vẫn chạy.
- Route test dùng Meta client giả để kiểm tra không đưa token ra client và trả trạng thái từng node.
- Manual smoke test với Meta sandbox/tài khoản có quyền: tất cả đối tượng được tạo `PAUSED`.

## Tiêu chí hoàn thành

Một user có thể đăng nhập Meta, chọn ad account và Page được tải tự động, cấu hình nhiều campaign/ad set/ad theo cây, rồi tạo chúng qua Marketing API. Kết quả phải cho biết ID/trạng thái từng đối tượng, và mọi đối tượng thành công luôn ở `PAUSED`.

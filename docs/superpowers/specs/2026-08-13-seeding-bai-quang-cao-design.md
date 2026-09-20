# Thiết kế seeding bài quảng cáo bằng Facebook Page

## Mục tiêu

Sau khi một lượt tạo quảng cáo hoàn tất và Meta trả Post ID, tool tự đăng danh sách bình luận đã cấu hình cho từng chiến dịch. Bình luận được đăng bằng Facebook Page của chiến dịch, theo đúng thứ tự, cách nhau ngẫu nhiên từ 3 đến 5 giây và không đăng lặp trên cùng một Post ID.

Tính năng phải hỗ trợ:

- Văn bản.
- Văn bản có chứa link HTTPS.
- Văn bản kèm một ảnh JPEG hoặc PNG.
- Mẫu seeding được lưu trên server, dùng lại được khi đăng nhập cùng tài khoản Meta trên máy khác.

## Quy tắc nghiệp vụ

1. Mỗi chiến dịch chọn tối đa một mẫu seeding.
2. Một mẫu có từ 1 đến 10 bình luận theo thứ tự cố định.
3. Mỗi bình luận có nội dung văn bản, một ảnh tùy chọn hoặc cả hai. Bình luận rỗng hoàn toàn không hợp lệ.
4. Link được nhập trực tiếp trong văn bản. Tool không thay đổi URL; Facebook tự nhận diện link khi hiển thị comment.
5. Những Ads trong cùng chiến dịch có chung Post ID chỉ nhận một bộ seeding.
6. Nếu một chiến dịch có nhiều Post ID khác nhau, mỗi Post ID duy nhất nhận đầy đủ bộ seeding đúng một lần.
7. Hai chiến dịch được xử lý độc lập. Nếu cùng một Post ID xuất hiện trong nhiều chiến dịch của cùng lượt tạo, tool không tự chọn mẫu nào: Post ID đó được đánh dấu xung đột và tạm dừng để người dùng chọn đúng chiến dịch/mẫu, tránh đăng chồng nhiều bộ comment.
8. Seeding thất bại không thay đổi trạng thái thành công của Campaign, Ad Set hoặc Ad.
9. Khoảng nghỉ 3 đến 5 giây giảm việc gửi dồn nhưng không bảo đảm Meta sẽ không áp dụng giới hạn hoặc chính sách chống spam.

## Quyền Meta

- Tool cần quyền `pages_manage_engagement` để Page đăng và quản lý bình luận.
- Người dùng phải có Page access token và quyền quản lý bình luận trên Page tương ứng. Tool kiểm tra Page task phù hợp, ưu tiên `MODERATE`.
- Page chỉ có quyền quảng cáo nhưng không có quyền quản lý tương tác vẫn tạo Ads được, nhưng không thể seeding bằng Page.
- `pages_manage_engagement` phải được thêm vào cấu hình Facebook Login for Business của ứng dụng. Người dùng cũ phải bấm `Kết nối lại Meta` để cấp quyền mới.
- Nếu ứng dụng phục vụ tài khoản ngoài vai trò ứng dụng, quyền phải có Advanced Access/App Review phù hợp.
- Page access token chỉ được lấy theo yêu cầu từ Meta và giữ trong bộ nhớ của request; không lưu token Page trong database và không gửi token về trình duyệt.

## Thư viện mẫu riêng từng tài khoản

Thêm bảng `seeding_templates`:

- `id`
- `owner_meta_user_id`
- `name`
- `items_json`
- `created_at`
- `updated_at`

`items_json` là mảng từ 1 đến 10 phần tử:

```json
{
  "id": "item-id",
  "message": "Nội dung comment và link nếu có",
  "imageMediaId": "media-id-hoặc-null"
}
```

Quy tắc thư viện:

- Mẫu chỉ hiển thị cho đúng tài khoản Meta đã tạo.
- Người dùng được tạo, sửa, nhân bản và xóa mẫu của mình.
- Ảnh thuộc cùng chủ sở hữu với mẫu.
- Khi chiến dịch bắt đầu tạo trên Meta, tool lưu một bản chụp bất biến của mẫu vào snapshot lượt tạo. Việc sửa mẫu sau đó không thay đổi lượt đang chạy hoặc lịch sử cũ.
- Không có mẫu mặc định tự áp dụng. Chiến dịch chỉ seeding khi người dùng chủ động bật và chọn mẫu hợp lệ.

## Lưu trữ ảnh

- Ảnh seeding dùng luồng tải media hiện có và được lưu riêng tư trên Vercel Blob ở production.
- Database chỉ lưu metadata và `mediaId`; không nhúng ảnh vào snapshot hoặc JSON mẫu.
- Chỉ chấp nhận JPEG và PNG, tối đa 10 MB mỗi ảnh.
- Khi gửi comment, server tạo URL đọc có chữ ký và thời hạn ngắn để Meta tải ảnh qua `attachment_url`.
- URL có chữ ký không được trả về báo cáo, log hoặc trình duyệt.
- Ở local, nếu không có URL HTTPS mà Meta truy cập được, tool cho phép soạn và lưu mẫu nhưng báo rõ ảnh chỉ có thể gửi trên môi trường production.
- Trước khi bật comment ảnh ở production, triển khai phải kiểm tra thực tế tham số ảnh trên Graph API hiện hành bằng Page `Duck Tool`. Nếu Meta từ chối `attachment_url`, tool giữ comment văn bản hoạt động, đánh dấu riêng comment ảnh là không được hỗ trợ và tuyệt đối không âm thầm bỏ ảnh rồi đăng nội dung khác với cấu hình.

## Snapshot chiến dịch

Phiên bản snapshot được tăng để mỗi chiến dịch có thêm:

```json
{
  "seeding": {
    "enabled": true,
    "templateId": "template-id",
    "templateName": "Triệt nách nữ",
    "items": [
      {
        "id": "item-id",
        "message": "Nội dung comment",
        "imageMediaId": null,
        "imageName": null
      }
    ]
  }
}
```

Snapshot không chứa Blob URL, token, nội dung file hoặc vị trí lưu trữ riêng tư.

## Hàng đợi seeding bền vững

Thêm bảng `seeding_jobs` để lưu từng comment phải đăng:

- `id`
- `run_id`
- `owner_meta_user_id`
- `campaign_client_id`
- `page_id`
- `post_id`
- `item_id`
- `position`
- `message`
- `image_media_id`
- `status`
- `meta_comment_id`
- `error_json`
- `attempt_count`
- `started_at`
- `completed_at`
- `created_at`
- `updated_at`

Ràng buộc chống trùng là `run_id + campaign_client_id + post_id + item_id`.

Các trạng thái:

- `waiting_post`: chưa có Post ID.
- `pending`: đã sẵn sàng đăng.
- `posting`: server đã nhận việc và đang gọi Meta.
- `created`: Meta trả Comment ID thành công.
- `failed`: lỗi xác định, ví dụ thiếu quyền hoặc nội dung không hợp lệ.
- `needs_review`: kết quả không chắc chắn do timeout hoặc mất kết nối sau khi request có thể đã tới Meta.
- `cancelled`: người dùng dừng những comment chưa đăng.

## Luồng xử lý

1. Khi bắt đầu lượt tạo, snapshot lưu cấu hình seeding của từng chiến dịch.
2. Campaign, Ad Set và Ad vẫn được tạo theo luồng hiện có.
3. Khi lượt tạo đạt trạng thái cuối, trình duyệt gọi API chuẩn bị seeding.
4. Server đồng bộ các Post ID còn thiếu bằng luồng `Ad ID -> Creative -> Post ID` hiện có.
5. Server ánh xạ mỗi Ads về chiến dịch, gom Post ID duy nhất và tạo job bằng thao tác idempotent.
6. Nếu nhiều Ads trong cùng chiến dịch chung Post ID, database chỉ tạo một bộ job.
7. Nếu một Post ID thuộc nhiều chiến dịch trong cùng lượt tạo, server tạo trạng thái xung đột thay vì tạo job comment; người dùng phải chọn một chiến dịch/mẫu trước khi tiếp tục.
8. Trình duyệt gọi API xử lý một job tại một thời điểm.
9. Server lấy User token đã mã hóa, lấy Page access token theo yêu cầu, kiểm tra quyền và xác nhận Post ID thuộc đúng Page của chiến dịch.
10. Server gọi `POST /{post-id}/comments` bằng Page access token với `message` và `attachment_url` nếu có ảnh.
11. Khi Meta trả Comment ID, server lưu `created` trước khi cho phép job tiếp theo.
12. Trình duyệt chờ một khoảng ngẫu nhiên từ 3.000 đến 5.000 mili giây rồi mới gọi job tiếp theo.
13. Nếu đóng tab hoặc mất mạng, hàng đợi tạm dừng. Khi người dùng mở lại kết quả hoặc lịch sử, tool tiếp tục từ job chưa hoàn tất và không gửi lại job `created`.

Thiết kế không dùng một request dài để gửi toàn bộ comment vì Vercel có giới hạn thời gian và Post ID có thể xuất hiện chậm.

## An toàn khi lỗi mạng

- Mỗi API chỉ xử lý tối đa một comment.
- Job được chuyển sang `posting` trước khi gọi Meta.
- Nếu Meta trả lỗi rõ ràng và không có Comment ID, job chuyển `failed` với thông báo có thể xử lý.
- Nếu request timeout, kết nối bị ngắt hoặc một job `posting` hết hạn mà chưa lưu kết quả, job chuyển `needs_review` và không tự đăng lại.
- Người dùng xem bài Facebook rồi mới quyết định `Đánh dấu đã có` hoặc `Thử lại` cho job `needs_review`.
- Không tự động retry trường hợp không chắc chắn để tránh tạo comment trùng.

## API

Thư viện mẫu:

- `GET /api/seeding-templates`
- `POST /api/seeding-templates`
- `PUT /api/seeding-templates/:id`
- `POST /api/seeding-templates/:id/duplicate`
- `DELETE /api/seeding-templates/:id`

Hàng đợi:

- `POST /api/runs/:runId/seeding/prepare`
- `POST /api/runs/:runId/seeding/next`
- `GET /api/runs/:runId/seeding`
- `POST /api/runs/:runId/seeding/jobs/:jobId/retry`
- `POST /api/runs/:runId/seeding/jobs/:jobId/confirm`
- `POST /api/runs/:runId/seeding/cancel`

Tất cả route đều yêu cầu session Meta và kiểm tra `owner_meta_user_id`. Run, template, media và job của tài khoản khác đều trả cùng một phản hồi không tìm thấy.

## Giao diện chiến dịch

Thêm phần `Seeding bài quảng cáo` trong editor của Campaign:

- Công tắc `Tự động seeding sau khi có Post ID`, mặc định tắt.
- Bộ chọn mẫu riêng của tài khoản.
- Nút `Mẫu mới`, `Lưu thay đổi`, `Nhân bản`, `Xóa mẫu`.
- Danh sách tối đa 10 comment.
- Mỗi comment có textarea, vùng tải một ảnh, thumbnail, thay ảnh, xóa ảnh, di chuyển lên và di chuyển xuống.
- Link HTTPS được giữ trong nội dung và hiển thị như một phần của bản xem trước.
- Ghi chú rõ: mỗi Post ID duy nhất nhận bộ comment này một lần.
- Nếu thiếu quyền, hiển thị `Kết nối lại Meta để cấp pages_manage_engagement` nhưng không chặn việc tạo Ads khi seeding đang tắt.

## Tiến độ và lịch sử

Sau phần kết quả tạo quảng cáo, hiển thị riêng tiến độ seeding:

- Tổng số Post ID.
- Số comment đã đăng, đang chờ, cần kiểm tra và thất bại.
- Tên chiến dịch, Post ID, link bài Facebook và từng nội dung comment thu gọn.
- Comment ID Meta khi thành công.
- Nút `Tạm dừng phần còn lại`, `Tiếp tục`, `Mở bài Facebook`, `Thử lại` và `Đánh dấu đã có` theo trạng thái.

Lịch sử hoạt động đọc cùng dữ liệu `seeding_jobs`, nên trạng thái vẫn còn khi đổi máy hoặc đăng nhập lại bằng cùng tài khoản Meta.

## Xác thực và giới hạn

- Bật seeding phải có một mẫu hợp lệ.
- Mỗi mẫu có tối đa 10 comment.
- Mỗi message có tối đa 8.000 ký tự.
- Mỗi item phải có message không rỗng hoặc một ảnh.
- Ảnh phải thuộc đúng chủ sở hữu, là JPEG/PNG và không quá 10 MB.
- Page ID trong Campaign phải khớp phần Page của Post ID dạng `PAGE_ID_POST_ID` khi Meta trả định dạng ghép.
- Không cho phép seeding một Post ID không xuất phát từ Ads thành công của run hiện tại.

## Kiểm thử

- Chuẩn hóa và xác thực mẫu text, link, ảnh và giới hạn 10 item.
- Owner scope cho template, media, run và job ở SQLite lẫn Postgres.
- Tạo job đúng cho Post ID chung và Post ID khác nhau.
- Không tạo lại job khi gọi `prepare` nhiều lần.
- Chặn đúng trường hợp một Post ID xuất hiện trong nhiều chiến dịch của cùng lượt tạo.
- Giữ đúng thứ tự comment và chỉ xử lý một job mỗi API call.
- Khoảng nghỉ client luôn nằm trong 3 đến 5 giây.
- Dùng Page token và `pages_manage_engagement`, không rò token vào response hoặc log.
- Gửi đúng `message` và `attachment_url` cho Meta.
- Lưu Comment ID khi thành công.
- Không tự retry timeout hoặc job `posting` bị bỏ dở.
- Tiếp tục đúng vị trí sau refresh hoặc đăng nhập máy khác.
- Seeding lỗi không làm thay đổi kết quả Campaign, Ad Set và Ad.

## Triển khai quyền Meta

1. Thêm `pages_manage_engagement` vào Facebook Login for Business configuration đang dùng bởi `META_LOGIN_CONFIG_ID`.
2. Xin Advanced Access/App Review nếu tài khoản ngoài vai trò ứng dụng cần dùng.
3. Cập nhật hướng dẫn quyền trong README và giao diện kết nối.
4. Người dùng bấm `Kết nối lại Meta` để token mới có quyền.
5. Kiểm thử trước trên Page `Duck Tool` với một Post ID, một comment văn bản và một comment ảnh do người dùng cung cấp; chỉ bật comment ảnh sau khi Graph API trả Comment ID thành công.

## Ngoài phạm vi

- Không tạo bình luận giả danh khách hàng; mọi comment được đăng công khai bằng chính Facebook Page.
- Không tự trả lời comment của khách hàng.
- Không tự thích, chia sẻ hoặc tạo reaction.
- Không chạy nền khi không có trình duyệt nào tiếp tục hàng đợi. Có thể bổ sung dịch vụ queue riêng trong giai đoạn sau.
- Không xóa hoặc sửa comment đã đăng trong phiên bản đầu.

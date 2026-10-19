# Kiểm tra lỗi và Meta API — 19/10/2026

Kiểm tra chỉ đọc trên Ubuntu lúc khoảng 10:00 (UTC+7). Phạm vi chính: 7 ngày gần nhất; số lượng là ảnh chụp tại thời điểm kiểm tra, có thể tăng khi người dùng tiếp tục chạy.

## Kết luận

Chưa có bằng chứng app bị Meta rate limit liên tục. Có những call có thể tránh và lỗi vận hành cần xử lý. Không sửa cấu hình, khởi động lại dịch vụ hay gửi yêu cầu tạo đối tượng Meta trong đợt kiểm tra này.

## Bằng chứng runtime

- SSH kết nối được; dịch vụ hệ thống `campaignbuilder` active từ 17/10 lúc 08:55; `/api/health` trả `{"ok":true}`. Dịch vụ cùng tên ở user scope đã disabled/inactive.
- Database trong 7 ngày: 65 lượt chạy, 64 `completed`, 1 `completed_with_errors`. 12 lượt mới nhất đều không có node failed/skipped/retry_pending.
- Lượt gần nhất `5a66c0b7-2bd3-430f-bd79-e004d8828201`: 19/10 09:55:03–09:55:42, tạo thành công 9/9 node. Lỗi connect lúc 09:55:04 được đánh dấu tự thử lại; không còn node lỗi trong lượt này.
- Seeding: 2.692 job created; 1 needs_review do mất phản hồi ghi bình luận ngày 12/10, 5 pending cùng lượt `d591c568-b38a-4d40-ab3e-ca722ef3b4f5`. Không tự gửi lại job needs_review vì có thể trùng bình luận.
- Cron publication recovery, seeding và comment unhide chạy mỗi phút dưới `flock`. Log mới nhất của recovery/unhide idle, seeding processed=0/failures=0.

## Lỗi và call có thể tránh

| Phát hiện | Bằng chứng | Ý nghĩa / hướng xử lý |
|---|---|---|
| Đọc permalink thiếu quyền Meta #10 | 296 phản hồi HTTP 400 trên 296 Post ID khác nhau; mới nhất 19/10 09:56:48 | Mỗi bài có một lần đọc thất bại rồi dùng link fallback. Không phải vòng lặp cùng một bài. Cần kiểm tra quyền/token Page; ghi nhớ từ chối quyền có thời hạn theo đúng Page/token để tránh các lần đọc tiếp theo khi quyền chưa đổi. |
| Tài khoản chạm trần số nhóm | 15 phản hồi code 100/subcode 1359133 trên 2 tài khoản, Meta báo tối đa 10.000 nhóm; còn 8 node adSet failed | Đây là giới hạn số đối tượng, không phải rate limit. Sau lỗi đầu, publisher vẫn tạo các nhóm tiếp theo cùng tài khoản. Nên dừng các yêu cầu tạo nhóm còn lại cho tài khoản đó trong cùng lượt. Cần xử lý giới hạn tài khoản trước khi retry. |
| Scheduler bên ngoài gọi route bị tắt | 7.448 HTTP 404 từ `/api/internal/workflow/comment-unhide/tick` trong ảnh chụp 7 ngày; 1.440 trong 24 giờ | `WORKFLOW_ENABLED=false` làm route trả 404 trước khi gọi Meta. Cron Ubuntu riêng cho unhide vẫn chạy. Cần bỏ lịch bên ngoài dư thừa hoặc thống nhất cơ chế chạy; lỗi này tốn HTTP/log server, không trực tiếp tốn call Meta. |
| Lỗi kết nối Meta còn xuất hiện | 26 meta-request `fetch failed` trong ảnh chụp 7 ngày, đánh dấu retry; ví dụ ETIMEDOUT connect IPv4 + ENETUNREACH IPv6 | Chưa hết lỗi mạng vật lý. Retry đã giúp lượt gần nhất hoàn tất. Không thể quy mọi lỗi này thành Meta xử lý chậm hoặc rate limit. |
| Meta video import HTTP 500/code 1 | Một phản hồi ngày 13/10 và một sự kiện `meta-video-import-retry` | Bản sửa retry được kích hoạt thực tế; không có node ad đang failed vì lỗi này trong các lượt thuộc phạm vi 7 ngày. |
| Chiếm cổng 3000 trước đây | 56.856 bản ghi EADDRINUSE trong ảnh chụp 7 ngày, lần cuối 17/10 08:25:50 | Đã từng có vòng khởi động khi cổng đang bị tiến trình khác giữ. Chưa thấy tái diễn sau mốc đó; hiện chỉ dịch vụ hệ thống active. Không được tính các bản ghi này là call Meta. |
| Validation và bot scan | 3.999 HTTP 422 `/api/drafts/validate`; nhiều 404 WordPress/.env | 422 là yêu cầu draft bị từ chối, không phải lỗi kết nối Meta. Bot scan trả 404 không phải bằng chứng lộ dữ liệu. |

## Rate limit và cơ chế tiết kiệm đã có

- 312 phản hồi lỗi Meta trong ảnh chụp 7 ngày: 296 lỗi quyền, 15 lỗi trần số nhóm, 1 lỗi video. **0 phản hồi HTTP 429 hoặc mã 4/17/32/613/80000–80014**. Không có bản ghi `MetaThrottleError` trong phạm vi đó.
- Toàn bộ journal còn giữ từ 06/10 có 646 phản hồi lỗi Meta và 0 phản hồi thuộc nhóm rate limit nêu trên. Đây không phải lịch sử vô hạn: file có xoay vòng và một dòng JSON không đọc được.
- Cache resource 15 phút, resource tài khoản 10 phút; cache đọc dùng chung trên đĩa. Publication sync trên server có gom nhóm theo creative, lease 60 giây và backoff tối đa 1 giờ.
- Limiter mỗi client quan sát usage headers, giới hạn tối đa 3 request đồng thời (2 khi chưa biết usage), giảm tốc/tạm dừng theo usage; cooldown chia sẻ qua đĩa giữa các tiến trình. Concurrency không phải giới hạn tổng của mọi worker trên máy.
- Phần mã limiter, Meta client, request handler và read cache trên server khớp SHA-256 với checkout được kiểm tra. `publication-sync.js` khác checksum; đã đọc trực tiếp bản server để xác nhận gom nhóm/lease/backoff hiện có.

## Giới hạn kết luận

Journal chủ yếu ghi lỗi, chưa lưu chuỗi thời gian của toàn bộ request thành công, cache hit/miss hay usage headers. Vì vậy không thể tính tổng call/phút, phần trăm quota sử dụng hoặc khẳng định mọi call đều tối ưu. Nên bổ sung thống kê tổng hợp theo endpoint/tài khoản và usage, không ghi token, nội dung quảng cáo hay URL ký sẵn.

Ưu tiên tiếp theo: tránh call đọc thiếu quyền; dừng tạo nhóm cùng tài khoản khi đã báo chạm trần; bỏ scheduler HTTP 404 dư; đối chiếu bình luận needs_review; bổ sung số liệu tổng hợp trước khi điều chỉnh tốc độ toàn hệ thống.

## Khắc phục đã triển khai — 19/10 khoảng 10:28 (UTC+7)

### Đã sửa và xác minh

1. **Permalink dùng sai loại token:** kiểm tra thật cho thấy quyền `pages_read_engagement` đã granted và Page token đọc được bài mà User token bị từ chối. Meta client hiện lấy Page token trước khi đọc permalink. Cache Page token/kết quả kiểm tra quyền 5 phút, khóa theo Page và User token, dùng chung web/worker; lỗi quyền rõ ràng được ghi nhớ trong cùng thời hạn. Token chỉ được lưu dạng mã hóa. Hai bài khác nhau được kiểm tra sau bản cuối: 5 request đều HTTP 200, trả permalink thật, chỉ lấy Page token một lần.
2. **Gửi tiếp khi tài khoản hết chỗ tạo nhóm:** publisher ghi nhớ lỗi code 100/subcode 1359133 trong lần thực thi và không gửi thêm các yêu cầu tạo nhóm còn đang xếp hàng cho tài khoản đó. Tài khoản khác tiếp tục. Những request đã gửi đồng thời trước phản hồi lỗi đầu vẫn có thể hoàn tất; kiểm tra hồi quy gồm concurrency 1 và 3.
3. **Lịch HTTP 404 dư:** đổi `cloudflare/wrangler.jsonc` thành `crons: []`, triển khai riêng triggers và xác nhận qua Cloudflare API. Hai Worker trong account đều không còn cron. Cron Ubuntu vẫn hoạt động. Lỗi 404 cuối lúc 10:20:46; không có thêm đến 10:27:33. Thay đổi lịch có độ trễ lan truyền, [Cloudflare nêu tối đa 15 phút](https://developers.cloudflare.com/workers/configuration/cron-triggers/).
4. **Mạng đổi địa chỉ quá sớm:** Node trước đây chỉ đợi 250 ms trước khi đổi IPv4/IPv6; server không có tuyến IPv6 mặc định. Meta client nâng ngưỡng tối thiểu lên 1.000 ms, giữ nguyên cấu hình cao hơn nếu đã có. Giữ cơ chế retry an toàn và giới hạn thời gian tổng. Đây là giảm rủi ro lỗi connect, không đảm bảo mạng/Meta không bao giờ gián đoạn.
5. **Seeding thiếu phản hồi:** tăng timeout mặc định 20 lên 60 giây, thời gian xét job posting bị bỏ dở từ 2 lên 5 phút. Worker truyền deadline tổng 100 giây để không bắt đầu/gửi tiếp quá ngân sách trước khi cron bị timeout 115 giây. Hết thời gian chuẩn bị thì trả job về pending; mất phản hồi sau khi ghi vẫn needs_review, không gửi lặp mù.
6. **Worker bỏ sót lượt cũ:** phát hiện thêm giới hạn chỉ chọn 20 lượt mới nhất làm 5 job pending không được xét. Selector mới ưu tiên job đã đến hạn, kể cả lượt cũ hơn 14 ngày; giữ quy tắc chặn khi bình luận trước chưa rõ kết quả và đưa posting quá hạn vào kiểm tra. Kiểm tra PostgreSQL thật mô phỏng 25 lượt mới, lượt cũ đến hạn, lượt đang gửi, lượt chưa đến hạn và chuỗi bị chặn.
7. **Khôi phục dữ liệu seeding:** đối chiếu một Comment ID duy nhất theo Page, nội dung, thời điểm gửi, có ảnh đính kèm và chưa thuộc job khác; nhận lại Comment ID đã tồn tại bằng UPDATE có điều kiện `needs_review`. Không đăng lại bình luận đó. Worker sau sửa đã xử lý 5 job pending còn lại, log `processed:5, failures:0`; lượt `d591c568-b38a-4d40-ab3e-ca722ef3b4f5` hiện **90/90 created**, không còn pending/posting/needs_review.
8. **Thiếu số liệu call:** thêm `/home/campaignadmin/.local/state/campaignbuilder/meta-api-calls.jsonl`, ghi mỗi lần dispatch: thời gian, endpoint đã ẩn object ID, account ID, HTTP status/lỗi mạng, số lần thử, thời gian tới response headers và usage tổng hợp. Không ghi query, body, token hay nội dung quảng cáo. File xoay vòng 5 MiB, tối đa 3 bản lưu; lỗi telemetry không đổi kết quả yêu cầu Meta. Log lỗi cũ tiếp tục giữ mã lỗi/chi tiết nguyên nhân.

### Kiểm chứng và vận hành

- Bộ kiểm tra đầy đủ: **990 pass, 0 fail, 1 skip**. Test bị skip là integration PostgreSQL cần database; đã chạy riêng trên Ubuntu với **1 pass**, dùng bảng TEMP trong transaction rồi ROLLBACK, không đụng dữ liệu production.
- Nhóm kiểm tra code liên quan trên Ubuntu: **123/123 pass**.
- Đã cập nhật file nguồn trên server, kiểm tra không có lượt tạo hoặc seeding write đang chạy trước khi restart; health nội bộ và domain công khai đều OK. Dịch vụ user scope vẫn disabled để tránh tranh cổng với dịch vụ hệ thống.
- Backup trước thay đổi ở `/home/campaignadmin/.local/state/campaignbuilder/diagnostics/2026-10-19/`; kết quả kiểm tra server trong `fix-tests.txt`.
- Không tạo chiến dịch/nhóm/quảng cáo thật để thử và không xóa đối tượng trên Meta. Chỉ thực hiện các lượt đọc để xác minh; 5 bình luận pending của lượt cũ được cron tiếp tục theo công việc đã có.

### Điều kiện bên ngoài còn lại và đề xuất

- **8 nhóm lỗi do tài khoản chạm giới hạn 10.000 vẫn cần xử lý tài khoản.** Bản sửa ngăn call lãng phí, không tăng được giới hạn Meta. Cần chọn tài khoản khác hoặc xác nhận các nhóm cũ không còn dùng để giải phóng khả năng tạo trước khi thử lại. Không tự xóa nhóm quảng cáo.
- Giữ một cơ chế scheduler Ubuntu cho cùng tác vụ, không bật thêm cron Cloudflare khi chưa chuyển quyền vận hành.
- Dùng log call mới để xem lượng gọi, lỗi và usage theo endpoint/tài khoản trước khi tăng concurrency. Mẫu hiện tại quá ngắn để kết luận mức quota cả ngày.
- Đề xuất tiếp theo: cảnh báo khi usage cao kéo dài, lỗi tăng theo endpoint, job chờ quá lâu hoặc dịch vụ restart bất thường; tiếp tục đối chiếu trước mọi retry có kết quả ghi chưa rõ. Đây là đề xuất, chưa tạo tác vụ thông báo định kỳ.

# ECC review: Meta API và mô phỏng 10/50/50, ngày 2026-10-07

**Lưu ý:** Phần review bên dưới ghi nhận trạng thái trước sửa. Bản khắc phục và kết quả chạy lại được mô tả cuối tài liệu.

Phạm vi: luồng publisher → Meta client → retry/rate limiter; chuẩn bị video, deadline và cấu hình thực tế trên server. Chỉ đọc cấu hình không nhạy cảm; không đổi production, không tạo quảng cáo thật. Áp dụng checklist ECC error-handling và code-review.

## Kết quả mô phỏng

Chạy lại: `node scripts/simulate-meta-load.mjs data-preview/diagnostics/meta-load-2026-10-07.json`.

Mỗi lượt gồm 10 campaign, 50 ad set và 50 ad, một tài khoản quảng cáo, concurrency 3 như server. Dùng publisher, Meta client, bộ giới hạn và tạo tham số thật; thay Meta bằng API giả. API giả tải thật dữ liệu qua HTTP localhost từ fixture 209.715.200 byte (200 MiB, lớn hơn 200 MB thập phân). Fixture nhị phân không phải video đã mã hóa: kiểm tra đường truyền byte và logic, không kiểm tra codec, xét duyệt hay thời gian xử lý thật của Meta. Không đo đường truyền người dùng → R2 hoặc R2 → Meta thực tế; 50 media ID khác nhau dùng lại cùng fixture để giới hạn dung lượng đĩa.

| Kịch bản | Kết quả |
|---|---|
| 50 quảng cáo dùng chung một file 200 MiB | 110/110 đối tượng created có ID; 1 tải video; 50 creative, 50 ad |
| 50 quảng cáo dùng 50 media riêng, mỗi file 200 MiB | 110/110 đối tượng created có ID; 50 tải video, tổng 10.485.760.000 byte; 50 video ID riêng |
| Video vẫn processing sau 120 giây trong luồng trực tiếp | 50 quảng cáo dùng chung video bị failed: “Video xử lý quá lâu” |
| Video processing trong bước chuẩn bị Workflow | pending, không failed; trả retryAfterMs=15000 |
| Deadline 20 ms, request tạo campaign mất 100 ms | Request vẫn chạy hết; không nhận AbortSignal; sau đó mới báo deadlineHit |
| HTTP 200 nhưng JSON phản hồi campaign bị hỏng | Campaign bị ghi created không có ID; 5 nhóm và 5 quảng cáo con bị skipped |

Sáu kịch bản chạy thành công theo các assertion mô tả hành vi hiện tại, bao gồm tái hiện lỗi. 49/49 test hiện có về network retry, publisher resilience, workflow media và rate limiter đạt. Test cũ đạt không phủ nhận các lỗi tái hiện mới.

## Phát hiện cần sửa

1. **HIGH: video pending bị coi là thất bại sau 120 giây.** `src/publisher.js:878` đặt thời hạn xử lý video 120.000 ms; lỗi được dùng chung qua promise nên cả 50 ad cùng video thất bại (`:884`). Server hiện `WORKFLOW_ENABLED=false`, vì vậy luồng Workflow có khả năng trả pending không được sử dụng. Không có căn cứ coi 120 giây là thời gian tối đa Meta cần xử lý video 200 MB. Nên lưu trạng thái chờ, Video ID và cho tác vụ nền tiếp tục; không upload lại video chỉ vì chưa ready.

2. **HIGH: deadline không hủy request đang chạy.** `src/publisher.js:1020` chỉ chuyển signal được truyền vào, không sinh signal từ deadlineAt. Caller Workflow đặt deadline 95 giây và caller retry đặt 220 giây nhưng không truyền signal. `assertPublicationDeadline` chỉ chạy trước/sau await. Bước media prepare cũng chỉ có stopStartingAt, không có hard deadline cho upload/status request. Nên áp dụng timeout thật ở request, đồng thời giữ trạng thái “chưa biết đã tạo hay chưa” cho write bị ngắt để reconcile trước khi gửi lại; không tự coi write bị abort là chắc chắn chưa tạo.

3. **HIGH: phản hồi hỏng bị chuyển thành thành công thiếu ID.** `src/meta-client.js:736-752` bắt lỗi đọc JSON rồi trả `{}`; createCampaign/createAdSet/createCreative trả `payload.id` mà không kiểm tra. Publisher ghi node created trước khi nhận ra ID không tồn tại. Đã tái hiện một campaign created không ID và 10 con bị skipped. Nên giữ lỗi đọc body/JSON, kiểm tra ID ở mọi mutation, và xử lý kết quả write thiếu phản hồi như chưa xác định. Không retry write mù.

## Thời gian chờ thực tế

Server Node v22.22.1, publish concurrency 3; Workflow đang tắt. Đã đọc các dòng mặc định từ Undici tích hợp của chính Node trên server, không suy ra từ Node local.

| Lớp | Hiện tại | Ý nghĩa |
|---|---:|---|
| TCP/TLS connect | 10 giây | Mặc định thư viện HTTP, không phải quy định timeout Meta |
| Nhận đầy đủ header | 300 giây | Mặc định thư viện; có thể bị lớp proxy/ứng dụng cắt sớm hơn |
| Nhận body | 300 giây giữa các chunk | Timeout khi đứng dữ liệu, không phải trần tổng thời lượng |
| Chờ video ready trong luồng trực tiếp | khoảng 120 giây | Chính ứng dụng đặt; request đang chạy có thể khiến thực tế vượt mốc |
| Workflow publish | mềm 45 giây / cứng dự kiến 95 giây | Chưa abort request; Workflow đang tắt |
| Retry trực tiếp | cứng dự kiến 220 giây | Chưa abort request |
| Lookup Post ID | 8 giây, permalink có giới hạn phụ 2,5 giây | Có AbortSignal thật |
| Workflow media polling | tối đa 60 lần chờ, mặc định 15 giây/lần | Khoảng 15 phút ngủ cộng thời gian gọi API; chưa áp dụng ở production hiện tại |
| URL R2 cho Meta đọc | 1.800 giây | Hạn link ký, khác timeout request |

Không có một “mức tối đa Meta” đã được xác minh áp dụng chung cho mọi endpoint. 300 giây là mặc định client, không phải bằng chứng Meta cho chờ tối đa 300 giây. Tài liệu Meta trực tiếp không truy cập được khi kiểm tra (429/lỗi fetch), nên không khẳng định trần phía Meta. Tài liệu Undici: https://undici.nodejs.org/api/Client .

Cloudflare hiện công bố proxy read timeout mặc định 125 giây; không đồng nhất với timeout Meta. Streaming có heartbeat trong các lần delay, nhưng chưa có heartbeat xuyên suốt request Meta đang treo. Không nên chỉ tăng timeout client lên 300 giây rồi kết luận toàn luồng chờ được 300 giây. Nguồn: https://developers.cloudflare.com/support/troubleshooting/http-status-codes/cloudflare-5xx-errors/error-524/ .

## Quy tắc đang hợp lý và phần cần tiết chế

- Retry write thêm một lần chỉ khi mọi nguyên nhân đều chứng minh chưa kết nối; không tự gửi lại khi ECONNRESET/UND_ERR_SOCKET. Read được thử lại tối đa hai lần. Bộ test các trường hợp này đạt.
- Khi mất phản hồi tạo Ad, có reconcile theo tên, creative và mốc thời gian trước khi nhận ID; không tạo mới khi kết quả chưa chắc chắn.
- Dùng lại video theo owner/account/media, lưu Video ID, dùng lại trạng thái ready; mô phỏng dùng chung file chỉ tải một lần. 50 media riêng thực sự cần 50 lượt tải, không thể tối ưu thành một lượt nếu nội dung khác nhau.
- Rate limiter tự hạ concurrency/delay theo usage header và chia sẻ cooldown giữa process. Không nên tăng concurrency hoặc số retry chỉ vì có 110 đối tượng; quota tùy tài khoản/app và tình trạng thực tế.
- Luồng trực tiếp chưa có deadline toàn lượt, cùng lúc việc chờ video lại giới hạn cứng 120 giây: chính sách thời gian đang thiếu thống nhất. Ưu tiên tách xử lý video dài khỏi HTTP request, deadline thật và kiểm tra phản hồi mutation trước khi tăng bất kỳ thời gian chờ nào.

Chưa sửa logic production, chưa commit/deploy trong lượt kiểm tra này. Mô phỏng không xác nhận khả năng giải mã file, quota, throughput hay độ ổn định của Meta thật.


## Bản khắc phục sau review

- Chờ video ready tối đa 60 phút thay vì 120 giây. Quá một giờ vẫn processing thì giữ ad ở retry_pending, với loại VideoProcessingPendingError; lịch sử cho thử tiếp bằng Video ID đã lưu. Đây là giới hạn ứng dụng, không khẳng định là trần Meta. Lượt thử lại trực tiếp có deadline 65 phút.
- Mỗi lời gọi Meta có AbortSignal timeout tổng 300 giây, kết hợp signal caller. Deadline publish và bước media prepare hủy request thật, kể cả thời gian ngủ giữa các lần poll. Timeout TCP/TLS mặc định 10 giây được giữ cùng retry an toàn trước khi kết nối.
- Lỗi đọc JSON được giữ lại; campaign/ad set/creative/video và ad đều phải có ID hợp lệ trước khi trả kết quả tạo. Write đã gửi nhưng mất phản hồi bị đánh dấu cần kiểm tra, không chuyển về retry_pending tự động. API/UI chặn retry mù ad set chưa rõ kết quả. Lệnh Ad giữ cơ chế reconcile/confirmation hiện có.
- Hủy trước dispatch hoặc trong thời gian chờ sau phản hồi throttle được phân biệt với write không rõ kết quả để không yêu cầu kiểm tra oan.
- Stream gửi heartbeat cả trong khi đang chờ Meta; link R2 được ký mới khi lấy media cho lệnh tạo, tránh dùng link hết hạn trong batch dài.
- Workflow polling tăng từ 60 lên 240 lần mặc định 15 giây. Workflow vẫn tắt trên production; thay đổi worker nằm trong source, không bật hoặc triển khai Worker ngoài yêu cầu.
- Kiểm tra trước deploy nhận diện direct run/retry dài, bảo vệ tối đa 24 giờ thay vì bỏ qua sau 15 phút/lease hết hạn.

Chạy lại mô phỏng: `node scripts/simulate-meta-load.mjs data-preview/diagnostics/meta-load-fixed-2026-10-07.json`. Cả hai batch dùng chung/50 file riêng vẫn tạo đủ 110 đối tượng; dữ liệu truyền vẫn là 200 MiB và 10.485.760.000 byte. Video ready sau 3 phút tạo đủ 50 ad; video processing hết 60 phút giữ 50 ad pending, không failed. Deadline 20ms hủy request khoảng 21ms; JSON hỏng không còn ghi campaign created. Đây vẫn là mô phỏng cách ly, không xác nhận tốc độ/codec/quota của Meta thật.

Kiểm tra trên Node 22 production còn phát hiện timer chờ rate-limit từng gọi `unref()`, khiến worker CLI có thể thoát khi vẫn còn API xếp hàng. Đã bỏ `unref()` và thêm test subprocess xác nhận worker chờ tới khi có slot.

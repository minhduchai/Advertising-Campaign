# Thiết kế quy trình tạo quảng cáo nền bằng Cloudflare Workflows

## Mục tiêu

Loại bỏ giới hạn một request Vercel phải hoàn thành toàn bộ lượt tạo trong 240–300 giây. Lượt tạo phải tiếp tục khi người dùng đóng trình duyệt, tải lại trang hoặc mạng phía người dùng bị gián đoạn; tiến độ không quay ngược và lỗi phải chỉ rõ đúng đối tượng.

## Kiến trúc được chọn

Ứng dụng tiếp tục chạy trên Vercel. OAuth Meta, mã hóa token, kiểm tra quyền, nghiệp vụ tạo Campaign/Ad Set/Ad, Neon Postgres và giao diện không chuyển khỏi Vercel.

Cloudflare Workflows chỉ đóng vai trò điều phối bền vững:

1. Vercel kiểm tra draft, tạo `runId` và lưu snapshot vào Neon.
2. Vercel khởi chạy một Workflow bằng HTTP có chữ ký HMAC.
3. Workflow gọi tuần tự các endpoint nội bộ ngắn trên Vercel.
4. Mỗi endpoint chỉ xử lý một bước có thể tiếp tục: một Campaign, một Ad Set, một Ad, lấy Post ID hoặc một bình luận seeding.
5. Kết quả từng bước được lưu ngay vào Neon trước khi Workflow chuyển bước kế tiếp.
6. Giao diện đọc tiến độ từ API run hiện có; việc đóng hoặc F5 trang không ảnh hưởng Workflow.

Không chuyển access token Meta sang trình duyệt. Cloudflare không lưu access token Meta; Vercel giải mã token khi xử lý từng bước nội bộ.

## Xác thực nội bộ

- Vercel và Cloudflare dùng chung `WORKFLOW_SHARED_SECRET`.
- Mỗi request nội bộ có timestamp, nonce và chữ ký HMAC-SHA256 trên phương thức, pathname, timestamp, nonce và SHA-256 body.
- Vercel từ chối timestamp lệch quá 5 phút hoặc nonce đã dùng.
- Endpoint nội bộ không dùng cookie người dùng và không được công khai trong UI.

## Trạng thái và tính lặp an toàn

Mỗi bước có khóa ổn định gồm `runId`, loại bước và `clientId`. Trước khi gọi Meta, Vercel kiểm tra kết quả đã lưu:

- Đã thành công: trả lại kết quả cũ, không gọi Meta lần nữa.
- Đang xử lý nhưng chưa rõ kết quả: chuyển `needs_review`, không tự tạo lại để tránh trùng.
- Thất bại chắc chắn trước khi Meta tạo đối tượng: cho phép retry.
- Thất bại do validation/quyền: dừng nhánh liên quan và ghi lỗi đầy đủ.

Campaign lỗi sẽ bỏ qua các Ad Set và Ad con. Ad Set lỗi chỉ bỏ qua các Ad con. Một Ad lỗi không chặn các Ad độc lập khác.

## Luồng công việc

Workflow thực hiện theo thứ tự:

1. Chuẩn bị lượt tạo và kiểm tra trạng thái hiện tại.
2. Tạo Campaign.
3. Tạo từng Ad Set thuộc Campaign.
4. Tạo từng Ad; creative dùng chung phải được tái sử dụng theo khóa artifact hiện có.
5. Poll lấy Post ID/permalink cho từng Ad chưa có link, dùng khoảng nghỉ tăng dần và giới hạn số lần rõ ràng.
6. Gom Post ID duy nhất theo Campaign.
7. Seeding từng Post ID duy nhất theo đúng thứ tự mẫu, cách bình luận 3–5 giây.
8. Hoàn tất run và dọn media tạm khi mọi bước đã ở trạng thái cuối.

## Tiến độ

Tổng bước được cố định khi tạo run, gồm:

- Tạo Campaign, Ad Set và Ad.
- Lấy Post ID cho từng Ad.
- Seeding theo số Post ID duy nhất nhân số bình luận.

Phần trăm hiển thị bằng `max(previousPercent, completedSteps / totalSteps)`, vì vậy không giảm. Nếu sau khi tạo Ads phát hiện nhiều Post ID hơn dự kiến, tổng bước nội bộ được điều chỉnh nhưng phần trăm giao diện vẫn không quay ngược.

## Lỗi và báo cáo

Mỗi lỗi lưu:

- Giai đoạn: Campaign, Ad Set, Ad, lấy Post ID hoặc seeding.
- Tên và `clientId` đối tượng.
- Meta ID/Post ID nếu đã có.
- Mã lỗi, subcode, thông báo gốc đã làm sạch.
- Khả năng retry và hành động đề xuất.

Run chỉ đạt 100% khi mọi bước đã thành công, thất bại, bỏ qua hoặc cần kiểm tra thủ công. Trạng thái `completed_with_errors` hiển thị các lỗi trong panel theo từng Campaign.

## Giới hạn gói miễn phí

Thiết kế bắt đầu với Cloudflare Workers/Workflows Free. Workflow giữ bước nhỏ, chủ yếu chờ network nên giảm CPU. Hệ thống ghi số bước ước tính và cảnh báo trước khi gửi nếu lượt tạo có nguy cơ dùng quá hạn mức vận hành đã cấu hình. Có thể nâng Workers Paid mà không thay đổi kiến trúc.

## Chuyển đổi và dự phòng

- Có cờ `WORKFLOW_ENABLED`.
- Khi tắt cờ, ứng dụng giữ luồng đồng bộ hiện tại để dự phòng trong giai đoạn đầu.
- Khi bật cờ nhưng Cloudflare không nhận job, Vercel đánh dấu `dispatch_failed` và cho phép gửi lại cùng `runId`.
- Không tự fallback sang luồng đồng bộ sau khi Workflow đã nhận job để tránh tạo trùng.

## Kiểm thử chấp nhận

- Lượt tạo dài hơn 300 giây vẫn hoàn thành.
- F5 hoặc đóng trình duyệt không dừng lượt tạo.
- Gửi lại cùng một bước không tạo trùng đối tượng đã thành công.
- Progress không giảm.
- Post ID dùng chung chỉ seeding một lần.
- Lỗi hiển thị đúng Campaign/Ad Set/Ad/Post ID/bình luận.
- Khi Cloudflare chưa cấu hình, luồng hiện tại vẫn hoạt động.

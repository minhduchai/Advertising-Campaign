# Meta Ads Campaign Builder

Ứng dụng local để đăng nhập Meta, tự tải tài khoản quảng cáo và tạo cấu trúc nhiều cấp:

```text
Campaign → nhiều Ad Set → nhiều Ad
```

Preset hiện tại chỉ hỗ trợ quảng cáo **Cuộc trò chuyện trên Messenger**. Campaign, Ad Set và Ad được tạo ở trạng thái `ACTIVE` sau khi người dùng xác nhận cảnh báo chi tiêu.

## Chức năng

- Workspace ba cột: cây chiến dịch, trình chỉnh sửa theo node và bảng kiểm tra lỗi.
- Tạo nhiều Campaign, nhiều Ad Set trong mỗi Campaign và nhiều Ad trong mỗi Ad Set.
- Hai chiến lược ngân sách ngày loại trừ lẫn nhau:
  - **Ngân sách chiến dịch:** Campaign gửi `daily_budget`; Ad Set không gửi ngân sách.
  - **Ngân sách nhóm quảng cáo:** Campaign gửi `is_adset_budget_sharing_enabled=false`; mỗi Ad Set gửi `daily_budget`.
- Chọn tài khoản quảng cáo và Facebook Page riêng cho từng Campaign.
- Tự tải Page từ `promote_pages`, `/me/accounts` và các Business Portfolio; đồng thời tải Custom Audience theo tài khoản quảng cáo đang chọn.
- Nhắm vị trí theo tỉnh/thành phố Việt Nam: mỗi Ad Set phải có ít nhất một tỉnh/thành phố trong **Bao gồm**, gửi đúng `region key` từ Meta và có thể thêm danh sách **Loại trừ**.
- Đối tượng thủ công với tuổi, giới tính, Custom Audience bao gồm/loại trừ và nhắm mục tiêu chi tiết.
- Advantage+ Audience luôn tắt bằng `targeting_automation: { advantage_audience: 0 }`.
- Upload JPG, PNG, WEBP, MP4 hoặc MOV; nhập văn bản chính và tiêu đề cho từng quảng cáo.
- Trình tạo **Cuộc trò chuyện** trong từng Ad gồm tên mẫu, nội dung tin nhắn và 1–3 nút mở URL HTTPS.
- Tool tự sinh Messenger button-template `{ message }`; giao diện có JSON xem trước chỉ đọc.
- Mọi người dùng đã kết nối Meta dùng chung một thư viện mẫu; ai cũng có thể tạo, cập nhật, nhân bản và xóa mẫu. Quảng cáo mới luôn bắt đầu với `Mặc định (trống)` và chỉ điền nội dung khi người dùng chủ động chọn mẫu.
- Mỗi Ad giữ một snapshot riêng của mẫu. Cập nhật mẫu nguồn không tự thay đổi các Ad đã cấu hình.
- Creative ảnh và video gửi `page_welcome_message` dạng Visual Editor cùng nội dung snapshot.
- Media quảng cáo được tải vào Cloudflare R2 qua application server; bản nháp chỉ giữ `image_hash` hoặc `video_id`, không lưu ảnh/video quảng cáo trong cơ sở dữ liệu.
- Cloudflare R2 giữ ảnh seeding cần dùng lại khi đăng bình luận. Đổi tài khoản quảng cáo của một Campaign sẽ yêu cầu chọn lại media cho Campaign đó.
- Validation theo đường dẫn field trước khi cho phép gửi dữ liệu sang Meta.

## Yêu cầu

- Node.js 24 trở lên.
- Meta App đã bật Marketing API.
- OAuth redirect URI khớp chính xác URL local, ví dụ `http://localhost:3001/api/auth/meta/callback`.
- User Meta có quyền quảng cáo phù hợp trên ad account và Page cần dùng.

Ứng dụng yêu cầu các scope:

```text
ads_read
ads_management
pages_show_list
pages_read_engagement
pages_manage_engagement
pages_manage_ads
business_management
```

Không bắt buộc user phải là Admin toàn phần của Page. Ứng dụng tổng hợp Page từ quyền quảng bá của ad account, các Page user quản lý và các Page thuộc Business Portfolio; chỉ Page có tín hiệu quyền quảng cáo hiện tại mới được bật để chọn. Nếu Page không xuất hiện hoặc đang bị vô hiệu hóa, hãy kiểm tra quyền tài sản trong Business Portfolio, quyền advertiser trên ad account/Page và trạng thái App Review; ứng dụng không cho nhập Page ID thủ công để vượt quyền.

### Facebook Page discovery

The Page selector merges all paginated results from:

- `/{ad_account_id}/promote_pages`
- `/me/accounts`
- `/me/businesses` → `owned_pages` and `client_pages`

OAuth requests `business_management` for Business Portfolio discovery. Existing tokens must reconnect through **Kết nối lại Meta** before Business-owned and client Pages can appear. If Meta does not grant that scope, the app continues with promotable and user-managed Pages and displays a partial-catalog warning.

Pages without a current advertising permission signal remain visible but disabled. Publish reloads the server-side catalog; browser state is never accepted as proof of Page permission.

Mẫu Cuộc trò chuyện của ứng dụng là thư viện **dùng chung toàn tool**, không phụ thuộc Page, BM hoặc tài khoản quảng cáo. Mẫu không tự xuất hiện trong mục mẫu đã lưu native của Ads Manager và thay đổi trong Ads Manager cũng không tự đồng bộ về ứng dụng.

### Public Test khi Meta App chưa Live

Trong từng Quảng cáo, chọn **Bài công khai để thử App Dev** để đăng ảnh thành bài viết công khai trên Facebook Page rồi dùng chính bài viết đó tạo quảng cáo. Chế độ này chỉ hỗ trợ ảnh và Campaign/Ad Set/Ad sẽ được kích hoạt sau khi người dùng xác nhận.

Token cũ phải bấm **Kết nối lại Meta** để cấp thêm `pages_manage_posts`. Page phải xuất hiện trong `/me/accounts`, có Page access token và task `CREATE_CONTENT`; quyền quảng cáo đơn thuần không đủ để đăng bài công khai. Nếu tạo Creative hoặc Ad thất bại, ứng dụng cố gắng xóa bài vừa đăng và hiển thị ID bài viết nếu việc dọn dẹp cũng thất bại.

Chế độ mặc định **Bài quảng cáo ẩn** không đăng bài lên Page. Khi App đã Live và hoàn tất App Review, nên quay lại chế độ mặc định cho chiến dịch thật.

### Cuộc trò chuyện dạng JSON

Biểu mẫu hỗ trợ Messenger button template với nội dung tối đa 640 ký tự và 1–3 nút `web_url`. Mỗi nút có tiêu đề tối đa 20 ký tự và URL HTTPS. Tool hiển thị JSON `{ message }` được sinh tự động để kiểm tra trước khi tạo quảng cáo.

Ứng dụng giữ nguyên biến Meta Ads `{{full_name}}`, tự động chuyển mẫu cũ `{fullname}` sang biến chuẩn, tự thêm `https://` cho URL bị thiếu giao thức và từ chối URL không dùng HTTPS. Server tự tạo wrapper `page_welcome_message` Visual Editor cho ảnh và video.

## Seeding bài quảng cáo

- Thư viện seeding là thư viện riêng theo chủ sở hữu Meta đang đăng nhập, không phải thư viện mẫu Cuộc trò chuyện dùng chung toàn tool.
- Mỗi `postId` chỉ seeding một lần. Nếu nhiều ads cùng trỏ về cùng một `postId`, hệ thống gom lại và không lặp bình luận.
- Hàng đợi seeding chạy tuần tự từng item, chờ tự nhiên khoảng 3–5 giây giữa các lần gọi Meta để giảm rủi ro bị đánh giá là spam.
- Khi reload hoặc khôi phục tiến trình, hệ thống tiếp tục từ trạng thái còn lại. Item đã rơi vào `needs_review` sẽ không tự retry để tránh tạo comment trùng.
- Ảnh comment có thể lưu cục bộ khi soạn thảo, nhưng Meta chỉ nhận URL HTTPS khi tạo comment ảnh. Ở production, application server cấp URL HTTPS ký sẵn, có thời hạn từ Cloudflare R2 để Meta tải ảnh; ảnh không cần công khai vĩnh viễn.
- Để người dùng ngoài app dùng được seeding, Facebook Login for Business gắn với `META_LOGIN_CONFIG_ID` phải bật `pages_manage_engagement` và app phải có Advanced Access / App Review cho quyền này.
- Người dùng cũ phải bấm **Kết nối lại Meta** để lấy token mới có thêm quyền `pages_manage_engagement`.
- Page phải xuất hiện trong `/me/accounts` với Page access token và task `MODERATE` thì mới comment bằng Page được. Page chỉ có quyền quảng cáo vẫn tạo Ads được, nhưng không comment được bằng Page.

### Checklist nhanh cho Duck Tool

1. Bấm **Kết nối lại Meta** sau khi bật quyền mới.
2. Kiểm tra Page Duck Tool xuất hiện trong danh sách Page.
3. Xác nhận Page có Page access token và task `MODERATE`.
4. Chạy thử seeding text trước; nếu seeding ảnh, dùng ảnh JPEG/PNG đã tải lên tool để hệ thống cấp URL HTTPS ký sẵn cho Meta.
5. Mở lại lịch sử sau reload để xác nhận hàng đợi, `postId` và kết quả seeding không bị tạo trùng.

## Cấu hình

Sao chép `.env.example` thành `.env`:

```powershell
Copy-Item .env.example .env
```

| Biến | Mô tả |
| --- | --- |
| `META_APP_ID` | App ID của Meta App. |
| `META_APP_SECRET` | App Secret; chỉ đặt ở `.env`, không gửi xuống browser. |
| `META_LOGIN_CONFIG_ID` | Configuration ID của Facebook Login for Business. |
| `META_REDIRECT_URI` | OAuth callback local, phải khớp cấu hình Meta App. |
| `META_API_VERSION` | Phiên bản Graph API ứng dụng sử dụng. |
| `TOKEN_ENCRYPTION_KEY` | Khóa Base64 đúng 32 byte để mã hóa token trong SQLite. |
| `SESSION_SECRET` | Chuỗi ngẫu nhiên dùng để ký session cookie. |
| `PORT` | Cổng local, mặc định `3000`. |

Tạo khóa mã hóa và session secret:

```powershell
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"
```

## Chạy local

```powershell
npm.cmd run dev
```

Mở URL đúng với `PORT` trong `.env`, kết nối Meta, rồi chọn tài khoản quảng cáo và Page trong từng Campaign.

## Kiểm thử

```powershell
npm.cmd test
```

Automated tests không tạo object thật trên Meta.

## Template migration

Export the local SQLite library only after signing in to Meta. The owner is the local app's Meta user ID; the exporter requires a matching local connection and writes only the output path and count. `data-migrations/conversation-templates.json` excludes the old owner identity, OAuth tokens, and other secrets:

```powershell
npm.cmd run templates:export -- --owner <old-local-meta-user-id>
```

After migrating the production schema and completing OAuth with the production Meta app, list the newly app-scoped owner IDs. This command only prints each Meta user ID and connection update timestamp; it never decrypts or prints tokens:

```powershell
node --env-file=.env.production.local scripts/list-production-connections.js
```

Use the production OAuth owner ID, not the local owner ID, for the import. The importer does not load `.env`; supply `DATABASE_URL` explicitly through the production environment:

```powershell
node --env-file=.env.production.local scripts/import-conversation-templates.js --file data-migrations/conversation-templates.json --owner <new-production-meta-user-id>
```

Các lệnh import/export trên chỉ phục vụ dữ liệu mẫu cũ theo Page. Thư viện dùng chung mới được seed một lần qua database migration và không tự tạo lại mẫu đã bị người dùng xóa.

## Smoke checklist

1. Hoàn tất OAuth và xác nhận danh sách ad account tự tải.
2. Chọn ad account và xác nhận Page/Custom Audience tự tải theo account đó.
3. Tạo ít nhất hai Campaign; thêm nhiều Ad Set và nhiều Ad.
4. Chuyển qua lại hai chiến lược ngân sách và xác nhận cấp ngân sách không dùng bị vô hiệu hóa.
5. Chọn ít nhất một tỉnh/thành phố Việt Nam trong **Bao gồm**; thử thêm hoặc chuyển một tỉnh sang **Loại trừ**.
6. Chọn giới tính, Page, Custom Audience include/exclude và điều kiện targeting.
7. Upload media, điền văn bản chính và tiêu đề.
8. Chọn hoặc tạo mẫu Cuộc trò chuyện, kiểm tra nội dung, 1–3 nút URL, JSON sinh tự động và preview Messenger.
9. Đăng nhập bằng người dùng Meta khác và xác nhận cả hai cùng thấy, sửa và xóa được thư viện mẫu dùng chung.
10. Chỉ thực hiện lượt tạo thật sau khi đã duyệt; kiểm tra tất cả object trong Ads Manager đã ở trạng thái `ACTIVE`.

## Bảo mật

- Token Meta được mã hóa AES-256-GCM trong `data/meta-ads.sqlite`.
- Static asset và health check không tạo session mới, tránh ghi đè phiên OAuth khi tải trang.
- Không commit `.env` hoặc thư mục `data/`.
- Access token không được trả về browser qua bất kỳ resource endpoint nào.

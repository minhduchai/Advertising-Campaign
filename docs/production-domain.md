# Tên miền production

Website người dùng và callback Meta dùng `https://setads.click`.

Application chạy bằng systemd service `campaignbuilder` trên Ubuntu và khởi động từ `src/hosted-server.js`. Deploy bằng:

```powershell
Set-Location 'D:\Advertising-Campaign'
.\scripts\deploy-server.ps1
```

Sau mỗi lần deploy, xác minh `/api/health`, `/api/auth/session`, file JavaScript liên quan và thao tác trình duyệt vừa thay đổi. Không deploy lại nền tảng serverless cũ.

## Ngừng môi trường Vercel cũ (02/10/2026)

Project `creative-campaign-lgclinic` (`prj_2nMfbvmV4pHr8zsF3F1eq0jLJGHT`)
đã được pause trên Vercel; không có liên kết Git tự deploy. Hai alias của
project và URL deployment production đều trả `503 DEPLOYMENT_PAUSED`, kể cả
`POST /api/runs`. Không unpause hoặc deploy lại project này.

Đã bỏ origin Vercel khỏi CORS của bucket `creative-campaign-temp-media`.
Website production vẫn là `https://setads.click`, qua Tunnel tới Ubuntu
`127.0.0.1:3000`, với `WORKFLOW_ENABLED=false`.

Cơ sở dữ liệu cũ được giữ nguyên để đối chiếu: có 5 lượt `dispatch_failed`
ngày 02/10/2026 lúc 14:34-14:38 (UTC+7), khớp mã chiến dịch trong ảnh lỗi
`invalid_signature`; cả 5 không có `node_results`. Cơ sở dữ liệu này khác
database của Ubuntu. Không dùng `.env.production.local` hoặc `.env.recovery`
để vận hành production hiện tại; cấu hình đang chạy nằm trong
`/home/campaignadmin/.config/campaignbuilder/app.env` trên Ubuntu.

Kiểm tra đã xác nhận health của tên miền chính trả 200, chữ ký Ubuntu được
Worker chấp nhận và bản cũ đã ngừng nhận yêu cầu. Chưa xác minh được đường đi
của request gốc từ trình duyệt người dùng; chưa chạy lại batch quảng cáo.
Phiên Meta trên `setads.click` tải được lịch sử đã đăng nhập. R2 preflight
PUT từ `https://setads.click` trả 204 với đúng Allow-Origin; origin Vercel
trả 403. Các kiểm tra này không tạo thêm quảng cáo.

## Lưu media seeding trên R2

Bucket `creative-campaign-temp-media` dùng hai prefix phân biệt hoa/thường:

- `ads/`: media quảng cáo, rule `delete-temp-media-after-1-day` xóa sau 1 ngày.
- `Seeding/`: media seeding lưu lâu dài, không có rule expiration. App cũng
  không xóa prefix này khi dọn media sau lượt tạo.

Upload seeding gửi `purpose: 'seeding'`. Khi lưu mẫu hoặc tạo lượt quảng cáo,
app chuyển media seeding cũ từ `ads/` sang `Seeding/`: copy, kiểm tra file rồi
đổi đường dẫn trong DB, giữ nguyên media ID. Bản gốc giữ lại cho URL đang dùng
và được lifecycle dọn sau đó.

Trước khi bật rule `ads/` trên bản cũ, deploy code rồi chạy trên server:

```sh
node --env-file=/home/campaignadmin/.config/campaignbuilder/app.env scripts/migrate-seeding-media-r2.js
```

Script bảo vệ media được tham chiếu bởi mẫu seeding, job và snapshot/execution
của lượt tạo; báo riêng file đã mất. Bản nháp chỉ trong trình duyệt chưa nằm
trong các nguồn này cần được mở và lưu thành mẫu trước khi file hết hạn.

Giữ `Default Multipart Abort Rule` để hủy upload multipart chưa hoàn tất sau
7 ngày; rule này không xóa file đã upload hoàn tất. Ngoài lifecycle, app dọn
media quảng cáo theo vòng đời lượt tạo và file dư theo ngưỡng dung lượng.
File đã bị expiration
xóa trước đó cần được tải lại rồi lưu vào mẫu.

Kiểm tra cấu hình thực tế từ thư mục `cloudflare`:

```powershell
npx wrangler r2 bucket lifecycle list creative-campaign-temp-media
```

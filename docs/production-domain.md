# Tên miền production

Website người dùng và callback Meta dùng `https://advertisingserver.tailac4f15.ts.net`.

Application chạy bằng systemd service `campaignbuilder` trên Ubuntu và khởi động từ `src/hosted-server.js`. Deploy bằng:

```powershell
Set-Location 'D:\Advertising-Campaign'
.\scripts\deploy-server.ps1
```

Sau mỗi lần deploy, xác minh `/api/health`, `/api/auth/session`, file JavaScript liên quan và thao tác trình duyệt vừa thay đổi. Không deploy lại nền tảng serverless cũ.

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

# Triển khai Cloudflare Workflow

## Tạo khóa dùng chung

```powershell
$secretBytes = New-Object byte[] 32
[Security.Cryptography.RandomNumberGenerator]::Fill($secretBytes)
$secret = [Convert]::ToBase64String($secretBytes)
$secret
```

Đặt cùng giá trị vào `WORKFLOW_SHARED_SECRET` của application server và Cloudflare. `APP_SERVER_BASE_URL` trong `cloudflare/wrangler.jsonc` phải trỏ tới `https://setads.click`.

## Deploy Workflow

```powershell
Set-Location 'D:\Advertising-Campaign\cloudflare'
npx wrangler secret put WORKFLOW_SHARED_SECRET
npx wrangler deploy
```

## Cấu hình application server

- `WORKFLOW_ENABLED=true`
- `WORKFLOW_URL=https://<worker>.workers.dev`
- `WORKFLOW_SHARED_SECRET=<khóa dùng chung>`

Deploy lại server bằng `scripts/deploy-server.ps1`.

## Rollback

Đặt `WORKFLOW_ENABLED=false` trong environment của service rồi deploy lại server. Không xóa Workflow đang chạy cho tới khi các lượt hiện tại kết thúc.

Hiện production giữ `WORKFLOW_ENABLED=false`; quy trình tạo Ads chạy trực tiếp trên application server. Tunnel `setads.click` đã hoạt động nhưng Worker chưa được bật lại.

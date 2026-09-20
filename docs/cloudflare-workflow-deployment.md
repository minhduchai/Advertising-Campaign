# Triển khai Cloudflare Workflow

## Tạo khóa dùng chung

```powershell
$secretBytes = New-Object byte[] 32
[Security.Cryptography.RandomNumberGenerator]::Fill($secretBytes)
$secret = [Convert]::ToBase64String($secretBytes)
$secret
```

Đặt cùng giá trị vào `WORKFLOW_SHARED_SECRET` của Vercel và Cloudflare.

## Deploy Workflow

```powershell
Set-Location 'D:\Advertising-Campaign\cloudflare'
npx wrangler secret put WORKFLOW_SHARED_SECRET
npx wrangler deploy
```

## Cấu hình Vercel

- `WORKFLOW_ENABLED=true`
- `WORKFLOW_URL=https://<worker>.workers.dev`
- `WORKFLOW_SHARED_SECRET=<khóa dùng chung>`

Deploy lại production:

```powershell
Set-Location 'D:\Advertising-Campaign'
npx vercel deploy --prod --yes --scope ducndna-5064s-projects --project creative-campaign-lgclinic
```

## Rollback

Đặt `WORKFLOW_ENABLED=false` rồi deploy lại Vercel. Không xóa Workflow đang chạy cho tới khi các lượt hiện tại kết thúc.

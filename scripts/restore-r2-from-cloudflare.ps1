param(
  [string]$Server = 'campaignadmin@100.89.81.110',
  [string]$KeyPath = "$env:USERPROFILE\.ssh\advertising_server_ed25519",
  [string]$R2EnvironmentPath = 'D:\Advertising-Campaign\r2-restore.env'
)

$ErrorActionPreference = 'Stop'
$temporaryEnvironment = Join-Path $env:TEMP ("campaignbuilder-r2-{0}.env" -f [guid]::NewGuid().ToString('N'))
$remoteEnvironment = '/tmp/campaignbuilder-r2.env'
$r2Names = @('R2_ACCOUNT_ID', 'R2_BUCKET_NAME', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_ENDPOINT')

function Read-EnvironmentFile([string]$Path) {
  $result = @{}
  Get-Content -LiteralPath $Path | ForEach-Object {
    if ($_ -match '^([^#=]+)=(.*)$') {
      $result[$matches[1].Trim()] = $matches[2].Trim().Trim('"').Trim("'")
    }
  }
  return $result
}

try {
  if (-not (Test-Path -LiteralPath $R2EnvironmentPath)) {
    throw "Không tìm thấy $R2EnvironmentPath"
  }

  $r2 = Read-EnvironmentFile $R2EnvironmentPath
  foreach ($name in $r2Names) {
    if (-not $r2[$name] -or $r2[$name] -eq '[SENSITIVE]') {
      throw "Thiếu giá trị hợp lệ: $name"
    }
  }
  if ($r2['R2_ENDPOINT'] -notmatch '^https://') { throw 'R2_ENDPOINT phải bắt đầu bằng https://' }

  $lines = @($r2Names | ForEach-Object { '{0}={1}' -f $_, $r2[$_] })
  [IO.File]::WriteAllLines($temporaryEnvironment, $lines, [Text.UTF8Encoding]::new($false))

  Write-Host '1/2 Updating Cloudflare R2 settings on Ubuntu...'
  & scp -i $KeyPath -o BatchMode=yes $temporaryEnvironment "${Server}:$remoteEnvironment"
  if ($LASTEXITCODE -ne 0) { throw 'Không gửi được cấu hình bảo mật tới Ubuntu.' }

  $remoteScript = @'
python3 - <<'PY'
from pathlib import Path
source = Path('/tmp/campaignbuilder-r2.env')
target = Path('/home/campaignadmin/.config/campaignbuilder/app.env')
values = {}
for line in source.read_text().splitlines():
    if '=' in line:
        key, value = line.split('=', 1)
        values[key] = value
needed = {'R2_ACCOUNT_ID','R2_BUCKET_NAME','R2_ACCESS_KEY_ID','R2_SECRET_ACCESS_KEY','R2_ENDPOINT'}
if set(values) != needed:
    raise SystemExit('R2 configuration is incomplete.')
out, pending = [], set(needed)
for line in target.read_text().splitlines():
    key = line.split('=', 1)[0] if '=' in line else ''
    if key in needed:
        out.append(f'{key}={values[key]}')
        pending.discard(key)
    else:
        out.append(line)
for key in sorted(pending):
    out.append(f'{key}={values[key]}')
target.write_text('\n'.join(out) + '\n')
source.unlink()
PY
oldpid=$(systemctl show campaignbuilder --property=MainPID --value)
kill -KILL "$oldpid"
for i in $(seq 1 20); do
  newpid=$(systemctl show campaignbuilder --property=MainPID --value)
  if [ "$newpid" != 0 ] && [ "$newpid" != "$oldpid" ] && curl -fsS http://127.0.0.1:3000/api/health >/dev/null; then
    break
  fi
  sleep 1
done
cd /home/campaignadmin/apps/campaignbuilder
node --env-file=/home/campaignadmin/.config/campaignbuilder/app.env --input-type=module - <<'NODE'
import { S3Client, ListObjectsV2Command } from '@aws-sdk/client-s3';
const client = new S3Client({
  region: 'auto', endpoint: process.env.R2_ENDPOINT,
  credentials: { accessKeyId: process.env.R2_ACCESS_KEY_ID, secretAccessKey: process.env.R2_SECRET_ACCESS_KEY }
});
await client.send(new ListObjectsV2Command({ Bucket: process.env.R2_BUCKET_NAME, MaxKeys: 1 }));
console.log('R2 connected successfully.')
NODE
'@
  & ssh -i $KeyPath -o BatchMode=yes $Server $remoteScript
  if ($LASTEXITCODE -ne 0) { throw 'Ubuntu hoặc R2 chưa khởi động đúng.' }

  Write-Host '2/2 Completed. Cloudflare R2 is connected.'
}
finally {
  Remove-Item -LiteralPath $temporaryEnvironment -Force -ErrorAction SilentlyContinue
}

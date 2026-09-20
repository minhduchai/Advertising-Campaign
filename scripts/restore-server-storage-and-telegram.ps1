param(
  [string]$Server = 'campaignadmin@100.89.81.110',
  [string]$KeyPath = "$env:USERPROFILE\.ssh\advertising_server_ed25519",
  [string]$BotEnvironmentPath = 'C:\TelegramFileBot\.env'
)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$vercelEnvironment = Join-Path $env:TEMP ("campaignbuilder-vercel-{0}.env" -f [guid]::NewGuid().ToString('N'))
$selectedEnvironment = Join-Path $env:TEMP ("campaignbuilder-runtime-{0}.env" -f [guid]::NewGuid().ToString('N'))
$remoteEnvironment = '/tmp/campaignbuilder-runtime.env'
$names = @(
  'R2_ACCOUNT_ID', 'R2_BUCKET_NAME', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY',
  'R2_ENDPOINT', 'TELEGRAM_UPLOAD_WORKER_SECRET'
)

try {
  Set-Location $projectRoot
  Write-Host '1/4 Reading the existing Vercel production configuration...'
  & npx vercel env pull $vercelEnvironment --environment=production
  if ($LASTEXITCODE -ne 0) { throw 'Could not read the Vercel production configuration.' }

  $values = @{}
  Get-Content -LiteralPath $vercelEnvironment | ForEach-Object {
    if ($_ -match '^([^#=]+)=(.*)$') {
      $values[$matches[1].Trim()] = $matches[2].Trim().Trim('"').Trim("'")
    }
  }
  foreach ($name in $names) {
    if (-not $values[$name] -or $values[$name] -eq '[SENSITIVE]') {
      throw "Vercel did not return a usable value for $name."
    }
  }
  if ($values['R2_ENDPOINT'] -notmatch '^https://') { throw 'The Cloudflare R2 endpoint is invalid.' }

  $selectedLines = @($names | ForEach-Object { '{0}={1}' -f $_, $values[$_] })
  [IO.File]::WriteAllLines($selectedEnvironment, $selectedLines, [Text.UTF8Encoding]::new($false))

  Write-Host '2/4 Updating Cloudflare R2 and Telegram worker settings on Ubuntu...'
  & scp -i $KeyPath -o BatchMode=yes $selectedEnvironment "${Server}:$remoteEnvironment"
  if ($LASTEXITCODE -ne 0) { throw 'Could not send the protected configuration to Ubuntu.' }

  $remoteScript = @'
python3 - <<'PY'
from pathlib import Path
source = Path('/tmp/campaignbuilder-runtime.env')
target = Path('/home/campaignadmin/.config/campaignbuilder/app.env')
values = {}
for line in source.read_text().splitlines():
    if '=' in line:
        key, value = line.split('=', 1)
        values[key] = value
needed = {
    'R2_ACCOUNT_ID', 'R2_BUCKET_NAME', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY',
    'R2_ENDPOINT', 'TELEGRAM_UPLOAD_WORKER_SECRET'
}
if set(values) != needed:
    raise SystemExit('Protected runtime configuration is incomplete.')
out = []
pending = set(needed)
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
    echo 'Ubuntu application restarted.'
    exit 0
  fi
  sleep 1
done
exit 1
'@
  & ssh -i $KeyPath -o BatchMode=yes $Server $remoteScript
  if ($LASTEXITCODE -ne 0) { throw 'Ubuntu did not restart successfully.' }

  Write-Host '3/4 Updating the Telegram bot worker on Windows...'
  $botText = [IO.File]::ReadAllText($BotEnvironmentPath)
  $workerLine = "TELEGRAM_UPLOAD_WORKER_SECRET=$($values['TELEGRAM_UPLOAD_WORKER_SECRET'])"
  if ($botText -match '(?m)^TELEGRAM_UPLOAD_WORKER_SECRET=') {
    $botText = $botText -replace '(?m)^TELEGRAM_UPLOAD_WORKER_SECRET=.*$', $workerLine
  } else {
    $botText = $botText.TrimEnd() + "`r`n$workerLine`r`n"
  }
  [IO.File]::WriteAllText($BotEnvironmentPath, $botText, [Text.UTF8Encoding]::new($false))
  $values.Clear()

  $taskName = 'Telegram Company File Bot Native'
  Stop-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
  Start-Sleep -Seconds 2
  Start-ScheduledTask -TaskName $taskName
  Start-Sleep -Seconds 5

  Write-Host '4/4 Completed. Verifying the bot task...'
  Get-ScheduledTask -TaskName $taskName | Select-Object TaskName, State
}
finally {
  Remove-Item -LiteralPath $vercelEnvironment -Force -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath $selectedEnvironment -Force -ErrorAction SilentlyContinue
}

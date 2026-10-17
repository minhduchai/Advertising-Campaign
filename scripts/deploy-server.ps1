param(
  [string]$Server = 'campaignadmin@100.89.81.110',
  [string]$KeyPath = "$env:USERPROFILE\.ssh\advertising_server_ed25519",
  # Skip the running-campaign check (the deploy restarts the service and interrupts any run in progress).
  [switch]$Force
)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$archivePath = Join-Path $env:TEMP ("campaignbuilder-deploy-{0}.tar.gz" -f [guid]::NewGuid().ToString('N'))
$remoteArchive = '/home/campaignadmin/campaignbuilder-deploy.tar.gz'

try {
  Set-Location $projectRoot

  if ($Force) {
    Write-Host '0/4 Skipping the running-campaign check (-Force).'
  } else {
    Write-Host '0/4 Checking for running campaign runs...'
    $remoteApp = '/home/campaignadmin/apps/campaignbuilder'
    & scp -i $KeyPath -o BatchMode=yes (Join-Path $projectRoot 'scripts/check-active-runs.js') "${Server}:$remoteApp/scripts/check-active-runs.js"
    if ($LASTEXITCODE -ne 0) { throw 'Could not upload the running-campaign check script.' }
    & ssh -i $KeyPath -o BatchMode=yes $Server "cd $remoteApp && node --env-file=/home/campaignadmin/.config/campaignbuilder/app.env scripts/check-active-runs.js"
    if ($LASTEXITCODE -eq 3) {
      throw 'A campaign run is in progress: restarting now would interrupt it. Wait for it to finish and deploy again, or pass -Force if you are sure.'
    }
    if ($LASTEXITCODE -ne 0) { throw 'Could not check for running campaign runs. Check the connection, or pass -Force if you are sure.' }
  }

  Write-Host '1/4 Building frontend...'
  & npm.cmd run build:client
  if ($LASTEXITCODE -ne 0) { throw 'Frontend build failed.' }

  Write-Host '2/4 Creating deployment package...'
  & tar -czf $archivePath --exclude=node_modules --exclude=.git --exclude=.next --exclude=dist package.json package-lock.json src public scripts deploy
  if ($LASTEXITCODE -ne 0) { throw 'Could not create deployment package.' }

  Write-Host '3/4 Uploading code to Ubuntu...'
  & scp -i $KeyPath -o BatchMode=yes $archivePath "${Server}:$remoteArchive"
  if ($LASTEXITCODE -ne 0) { throw 'Upload failed.' }

  Write-Host '4/4 Installing and restarting Campaign Builder...'
  $remoteScript = @'
set -eu
app=/home/campaignadmin/apps/campaignbuilder
mkdir -p "$app"
tar -xzf /home/campaignadmin/campaignbuilder-deploy.tar.gz -C "$app"
cd "$app"
npm ci --omit=dev
node --env-file=/home/campaignadmin/.config/campaignbuilder/app.env scripts/migrate-postgres.js
node --env-file=/home/campaignadmin/.config/campaignbuilder/app.env scripts/migrate-comment-unhide.js
if systemctl --user is-active --quiet campaignbuilder; then
  systemctl --user restart campaignbuilder
  i=0
  while [ "$i" -lt 20 ]; do
    if systemctl --user is-active --quiet campaignbuilder && curl -fsS http://127.0.0.1:3000/api/health; then exit 0; fi
    i=$((i+1))
    sleep 1
  done
  journalctl --user -u campaignbuilder -n 30 --no-pager
  exit 1
fi
oldpid=$(systemctl show campaignbuilder --property=MainPID --value)
if [ "$oldpid" = 0 ]; then
  echo 'campaignbuilder is not running. Run: sudo systemctl start campaignbuilder'
  exit 1
fi
kill -KILL "$oldpid"
i=0
while [ "$i" -lt 20 ]; do
  newpid=$(systemctl show campaignbuilder --property=MainPID --value)
  if [ "$newpid" != 0 ] && [ "$newpid" != "$oldpid" ] && curl -fsS http://127.0.0.1:3000/api/health >/tmp/campaignbuilder-health.json; then
    cat /tmp/campaignbuilder-health.json
    exit 0
  fi
  i=$((i+1))
  sleep 1
done
journalctl -u campaignbuilder -n 30 --no-pager
exit 1
'@
  & ssh -i $KeyPath -o BatchMode=yes $Server $remoteScript
  if ($LASTEXITCODE -ne 0) { throw 'Server restart or health check failed.' }

  Write-Host 'Deployment completed: https://setads.click'
}
finally {
  if (Test-Path -LiteralPath $archivePath) {
    Remove-Item -LiteralPath $archivePath -Force
  }
}

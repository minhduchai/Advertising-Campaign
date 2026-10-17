$ErrorActionPreference = 'Stop'

$sourceRoot = [IO.Path]::GetFullPath($PSScriptRoot)
$targetRoot = [IO.Path]::GetFullPath('C:\TelegramFileBot')
$files = @(
    'bot.py',
    'telegram_app_upload.py',
    'telegram_api.py',
    'path_guard.py',
    'file_search.py',
    'requirements.txt',
    'run-bot.cmd',
    'HUONG-DAN.txt',
    '.env.example',
    'native_runtime.py',
    'native-task.ps1'
)

New-Item -ItemType Directory -Path $targetRoot -Force | Out-Null

foreach ($name in $files) {
    $source = Join-Path $sourceRoot $name
    $target = Join-Path $targetRoot $name
    if (-not (Test-Path -LiteralPath $source)) {
        throw "Thiếu file trong bộ cập nhật: $name"
    }
    if ([IO.Path]::GetFullPath($source) -ieq [IO.Path]::GetFullPath($target)) {
        continue
    }
    Copy-Item -LiteralPath $source -Destination $target -Force
}

$python = Join-Path $targetRoot '.venv\Scripts\python.exe'
if (-not (Test-Path -LiteralPath $python)) {
    py -3.12 -m venv (Join-Path $targetRoot '.venv')
}

& $python -m pip install -r (Join-Path $targetRoot 'requirements.txt') | Out-Host
& $python -m py_compile `
    (Join-Path $targetRoot 'bot.py') `
    (Join-Path $targetRoot 'telegram_app_upload.py') `
    (Join-Path $targetRoot 'telegram_api.py') `
    (Join-Path $targetRoot 'path_guard.py') `
    (Join-Path $targetRoot 'file_search.py')
if ($LASTEXITCODE -ne 0) { throw 'Kiem tra ma Python that bai; chua khoi dong lai bot.' }

$taskName = 'Telegram Company File Bot'
if (Get-ScheduledTask -TaskName 'Telegram Company File Bot Native' -ErrorAction SilentlyContinue | Where-Object { $_.State -ne 'Disabled' }) {
    $taskName = 'Telegram Company File Bot Native'
}
$task = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
if ($task) {
    Stop-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 2
    Start-ScheduledTask -TaskName $taskName
    Write-Host "Da cap nhat va khoi dong lai bot." -ForegroundColor Green
} else {
    Write-Host "Da cap nhat file. Khong tim thay Task Scheduler '$taskName'; hay khoi dong bot thu cong." -ForegroundColor Yellow
}

Read-Host 'Nhan Enter de dong'

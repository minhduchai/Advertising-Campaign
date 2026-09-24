$ErrorActionPreference = 'Stop'
$targetRoot = 'C:\TelegramFileBot'
$taskName = 'Telegram Company File Bot'
try {
    if (-not (Get-Command py -ErrorAction SilentlyContinue)) { throw 'Can cai Python 3.12 va Python Launcher truoc.' }
    & py -3.12 --version
    if ($LASTEXITCODE -ne 0) { throw 'Chua co Python 3.12.' }
    if (-not (Get-Command docker -ErrorAction SilentlyContinue)) { throw 'Can cai Docker Desktop truoc.' }
    & docker info --format '{{.OSType}}'
    if ($LASTEXITCODE -ne 0) { throw 'Mo Docker Desktop va cho Engine running, sau do thu lai.' }
    New-Item -ItemType Directory -Path $targetRoot -Force | Out-Null
    $files = @('bot.py','telegram_api.py','telegram_app_upload.py','path_guard.py','requirements.txt','run-bot.cmd','CHAY-AN.vbs','.env.example','docker.env.example','HUONG-DAN.txt','CAI-LAI-WINDOWS.txt')
    foreach ($name in $files) {
        $source = Join-Path $PSScriptRoot $name
        $target = Join-Path $targetRoot $name
        if ([IO.Path]::GetFullPath($source) -ine [IO.Path]::GetFullPath($target)) {
            Copy-Item -LiteralPath $source -Destination $target -Force
        }
    }
    foreach ($name in @('.env','docker.env')) {
        $configPath = Join-Path $targetRoot $name
        if (-not (Test-Path -LiteralPath $configPath)) {
            Copy-Item -LiteralPath (Join-Path $targetRoot ($name + '.example')) -Destination $configPath
        }
    }
    $botConfig = Get-Content -LiteralPath (Join-Path $targetRoot '.env') -Raw
    $dockerConfig = Get-Content -LiteralPath (Join-Path $targetRoot 'docker.env') -Raw
    if ($botConfig.Contains('THAY_BANG_') -or $dockerConfig.Contains('THAY_BANG_')) {
        Write-Host 'Da tao C:\TelegramFileBot\.env va docker.env. Dien cau hinh theo CAI-LAI-WINDOWS.txt, luu roi chay lai CAI-MOI.cmd.'
        exit 1
    }
    $python = Join-Path $targetRoot '.venv\Scripts\python.exe'
    if (-not (Test-Path -LiteralPath $python)) {
        & py -3.12 -m venv (Join-Path $targetRoot '.venv')
        if ($LASTEXITCODE -ne 0) { throw 'Tao moi truong Python that bai.' }
    }
    & $python -m pip install -r (Join-Path $targetRoot 'requirements.txt')
    if ($LASTEXITCODE -ne 0) { throw 'Cai thu vien that bai.' }
    & $python -m py_compile (Join-Path $targetRoot 'bot.py') (Join-Path $targetRoot 'telegram_api.py') (Join-Path $targetRoot 'telegram_app_upload.py') (Join-Path $targetRoot 'path_guard.py')
    if ($LASTEXITCODE -ne 0) { throw 'Kiem tra ma Python that bai.' }
    $existing = & docker ps -a --filter 'name=^/telegram-bot-api$' --format '{{.Names}}'
    if ($LASTEXITCODE -ne 0) { throw 'Khong doc duoc danh sach container.' }
    if ($existing -contains 'telegram-bot-api') {
        & docker start telegram-bot-api
    } else {
        & docker run -d --name telegram-bot-api --restart unless-stopped --env-file (Join-Path $targetRoot 'docker.env') -p '127.0.0.1:8081:8081' -v 'telegram-bot-api-data:/var/lib/telegram-bot-api' aiogram/telegram-bot-api:latest
    }
    if ($LASTEXITCODE -ne 0) { throw 'Khoi dong Local Bot API that bai.' }
    $account = [Security.Principal.WindowsIdentity]::GetCurrent().Name
    $action = New-ScheduledTaskAction -Execute "$env:WINDIR\System32\wscript.exe" -Argument '"C:\TelegramFileBot\CHAY-AN.vbs"' -WorkingDirectory $targetRoot
    $trigger = New-ScheduledTaskTrigger -AtLogOn -User $account
    $principal = New-ScheduledTaskPrincipal -UserId $account -LogonType Interactive -RunLevel Limited
    $settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
    if (Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue) {
        Stop-ScheduledTask -TaskName $taskName
        Start-Sleep -Seconds 2
    }
    Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Force | Out-Null
    Start-ScheduledTask -TaskName $taskName
    Write-Host 'Da cai va yeu cau khoi dong bot. Thu /status trong Telegram de xac nhan. Log: C:\TelegramFileBot\bot.log'
    Write-Host 'Bat Start Docker Desktop when you sign in trong Docker Settings. Bot tu chay sau khi dang nhap Windows; tat may/sleep thi bot khong gui file.'
} catch {
    Write-Host ('Cai dat chua hoan tat: ' + $_.Exception.Message) -ForegroundColor Red
    exit 1
}

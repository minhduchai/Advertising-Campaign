Get-ScheduledTask -TaskName 'Telegram Company File Bot Native' -ErrorAction SilentlyContinue | Select-Object TaskName,State
Get-ScheduledTaskInfo -TaskName 'Telegram Company File Bot Native' -ErrorAction SilentlyContinue | Select-Object LastRunTime,LastTaskResult
Test-NetConnection 127.0.0.1 -Port 8081 -InformationLevel Quiet
foreach ($name in @('native-runtime.log','native-api-console.log','bot.log')) {
    $path = Join-Path 'C:\TelegramFileBot' $name
    if (Test-Path -LiteralPath $path) {
        Write-Host $name
        Get-Content -LiteralPath $path -Tail 15 | ForEach-Object {
            $_ -replace 'bot\d+:[A-Za-z0-9_-]+','bot[TOKEN_DA_CHE]' -replace '(https?://[^\s?]+)\?[^\s]+','$1?[DA_CHE]'
        }
    }
}

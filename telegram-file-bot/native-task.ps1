param([ValidateSet('Save','Stop','Install','Restore')][string]$Action, [string]$Backup)
$ErrorActionPreference = 'Stop'
$oldTaskName = 'Telegram Company File Bot'
$taskName = 'Telegram Company File Bot Native'
if ($Action -eq 'Save') {
    if (Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue) {
        throw 'Da co tac vu Native. Kiem tra ban Native hien tai truoc khi cai lai.'
    }
    # Máy cài mới (không còn tác vụ cũ) thì bỏ qua kiểm tra chủ tác vụ và sao lưu XML.
    $existing = Get-ScheduledTask -TaskName $oldTaskName -ErrorAction SilentlyContinue
    if ($existing) {
        $owner = $existing.Principal.UserId
        if ($owner -like 'S-1-*') {
            $ownerSid = $owner
        } else {
            $ownerSid = ([Security.Principal.NTAccount]::new($owner)).Translate([Security.Principal.SecurityIdentifier]).Value
        }
        if ($ownerSid -ne [Security.Principal.WindowsIdentity]::GetCurrent().User.Value) {
            throw 'Hay chay bo chuyen doi bang dung tai khoan Windows cua tac vu bot cu.'
        }
        Export-ScheduledTask -TaskName $oldTaskName | Set-Content -LiteralPath (Join-Path $Backup 'task.xml') -Encoding Unicode
    }
} elseif ($Action -eq 'Stop') {
    Stop-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
    Stop-ScheduledTask -TaskName $oldTaskName -ErrorAction SilentlyContinue
    Disable-ScheduledTask -TaskName $oldTaskName -ErrorAction SilentlyContinue | Out-Null
    Start-Sleep -Seconds 2
    Get-CimInstance Win32_Process | Where-Object {
        $_.Name -match '^python(w)?\.exe$' -and
        ($_.CommandLine -match '(?i)C:\\TelegramFileBot\\(bot|native_runtime)\.py')
    } | ForEach-Object { & taskkill.exe /PID $_.ProcessId /T /F | Out-Null }
} elseif ($Action -eq 'Install') {
    $account = [Security.Principal.WindowsIdentity]::GetCurrent().Name
    $taskAction = New-ScheduledTaskAction -Execute 'C:\TelegramFileBot\.venv\Scripts\pythonw.exe' -Argument '"C:\TelegramFileBot\native_runtime.py"' -WorkingDirectory 'C:\TelegramFileBot'
    $trigger = New-ScheduledTaskTrigger -AtLogOn -User $account
    $principal = New-ScheduledTaskPrincipal -UserId $account -LogonType Interactive -RunLevel Limited
    $settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -RestartCount 10 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
    Register-ScheduledTask -TaskName $taskName -Action $taskAction -Trigger $trigger -Principal $principal -Settings $settings -Force | Out-Null
    Start-ScheduledTask -TaskName $taskName
} elseif ($Action -eq 'Restore') {
    if (Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue) {
        Disable-ScheduledTask -TaskName $taskName | Out-Null
    }
    Enable-ScheduledTask -TaskName $oldTaskName -ErrorAction SilentlyContinue | Out-Null
    Start-ScheduledTask -TaskName $oldTaskName -ErrorAction SilentlyContinue
}

# Preview: .\scripts\cleanup-workspace.ps1
# Delete reviewed artifacts: .\scripts\cleanup-workspace.ps1 -Apply
param([switch]$Apply)
$ErrorActionPreference = 'Stop'
$cleanupRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..')).TrimEnd('\')
if ((Get-Content -LiteralPath (Join-Path $cleanupRoot 'package.json') -Raw | ConvertFrom-Json).name -ne 'meta-ads-campaign-builder') {
    throw 'Unexpected project; nothing deleted.'
}

# Keep native source, installed libraries, packaging binaries, data and review videos.
$relativeTargets = @(
    '.audit-venv', '.pytest_cache', '.superpowers', '.old-frontend-dpl_7jWwTw',
    'review-backup-20260813-224833', 'dist', 'docs\superpowers', 'test-output.txt',
    'telegram-file-bot\.pytest_cache', 'telegram-file-bot\__pycache__', 'telegram-file-bot\tests\__pycache__',
    'cloudflare\.wrangler\tmp', 'tmp\customer-build', 'tmp\customer-tools',
    'tmp\telegram-bot-api-native-src\build-native',
    'tmp\telegram-native-vcpkg\buildtrees', 'tmp\telegram-native-vcpkg\downloads', 'tmp\telegram-native-vcpkg\packages',
    'review-src.zip', 'telegram-file-bot.zip', 'TelegramFileBot-DayDu-20260910.zip',
    'TelegramFileBot-Progress-Percent.zip', 'TelegramFileBot-TraLoiGon-20260906.zip',
    'tmp\api-client-production.js', 'tmp\app-debug-bundle.js', 'tmp\audit-full-tests.log',
    'tmp\audit-publish-load.mjs', 'tmp\check-post-latency.mjs', 'tmp\check-seeding-status.mjs',
    'tmp\check-unhide.mjs', 'tmp\install-unhide-cron.py', 'tmp\measure-meta-publication.mjs',
    'tmp\publish-load-report.json', 'tmp\repair-seeding-image.mjs', 'tmp\resume-seeding-new.mjs',
    'tmp\resume-seeding.mjs', 'tmp\rotate-telegram-worker.cjs', 'tmp\seeding-fix-tests.log', 'tmp\unhide-tests.log'
)
$targets = @($relativeTargets | ForEach-Object { Join-Path $cleanupRoot $_ } | Where-Object { Test-Path -LiteralPath $_ })
$buildRoot = Join-Path $cleanupRoot 'tmp\telegram-bot-api-native-src\build'
if (Test-Path -LiteralPath $buildRoot) {
    $targets += @(Get-ChildItem -LiteralPath $buildRoot -Force | Where-Object Name -ne 'Release' | ForEach-Object FullName)
    $releaseRoot = Join-Path $buildRoot 'Release'
    if (Test-Path -LiteralPath $releaseRoot) {
        $targets += @(Get-ChildItem -LiteralPath $releaseRoot -Force | Where-Object Name -ne 'telegram-bot-api.exe' | ForEach-Object FullName)
    }
}

# Historical tracked plans can be restored from Git; preserve any local edits.
$changedPlans = & git -C $cleanupRoot diff --name-only HEAD -- docs/superpowers
if ($LASTEXITCODE -ne 0 -or $changedPlans) { throw 'Cannot confirm historical plans are unchanged; nothing deleted.' }
$newPlans = & git -C $cleanupRoot ls-files --others --exclude-standard -- docs/superpowers
if ($LASTEXITCODE -ne 0 -or $newPlans) { throw 'Untracked historical plans found; nothing deleted.' }

$targets = @($targets | Sort-Object -Unique)
$totalBytes = 0L
foreach ($target in $targets) {
    $absoluteTarget = [IO.Path]::GetFullPath($target)
    if (-not $absoluteTarget.StartsWith($cleanupRoot + '\', [StringComparison]::OrdinalIgnoreCase)) {
        throw "Target outside project: $absoluteTarget"
    }
    $ancestor = $absoluteTarget
    while ($ancestor -ne $cleanupRoot) {
        if ((Get-Item -LiteralPath $ancestor -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) {
            throw "Linked path requires manual review: $ancestor"
        }
        $ancestor = [IO.Path]::GetDirectoryName($ancestor)
    }
    $entries = @(Get-Item -LiteralPath $absoluteTarget -Force)
    if ($entries[0].PSIsContainer) { $entries += @(Get-ChildItem -LiteralPath $absoluteTarget -Force -Recurse) }
    if ($entries | Where-Object { $_.Attributes -band [IO.FileAttributes]::ReparsePoint }) {
        throw "Linked content requires manual review: $absoluteTarget"
    }
    $bytes = ($entries | Where-Object { -not $_.PSIsContainer } | Measure-Object -Property Length -Sum).Sum
    $totalBytes += [long]$bytes
    Write-Output ('{0,10:N1} MiB  {1}' -f ($bytes / 1MB), $absoluteTarget)
}
Write-Output ('Total: {0:N2} GiB; {1} targets.' -f ($totalBytes / 1GB), $targets.Count)
if (-not $Apply) {
    Write-Output 'Preview only. Run this script with -Apply to delete the listed artifacts.'
    return
}
foreach ($target in $targets) { Remove-Item -LiteralPath $target -Recurse -Force }
Write-Output 'Cleanup completed. Native build caches will be regenerated when needed.'

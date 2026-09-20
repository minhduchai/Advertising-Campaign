$ErrorActionPreference = 'Stop'
$projectRoot = 'D:\Advertising-Campaign'
$botRoot = Join-Path $projectRoot 'telegram-file-bot'
$nativeRoot = Join-Path $botRoot 'native'
$binary = Join-Path $projectRoot 'tmp\telegram-native-install\bin\telegram-bot-api.exe'
if (-not (Test-Path -LiteralPath $binary)) { throw 'Missing tested binary' }
New-Item -ItemType Directory -Path $nativeRoot -Force | Out-Null
Copy-Item -LiteralPath $binary -Destination (Join-Path $nativeRoot 'telegram-bot-api.exe') -Force
Copy-Item -LiteralPath (Join-Path $projectRoot 'tmp\telegram-bot-api-native-src\LICENSE_1_0.txt') -Destination (Join-Path $nativeRoot 'LICENSE-Telegram.txt') -Force
Copy-Item -LiteralPath (Join-Path $projectRoot 'tmp\telegram-native-vcpkg\installed\x64-windows-static\share\openssl\copyright') -Destination (Join-Path $nativeRoot 'LICENSE-OpenSSL.txt') -Force
Copy-Item -LiteralPath (Join-Path $projectRoot 'tmp\telegram-native-vcpkg\installed\x64-windows-static\share\zlib\copyright') -Destination (Join-Path $nativeRoot 'LICENSE-zlib.txt') -Force
$sha = (Get-FileHash -LiteralPath $binary -Algorithm SHA256).Hash.ToLowerInvariant()
$sourceCommit = & git -C (Join-Path $projectRoot 'tmp\telegram-bot-api-native-src') rev-parse HEAD
$tdCommit = & git -C (Join-Path $projectRoot 'tmp\telegram-bot-api-native-src\td') rev-parse HEAD
$vcpkgCommit = & git -C (Join-Path $projectRoot 'tmp\telegram-native-vcpkg') rev-parse HEAD
$manifest = [ordered]@{
    platform='Windows x64'; build='Release, MSVC 2022, static runtime';
    source='https://github.com/tdlib/telegram-bot-api'; commit=$sourceCommit; tdlibCommit=$tdCommit;
    vcpkgCommit=$vcpkgCommit; openssl='3.6.4'; zlib='1.3.2';
    sha256=@{'telegram-bot-api.exe'=$sha}
}
$manifest | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath (Join-Path $nativeRoot 'manifest.json') -Encoding utf8
$fileNames = @('bot.py','telegram_api.py','telegram_app_upload.py','path_guard.py','requirements.txt',
    'native_runtime.py','switch_native.py','native-task.ps1','CHUYEN-KHONG-DOCKER.cmd',
    'KIEM-TRA-KHONG-DOCKER.cmd','KIEM-TRA-KHONG-DOCKER.ps1','HUONG-DAN-KHONG-DOCKER.txt')
$packageFiles = @($fileNames | ForEach-Object { Join-Path $botRoot $_ }) + @($nativeRoot)
$zipPath = Join-Path $projectRoot 'TelegramFileBot-KhongDocker-20260911.zip'
Compress-Archive -LiteralPath $packageFiles -DestinationPath $zipPath -Force
Get-Item -LiteralPath $zipPath | Select-Object FullName,Length
Write-Host ('Native binary SHA256: ' + $sha)

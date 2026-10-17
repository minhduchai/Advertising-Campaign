# Đóng gói ZIP "chuyển bot sang Windows không Docker" (chạy trên máy dev, không phải máy công ty).
# Cần có sẵn telegram-bot-api.exe đã build; cách build (một lần, ~1 giờ) ở cuối file.
# -KemCauHinh: đóng kèm .env/docker.env THẬT đang có trong thư mục này -> ZIP có khóa bí mật, không để lên ổ chung.
param([string]$Exe = (Join-Path $PSScriptRoot '..\tmp\telegram-bot-api-native-src\build\Release\telegram-bot-api.exe'), [switch]$KemCauHinh)
$ErrorActionPreference = 'Stop'

$native = Join-Path $PSScriptRoot 'native'
New-Item -ItemType Directory -Path $native -Force | Out-Null
Copy-Item -LiteralPath $Exe -Destination (Join-Path $native 'telegram-bot-api.exe') -Force
& (Join-Path $native 'telegram-bot-api.exe') --version
if ($LASTEXITCODE -ne 0) { throw 'telegram-bot-api.exe --version that bai.' }

# manifest.json: switch_native.py so SHA-256 từng file trong native\ trước khi chuyển.
$hashes = @{}
Get-ChildItem -LiteralPath $native -File | Where-Object Name -ne 'manifest.json' | ForEach-Object {
    $hashes[$_.Name] = (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLower()
}
@{ sha256 = $hashes } | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $native 'manifest.json') -Encoding Ascii

$files = @('CHUYEN-KHONG-DOCKER.cmd','switch_native.py','native_runtime.py','native-task.ps1',
           'bot.py','telegram_api.py','telegram_app_upload.py','path_guard.py','file_search.py','HUONG-DAN-KHONG-DOCKER.txt',
           'requirements.txt','.env.example','docker.env.example','KIEM-TRA-KHONG-DOCKER.cmd','KIEM-TRA-KHONG-DOCKER.ps1')
$suffix = ''
if ($KemCauHinh) {
    $files += @('.env','docker.env') | Where-Object { Test-Path -LiteralPath (Join-Path $PSScriptRoot $_) }
    $suffix = '-CO-CAU-HINH'
}
$paths = ($files | ForEach-Object { Join-Path $PSScriptRoot $_ }) + $native
$dist = Join-Path $PSScriptRoot '..\dist'
New-Item -ItemType Directory -Path $dist -Force | Out-Null
$zip = Join-Path $dist ('TelegramFileBot-KhongDocker-' + (Get-Date -Format 'yyyyMMdd-HHmm') + $suffix + '.zip')
Compress-Archive -LiteralPath $paths -DestinationPath $zip -Force
Write-Host "Da tao $zip"

<#
BUILD telegram-bot-api.exe (Windows, VS Build Tools 2022 + CMake kèm theo, vcpkg):
  git clone --recursive https://github.com/tdlib/telegram-bot-api.git tmp\telegram-bot-api-native-src
  git clone https://github.com/microsoft/vcpkg.git tmp\telegram-native-vcpkg ; tmp\telegram-native-vcpkg\bootstrap-vcpkg.bat
  tmp\telegram-native-vcpkg\vcpkg.exe install gperf:x64-windows-static openssl:x64-windows-static zlib:x64-windows-static
  cmake -S tmp\telegram-bot-api-native-src -B tmp\telegram-bot-api-native-src\build -G "Visual Studio 17 2022" -A x64 `
    -DCMAKE_TOOLCHAIN_FILE=tmp\telegram-native-vcpkg\scripts\buildsystems\vcpkg.cmake -DVCPKG_TARGET_TRIPLET=x64-windows-static `
    -DCMAKE_POLICY_DEFAULT_CMP0091=NEW -DCMAKE_MSVC_RUNTIME_LIBRARY=MultiThreaded
  cmake --build tmp\telegram-bot-api-native-src\build --config Release --target telegram-bot-api --parallel 8
Static CRT + static OpenSSL/zlib: máy công ty không cần cài thêm gì.
#>

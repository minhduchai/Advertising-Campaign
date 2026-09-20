param(
    [string]$SourceRoot = 'D:\Advertising-Campaign\tmp\telegram-bot-api-native-src',
    [string]$VcpkgRoot = 'D:\Advertising-Campaign\tmp\telegram-native-vcpkg',
    [string]$OutputRoot = 'D:\Advertising-Campaign\tmp\telegram-native-install'
)
$ErrorActionPreference = 'Stop'
$cmake = 'C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\Common7\IDE\CommonExtensions\Microsoft\CMake\CMake\bin\cmake.exe'
$buildRoot = Join-Path $SourceRoot 'build-native'
& $cmake -S $SourceRoot -B $buildRoot -G 'Visual Studio 17 2022' -A x64 `
    "-DCMAKE_TOOLCHAIN_FILE=$VcpkgRoot/scripts/buildsystems/vcpkg.cmake" `
    '-DVCPKG_TARGET_TRIPLET=x64-windows-static' '-DCMAKE_POLICY_DEFAULT_CMP0091=NEW' `
    '-DCMAKE_MSVC_RUNTIME_LIBRARY=MultiThreaded' '-DCMAKE_CXX_FLAGS=/MP8 /EHsc' "-DCMAKE_INSTALL_PREFIX=$OutputRoot" `
    '-DTD_INSTALL_STATIC_LIBRARIES=OFF' '-DTD_INSTALL_SHARED_LIBRARIES=OFF'
if ($LASTEXITCODE -ne 0) { throw 'CMake configure failed' }
& $cmake --build $buildRoot --config Release --target telegram-bot-api --parallel 4
if ($LASTEXITCODE -ne 0) { throw 'Native build failed' }
& $cmake --install $buildRoot --config Release
if ($LASTEXITCODE -ne 0) { throw 'Native install failed' }
& (Join-Path $OutputRoot 'bin\telegram-bot-api.exe') --version
if ($LASTEXITCODE -ne 0) { throw 'Native executable smoke test failed' }

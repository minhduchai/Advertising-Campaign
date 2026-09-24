@echo off
set TARGET=C:\TelegramFileBot
if not exist "%TARGET%" mkdir "%TARGET%"
if not exist "%TARGET%\.venv\Scripts\python.exe" (
  echo Chua co moi truong Python tai %TARGET%, dang tao...
  py -3.12 -m venv "%TARGET%\.venv" || (echo Can cai Python 3.12 tu python.org, chon Python Launcher, roi chay lai. & pause & exit /b 1)
)
"%TARGET%\.venv\Scripts\python.exe" -m pip install -q -r "%~dp0requirements.txt" || (echo Cai thu vien Python that bai. Kiem tra Internet roi chay lai. & pause & exit /b 1)
set MISSING=
rem Goi "CO-CAU-HINH" mang san .env/docker.env that; goi thuong chi co file mau.
if not exist "%TARGET%\.env" (
  if exist "%~dp0.env" (copy /y "%~dp0.env" "%TARGET%\.env" >nul) else (copy /y "%~dp0.env.example" "%TARGET%\.env" >nul & set MISSING=1)
)
if not exist "%TARGET%\docker.env" (
  if exist "%~dp0docker.env" (copy /y "%~dp0docker.env" "%TARGET%\docker.env" >nul) else (copy /y "%~dp0docker.env.example" "%TARGET%\docker.env" >nul & set MISSING=1)
)
if defined MISSING (
  echo Da tao file mau %TARGET%\.env va docker.env. Mo bang Notepad, dien BOT_TOKEN, API ID, API Hash, luu dung ten file roi chay lai.
  pause
  exit /b 1
)
"%TARGET%\.venv\Scripts\python.exe" "%~dp0switch_native.py"
pause

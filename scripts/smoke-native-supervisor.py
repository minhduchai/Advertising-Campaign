"""Kiểm tra bộ giám sát với server thật và bot giả trong thư mục tạm."""
import os
from pathlib import Path
import shutil
import signal
import socket
import subprocess
import sys
import tempfile
import time

exe = Path(sys.argv[1]).resolve(strict=True)
runtime_source = Path(__file__).resolve().parents[1] / 'telegram-file-bot'
with socket.socket() as listener:
    listener.bind(('127.0.0.1', 0))
    port = listener.getsockname()[1]


def wait_for(predicate, timeout=25):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        value = predicate()
        if value:
            return value
        time.sleep(0.25)
    raise AssertionError('Timed out waiting for lifecycle transition')


def listening():
    try:
        with socket.create_connection(('127.0.0.1',port), timeout=0.5):
            return True
    except OSError:
        return False


with tempfile.TemporaryDirectory(prefix='telegram-supervisor-smoke-') as folder:
    root = Path(folder)
    (root / 'native').mkdir()
    shutil.copy2(exe, root / 'native' / exe.name)
    (root / '.env').write_text('BOT_TOKEN=123:fake-token\nALLOWED_USER_ID=1\nFILE_ROOT=C:\\\nBOT_API_BASE=http://127.0.0.1:8081\n')
    (root / 'docker.env').write_text('TELEGRAM_API_ID=1\nTELEGRAM_API_HASH=' + '0' * 32)
    (root / 'bot.py').write_text("import os,time\nfrom pathlib import Path\nPath('bot-pid.txt').write_text(str(os.getpid()))\nwhile True: time.sleep(1)\n")
    code = 'import sys; from pathlib import Path; sys.path.insert(0,sys.argv[1]); import native_runtime as r; r.ROOT=Path(sys.argv[2]); r.API_PORT=int(sys.argv[3]); r.main()'
    supervisor = subprocess.Popen([sys.executable,'-c',code,str(runtime_source),str(root),str(port)], creationflags=subprocess.CREATE_NO_WINDOW)
    try:
        wait_for(listening)
        marker = root / 'bot-pid.txt'
        wait_for(lambda: marker.exists() and marker.read_text().strip())
        old_bot_pid = int(marker.read_text())
        os.kill(old_bot_pid, signal.SIGTERM)
        wait_for(lambda: marker.read_text().strip() and int(marker.read_text()) != old_bot_pid)
        print('PASS: bot child restarted after exit.')
        result = subprocess.run(['powershell.exe','-NoProfile','-Command',
            f'(Get-NetTCPConnection -LocalPort {port} -State Listen).OwningProcess'], capture_output=True, text=True, check=True)
        api_pid = int(result.stdout.strip())
        os.kill(api_pid, signal.SIGTERM)
        wait_for(lambda: not listening())
        wait_for(listening)
        print('PASS: native API child restarted after exit.')
    finally:
        supervisor.terminate()
        supervisor.wait(timeout=10)
        wait_for(lambda: not listening(), timeout=10)
        print('PASS: stopping supervisor releases native listener.')

"""Smoke test binary Windows bằng cấu hình giả, không dùng token thật."""
import json
import os
from pathlib import Path
import socket
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request

exe = Path(sys.argv[1]).resolve(strict=True)
with socket.socket() as listener:
    listener.bind(('127.0.0.1', 0))
    port = listener.getsockname()[1]
with tempfile.TemporaryDirectory(prefix='telegram-native-smoke-') as temp:
    (Path(temp) / 'temp').mkdir()
    environment = os.environ.copy()
    environment.update(TELEGRAM_API_ID='1', TELEGRAM_API_HASH='0' * 32)
    with open(Path(temp) / 'api.log', 'wb') as output:
        process = subprocess.Popen([str(exe), '--local', '--http-ip-address=127.0.0.1',
            f'--http-port={port}', f'--dir={temp}', f'--temp-dir={temp}/temp', '--verbosity=1'], env=environment,
            stdout=output, stderr=output, creationflags=subprocess.CREATE_NO_WINDOW)
        try:
            deadline = time.monotonic() + 30
            while True:
                if process.poll() is not None:
                    raise RuntimeError('Native server exited: ' + str(process.returncode))
                try:
                    urllib.request.urlopen(f'http://127.0.0.1:{port}/', timeout=2)
                    raise RuntimeError('Unexpected API root success')
                except urllib.error.HTTPError as response:
                    payload = json.loads(response.read())
                    assert response.code == 404 and payload['ok'] is False
                    print('PASS: native HTTP listener responds correctly on localhost; no real credentials used.')
                    break
                except urllib.error.URLError:
                    if time.monotonic() >= deadline:
                        raise RuntimeError('Native listener did not start')
                    time.sleep(0.5)
        finally:
            process.terminate()
            process.wait(timeout=10)

"""Chạy Local Bot API và bot Python trên Windows, không cần Docker."""
from __future__ import annotations

import ctypes
from ctypes import wintypes
import logging
from logging.handlers import RotatingFileHandler
import os
from pathlib import Path
import re
import socket
import subprocess
import sys
import time

from dotenv import dotenv_values

ROOT = Path(__file__).resolve().parent
API_PORT = 8081


def configuration(root=ROOT):
    api = dotenv_values(root / 'docker.env', encoding='utf-8-sig')
    bot = dotenv_values(root / '.env', encoding='utf-8-sig')
    for name in ('TELEGRAM_API_ID', 'TELEGRAM_API_HASH'):
        value = api.get(name) or ''
        if not value or 'THAY_' in value or 'DIEN_' in value:
            raise ValueError(f'Thiếu cấu hình {name} trong docker.env')
    if not (api['TELEGRAM_API_ID'].isdigit() and int(api['TELEGRAM_API_ID']) > 0):
        raise ValueError('TELEGRAM_API_ID phải là số dương')
    if not re.fullmatch(r'[a-fA-F0-9]{32}', api['TELEGRAM_API_HASH']):
        raise ValueError('TELEGRAM_API_HASH phải gồm 32 ký tự hex')
    if not re.fullmatch(r'\d+:[A-Za-z0-9_-]+', bot.get('BOT_TOKEN') or ''):
        raise ValueError('BOT_TOKEN chưa hợp lệ trong .env')
    for name in ('ALLOWED_USER_ID', 'FILE_ROOT'):
        if not bot.get(name):
            raise ValueError(f'Thiếu cấu hình {name} trong .env')
    if (bot.get('BOT_API_BASE') or '').rstrip('/') != 'http://127.0.0.1:8081':
        raise ValueError('BOT_API_BASE phải là http://127.0.0.1:8081')
    return api, bot


class ChildJob:
    """Windows đóng toàn bộ tiến trình con khi tác vụ bị dừng."""
    def __init__(self):
        class Basic(ctypes.Structure):
            _fields_ = [('process_time', ctypes.c_int64), ('job_time', ctypes.c_int64),
                        ('flags', wintypes.DWORD), ('min_ws', ctypes.c_size_t),
                        ('max_ws', ctypes.c_size_t), ('active', wintypes.DWORD),
                        ('affinity', ctypes.c_size_t), ('priority', wintypes.DWORD),
                        ('scheduling', wintypes.DWORD)]
        class IO(ctypes.Structure):
            _fields_ = [(name, ctypes.c_uint64) for name in ('ro','wo','oo','rt','wt','ot')]
        class Limits(ctypes.Structure):
            _fields_ = [('basic', Basic), ('io', IO), ('process_mem', ctypes.c_size_t),
                        ('job_mem', ctypes.c_size_t), ('peak_process', ctypes.c_size_t),
                        ('peak_job', ctypes.c_size_t)]
        self.dll = ctypes.WinDLL('kernel32', use_last_error=True)
        self.dll.CreateJobObjectW.argtypes = [ctypes.c_void_p, wintypes.LPCWSTR]
        self.dll.CreateJobObjectW.restype = wintypes.HANDLE
        self.dll.SetInformationJobObject.argtypes = [wintypes.HANDLE, ctypes.c_int, ctypes.c_void_p, wintypes.DWORD]
        self.dll.AssignProcessToJobObject.argtypes = [wintypes.HANDLE, wintypes.HANDLE]
        self.dll.CloseHandle.argtypes = [wintypes.HANDLE]
        self.handle = self.dll.CreateJobObjectW(None, None)
        limits = Limits()
        limits.basic.flags = 0x2000  # JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
        if not self.handle or not self.dll.SetInformationJobObject(self.handle, 9, ctypes.byref(limits), ctypes.sizeof(limits)):
            raise ctypes.WinError(ctypes.get_last_error())

    def add(self, process):
        if not self.dll.AssignProcessToJobObject(self.handle, int(process._handle)):
            process.kill()
            process.wait()
            raise ctypes.WinError(ctypes.get_last_error())

    def close(self):
        if self.handle:
            self.dll.CloseHandle(self.handle)
            self.handle = None


def port_ready(port=None):
    port = API_PORT if port is None else port
    try:
        with socket.create_connection(('127.0.0.1', port), timeout=1):
            return True
    except OSError:
        return False


def main():
    os.chdir(ROOT)
    handler = RotatingFileHandler(ROOT / 'native-runtime.log', maxBytes=2_000_000, backupCount=3, encoding='utf-8')
    logging.basicConfig(level=logging.INFO, handlers=[handler], format='%(asctime)s %(levelname)s %(message)s')
    api, _ = configuration()
    exe = ROOT / 'native' / 'telegram-bot-api.exe'
    if not exe.is_file():
        raise RuntimeError('Không tìm thấy native/telegram-bot-api.exe')
    if port_ready():
        raise RuntimeError('Cổng 8081 đang được sử dụng. Dừng Docker/container cũ trước.')
    state = ROOT / 'native-data'
    state.mkdir(exist_ok=True)
    (state / 'temp').mkdir(exist_ok=True)
    env = os.environ.copy()
    env.update({key: api[key] for key in ('TELEGRAM_API_ID','TELEGRAM_API_HASH')})
    job = ChildJob()
    api_process = bot_process = None
    try:
        with open(ROOT / 'native-api-console.log', 'ab') as api_log, open(ROOT / 'bot.log', 'ab') as bot_log:
            while True:
                if api_process is None or api_process.poll() is not None:
                    logging.info('Khởi động Local Bot API Windows')
                    api_process = subprocess.Popen([str(exe), '--local', '--http-ip-address=127.0.0.1',
                        f'--http-port={API_PORT}', '--dir=' + str(state), '--temp-dir=' + str(state / 'temp'),
                        '--verbosity=1'], cwd=ROOT, env=env, stdout=api_log, stderr=api_log,
                        creationflags=subprocess.CREATE_NO_WINDOW)
                    job.add(api_process)
                if port_ready() and (bot_process is None or bot_process.poll() is not None):
                    logging.info('Khởi động bot Python')
                    bot_process = subprocess.Popen([str(Path(sys.executable).with_name('python.exe')), '-u', str(ROOT / 'bot.py')],
                        cwd=ROOT, stdout=bot_log, stderr=bot_log, creationflags=subprocess.CREATE_NO_WINDOW)
                    job.add(bot_process)
                time.sleep(5)
    finally:
        job.close()


if __name__ == '__main__':
    try:
        main()
    except Exception:
        logging.exception('Bộ chạy nền chưa khởi động được')
        sys.exit(1)

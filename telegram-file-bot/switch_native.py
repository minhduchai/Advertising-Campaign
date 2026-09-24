"""Chuyển bản Docker đang hoạt động sang Local Bot API Windows; có sao lưu."""
from __future__ import annotations
import ctypes
from datetime import datetime
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import time
import requests
from native_runtime import configuration, port_ready

SOURCE = Path(__file__).resolve().parent
TARGET = Path('C:/TelegramFileBot')
FILES = ('bot.py','telegram_api.py','telegram_app_upload.py','path_guard.py','native_runtime.py','native-task.ps1')


def command(args, timeout=60):
    result = subprocess.run(args, capture_output=True, text=True, errors='replace', timeout=timeout,
                            creationflags=subprocess.CREATE_NO_WINDOW)
    if result.returncode:
        # Không đưa output tùy ý hoặc khóa bí mật ra màn hình.
        raise RuntimeError(f'Lenh {Path(args[0]).name} that bai (ma {result.returncode}).')
    return result.stdout.strip()


def task(action, backup):
    return command(['powershell.exe','-NoProfile','-ExecutionPolicy','Bypass','-File',str(SOURCE / 'native-task.ps1'),
                    '-Action',action,'-Backup',str(backup)])


def api_call(token, method):
    try:
        response = requests.post(f'http://127.0.0.1:8081/bot{token}/{method}', timeout=45)
        data = response.json()
    except Exception:
        raise RuntimeError('Khong ket noi duoc Local Bot API.') from None
    if not data.get('ok'):
        raise RuntimeError(f'Local Bot API tu choi {method} (HTTP {response.status_code}).')
    return data['result']


def verify_bundle():
    manifest = json.loads((SOURCE / 'native' / 'manifest.json').read_text('utf-8-sig'))
    if 'telegram-bot-api.exe' not in manifest.get('sha256', {}):
        raise RuntimeError('Goi native thieu ma kiem tra binary.')
    for name, expected in manifest['sha256'].items():
        file = SOURCE / 'native' / name
        if file.parent != SOURCE / 'native' or hashlib.sha256(file.read_bytes()).hexdigest() != expected:
            raise RuntimeError('Goi native bi thieu/hong. Hay giai nen lai ZIP.')
    command([str(SOURCE / 'native' / 'telegram-bot-api.exe'),'--version'])


def main():
    if not ctypes.windll.shell32.IsUserAnAdmin():
        raise RuntimeError('Nhan chuot phai CHUYEN-KHONG-DOCKER.cmd > Run as administrator bang tai khoan Windows dang chay bot.')
    _, bot = configuration(TARGET)
    verify_bundle()
    token = bot['BOT_TOKEN']
    # Không thấy API cũ ở cổng 8081 (Docker đã chết/gỡ): cài native thẳng, bỏ qua các bước Docker.
    docker_mode = port_ready()
    restart = ''
    if docker_mode:
        api_call(token, 'getMe')
        webhook = api_call(token, 'getWebhookInfo')
        if webhook.get('url'):
            raise RuntimeError('Bot dang co webhook. Can kiem tra truoc khi chuyen.')
        state = json.loads(command(['docker','inspect','--format','{{json .State}}','telegram-bot-api']))
        if not state.get('Running'):
            raise RuntimeError('Cong 8081 dang mo nhung khong phai container telegram-bot-api. Kiem tra truoc khi chuyen.')
        restart = command(['docker','inspect','--format','{{.HostConfig.RestartPolicy.Name}}','telegram-bot-api'])
    else:
        print('Khong thay Local Bot API cu o cong 8081: cai ban native truc tiep, bo qua Docker.', flush=True)
    backup = TARGET / ('backup-native-' + datetime.now().strftime('%Y%m%d-%H%M%S'))
    backup.mkdir()
    for name in (*FILES,'.env','docker.env'):
        if (TARGET / name).exists():
            shutil.copy2(TARGET / name, backup / name)
    task('Save', backup)
    (backup / 'restart-policy.txt').write_text(restart, encoding='utf-8')
    print('Da sao luu cau hinh va tac vu. Dang chuyen Local Bot API...', flush=True)
    stopped = False
    try:
        stopped = True
        task('Stop', backup)
        if docker_mode:
            # Telegram yêu cầu đăng xuất phiên server cũ trước khi chuyển server.
            api_call(token, 'logOut')
            command(['docker','update','--restart=no','telegram-bot-api'])
            command(['docker','stop','telegram-bot-api'])
        else:
            try:
                # Container cũ không được tự bật lại chiếm cổng 8081 khi Docker Desktop mở; Docker có thể đã gỡ.
                command(['docker','update','--restart=no','telegram-bot-api'])
            except Exception:
                pass
        for _ in range(20):
            if not port_ready():
                break
            time.sleep(1)
        if port_ready():
            raise RuntimeError('Cong 8081 van bi chiem.')
        if SOURCE != TARGET:  # gói giải nén thẳng vào C:\TelegramFileBot thì file đã ở đúng chỗ
            shutil.copytree(SOURCE / 'native', TARGET / 'native', dirs_exist_ok=True)
            for name in FILES:
                shutil.copy2(SOURCE / name, TARGET / name)
        task('Install', backup)
        for _ in range(45):
            if port_ready():
                break
            time.sleep(1)
        api_call(token, 'getMe')
        print('THANH CONG: Local Bot API Windows da xac thuc bot.' + (' Docker cu da dung, khong bi xoa.' if docker_mode else ''))
        print('Thu /status va gui mot file nho. Neu co yeu cau cu dang cho, hay gui lai.')
        print('Ban sao luu: ' + str(backup))
        print('Sau khi thu thanh cong, co the Quit Docker Desktop. Bot tu chay sau khi dang nhap Windows.')
    except Exception:
        if stopped:
            print('Chuyen chua thanh cong. Dang khoi phuc ban cu...', flush=True)
            try:
                # Đóng phiên native trước khi kích hoạt lại phiên Docker.
                if port_ready():
                    try:
                        api_call(token, 'logOut')
                    except Exception:
                        pass
                task('Stop', backup)
                for name in FILES:
                    if (backup / name).exists():
                        shutil.copy2(backup / name, TARGET / name)
                if docker_mode:
                    command(['docker','update','--restart=' + (restart or 'no'),'telegram-bot-api'])
                    command(['docker','start','telegram-bot-api'])
                task('Restore', backup)
                print('Da yeu cau chay lai tac vu cu' + (' va Docker.' if docker_mode else '.'))
            except Exception:
                print('Khoi phuc tu dong chua xong. Giu nguyen backup va bao lai ket qua, khong xoa Docker.')
        raise


if __name__ == '__main__':
    try:
        main()
    except Exception as exc:
        # Chỉ thông báo lỗi kiểm soát; lỗi ngoài dự kiến không in URL chứa token.
        print(str(exc) if isinstance(exc, (RuntimeError, ValueError)) else f'Chua hoan tat: {type(exc).__name__}')
        sys.exit(1)

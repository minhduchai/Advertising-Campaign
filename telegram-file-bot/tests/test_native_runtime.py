import os
import subprocess
import sys

import pytest

from native_runtime import ChildJob, configuration


def write_config(root):
    (root / 'docker.env').write_text('TELEGRAM_API_ID=123\nTELEGRAM_API_HASH=' + 'a' * 32, encoding='utf-8')
    (root / '.env').write_text('BOT_TOKEN=123:fake-token\nALLOWED_USER_ID=123\nFILE_ROOT=\\\\server\\share\nBOT_API_BASE=http://127.0.0.1:8081\n', encoding='utf-8')


def test_native_uses_existing_configuration_without_worker_key(tmp_path):
    write_config(tmp_path)
    api, bot = configuration(tmp_path)
    assert api['TELEGRAM_API_ID'] == '123'
    assert bot['FILE_ROOT'] == r'\\server\share'


def test_native_rejects_wrong_endpoint_before_starting(tmp_path):
    write_config(tmp_path)
    file = tmp_path / '.env'
    file.write_text(file.read_text().replace('http://127.0.0.1:8081', 'https://api.telegram.org'))
    with pytest.raises(ValueError, match='BOT_API_BASE'):
        configuration(tmp_path)


def test_bot_reads_bom_config_beside_script_not_current_directory(tmp_path, monkeypatch):
    import bot
    write_config(tmp_path)
    env_file = tmp_path / '.env'
    env_file.write_text(env_file.read_text(), encoding='utf-8-sig')
    for key in ('BOT_TOKEN','ALLOWED_USER_ID','FILE_ROOT','BOT_API_BASE','ALLOWED_GROUP_IDS','APP_URL','TELEGRAM_UPLOAD_WORKER_SECRET'):
        monkeypatch.delenv(key, raising=False)
    monkeypatch.setattr(bot, '__file__', str(tmp_path / 'bot.py'))
    config = bot.load_config()
    assert config.bot_token == '123:fake-token'
    assert config.allowed_user_id == 123


@pytest.mark.skipif(os.name != 'nt', reason='Windows job object')
def test_closing_supervisor_job_kills_child():
    job = ChildJob()
    process = subprocess.Popen([sys.executable, '-c', 'import time; time.sleep(60)'], creationflags=subprocess.CREATE_NO_WINDOW)
    try:
        job.add(process)
        assert process.poll() is None
        job.close()
        process.wait(timeout=5)
        assert process.returncode is not None
    finally:
        if process.poll() is None:
            process.kill()
            process.wait()
        job.close()

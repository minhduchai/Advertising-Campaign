import json
from pathlib import Path
from unittest.mock import Mock

import pytest
import switch_native as switch


@pytest.mark.parametrize('in_place', [False, True])
@pytest.mark.parametrize('docker_mode', [True, False])
@pytest.mark.parametrize('fail_install', [False, True])
def test_switch_preserves_secrets_and_restores_old_files_on_failure(tmp_path, monkeypatch, fail_install, docker_mode, in_place):
    target = tmp_path / 'installed'
    target.mkdir()
    # in_place: gói giải nén thẳng vào thư mục cài, không có bước chép file.
    source = target if in_place else tmp_path / 'package'
    source.mkdir(exist_ok=True)
    (source / 'native').mkdir()
    (source / 'native' / 'telegram-bot-api.exe').write_bytes(b'fixture')
    for name in switch.FILES:
        (target / name).write_text('old')
        (source / name).write_text('new')
    (target / '.env').write_text('private configuration')
    (target / 'docker.env').write_text('private API configuration')
    monkeypatch.setattr(switch, 'SOURCE', source)
    monkeypatch.setattr(switch, 'TARGET', target)
    monkeypatch.setattr(switch.ctypes, 'windll', Mock(shell32=Mock(IsUserAnAdmin=Mock(return_value=True))))
    monkeypatch.setattr(switch, 'configuration', lambda root: ({}, {'BOT_TOKEN':'123:fake'}))
    monkeypatch.setattr(switch, 'verify_bundle', lambda: None)
    api = Mock(side_effect=lambda token, method: {} if method == 'getWebhookInfo' else True)
    monkeypatch.setattr(switch, 'api_call', api)
    def command(args):
        if args[1] == 'inspect':
            return json.dumps({'Running':True}) if '.State' in args[3] else 'unless-stopped'
        return ''
    commands = Mock(side_effect=command)
    monkeypatch.setattr(switch, 'command', commands)
    tasks = []
    def task(action, backup):
        tasks.append(action)
        if action == 'Install' and fail_install:
            raise RuntimeError('test failure')
    monkeypatch.setattr(switch, 'task', task)
    # Lần gọi đầu quyết định có API cũ (Docker) hay không; ba lần sau: chờ cổng trống, kiểm tra trống, cổng mới lên.
    monkeypatch.setattr(switch, 'port_ready', Mock(side_effect=[docker_mode, False, False, True]))
    docker_started = lambda: any(call.args[0] == ['docker','start','telegram-bot-api'] for call in commands.call_args_list)
    if fail_install:
        with pytest.raises(RuntimeError, match='test failure'):
            switch.main()
        assert tasks[-2:] == ['Stop','Restore']
        assert (target / 'bot.py').read_text() == ('new' if in_place else 'old')  # in_place: file sẵn có là bản 'new'
        assert docker_started() == docker_mode
    else:
        switch.main()
        assert tasks == ['Save','Stop','Install']
        assert (target / 'bot.py').read_text() == 'new'
    # Docker chết: không logOut khỏi API cũ, không docker stop; chỉ cố tắt tự khởi động container.
    # logOut: 1 lần khỏi API cũ (chỉ khi có Docker) + 1 lần khỏi API native khi rollback.
    assert sum(call.args[1] == 'logOut' for call in api.call_args_list) == int(docker_mode) + int(fail_install)
    assert any(call.args[0] == ['docker','stop','telegram-bot-api'] for call in commands.call_args_list) == docker_mode
    assert any(call.args[0][:3] == ['docker','update','--restart=no'] for call in commands.call_args_list)
    assert (target / '.env').read_text() == 'private configuration'
    assert (target / 'docker.env').read_text() == 'private API configuration'
    assert len(list(target.glob('backup-native-*/.env'))) == 1

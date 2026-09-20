import json
import os
import subprocess
from pathlib import Path
from urllib.parse import urlsplit, unquote

env_path = Path.home() / '.config' / 'campaignbuilder' / 'database.env'
values = {}
for line in env_path.read_text().splitlines():
    if '=' in line:
        key, value = line.split('=', 1)
        values[key] = json.loads(value) if value.startswith('"') else value
url = urlsplit(values['DATABASE_URL'])
environment = os.environ.copy()
environment['PGPASSWORD'] = unquote(url.password or '')
subprocess.run([
    'psql', '-h', url.hostname or '127.0.0.1', '-p', str(url.port or 5432),
    '-U', unquote(url.username or ''), '-d', url.path.lstrip('/'),
    '-v', 'ON_ERROR_STOP=1', '-Atc', 'SELECT current_database(), current_user;'
], env=environment, check=True)

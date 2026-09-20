"""Run interactively on the Ubuntu server; never print the password."""
import getpass
import json
import os
from pathlib import Path
from urllib.parse import quote

target = Path.home() / '.config' / 'campaignbuilder' / 'database.env'
target.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
if target.exists():
    raise SystemExit('Configuration already exists; leaving it unchanged.')
password = getpass.getpass('Database password for campaignapp: ')
if not password:
    raise SystemExit('Empty password; configuration not written.')
url = 'postgresql://campaignapp:' + quote(password, safe='') + '@127.0.0.1:5432/campaignbuilder'
fd = os.open(target, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
with os.fdopen(fd, 'w') as output:
    output.write('DATABASE_DRIVER=pg\nDATABASE_URL=' + json.dumps(url) + '\n')
print('Database configuration saved privately.')

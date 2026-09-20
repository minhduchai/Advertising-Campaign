"""Install the self-hosted seeding worker for campaignadmin."""
from pathlib import Path
import subprocess

home = Path.home()
app = home / 'apps/campaignbuilder'
state = home / '.local/state/campaignbuilder'
state.mkdir(parents=True, exist_ok=True)
worker = app / 'scripts/tick-seeding.js'
if not worker.is_file():
    raise RuntimeError('Deploy tick-seeding.js first')
marker = '# campaignbuilder-seeding-worker'
entry = (
    f'* * * * * /usr/bin/flock -n {state}/seeding.lock '
    f'/usr/bin/timeout 115 /usr/bin/node '
    f'--env-file={home}/.config/campaignbuilder/app.env {worker} '
    f'>> {state}/seeding.log 2>&1 {marker}'
)
old = subprocess.run(['crontab', '-l'], capture_output=True, text=True)
if old.returncode not in (0, 1):
    raise RuntimeError('Cannot read crontab')
lines = [line for line in old.stdout.splitlines() if marker not in line]
subprocess.run(['crontab', '-'], input='\n'.join(lines + [entry]) + '\n', text=True, check=True)
print('Seeding worker scheduled every minute')

"""Run as campaignadmin on Ubuntu after deploying the recovery worker files."""
from pathlib import Path
import subprocess

home = Path.home()
app = home / 'apps/campaignbuilder'
state = home / '.local/state/campaignbuilder'
state.mkdir(parents=True, exist_ok=True)
worker = app / 'scripts/tick-publication-recovery.js'
if not worker.is_file():
    raise RuntimeError('Deploy tick-publication-recovery.js first')
marker = '# campaignbuilder-publication-recovery'
entry = (
    f'* * * * * /usr/bin/flock -n {state}/publication-recovery.lock '
    f'/usr/bin/timeout 110 /usr/bin/node '
    f'--env-file={home}/.config/campaignbuilder/app.env {worker} '
    f'>> {state}/publication-recovery.log 2>&1 {marker}'
)
old = subprocess.run(['crontab', '-l'], capture_output=True, text=True)
if old.returncode not in (0, 1):
    raise RuntimeError('Cannot read crontab')
lines = [line for line in old.stdout.splitlines() if marker not in line]
subprocess.run(['crontab', '-'], input='\n'.join(lines + [entry]) + '\n', text=True, check=True)
print('Publication recovery scheduled every minute')

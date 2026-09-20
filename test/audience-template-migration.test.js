import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectDirectory = fileURLToPath(new URL('../', import.meta.url));

test('provides an explicit idempotent production migration command for audience templates', async () => {
  const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  const script = await readFile(
    new URL('../scripts/migrate-audience-templates-postgres.js', import.meta.url),
    'utf8'
  );

  assert.equal(
    packageJson.scripts['db:migrate:audience-templates:postgres'],
    'node --env-file-if-exists=.env.production.local scripts/migrate-audience-templates-postgres.js'
  );
  assert.match(script, /DATABASE_URL is required/);
  assert.match(script, /applyAudienceTemplateSchema/);
  assert.match(script, /audience_templates/);
});

test('audience-template migration dry-run never connects to or mutates Postgres', () => {
  const result = spawnSync(
    process.execPath,
    ['scripts/migrate-audience-templates-postgres.js', '--dry-run'],
    {
      cwd: projectDirectory,
      env: { ...process.env, DATABASE_URL: '' },
      encoding: 'utf8'
    }
  );

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Dry run/);
  assert.match(result.stdout, /audience_templates/);
});

test('existing DATABASE_URL overrides the optional production env file', () => {
  const directory = mkdtempSync(join(tmpdir(), 'audience-env-'));
  const envPath = join(directory, '.env.production.local');
  writeFileSync(envPath, 'DATABASE_URL=postgresql://from-file.invalid/app\n');
  try {
    const result = spawnSync(
      process.execPath,
      [`--env-file-if-exists=${envPath}`, '-e', 'process.stdout.write(process.env.DATABASE_URL)'],
      {
        env: { ...process.env, DATABASE_URL: 'postgresql://override.invalid/app' },
        encoding: 'utf8'
      }
    );

    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, 'postgresql://override.invalid/app');
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

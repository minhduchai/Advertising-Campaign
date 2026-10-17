import test from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig } from '../src/config.js';
import { tmpdir } from 'node:os';

function validEnvironment(overrides = {}) {
  return {
    META_APP_ID: 'app-id',
    META_APP_SECRET: 'app-secret',
    META_LOGIN_CONFIG_ID: 'login-config-id',
    META_REDIRECT_URI: 'http://localhost:3000/api/auth/meta/callback',
    META_API_VERSION: 'v25.0',
    TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),
    SESSION_SECRET: 'session-secret',
    ...overrides
  };
}

test('loads the Facebook Login for Business configuration ID', () => {
  const config = loadConfig(validEnvironment());

  assert.equal(config.loginConfigId, 'login-config-id');
});

test('loads private app admin IDs and rejects malformed IDs', () => {
  const config = loadConfig(validEnvironment({ ACCESS_ADMIN_META_USER_IDS: '123, 456', ACCESS_CONTROL_FILE: '' }));
  assert.deepEqual(config.accessAdminMetaUserIds, ['123', '456']);
  assert.match(config.accessControlFile, /access-users\.json$/);
  assert.throws(() => loadConfig(validEnvironment({ ACCESS_ADMIN_META_USER_IDS: 'invalid' })), /ACCESS_ADMIN_META_USER_IDS/);
});

test('rejects configuration when the Meta app secret is missing', () => {
  assert.throws(
    () => loadConfig({ META_APP_ID: 'app-id' }),
    /META_APP_SECRET/
  );
});

test('allows switching the address geocoder without changing application code', () => {
  assert.equal(loadConfig(validEnvironment()).photonGeocoderUrl, 'https://photon.komoot.io/api/');
  assert.equal(loadConfig(validEnvironment({ PHOTON_GEOCODER_URL: ' https://geo.example/api/ ' })).photonGeocoderUrl, 'https://geo.example/api/');
});

test('production requires Neon and R2', () => {
  const environment = validEnvironment({
    NODE_ENV: 'production',
    DATABASE_URL: '',
  });

  assert.throws(() => loadConfig(environment), /DATABASE_URL/);
  assert.throws(
    () => loadConfig({ ...environment, DATABASE_URL: 'postgresql://example.invalid/app' }),
    /R2 storage/,
  );
});

test('production disables the SQLite database path', () => {
  const config = loadConfig(validEnvironment({
    NODE_ENV: 'production',
    DATABASE_URL: 'postgresql://example.invalid/app',
    R2_ACCOUNT_ID: 'account',
    R2_BUCKET_NAME: 'bucket',
    R2_ACCESS_KEY_ID: 'key',
    R2_SECRET_ACCESS_KEY: 'secret',
    R2_ENDPOINT: 'https://account.r2.cloudflarestorage.com',
  }));

  assert.equal(config.databasePath, null);
  const cwd = process.cwd();
  try {
    process.chdir(tmpdir());
    const fromCron = loadConfig(validEnvironment({
      NODE_ENV: 'production', DATABASE_URL: 'postgresql://example.invalid/app',
      R2_ACCOUNT_ID: 'account', R2_BUCKET_NAME: 'bucket', R2_ACCESS_KEY_ID: 'key',
      R2_SECRET_ACCESS_KEY: 'secret', R2_ENDPOINT: 'https://account.r2.cloudflarestorage.com'
    }));
    assert.equal(fromCron.metaReadCacheDirectory, config.metaReadCacheDirectory);
  } finally {
    process.chdir(cwd);
  }
});

test('production uses R2 media storage', () => {
  const config = loadConfig(validEnvironment({
    NODE_ENV: 'production',
    DATABASE_URL: 'postgresql://example.invalid/app',
    R2_ACCOUNT_ID: 'account',
    R2_BUCKET_NAME: 'bucket',
    R2_ACCESS_KEY_ID: 'key',
    R2_SECRET_ACCESS_KEY: 'secret',
    R2_ENDPOINT: 'https://account.r2.cloudflarestorage.com'
  }));

  assert.equal(config.mediaUploadMode, 'r2');
});

test('local runtime keeps SQLite media uploads', () => {
  const config = loadConfig(validEnvironment({ NODE_ENV: 'development' }));

  assert.equal(config.isProduction, false);
  assert.equal(config.mediaUploadMode, 'local');
});

test('defaults R2 cleanup to 9 GB with a 72-hour orphan safety window', () => {
  const config = loadConfig(validEnvironment());

  assert.equal(config.r2CleanupThresholdBytes, 9 * 1024 ** 3);
  assert.equal(config.r2CleanupMinAgeMs, 72 * 60 * 60 * 1000);
});

test('loads the Telegram path worker secret and limits paths to the marketing share by default', () => {
  const config = loadConfig({
    ...validEnvironment(),
    TELEGRAM_UPLOAD_WORKER_SECRET: 'worker-secret'
  });

  assert.equal(config.telegramUploadWorkerSecret, 'worker-secret');
  assert.equal(config.telegramFileRoot, '\\\\192.168.1.6\\marketing');
});

test('loads an explicit Meta user allowlist for Telegram network uploads', () => {
  const config = loadConfig({
    ...validEnvironment(),
    TELEGRAM_UPLOAD_ALLOWED_META_USER_IDS: '1034343082727070, 123,invalid'
  });

  assert.deepEqual([...config.telegramUploadAllowedMetaUserIds], ['1034343082727070', '123']);
});

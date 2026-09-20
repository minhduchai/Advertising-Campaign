import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const requiredKeys = [
  'META_APP_ID',
  'META_APP_SECRET',
  'META_LOGIN_CONFIG_ID',
  'META_REDIRECT_URI',
  'META_API_VERSION',
  'TOKEN_ENCRYPTION_KEY',
  'SESSION_SECRET'
];

export function loadConfig(environment = process.env) {
  for (const key of requiredKeys) {
    if (!environment[key]) {
      throw new Error(`Missing required environment variable: ${key}`);
    }
  }

  const redirectUri = new URL(environment.META_REDIRECT_URI);
  if (redirectUri.protocol !== 'https:' && redirectUri.hostname !== 'localhost') {
    throw new Error('META_REDIRECT_URI must use HTTPS unless it points to localhost');
  }

  const tokenEncryptionKey = Buffer.from(environment.TOKEN_ENCRYPTION_KEY, 'base64');
  if (tokenEncryptionKey.length !== 32) {
    throw new Error('TOKEN_ENCRYPTION_KEY must be a Base64-encoded 32-byte value');
  }

  const isProduction = environment.NODE_ENV === 'production';
  const databaseUrl = environment.DATABASE_URL?.trim() ?? '';
  const blobReadWriteToken = environment.BLOB_READ_WRITE_TOKEN?.trim() ?? '';
  const r2AccountId = environment.R2_ACCOUNT_ID?.trim() ?? '';
  const r2BucketName = environment.R2_BUCKET_NAME?.trim() ?? '';
  const r2AccessKeyId = environment.R2_ACCESS_KEY_ID?.trim() ?? '';
  const r2SecretAccessKey = environment.R2_SECRET_ACCESS_KEY?.trim() ?? '';
  const r2Endpoint = environment.R2_ENDPOINT?.trim() ?? '';
  const r2Enabled = Boolean(r2AccountId && r2BucketName && r2AccessKeyId && r2SecretAccessKey && r2Endpoint);
  const r2CleanupThresholdBytes = positiveNumber(environment.R2_CLEANUP_THRESHOLD_BYTES, 9 * 1024 ** 3);
  const r2CleanupMinAgeMs = positiveNumber(environment.R2_CLEANUP_MIN_AGE_MS, 72 * 60 * 60 * 1000);
  const workflowUrl = environment.WORKFLOW_URL?.trim().replace(/\/$/, '') ?? '';
  const workflowSharedSecret = environment.WORKFLOW_SHARED_SECRET?.trim() ?? '';
  const workflowEnabled = environment.WORKFLOW_ENABLED === 'true';
  // Số node tạo song song trên Meta trong một bước. Marketing API Access Tier đã Full access; các phanh theo mức dùng nằm ở meta-rate-limiter.
  const publishConcurrency = Math.min(8, Math.floor(positiveNumber(environment.PUBLISH_CONCURRENCY, 5)));
  const telegramBotUsername = (environment.TELEGRAM_BOT_USERNAME ?? 'duck_company_file_bot')
    .trim()
    .replace(/^@/, '');
  const telegramUploadWorkerSecret = environment.TELEGRAM_UPLOAD_WORKER_SECRET?.trim() ?? '';
  const telegramFileRoot = environment.TELEGRAM_FILE_ROOT?.trim() ?? '\\\\192.168.1.6\\marketing';
  const telegramUploadAllowedMetaUserIds = new Set(
    String(environment.TELEGRAM_UPLOAD_ALLOWED_META_USER_IDS ?? '')
      .split(',')
      .map((value) => value.trim())
      .filter((value) => /^\d+$/.test(value))
  );

  if (workflowEnabled && (!workflowUrl || !workflowSharedSecret)) {
    throw new Error('WORKFLOW_URL and WORKFLOW_SHARED_SECRET are required when WORKFLOW_ENABLED=true');
  }

  if (isProduction && !databaseUrl) {
    throw new Error('DATABASE_URL is required in production.');
  }
  if (isProduction && !r2Enabled && !blobReadWriteToken) {
    throw new Error('R2 storage or BLOB_READ_WRITE_TOKEN is required in production.');
  }

  const runtimeDirectory = resolve(environment.RUNTIME_DIRECTORY ?? 'data');
  if (!databaseUrl) {
    mkdirSync(runtimeDirectory, { recursive: true });
  }

  return {
    appId: environment.META_APP_ID,
    appSecret: environment.META_APP_SECRET,
    loginConfigId: environment.META_LOGIN_CONFIG_ID,
    redirectUri: redirectUri.toString(),
    apiVersion: environment.META_API_VERSION,
    photonGeocoderUrl: environment.PHOTON_GEOCODER_URL?.trim() || 'https://photon.komoot.io/api/',
    tokenEncryptionKey,
    sessionSecret: environment.SESSION_SECRET,
    port: Number(environment.PORT ?? 3000),
    databasePath: databaseUrl ? null : resolve(runtimeDirectory, 'meta-ads.sqlite'),
    isProduction,
    databaseUrl,
    blobReadWriteToken,
    r2Enabled,
    r2AccountId,
    r2BucketName,
    r2AccessKeyId,
    r2SecretAccessKey,
    r2Endpoint,
    r2CleanupThresholdBytes,
    r2CleanupMinAgeMs,
    workflowEnabled,
    commentUnhideOwner: environment.COMMENT_UNHIDE_OWNER_ID?.trim() ?? '',
    commentUnhideEnabledAt: Date.parse(environment.COMMENT_UNHIDE_ENABLED_AT ?? ''),
    publishConcurrency,
    workflowUrl,
    workflowSharedSecret,
    telegramBotUsername,
    telegramUploadWorkerSecret,
    telegramFileRoot,
    telegramUploadAllowedMetaUserIds,
    mediaUploadMode: r2Enabled ? 'r2' : (blobReadWriteToken ? 'vercel-blob' : 'local')
  };
}

function positiveNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

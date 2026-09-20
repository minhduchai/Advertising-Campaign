import { writeFileSync } from 'node:fs';

const [source, destination] = process.argv.slice(2);
if (!source || !destination) throw new Error('Usage: prepare-server-env SOURCE DESTINATION');
process.loadEnvFile(source);
const names = [
  'META_API_VERSION', 'META_APP_ID', 'META_APP_SECRET', 'META_LOGIN_CONFIG_ID',
  'META_REDIRECT_URI', 'R2_ACCESS_KEY_ID', 'R2_ACCOUNT_ID', 'R2_BUCKET_NAME',
  'R2_ENDPOINT', 'R2_SECRET_ACCESS_KEY', 'SESSION_SECRET', 'TOKEN_ENCRYPTION_KEY',
  'WORKFLOW_ENABLED', 'WORKFLOW_SHARED_SECRET', 'WORKFLOW_URL',
  'BLOB_READ_WRITE_TOKEN', 'PUBLISH_CONCURRENCY', 'TELEGRAM_BOT_USERNAME',
  'TELEGRAM_UPLOAD_WORKER_SECRET', 'TELEGRAM_UPLOAD_ALLOWED_META_USER_IDS'
];
const lines = ['NODE_ENV=production', 'PORT=3000'];
for (const name of names) {
  const value = process.env[name];
  if (value) lines.push(`${name}=${JSON.stringify(value)}`);
}
writeFileSync(destination, `${lines.join('\n')}\n`, { mode: 0o600, flag: 'wx' });

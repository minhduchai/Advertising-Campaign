import assert from 'node:assert/strict';
import test from 'node:test';

import { signSession } from '../src/crypto.js';
import { createSqliteDatabase } from '../src/db.js';
import { normalizeTelegramNetworkPath } from '../src/request-handler.js';
import { createServer } from '../src/server.js';
import { request, testConfig } from './helpers.js';

test('accepts only media files below the configured marketing share', () => {
  const root = '\\\\192.168.1.6\\marketing';
  assert.equal(
    normalizeTelegramNetworkPath('\\\\192.168.1.6\\marketing\\CHUNG\\THÁNG 8\\video.mp4', root),
    '\\\\192.168.1.6\\marketing\\CHUNG\\THÁNG 8\\video.mp4'
  );
  assert.equal(
    normalizeTelegramNetworkPath('\\\\192.168.1.6\\marketing\\CHUNG\\THÁNG 8\\video.MOV', root),
    '\\\\192.168.1.6\\marketing\\CHUNG\\THÁNG 8\\video.MOV'
  );
  assert.equal(normalizeTelegramNetworkPath('\\\\192.168.1.6\\secret\\video.mp4', root), null);
  assert.equal(normalizeTelegramNetworkPath('\\\\192.168.1.6\\marketing\\CHUNG\\file.psd', root), null);
  assert.equal(normalizeTelegramNetworkPath('\\\\192.168.1.6\\marketing\\..\\secret\\video.mp4', root), null);
});

test('rejects Telegram network upload APIs for a Meta user outside the experiment allowlist', async (context) => {
  const config = {
    ...testConfig(),
    telegramBotUsername: 'duck_company_file_bot',
    telegramUploadAllowedMetaUserIds: new Set(['1034343082727070'])
  };
  const db = {
    createSession: () => ({ id: 'new-session' }),
    getSession: () => ({ id: 'session-user', metaUserId: '1643641244', metaUserName: 'Other user' })
  };
  const server = createServer({ config, db, metaClient: {}, mediaStore: { r2: {} } });
  context.after(() => server.close());
  const cookie = `meta_ads_session=${encodeURIComponent(signSession('session-user', config.sessionSecret))}`;

  const response = await request(server, '/api/telegram-upload/intent', {
    method: 'POST',
    headers: { cookie }
  });

  assert.equal(response.status, 403);
  assert.match(response.body.error, /chưa được cấp/);
});

test('creates a Telegram intent and uses it for owner-scoped multipart upload', async (context) => {
  const config = {
    ...testConfig(),
    telegramBotUsername: 'duck_company_file_bot',
    telegramUploadAllowedMetaUserIds: new Set(['1643641244'])
  };
  const calls = [];
  const savedMedia = {
    id: 'a'.repeat(32),
    name: 'video.mp4',
    mimeType: 'video/mp4',
    sizeBytes: 123
  };
  const db = {
    createSession: () => ({ id: 'new-session' }),
    getSession: () => ({ id: 'session-user', metaUserId: '1643641244', metaUserName: 'Duc' }),
    getMedia: async (_owner, mediaId) => mediaId === savedMedia.id ? savedMedia : null
  };
  const mediaStore = {
    r2: {
      createMultipartUpload: async (input) => {
        calls.push(['create', input]);
        savedMedia.id = input.mediaId;
        return { mediaId: input.mediaId, uploadId: 'upload-1', key: `ads/${input.mediaId}/video.mp4` };
      },
      presignMultipartPart: async (input) => ({ ...input, uploadUrl: 'https://r2.test/part-1' }),
      completeMultipartUpload: async (input) => {
        calls.push(['complete', input]);
        return savedMedia;
      },
      abortMultipartUpload: async (input) => ({ ...input, aborted: true })
    }
  };
  const server = createServer({ config, db, metaClient: {}, mediaStore });
  context.after(() => server.close());
  const cookie = `meta_ads_session=${encodeURIComponent(signSession('session-user', config.sessionSecret))}`;

  const intent = await request(server, '/api/telegram-upload/intent', {
    method: 'POST',
    headers: { cookie }
  });

  assert.equal(intent.status, 201);
  assert.match(intent.body.deepLink, /^https:\/\/t\.me\/duck_company_file_bot\?start=app_[A-Za-z0-9_-]{54}$/);
  const code = new URL(intent.body.deepLink).searchParams.get('start').slice(4);

  const created = await request(server, '/api/telegram-upload/r2-multipart/create', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code, name: 'video.mp4', mimeType: 'video/mp4', sizeBytes: 123 })
  });

  assert.equal(created.status, 201);
  assert.equal(created.body.mediaId, intent.body.mediaId);
  assert.equal(calls[0][1].ownerMetaUserId, '1643641244');

  const status = await request(server, `/api/telegram-upload/status?mediaId=${intent.body.mediaId}`, {
    headers: { cookie }
  });
  assert.equal(status.status, 200);
  assert.equal(status.body.status, 'completed');
});

test('queues a network path for the authenticated company bot worker', async (context) => {
  const config = {
    ...testConfig(),
    telegramBotUsername: 'duck_company_file_bot',
    telegramUploadWorkerSecret: 'worker-secret',
    telegramFileRoot: '\\\\192.168.1.6\\marketing',
    telegramUploadAllowedMetaUserIds: new Set(['1643641244'])
  };
  const db = createSqliteDatabase(':memory:');
  db.createSession({ id: 'session-user', now: 1 });
  db.attachMetaUser('session-user', { id: '1643641244', name: 'Duc' });
  const mediaStore = { r2: {} };
  const server = createServer({ config, db, metaClient: {}, mediaStore });
  context.after(() => {
    server.close();
    db.close();
  });
  const cookie = `meta_ads_session=${encodeURIComponent(signSession('session-user', config.sessionSecret))}`;
  const networkPath = '\\\\192.168.1.6\\marketing\\CHUNG\\MEDIA\\video.mp4';

  const queued = await request(server, '/api/telegram-upload/path-jobs', {
    method: 'POST',
    headers: { cookie, 'content-type': 'application/json' },
    body: JSON.stringify({ path: networkPath })
  });

  assert.equal(queued.status, 201);
  assert.match(queued.body.jobId, /^[a-f0-9]{32}$/);

  const denied = await request(server, '/api/telegram-upload/jobs/claim', { method: 'POST' });
  assert.equal(denied.status, 401);

  const claimed = await request(server, '/api/telegram-upload/jobs/claim', {
    method: 'POST',
    headers: { authorization: 'Bearer worker-secret' }
  });
  assert.equal(claimed.status, 200);
  assert.equal(claimed.body.path, networkPath);
  assert.equal(claimed.body.mediaId, queued.body.mediaId);

  const progress = await request(server, '/api/telegram-upload/jobs/progress', {
    method: 'POST',
    headers: {
      authorization: 'Bearer worker-secret',
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      jobId: claimed.body.jobId,
      leaseToken: claimed.body.leaseToken,
      uploadedBytes: 32 * 1024 * 1024,
      totalBytes: 100 * 1024 * 1024
    })
  });
  assert.equal(progress.status, 200);
  assert.equal(progress.body.percentage, 32);

  const uploading = await request(server, `/api/telegram-upload/status?mediaId=${queued.body.mediaId}`, {
    headers: { cookie }
  });
  assert.deepEqual(uploading.body, {
    status: 'uploading',
    mediaId: queued.body.mediaId,
    uploadedBytes: 32 * 1024 * 1024,
    totalBytes: 100 * 1024 * 1024,
    percentage: 32
  });

  const failed = await request(server, '/api/telegram-upload/jobs/result', {
    method: 'POST',
    headers: {
      authorization: 'Bearer worker-secret',
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      jobId: claimed.body.jobId,
      leaseToken: claimed.body.leaseToken,
      status: 'failed',
      error: 'Không tìm thấy file'
    })
  });
  assert.equal(failed.status, 200);

  const status = await request(server, `/api/telegram-upload/status?mediaId=${queued.body.mediaId}`, {
    headers: { cookie }
  });
  assert.deepEqual(status.body, {
    status: 'failed',
    mediaId: queued.body.mediaId,
    error: 'Không tìm thấy file'
  });
});

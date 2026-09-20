import assert from 'node:assert/strict';
import test from 'node:test';

import { createTelegramUploadClient, TELEGRAM_UPLOAD_STORAGE_KEY } from '../public/telegram-upload-client.js';

function response(payload, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(payload)
  };
}

test('opens Telegram and polls until the uploaded media is ready', async () => {
  const calls = [];
  const opened = [];
  const storage = memoryStorage();
  const client = createTelegramUploadClient({
    storage,
    pollIntervalMs: 0,
    sleepImpl: async () => {},
    now: () => 1_000,
    fetchImpl: async (url) => {
      calls.push(url);
      if (url === '/api/telegram-upload/intent') {
        return response({ mediaId: 'a'.repeat(32), deepLink: 'https://t.me/bot?start=app_code', expiresAt: 60_000 }, 201);
      }
      if (calls.filter((entry) => entry.includes('/status')).length === 1) {
        return response({ status: 'waiting', mediaId: 'a'.repeat(32) });
      }
      return response({ status: 'completed', mediaId: 'a'.repeat(32), name: 'video.mp4', mimeType: 'video/mp4', sizeBytes: 123 });
    }
  });

  const result = await client.upload({ clientId: 'ad-1', openTelegram: (url) => opened.push(url) });

  assert.deepEqual(opened, ['https://t.me/bot?start=app_code']);
  assert.equal(result.kind, 'video');
  assert.equal(storage.getItem(TELEGRAM_UPLOAD_STORAGE_KEY), null);
});

test('submits a network path and waits for the company bot without opening Telegram', async () => {
  const calls = [];
  const progress = [];
  const storage = memoryStorage();
  const client = createTelegramUploadClient({
    storage,
    pollIntervalMs: 0,
    sleepImpl: async () => {},
    now: () => 1_000,
    fetchImpl: async (url, options = {}) => {
      calls.push([url, options]);
      if (url === '/api/telegram-upload/path-jobs') {
        return response({
          jobId: 'job-1',
          mediaId: 'b'.repeat(32),
          expiresAt: 60_000,
          status: 'queued'
        }, 201);
      }
      if (calls.filter(([entry]) => entry.includes('/status')).length === 1) {
        return response({
          status: 'uploading',
          mediaId: 'b'.repeat(32),
          uploadedBytes: 32 * 1024 * 1024,
          totalBytes: 100 * 1024 * 1024,
          percentage: 32
        });
      }
      return response({
        status: 'completed',
        mediaId: 'b'.repeat(32),
        name: 'banner.jpg',
        mimeType: 'image/jpeg',
        sizeBytes: 456,
        uploadedBytes: 456,
        totalBytes: 456,
        percentage: 100
      });
    }
  });

  const result = await client.uploadPath({
    clientId: 'ad-2',
    path: '\\\\192.168.1.6\\marketing\\banner.jpg',
    onProgress: (status) => progress.push(status.percentage)
  });

  assert.equal(result.kind, 'image');
  assert.equal(JSON.parse(calls[0][1].body).path, '\\\\192.168.1.6\\marketing\\banner.jpg');
  assert.deepEqual(progress, [32, 100]);
  assert.equal(storage.getItem(TELEGRAM_UPLOAD_STORAGE_KEY), null);
});

function memoryStorage() {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key)
  };
}

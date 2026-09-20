import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  UPLOAD_AGENT_STORAGE_KEY,
  createUploadAgentClient
} from '../public/upload-agent-client.js';

function createStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem(key) {
      return values.has(key) ? values.get(key) : null;
    },
    setItem(key, value) {
      values.set(key, String(value));
    },
    removeItem(key) {
      values.delete(key);
    }
  };
}

function jsonResponse(value, status = 200) {
  return Response.json(value, { status });
}

test('detects, pairs, selects and polls a localhost upload job', async () => {
  const calls = [];
  const storage = createStorage();
  const jobUpdates = [
    {
      id: 'job-1',
      name: 'creative.mp4',
      size: 20_000_000,
      status: 'uploading',
      uploadedBytes: 10_000_000,
      speedBps: 5_000_000,
      etaSeconds: 2
    },
    {
      id: 'job-1',
      name: 'creative.mp4',
      size: 20_000_000,
      status: 'completed',
      uploadedBytes: 20_000_000,
      speedBps: 5_000_000,
      etaSeconds: 0,
      mediaId: 'media-1'
    }
  ];
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url, options });
    if (url === 'http://127.0.0.1:47831/health') return jsonResponse({ status: 'ok', paired: false });
    if (url === '/api/upload-agent/pair') return jsonResponse({ code: 'PAIR-1234' }, 201);
    if (url === 'http://127.0.0.1:47831/pair') return jsonResponse({ paired: true });
    if (url === 'http://127.0.0.1:47831/select-file') {
      return jsonResponse({ id: 'job-1', name: 'creative.mp4', size: 20_000_000, status: 'queued' }, 201);
    }
    if (url === 'http://127.0.0.1:47831/jobs/job-1') return jsonResponse(jobUpdates.shift());
    throw new Error(`Unexpected request: ${url}`);
  };
  const progress = [];
  const client = createUploadAgentClient({
    fetchImpl,
    storage,
    sleepImpl: async () => {}
  });

  const result = await client.upload({
    clientId: 'ad-1',
    onProgress: (job) => progress.push(job)
  });

  assert.equal(result.mediaId, 'media-1');
  assert.equal(result.name, 'creative.mp4');
  assert.equal(result.size, 20_000_000);
  assert.equal(progress.at(-1).uploadedBytes, 20_000_000);
  assert.equal(storage.getItem(UPLOAD_AGENT_STORAGE_KEY), null);
  assert.deepEqual(
    calls.map(({ url }) => url),
    [
      'http://127.0.0.1:47831/health',
      '/api/upload-agent/pair',
      'http://127.0.0.1:47831/pair',
      'http://127.0.0.1:47831/select-file',
      'http://127.0.0.1:47831/jobs/job-1',
      'http://127.0.0.1:47831/jobs/job-1'
    ]
  );
  assert.deepEqual(JSON.parse(calls[2].options.body), { code: 'PAIR-1234' });
});

test('reattaches persisted jobs and reports completion to the owning ad', async () => {
  const storage = createStorage({
    [UPLOAD_AGENT_STORAGE_KEY]: JSON.stringify([{ id: 'job-2', clientId: 'ad-2' }])
  });
  const fetchImpl = async (url) => {
    assert.equal(url, 'http://127.0.0.1:47831/jobs/job-2');
    return jsonResponse({
      id: 'job-2',
      name: 'banner.webp',
      size: 4_000_000,
      status: 'completed',
      uploadedBytes: 4_000_000,
      speedBps: 2_000_000,
      etaSeconds: 0,
      mediaId: 'media-2'
    });
  };
  const completed = [];
  const client = createUploadAgentClient({ fetchImpl, storage, sleepImpl: async () => {} });

  await client.reattach({
    onComplete: (entry) => completed.push(entry)
  });

  assert.equal(completed.length, 1);
  assert.equal(completed[0].clientId, 'ad-2');
  assert.equal(completed[0].result.mediaId, 'media-2');
  assert.equal(storage.getItem(UPLOAD_AGENT_STORAGE_KEY), null);
});

test('marks a failed localhost health request as an Agent availability error', async () => {
  const client = createUploadAgentClient({
    fetchImpl: async () => {
      throw new TypeError('fetch failed');
    },
    storage: createStorage()
  });

  await assert.rejects(
    client.detect(),
    (error) => error.code === 'UPLOAD_AGENT_UNAVAILABLE'
  );
});

test('replaces Agent selection with a direct network path handled by the Telegram bot worker', async () => {
  const [appSource, workspaceSource, cssSource, buildSource] = await Promise.all([
    readFile(new URL('../public/app.js', import.meta.url), 'utf8'),
    readFile(new URL('../public/workspace.js', import.meta.url), 'utf8'),
    readFile(new URL('../public/app.css', import.meta.url), 'utf8'),
    readFile(new URL('../scripts/build-client.js', import.meta.url), 'utf8')
  ]);

  assert.match(appSource, /createTelegramUploadClient/);
  assert.match(appSource, /action === 'upload-media-from-network-path'/);
  assert.match(appSource, /telegramUpload\.uploadPath/);
  assert.match(appSource, /telegramUpload\.reattach/);
  assert.doesNotMatch(appSource, /createUploadAgentClient/);
  assert.doesNotMatch(appSource, /select-media-via-agent/);
  assert.match(appSource, /match\.node\.mediaId = result\.mediaId/);
  assert.match(appSource, /api\.mediaPreviewUrl\(result\.mediaId\)/);
  assert.match(workspaceSource, /data-action="upload-media-from-network-path"/);
  assert.match(workspaceSource, /Tải từ ổ chung/);
  assert.match(workspaceSource, /Dán đường dẫn/);
  assert.doesNotMatch(workspaceSource, /Chọn qua Agent/);
  assert.match(cssSource, /\.media-network-upload/);
  assert.match(cssSource, /\.media-preview-frame/);
  assert.match(cssSource, /max-height: min\(65vh, 520px\)/);
  assert.match(buildSource, /public\/telegram-upload-client\.js/);
});

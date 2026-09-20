export const TELEGRAM_UPLOAD_STORAGE_KEY = 'meta-ads-telegram-upload-intents';

export function createTelegramUploadClient({
  fetchImpl = globalThis.fetch?.bind(globalThis),
  storage = globalThis.localStorage,
  pollIntervalMs = 2000,
  sleepImpl = (duration) => new Promise((resolve) => setTimeout(resolve, duration)),
  now = Date.now
} = {}) {
  if (typeof fetchImpl !== 'function') throw new TypeError('Fetch API is required');

  async function fetchJson(url, options = {}) {
    const response = await fetchImpl(url, options);
    const text = await response.text();
    const payload = text ? parsePayload(text) : {};
    if (!response.ok) throw new Error(payload?.error || `Máy chủ trả về HTTP ${response.status}.`);
    return payload;
  }

  async function createIntent() {
    const intent = await fetchJson('/api/telegram-upload/intent', { method: 'POST' });
    if (!intent.mediaId || !intent.deepLink || !intent.expiresAt) {
      throw new Error('Máy chủ không trả về phiên tải qua Telegram hợp lệ.');
    }
    return intent;
  }

  async function createPathJob(path) {
    const job = await fetchJson('/api/telegram-upload/path-jobs', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ path })
    });
    if (!job.jobId || !job.mediaId || !job.expiresAt) {
      throw new Error('Máy chủ không trả về yêu cầu tải từ ổ chung hợp lệ.');
    }
    return job;
  }

  async function poll(intent, { onProgress } = {}) {
    while (now() < Number(intent.expiresAt)) {
      const status = await fetchJson(`/api/telegram-upload/status?mediaId=${encodeURIComponent(intent.mediaId)}`);
      onProgress?.(status);
      if (status.status === 'completed') return normalizeResult(status);
      if (status.status === 'failed') throw terminalError(status.error || 'Máy công ty không thể tải file.');
      if (status.status === 'expired') throw terminalError('Yêu cầu tải từ ổ chung đã hết hạn. Anh thử lại nhé.');
      await sleepImpl(pollIntervalMs);
    }
    throw new Error('Phiên tải qua Telegram đã hết hạn. Anh bấm lại nút để tạo phiên mới.');
  }

  async function upload({ clientId, openTelegram, onWaiting, onProgress } = {}) {
    const intent = await createIntent();
    rememberIntent(storage, { ...intent, clientId });
    onWaiting?.(intent);
    openTelegram?.(intent.deepLink);
    try {
      const result = await poll(intent, { onProgress });
      forgetIntent(storage, intent.mediaId);
      return result;
    } catch (error) {
      if (now() >= Number(intent.expiresAt)) forgetIntent(storage, intent.mediaId);
      throw error;
    }
  }

  async function uploadPath({ clientId, path, onWaiting, onProgress } = {}) {
    const job = await createPathJob(path);
    rememberIntent(storage, { ...job, clientId, source: 'path' });
    onWaiting?.(job);
    try {
      const result = await poll(job, { onProgress });
      forgetIntent(storage, job.mediaId);
      return result;
    } catch (error) {
      forgetIntent(storage, job.mediaId);
      throw error;
    }
  }

  async function reattach({ onWaiting, onProgress, onComplete, onError } = {}) {
    const entries = readIntents(storage);
    return Promise.all(entries.map(async (entry) => {
      if (now() >= Number(entry.expiresAt)) {
        forgetIntent(storage, entry.mediaId);
        return { ...entry, expired: true };
      }
      onWaiting?.(entry);
      try {
        const result = await poll(entry, {
          onProgress: (status) => onProgress?.({ ...entry, status })
        });
        forgetIntent(storage, entry.mediaId);
        await onComplete?.({ ...entry, result });
        return { ...entry, result };
      } catch (error) {
        if (error?.terminal) forgetIntent(storage, entry.mediaId);
        onError?.({ ...entry, error });
        return { ...entry, error };
      }
    }));
  }

  return { createIntent, createPathJob, poll, upload, uploadPath, reattach };
}

function terminalError(message) {
  const error = new Error(message);
  error.terminal = true;
  return error;
}

function normalizeResult(status) {
  return {
    ...status,
    mediaId: status.mediaId,
    id: status.mediaId,
    name: status.name ?? '',
    size: Math.max(0, Number(status.size ?? status.sizeBytes) || 0),
    kind: String(status.mimeType ?? '').startsWith('video/') ? 'video' : 'image'
  };
}

function parsePayload(text) {
  try {
    return JSON.parse(text);
  } catch {
    return { message: text };
  }
}

function readIntents(storage) {
  if (!storage) return [];
  try {
    const entries = JSON.parse(storage.getItem(TELEGRAM_UPLOAD_STORAGE_KEY) ?? '[]');
    return Array.isArray(entries)
      ? entries.filter((entry) => entry?.clientId && entry?.mediaId && entry?.expiresAt)
      : [];
  } catch {
    return [];
  }
}

function writeIntents(storage, entries) {
  if (!storage) return;
  if (entries.length === 0) storage.removeItem(TELEGRAM_UPLOAD_STORAGE_KEY);
  else storage.setItem(TELEGRAM_UPLOAD_STORAGE_KEY, JSON.stringify(entries));
}

function rememberIntent(storage, entry) {
  const entries = readIntents(storage).filter((candidate) => candidate.mediaId !== entry.mediaId);
  writeIntents(storage, [...entries, entry]);
}

function forgetIntent(storage, mediaId) {
  writeIntents(storage, readIntents(storage).filter((entry) => entry.mediaId !== mediaId));
}

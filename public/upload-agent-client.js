export const UPLOAD_AGENT_BASE_URL = 'http://127.0.0.1:47831';
export const UPLOAD_AGENT_STORAGE_KEY = 'meta-ads-upload-agent-jobs';

const COMPLETED_STATUSES = new Set(['completed', 'complete', 'succeeded', 'success']);
const FAILED_STATUSES = new Set(['failed', 'error', 'cancelled', 'canceled']);

class UploadAgentError extends Error {
  constructor(message, { code = 'UPLOAD_AGENT_ERROR', status = 0 } = {}) {
    super(message);
    this.name = 'UploadAgentError';
    this.code = code;
    this.status = status;
  }
}

export function createUploadAgentClient({
  fetchImpl = globalThis.fetch?.bind(globalThis),
  storage = globalThis.localStorage,
  agentBaseUrl = UPLOAD_AGENT_BASE_URL,
  healthTimeoutMs = 1200,
  pollIntervalMs = 1000,
  sleepImpl = (duration) => new Promise((resolve) => setTimeout(resolve, duration))
} = {}) {
  if (typeof fetchImpl !== 'function') throw new TypeError('Fetch API is required');

  async function fetchJson(url, options = {}, timeoutMs = 0) {
    const controller = timeoutMs > 0 ? new AbortController() : null;
    const timeout = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
    try {
      const response = await fetchImpl(url, {
        ...options,
        ...(controller ? { signal: controller.signal } : {})
      });
      const text = await response.text();
      const payload = text ? parsePayload(text) : {};
      if (!response.ok) {
        throw new UploadAgentError(
          payload?.error || payload?.message || `Upload Agent trả về HTTP ${response.status}.`,
          { code: 'UPLOAD_AGENT_HTTP_ERROR', status: response.status }
        );
      }
      return payload;
    } catch (error) {
      if (error instanceof UploadAgentError) throw error;
      throw new UploadAgentError('Không thể kết nối Local Upload Agent.', {
        code: 'UPLOAD_AGENT_UNAVAILABLE'
      });
    } finally {
      if (timeout) clearTimeout(timeout);
    }
  }

  function requestAgent(path, options, timeoutMs) {
    return fetchJson(`${agentBaseUrl}${path}`, options, timeoutMs);
  }

  async function detect() {
    return requestAgent('/health', { method: 'GET' }, healthTimeoutMs);
  }

  async function pair() {
    const pairing = await fetchJson('/api/upload-agent/pair', { method: 'POST' });
    const code = pairing.code ?? pairing.pairingCode;
    if (!code) {
      throw new UploadAgentError('Máy chủ không trả về mã ghép cặp Upload Agent.');
    }
    return requestAgent('/pair', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code })
    });
  }

  async function selectFile() {
    const health = await detect();
    if (health.paired === false) await pair();
    try {
      return validateJob(await requestAgent('/select-file', { method: 'POST' }));
    } catch (error) {
      if (![401, 403].includes(error.status)) throw error;
      await pair();
      return validateJob(await requestAgent('/select-file', { method: 'POST' }));
    }
  }

  async function pollJob(jobId, { onProgress } = {}) {
    while (true) {
      const job = validateJob(await requestAgent(`/jobs/${encodeURIComponent(jobId)}`, { method: 'GET' }));
      onProgress?.(job);
      if (isCompleted(job)) {
        if (!job.mediaId) throw new UploadAgentError('Upload Agent hoàn tất nhưng thiếu Media ID.');
        return normalizeResult(job);
      }
      if (FAILED_STATUSES.has(normalizeStatus(job.status))) {
        throw new UploadAgentError(job.error || 'Upload qua Agent không thành công.', {
          code: 'UPLOAD_AGENT_JOB_FAILED'
        });
      }
      await sleepImpl(pollIntervalMs);
    }
  }

  async function upload({ clientId, onProgress } = {}) {
    const job = await selectFile();
    onProgress?.(job);
    rememberJob(storage, { id: job.id, clientId });
    try {
      const result = await pollJob(job.id, { onProgress });
      forgetJob(storage, job.id);
      return result;
    } catch (error) {
      if (error.code === 'UPLOAD_AGENT_JOB_FAILED') forgetJob(storage, job.id);
      throw error;
    }
  }

  async function reattach({ onProgress, onComplete, onError } = {}) {
    const entries = readJobs(storage);
    return Promise.all(entries.map(async (entry) => {
      try {
        const result = await pollJob(entry.id, {
          onProgress: (job) => onProgress?.({ ...entry, job })
        });
        forgetJob(storage, entry.id);
        const completion = { ...entry, result };
        await onComplete?.(completion);
        return completion;
      } catch (error) {
        if (error.code === 'UPLOAD_AGENT_JOB_FAILED') forgetJob(storage, entry.id);
        onError?.({ ...entry, error });
        return { ...entry, error };
      }
    }));
  }

  return { detect, pair, selectFile, pollJob, upload, reattach };
}

function parsePayload(text) {
  try {
    return JSON.parse(text);
  } catch {
    return { message: text };
  }
}

function validateJob(job) {
  if (!job?.id) throw new UploadAgentError('Upload Agent trả về job không hợp lệ.');
  return job;
}

function normalizeStatus(status) {
  return String(status ?? '').toLowerCase();
}

function isCompleted(job) {
  return Boolean(job.mediaId) || COMPLETED_STATUSES.has(normalizeStatus(job.status));
}

function normalizeResult(job) {
  const kind = job.kind || (/\.mp4$/i.test(job.name ?? '') ? 'video' : 'image');
  return {
    ...job,
    id: job.mediaId,
    mediaId: job.mediaId,
    kind,
    name: job.name ?? '',
    size: Math.max(0, Number(job.size) || 0),
    asset: job.asset ?? null
  };
}

function readJobs(storage) {
  if (!storage) return [];
  try {
    const entries = JSON.parse(storage.getItem(UPLOAD_AGENT_STORAGE_KEY) ?? '[]');
    return Array.isArray(entries)
      ? entries.filter((entry) => entry?.id && entry?.clientId)
      : [];
  } catch {
    return [];
  }
}

function writeJobs(storage, entries) {
  if (!storage) return;
  try {
    if (entries.length === 0) {
      storage.removeItem(UPLOAD_AGENT_STORAGE_KEY);
    } else {
      storage.setItem(UPLOAD_AGENT_STORAGE_KEY, JSON.stringify(entries));
    }
  } catch {
    // Storage is optional; the active tab can still follow the job.
  }
}

function rememberJob(storage, entry) {
  if (!entry.id || !entry.clientId) return;
  const entries = readJobs(storage).filter((candidate) => candidate.id !== entry.id);
  writeJobs(storage, [...entries, entry]);
}

function forgetJob(storage, jobId) {
  writeJobs(storage, readJobs(storage).filter((entry) => entry.id !== jobId));
}

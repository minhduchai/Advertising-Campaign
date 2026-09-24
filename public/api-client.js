// Tài nguyên chỉ tải lại khi người dùng bấm "Làm mới dữ liệu" hoặc khi tool tự sửa (CRUD) đúng loại đó.
const CACHED_GET_PREFIXES = [
  '/api/ad-account-resources',
  '/api/audience-templates',
  '/api/conversation-templates',
  '/api/seeding-templates',
  '/api/campaign-presets'
];
const API_CACHE_PREFIX = 'meta-campaign-builder:api-cache:v1:'; // tăng v khi đổi cấu trúc payload

export function createApiClient(fetchImpl = fetch, { storage = globalThis.localStorage } = {}) {
  const cachedPrefix = (url) => CACHED_GET_PREFIXES.find((prefix) => url === prefix || url.startsWith(`${prefix}?`) || url.startsWith(`${prefix}/`));
  const cacheRead = (url) => { try { return JSON.parse(storage?.getItem(API_CACHE_PREFIX + url)); } catch { return null; } };
  const cacheWrite = (url, payload) => { try { storage?.setItem(API_CACHE_PREFIX + url, JSON.stringify(payload)); } catch {} };
  const cacheDrop = (prefix = '') => {
    try {
      const keys = [];
      for (let index = 0; index < (storage?.length ?? 0); index += 1) keys.push(storage.key(index));
      for (const key of keys) if (key?.startsWith(API_CACHE_PREFIX + prefix)) storage.removeItem(key);
    } catch {}
  };
  const postJson = (body) => ({
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body)
  });
  const methodJson = (method, body) => ({ ...postJson(body), method });

  async function json(url, options) {
    const prefix = cachedPrefix(url);
    const isGet = !options?.method || options.method === 'GET';
    if (prefix && isGet) {
      const cached = cacheRead(url);
      if (cached) return cached;
    }
    const response = await fetchImpl(url, { ...options, cache: 'no-store', credentials: 'same-origin' });
    const payload = await readJson(response);
    if (!response.ok) {
      throw requestError(response.status, payload);
    }
    if (prefix) {
      if (isGet) cacheWrite(url, payload);
      else cacheDrop(prefix);
    }
    return payload;
  }

  return {
    clearCache: () => cacheDrop(),
    loadSession: () => json('/api/auth/session'),
    loadResources: () => json('/api/resources'),
    disconnectMeta: () => json('/api/auth/meta/disconnect', postJson({})),
    loadAdAccountResources: (adAccountId) => json(
      `/api/ad-account-resources?adAccountId=${encodeURIComponent(adAccountId)}`
    ),
    searchTargeting: (adAccountId, category, query) => json(
      `/api/targeting-search?adAccountId=${encodeURIComponent(adAccountId)}`
      + `&category=${encodeURIComponent(category)}`
      + `&query=${encodeURIComponent(query)}`
    ),
    searchLocations: (adAccountId, query, { includeAddresses = false } = {}) => json(
      `/api/location-search?adAccountId=${encodeURIComponent(adAccountId)}`
      + `&query=${encodeURIComponent(query)}`
      + (includeAddresses ? '&includeAddresses=1' : '')
    ),
    loadConversationTemplates: () => json('/api/conversation-templates'),
    createConversationTemplate: (body) => json(
      '/api/conversation-templates',
      postJson(body)
    ),
    updateConversationTemplate: (templateId, body) => json(
      `/api/conversation-templates/${encodeURIComponent(templateId)}`,
      methodJson('PUT', body)
    ),
    duplicateConversationTemplate: (templateId, body) => json(
      `/api/conversation-templates/${encodeURIComponent(templateId)}/duplicate`,
      postJson(body)
    ),
    setDefaultConversationTemplate: (templateId, body = {}) => json(
      `/api/conversation-templates/${encodeURIComponent(templateId)}/default`,
      postJson(body)
    ),
    deleteConversationTemplate: (templateId, body = {}) => json(
      `/api/conversation-templates/${encodeURIComponent(templateId)}`,
      methodJson('DELETE', body)
    ),
    loadAudienceTemplates: () => json('/api/audience-templates'),
    createAudienceTemplate: (body) => json('/api/audience-templates', postJson(body)),
    updateAudienceTemplate: (id, body) => json(
      `/api/audience-templates/${encodeURIComponent(id)}`,
      methodJson('PUT', body)
    ),
    duplicateAudienceTemplate: (id, body) => json(
      `/api/audience-templates/${encodeURIComponent(id)}/duplicate`,
      postJson(body)
    ),
    deleteAudienceTemplate: (id) => json(
      `/api/audience-templates/${encodeURIComponent(id)}`,
      methodJson('DELETE', {})
    ),
    loadSeedingTemplates: () => json('/api/seeding-templates'),
    createSeedingTemplate: (body) => json('/api/seeding-templates', postJson(body)),
    updateSeedingTemplate: (id, body) => json(
      `/api/seeding-templates/${encodeURIComponent(id)}`,
      methodJson('PUT', body)
    ),
    duplicateSeedingTemplate: (id, body) => json(
      `/api/seeding-templates/${encodeURIComponent(id)}/duplicate`,
      postJson(body)
    ),
    deleteSeedingTemplate: (id) => json(
      `/api/seeding-templates/${encodeURIComponent(id)}`,
      methodJson('DELETE', {})
    ),
    loadCampaignPresets: () => json('/api/campaign-presets'),
    createCampaignPreset: (body) => json('/api/campaign-presets', postJson(body)),
    updateCampaignPreset: (id, body) => json(
      `/api/campaign-presets/${encodeURIComponent(id)}`,
      methodJson('PUT', body)
    ),
    deleteCampaignPreset: (id) => json(
      `/api/campaign-presets/${encodeURIComponent(id)}`,
      methodJson('DELETE', {})
    ),
    validateDraft: (draft) => json('/api/drafts/validate', postJson(draft)),
    publishDraft: (draft, { onEvent } = {}) => publishDraftStream(draft, onEvent),
    listRuns: (options = {}) => {
      const params = new URLSearchParams();
      for (const key of ['from', 'to', 'limit', 'offset']) {
        if (options[key] !== undefined && options[key] !== null) params.set(key, String(options[key]));
      }
      const query = params.toString();
      return json(`/api/runs${query ? `?${query}` : ''}`);
    },
    loadRun: (runId) => json(`/api/runs/${encodeURIComponent(runId)}`),
    resumeRunWorkflow: (runId) => json(
      `/api/runs/${encodeURIComponent(runId)}/workflow/resume`,
      postJson({})
    ),
    retryFailedAd: (runId, clientId) => json(
      `/api/runs/${encodeURIComponent(runId)}/ads/${encodeURIComponent(clientId)}/retry`,
      postJson({})
    ),
    refreshRunPublications: (runId) => json(
      `/api/runs/${encodeURIComponent(runId)}/publications/refresh`,
      postJson({})
    ),
    prepareRunSeeding: (runId) => json(
      `/api/runs/${encodeURIComponent(runId)}/seeding/prepare`,
      postJson({})
    ),
    processNextSeeding: (runId) => json(
      `/api/runs/${encodeURIComponent(runId)}/seeding/next`,
      postJson({})
    ),
    loadRunSeeding: (runId) => json(`/api/runs/${encodeURIComponent(runId)}/seeding`),
    resolveSeedingConflict: (runId, body) => json(
      `/api/runs/${encodeURIComponent(runId)}/seeding/conflicts/resolve`,
      postJson(body)
    ),
    retrySeedingJob: (runId, jobId) => json(
      `/api/runs/${encodeURIComponent(runId)}/seeding/jobs/${encodeURIComponent(jobId)}/retry`,
      postJson({})
    ),
    confirmSeedingJob: (runId, jobId) => json(
      `/api/runs/${encodeURIComponent(runId)}/seeding/jobs/${encodeURIComponent(jobId)}/confirm`,
      postJson({})
    ),
    cancelRunSeeding: (runId) => json(
      `/api/runs/${encodeURIComponent(runId)}/seeding/cancel`,
      postJson({})
    ),
    resumeRunSeeding: (runId) => json(
      `/api/runs/${encodeURIComponent(runId)}/seeding/resume`,
      postJson({})
    ),
    createMultipartUpload: (body) => json('/api/r2-media/multipart/create', postJson(body)),
    presignMultipartPart: (body) => json('/api/r2-media/multipart/part', postJson(body)),
    completeMultipartUpload: (body) => json('/api/r2-media/multipart/complete', postJson(body)),
    abortMultipartUpload: (body) => json('/api/r2-media/multipart/abort', postJson(body)),
    mediaPreviewUrl: (mediaId) => `/api/media/${encodeURIComponent(mediaId)}/preview`,
    uploadAdMedia,
    uploadMedia
  };

  async function uploadAdMedia(file, _accountId, { onProgress } = {}) {
    const r2Upload = await tryR2Upload(file, onProgress);
    if (r2Upload) return r2Upload;
    throw new Error('R2 chưa sẵn sàng để nhận media; không thể tải media trực tiếp lên Meta');
  }

  async function tryR2Upload(file, onProgress, xhrFactory, purpose = 'ads') {
    const response = await fetchImpl('/api/r2-media/presign', postJson({
      name: file.name,
      mimeType: file.type,
      sizeBytes: file.size,
      purpose
    }));
    if (response.status === 404) return null;
    const signed = await readJson(response);
    if (!response.ok) throw requestError(response.status, signed);
    if (!signed?.enabled || !signed.uploadUrl || !signed.mediaId || !signed.key) return null;
    await uploadWithProgress(signed.uploadUrl, file, onProgress, xhrFactory);
    return json('/api/r2-media/complete', postJson({
      mediaId: signed.mediaId,
      key: signed.key,
      name: file.name,
      mimeType: file.type,
      sizeBytes: file.size,
      purpose
    }));
  }

  function uploadWithProgress(url, file, onProgress, xhrFactory = () => new XMLHttpRequest()) {
    return new Promise((resolve, reject) => {
      const xhr = xhrFactory();
      xhr.open('PUT', url);
      xhr.setRequestHeader('Content-Type', file.type);
      xhr.upload.onprogress = (event) => onProgress?.({
        loaded: event.loaded,
        total: event.lengthComputable ? event.total : file.size,
        percentage: Math.min(100, Math.round((event.loaded / file.size) * 100))
      });
      xhr.onload = () => xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`R2 upload failed (${xhr.status})`));
      xhr.onerror = () => reject(new Error('R2 upload failed'));
      xhr.send(file);
    });
  }

  async function publishDraftStream(draft, onEvent) {
    const response = await fetchImpl('/api/runs', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/x-ndjson'
      },
      body: JSON.stringify(draft)
    });
    if (!response.ok) {
      const payload = await readJson(response);
      throw requestError(response.status, payload);
    }

    const contentType = response.headers.get('content-type') ?? '';
    if (!contentType.toLowerCase().includes('application/x-ndjson')) {
      return readJson(response);
    }
    return readNdjson(response, onEvent);
  }

  async function uploadMedia(file, { mode, onProgress, xhrFactory, purpose = 'ads' } = {}) {
    if (mode === 'local') {
      if (onProgress) {
        return uploadLocalMedia(file, { onProgress, xhrFactory });
      }
      const formData = new FormData();
      formData.set('file', file);
      return json('/api/media', { method: 'POST', body: formData });
    }

    if (mode === 'r2') {
      const r2Upload = await tryR2Upload(file, onProgress, xhrFactory, purpose);
      if (!r2Upload) throw new Error('R2 chưa sẵn sàng để nhận media');
      return r2Upload;
    }

    throw new Error('Máy chủ chưa bật lưu trữ media');
  }
}

async function readNdjson(response, onEvent = () => {}) {
  const reader = response.body?.getReader();
  if (!reader) throw new Error('Trình duyệt không hỗ trợ theo dõi tiến độ trực tiếp');
  const decoder = new TextDecoder();
  let buffer = '';
  let runId = null;
  let startedRunId = null;
  let finalRun = null;

  try {
    while (true) {
      const { done, value } = await reader.read();
      buffer += decoder.decode(value ?? new Uint8Array(), { stream: !done });
      const lines = buffer.split('\n');
      buffer = done ? '' : lines.pop();
      for (const line of lines) {
        if (!line.trim()) continue;
        let event;
        try {
          event = JSON.parse(line);
        } catch {
          const error = new Error('Dữ liệu tiến độ từ máy chủ không hợp lệ');
          error.runId = runId;
          error.recoverable = false;
          throw error;
        }
        if (!isValidRunEvent(event)) throw malformedRunEventError(runId);
        if (event.type === 'run_started') {
          if (startedRunId) throw malformedRunEventError(runId);
        } else if (!startedRunId || event.runId !== startedRunId) {
          throw malformedRunEventError(runId);
        }
        runId = event.runId ?? runId;
        if (event.type === 'run_started') {
          startedRunId = event.runId ?? startedRunId;
        }
        onEvent(event);
        if (event.type === 'run_completed') {
          finalRun = { id: event.runId, status: event.status, nodes: event.nodes ?? [] };
        }
        if (event.type === 'run_failed') {
          const error = new Error(event.error?.message ?? 'Lượt tạo trên Meta thất bại');
          error.runId = runId;
          error.recoverable = false;
          throw error;
        }
      }
      if (done) break;
    }
  } catch (error) {
    if ('recoverable' in error) throw error;
    error.runId = runId;
    error.recoverable = Boolean(startedRunId && runId);
    throw error;
  }

  if (finalRun) return finalRun;
  const error = new Error('Kết nối theo dõi tiến độ đã bị gián đoạn');
  error.runId = runId;
  error.recoverable = Boolean(startedRunId && runId);
  throw error;
}

function isValidRunEvent(event) {
  if (!event || typeof event !== 'object' || Array.isArray(event)) return false;
  if (!isNonEmptyString(event.type) || !isNonEmptyString(event.runId)) return false;

  if (event.type === 'run_started') {
    return event.status === 'creating'
      && Number.isInteger(event.total)
      && event.total >= 0;
  }
  if (event.type === 'node_updated') {
    return isValidNodeUpdate(event.node);
  }
  if (event.type === 'run_completed') {
    return ['completed', 'completed_with_errors'].includes(event.status)
      && Array.isArray(event.nodes)
      && event.nodes.every(isValidCompletedNode);
  }
  if (event.type === 'run_failed') {
    return event.status === 'failed'
      && event.error
      && typeof event.error === 'object'
      && !Array.isArray(event.error)
      && isNonEmptyString(event.error.message);
  }
  return false;
}

function isValidCompletedNode(node) {
  return Boolean(
    isValidNodeUpdate(node)
    && ['created', 'failed', 'skipped'].includes(node.status)
  );
}

function isValidNodeUpdate(node) {
  return Boolean(
    node
    && typeof node === 'object'
    && !Array.isArray(node)
    && isNonEmptyString(node.clientId)
    && ['campaign', 'adSet', 'ad'].includes(node.type)
    && ['creating', 'created', 'failed', 'skipped'].includes(node.status)
  );
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function malformedRunEventError(runId) {
  const error = new Error('Dữ liệu tiến độ từ máy chủ sai cấu trúc');
  error.runId = runId;
  error.recoverable = false;
  return error;
}

function uploadLocalMedia(file, { onProgress, xhrFactory }) {
  const formData = new FormData();
  formData.set('file', file);
  return new Promise((resolve, reject) => {
    const createXhr = xhrFactory ?? (() => new globalThis.XMLHttpRequest());
    const xhr = createXhr();
    let lastPercentage = -1;
    const reportProgress = (loaded, total) => {
      if (!Number.isFinite(total) || total <= 0) return;
      const event = normalizedProgressEvent(loaded, total);
      if (event.percentage === lastPercentage) return;
      lastPercentage = event.percentage;
      onProgress(event);
    };

    xhr.open('POST', '/api/media');
    xhr.responseType = 'json';
    xhr.upload.addEventListener('progress', (event) => {
      if (event.lengthComputable) reportProgress(event.loaded, event.total);
    });
    xhr.addEventListener('load', () => {
      reportProgress(file.size, file.size);
      const payload = readXhrPayload(xhr);
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(payload);
        return;
      }
      reject(requestError(xhr.status, payload));
    });
    xhr.addEventListener('error', () => reject(new Error('Không thể tải tệp lên')));
    xhr.addEventListener('abort', () => reject(new Error('Đã hủy tải tệp')));
    xhr.addEventListener('timeout', () => reject(new Error('Tải tệp quá thời gian')));
    xhr.send(formData);
  });
}

function normalizedProgressEvent(loaded, total) {
  const safeLoaded = Math.max(0, Math.min(Number(loaded) || 0, total));
  return {
    loaded: safeLoaded,
    total,
    percentage: Math.round((safeLoaded / total) * 100)
  };
}

function readXhrPayload(xhr) {
  if (xhr.response && typeof xhr.response === 'object') return xhr.response;
  try {
    return JSON.parse(xhr.responseText || '{}');
  } catch {
    return {};
  }
}

function requestError(status, payload) {
  const message = payload.errors?.map((entry) => entry.message).join(' · ')
    ?? payload.message
    ?? payload.error
    ?? 'Yêu cầu thất bại';
  const error = new Error(message);
  error.status = status;
  error.payload = payload;
  return error;
}

async function readJson(response) {
  try {
    return await response.json();
  } catch {
    return {};
  }
}

import { AsyncLocalStorage } from 'node:async_hooks';
import { appendFileSync, mkdirSync, statSync, renameSync, rmSync } from 'node:fs';
import { createReadStream } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { createInterface } from 'node:readline';

const context = new AsyncLocalStorage();
const sanitizedErrors = new WeakMap();
let directory;
let configuredSecrets = [];
let monitoring = false;
const MAX_FILE_BYTES = 10 * 1024 * 1024;
const ARCHIVES = 3;
let responseWindow = 0;
let responseCount = 0;
let suppressedResponses = 0;
const fields = ['stage', 'requestId', 'ownerMetaUserId', 'runId', 'clientId', 'nodeType', 'nodeName',
  'method', 'host', 'path', 'statusCode', 'durationMs', 'headersDurationMs', 'attempt', 'retrying', 'networkCodes'];

export function configureErrorJournal(options = {}) {
  directory = options.directory;
  responseWindow = 0;
  responseCount = 0;
  suppressedResponses = 0;
  configuredSecrets = (options.secrets ?? []).filter(value => typeof value === 'string' && value.length >= 8);
  if (!monitoring && directory) {
    // Monitoring preserves Node's normal crash behavior; the synchronous append survives process exit.
    process.on('uncaughtExceptionMonitor', error => recordError(error, { stage: 'process' }));
    monitoring = true;
  }
}

export function withErrorContext(values, action) {
  return context.run({ ...context.getStore(), ...values }, action);
}

export function setErrorContext(values) {
  const current = context.getStore();
  if (current) Object.assign(current, values);
}

export function redactErrorText(value, secrets = []) {
  let text = String(value ?? '');
  for (const secret of [...configuredSecrets, ...secrets]) {
    if (typeof secret === 'string' && secret.length >= 4) text = text.split(secret).join('[đã che]');
  }
  return text
    .replace(/\b(?:https?|postgres(?:ql)?|redis):\/\/[^\s"'<>]+/gi, '[URL đã che]')
    .replace(/\b(Bearer|Basic)\s+[^\s,;"'}]+/gi, '$1 [đã che]')
    .replace(/((?:access_token|refresh_token|client_secret|password|authorization|api_key)\s*["']?\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\s,;&"'}]+)/gi, '$1[đã che]');
}

function serializeError(error, secrets, depth = 0) {
  if (depth > 4) return { message: 'Chuỗi lỗi quá sâu; xem stack của lỗi cha.' };
  if (!error || typeof error !== 'object') return { message: redactErrorText(error, secrets).slice(0, 4000) };
  if (sanitizedErrors.has(error)) return sanitizedErrors.get(error);
  const result = {};
  for (const key of ['name', 'type', 'message', 'stack', 'code', 'subcode', 'error_subcode', 'fbtraceId',
    'fbtrace_id', 'syscall', 'address', 'port', 'statusCode', 'retryAfterMs', 'reconciliation']) {
    const value = error[key];
    if (typeof value === 'string') result[key] = redactErrorText(value, secrets).slice(0, 4000);
    else if (typeof value === 'number' || typeof value === 'boolean') result[key] = value;
  }
  if (error.cause) result.cause = serializeError(error.cause, secrets, depth + 1);
  if (Array.isArray(error.errors)) result.errors = error.errors.slice(0, 20).map(value => serializeError(value, secrets, depth + 1));
  if (error.meta) result.meta = serializeError(error.meta, secrets, depth + 1);
  return result;
}

function filePath(ownerMetaUserId) {
  if (!directory) return null;
  const key = ownerMetaUserId ? createHash('sha256').update(String(ownerMetaUserId)).digest('hex') : 'system';
  return join(directory, `${key}.jsonl`);
}

export function recordError(error, values = {}, secrets = []) {
  const current = { ...context.getStore(), ...values };
  // Bound anonymous/client-error disk traffic globally, without an attacker-controlled key map.
  let suppressed = 0;
  if (current.stage === 'api-response' && current.statusCode >= 400 && current.statusCode < 500) {
    const window = Math.floor(Date.now() / 60_000);
    if (window !== responseWindow) {
      responseWindow = window;
      responseCount = 0;
      suppressed = suppressedResponses;
      suppressedResponses = 0;
    }
    if (++responseCount > 60) {
      suppressedResponses++;
      return {};
    }
  }
  const privateValues = [...(current.secrets ?? []), ...secrets];
  const event = { id: randomUUID(), at: new Date().toISOString() };
  if (suppressed) event.suppressedClientErrors = suppressed;
  for (const key of fields) {
    const value = current[key];
    if (typeof value === 'string') event[key] = redactErrorText(value, privateValues).slice(0, 500);
    else if (typeof value === 'number' || typeof value === 'boolean') event[key] = value;
    else if (key === 'networkCodes' && Array.isArray(value)) event[key] = value.map(code => redactErrorText(code, privateValues));
  }
  event.error = serializeError(error, privateValues);
  if (error && typeof error === 'object') sanitizedErrors.set(error, event.error);
  if (error?.diagnosticId) event.causedBy = error.diagnosticId;
  try {
    const path = filePath(current.ownerMetaUserId);
    if (path) {
      if (error && typeof error === 'object' && Object.isExtensible(error) && !error.diagnosticId) error.diagnosticId = event.id;
      mkdirSync(directory, { recursive: true, mode: 0o700 });
      const line = JSON.stringify(event) + '\n';
      let size = 0;
      try { size = statSync(path).size; } catch (error) { if (error.code !== 'ENOENT') throw error; }
      if (size && size + Buffer.byteLength(line) > MAX_FILE_BYTES) {
        rmSync(`${path}.${ARCHIVES}`, { force: true });
        for (let index = ARCHIVES - 1; index >= 0; index--) {
          try { renameSync(index ? `${path}.${index}` : path, `${path}.${index + 1}`); }
          catch (error) { if (error.code !== 'ENOENT') throw error; }
        }
      }
      // ponytail: append synchronously only on errors; use a queue if error volume affects request latency.
      appendFileSync(path, line, { mode: 0o600 });
    }
  } catch {
    // Logging must never turn a successful Meta write into a failed write that gets replayed.
    console.error('[error-journal-write-failed]', JSON.stringify(event));
  }
  return event;
}

export async function* iterateErrorJournal({ ownerMetaUserId, runId }) {
  const path = filePath(ownerMetaUserId);
  if (!path) return;
  for (let index = ARCHIVES; index >= 0; index--) {
    yield* iterateFile(index ? `${path}.${index}` : path, runId);
  }
}

async function* iterateFile(path, runId) {
  const input = createReadStream(path, { encoding: 'utf8' });
  const lines = createInterface({ input, crlfDelay: Infinity });
  try {
    // ponytail: scans one account's error file; index by run if error history becomes large.
    for await (const line of lines) {
      if (!line.trim()) continue;
      let event;
      try { event = JSON.parse(line); } catch { yield { unreadable: true }; continue; }
      if (runId && event.runId !== runId) continue;
      yield { event };
    }
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  } finally {
    lines.close();
    input.destroy();
  }
}

export async function readErrorJournal(options) {
  const events = [];
  let total = 0;
  let unreadableLines = 0;
  for await (const item of iterateErrorJournal(options)) {
    if (item.unreadable) { unreadableLines++; continue; }
    total++;
    events.push(item.event);
    if (events.length > (options.limit ?? 200)) events.shift();
  }
  return { events: events.reverse(), total, unreadableLines };
}

const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));

function codesFrom(error) {
  if (!error || typeof error !== 'object') return [];
  return [error.code, error.subcode, ...codesFrom(error.cause), ...codesFrom(error.meta),
    ...(error.errors ?? []).flatMap(codesFrom)].filter(value => value != null);
}

function errorHint(event) {
  const codes = new Set([...(event.networkCodes ?? []), ...codesFrom(event.error)]);
  if (codes.has('EAI_AGAIN') || codes.has('ENOTFOUND')) return 'Kiểm tra DNS trên máy chủ: chưa phân giải được địa chỉ máy chủ đích.';
  if (codes.has('UND_ERR_CONNECT_TIMEOUT') || codes.has('ETIMEDOUT')) return 'Kiểm tra đường kết nối và giới hạn thời gian chờ; xem syscall trong lỗi gốc để biết timeout xảy ra ở bước nào.';
  if (codes.has('ENETUNREACH') || codes.has('EHOSTUNREACH') || codes.has('ECONNREFUSED')) return 'Kiểm tra đường mạng, địa chỉ đích và tường lửa: kết nối chưa mở được.';
  if (codes.has('ECONNRESET') || codes.has('UND_ERR_SOCKET')) return 'Kết nối bị đóng giữa chừng. Kiểm tra đối tượng trên Meta trước khi gửi lại lệnh tạo để tránh trùng.';
  if (codes.has(190)) return 'Kiểm tra phiên kết nối Meta và quyền truy cập; có thể cần kết nối lại tài khoản.';
  if ([4, 17, 32, 613].some(code => codes.has(code))) return 'Kiểm tra hạn mức Meta và thời gian chờ trước khi thử lại.';
  return 'Đọc mã lỗi, chuỗi nguyên nhân và stack bên dưới; với lỗi Meta, giữ mã truy vết để đối chiếu.';
}

export function renderErrorJournal(report, downloadUrl) {
  return `<!doctype html><html lang="vi"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Nhật ký lỗi</title><style>body{font:16px/1.6 system-ui;margin:0;background:#f5f7fb;color:#17233b}main{max-width:1000px;margin:32px auto;padding:0 20px}article{background:white;border:1px solid #dce2ec;border-radius:12px;padding:20px;margin:16px 0}h1,h2{line-height:1.3}h2{font-size:18px}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#f5f7fb;padding:16px}small{color:#53627a}a{color:#175bd7}dt{font-weight:600}dd{margin:0 0 8px;overflow-wrap:anywhere}summary{cursor:pointer}</style><main>
  <h1>Nhật ký lỗi</h1><p>Lưu cả lỗi đã thử lại thành công. Thời gian hiển thị theo giờ Việt Nam. Token và mật khẩu được che.</p>
  <p>${report.total} bản ghi; hiển thị ${report.events.length} bản ghi mới nhất. <a href="${escape(downloadUrl)}">Tải toàn bộ nhật ký JSONL</a></p>
  ${report.unreadableLines ? '<p role="alert">Có dòng nhật ký không đọc được; cần kiểm tra file trên máy chủ.</p>' : ''}
  ${report.events.length ? report.events.map(event => `<article><small>${escape(new Date(event.at).toLocaleString('vi-VN', { timeZone: 'Asia/Bangkok' }))} · ${escape(event.stage)}</small>
    <h2>${escape(event.error?.meta?.message ?? event.error?.message ?? 'Lỗi không có thông báo')}</h2>
    <p><strong>Hướng kiểm tra:</strong> ${escape(errorHint(event))}</p>
    <dl>${[['Lượt chạy', event.runId], ['Đối tượng', event.nodeName ?? event.clientId], ['Mã nhật ký', event.id], ['Yêu cầu', event.method ? `${event.method} ${event.host ?? ''}${event.path ?? ''}` : null], ['Thời gian chờ', event.durationMs != null ? `${event.durationMs} ms` : null], ['Lần gọi', event.attempt], ['Thử lại', event.retrying == null ? null : event.retrying ? 'Sẽ thử lại' : 'Không tự gửi lại']].filter(([, value]) => value != null).map(([label, value]) => `<dt>${escape(label)}</dt><dd>${escape(value)}</dd>`).join('')}</dl>
    <details><summary>Chi tiết kỹ thuật và chuỗi nguyên nhân</summary><pre>${escape(JSON.stringify(event, null, 2))}</pre></details></article>`).join('') : '<p>Chưa ghi nhận lỗi trong phạm vi này từ khi bật nhật ký.</p>'}
  <p>Nhật ký ghi dữ liệu quan sát được; một lỗi mạng vẫn có thể cần kiểm tra thêm để xác định nguyên nhân. Lỗi xảy ra trước khi bật cơ chế này có thể không có chuỗi nguyên nhân gốc.</p>
  </main></html>`;
}

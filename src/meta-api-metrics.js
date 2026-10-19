import { appendFileSync, mkdirSync, statSync, renameSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { parseUsageHeaders } from './meta-rate-limiter.js';

// Bounded request metadata only; bodies, query strings, tokens and post names never reach this file.
export function recordMetaApiCall(errorDirectory, { input, options, response, error, startedAt, attempt }) {
  if (!errorDirectory) return;
  try {
    const target = new URL(input);
    const path = join(dirname(errorDirectory), 'meta-api-calls.jsonl');
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    let size = 0;
    try { size = statSync(path).size; } catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (size >= 5 * 1024 * 1024) {
      rmSync(`${path}.3`, { force: true });
      for (let i = 2; i >= 0; i--) {
        try { renameSync(i ? `${path}.${i}` : path, `${path}.${i + 1}`); }
        catch (error) { if (error.code !== 'ENOENT') throw error; }
      }
    }
    appendFileSync(path, JSON.stringify({ at: new Date().toISOString(), method: options.method ?? 'GET',
      endpoint: target.pathname.split('/').map(part => !part || /^v\d+\.\d+$/.test(part)
        || /^(me|accounts|permissions|businesses|owned_pages|client_pages|promote_pages|adaccounts|campaigns|adsets|ads|adcreatives|advideos|adimages|comments|customaudiences|saved_audiences|search|photos|feed)$/.test(part)
        ? part : /^act_\d+$/.test(part) ? 'act_:id' : ':id').join('/'),
      accountId: /\/act_(\d+)/.exec(target.pathname)?.[1] ?? null,
      status: response?.status ?? null, durationMs: Date.now() - startedAt, attempt,
      usage: response ? parseUsageHeaders(response.headers) : null,
      networkError: Boolean(error)
    }) + '\n', { mode: 0o600 });
  } catch {
    // Telemetry must never change the outcome of a Meta write.
  }
}

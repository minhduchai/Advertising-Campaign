import { mkdir, readdir, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const MAX_CONCURRENCY = 3;
// Chưa có header usage (mới khởi động, nghỉ >10 phút, hoặc endpoint không trả header) thì chạy 2 luồng thay vì tuần tự.
const UNKNOWN_USAGE_CONCURRENCY = 2;
const HEADER_MAX_AGE_MS = 10 * 60_000;

// `cooldowns` (createSharedCooldowns) shares pauses with the other processes on this host.
export function createMetaRateLimiter({ now = Date.now, cooldowns = null } = {}) {
  let usage = null;
  let usageAt = 0;
  let concurrency = MAX_CONCURRENCY;
  let recoverBelow = -Infinity;
  let nextStartAt = 0;
  let forcedPauseUntil = 0;
  let active = 0;

  return {
    async acquire(signal, url) {
      const scopes = requestScopes(url);
      while (true) {
        if (signal?.aborted) throw signal.reason ?? new DOMException('The operation was aborted', 'AbortError');
        const sharedUntil = cooldowns ? await cooldowns.until(scopes) : 0;
        const waitMs = Math.max(0, nextStartAt - now(), forcedPauseUntil - now(), sharedUntil - now());
        if (waitMs > 60_000) throw throttleError(waitMs);
        if (active < effectiveConcurrency() && waitMs === 0) {
          active += 1;
          const policy = policyForUsage(currentUsage(), now());
          nextStartAt = now() + policy.delayMs;
          return () => {
            active = Math.max(0, active - 1);
          };
        }
        await wait(Math.max(1, waitMs || 50), signal);
      }
    },

    async observe(response, url) {
      const nextUsage = parseUsageHeaders(response?.headers);
      if (nextUsage !== null) {
        const previous = usage;
        usage = nextUsage;
        usageAt = now();
        const nextPolicy = policyForUsage(nextUsage, usageAt);
        if (nextPolicy.concurrency < concurrency) {
          concurrency = nextPolicy.concurrency;
          recoverBelow = Math.max(nextUsage - 10, 0);
        } else if (nextPolicy.concurrency > concurrency && nextUsage <= recoverBelow) {
          concurrency = nextPolicy.concurrency;
          if (concurrency === MAX_CONCURRENCY) recoverBelow = -Infinity;
        }
        if (previous === null && nextPolicy.concurrency < MAX_CONCURRENCY) {
          recoverBelow = Math.max(nextUsage - 10, 0);
        }
        if (nextPolicy.delayMs > 0) nextStartAt = Math.max(nextStartAt, now() + nextPolicy.delayMs);
        if (nextPolicy.pauseMs > 0) forcedPauseUntil = Math.max(forcedPauseUntil, now() + nextPolicy.pauseMs);
      }
      if (!cooldowns) return;
      for (const [scope, value] of scopedUsage(response?.headers, accountScope(url))) {
        const { pauseMs } = policyForUsage(value, now());
        if (pauseMs > 0) await cooldowns.extend(scope, now() + pauseMs);
      }
    },

    async recordThrottle(retryAfterMs, { url, code, headers } = {}) {
      const waitMs = Math.max(0, Number(retryAfterMs) || 0);
      concurrency = 1;
      recoverBelow = Math.max((usage ?? 100) - 10, 0);
      forcedPauseUntil = Math.max(forcedPauseUntil, now() + waitMs);
      if (!cooldowns) return;
      for (const scope of throttleScopes(url, code, headers)) await cooldowns.extend(scope, now() + waitMs);
    },

    status() {
      const current = currentUsage();
      const policy = policyForUsage(current, now());
      return {
        usage: current,
        concurrency: effectiveConcurrency(),
        delayMs: policy.delayMs,
        pausedUntil: forcedPauseUntil > now() ? forcedPauseUntil : null,
        stale: usage === null || now() - usageAt > HEADER_MAX_AGE_MS
      };
    }
  };

  function currentUsage() {
    return usage !== null && now() - usageAt <= HEADER_MAX_AGE_MS ? usage : null;
  }

  function effectiveConcurrency() {
    if (currentUsage() === null) return UNKNOWN_USAGE_CONCURRENCY;
    return Math.min(concurrency, policyForUsage(currentUsage(), now()).concurrency);
  }

  function wait(milliseconds, signal) {
    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        signal?.removeEventListener('abort', onAbort);
        resolve();
      };
      const timer = setTimeout(finish, milliseconds);
      timer.unref?.();
      const onAbort = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);
        reject(signal.reason ?? new DOMException('The operation was aborted', 'AbortError'));
      };
      if (signal) signal.addEventListener('abort', onAbort, { once: true });
    });
  }
}

function throttleError(retryAfterMs) {
  const error = new Error('Đang chờ hạn mức Meta');
  error.name = 'MetaThrottleError';
  error.statusCode = 429;
  error.retryable = true;
  error.retryAfterMs = retryAfterMs;
  return error;
}

// ponytail: files beside the shared read cache coordinate the web server and cron workers on one host;
// move this to a shared store if workers ever run on several hosts.
export function createSharedCooldowns(directory) {
  if (!directory) return null;
  // Each pause is its own immutable file named by scope and expiry, so concurrent writers keep the longest
  // pause (never last-writer-wins) and a later low-usage response cannot clear one that is still active.
  // A subdirectory keeps these few files apart from the read cache entries, so a check is one small readdir.
  const markers = join(directory, 'cooldowns');
  const marker = (scope, expiry) => `${scope.replace(':', '-')}-${expiry}.json`;
  return {
    async until(scopes) {
      let names = [];
      try {
        names = await readdir(markers);
      } catch {}
      let until = 0;
      for (const name of names) {
        const expiry = Number(/-(\d+)\.json$/.exec(name)?.[1]);
        if (!(expiry > 0)) continue;
        if (expiry <= Date.now()) await unlink(join(markers, name)).catch(() => {});
        else if (scopes.some((scope) => name === marker(scope, expiry))) until = Math.max(until, expiry);
      }
      return until;
    },
    async extend(scope, until) {
      if (!Number.isFinite(until) || until <= Date.now()) return;
      try {
        await mkdir(markers, { recursive: true, mode: 0o700 });
        await writeFile(join(markers, marker(scope, Math.ceil(until))), '', { mode: 0o600, flag: 'wx' });
      } catch {
        // Best effort: this process still enforces its own pause when the shared file cannot be written.
      }
    }
  };
}

function accountScope(url) {
  let pathname = '';
  try {
    pathname = new URL(String(url)).pathname;
  } catch {}
  const accountId = /\/act_(\d+)(?:\/|$)/.exec(pathname)?.[1];
  return accountId ? `account:${accountId}` : null;
}

function requestScopes(url) {
  const account = accountScope(url);
  return account ? ['app', account] : ['app'];
}

// x-app-usage measures the whole app, x-ad-account-usage the requested ad account, and
// x-business-use-case-usage the business objects it names.
function scopedUsage(headers, account) {
  const usageByScope = new Map();
  const add = (scope, value) => {
    if (scope && value !== null) usageByScope.set(scope, Math.max(usageByScope.get(scope) ?? 0, value));
  };
  add('app', parseUsageValue(headers?.get?.('x-app-usage')));
  add(account, parseUsageValue(headers?.get?.('x-ad-account-usage')));
  for (const [id, entries] of businessUseCaseUsage(headers)) {
    const numbers = usageNumbers(entries);
    add(`account:${id}`, numbers.length ? Math.max(...numbers) : null);
  }
  return usageByScope;
}

// Code 4 is the app-wide limit. Other limits are shared only when a header or the URL names the ad
// account; anything else stays a pause for this process alone.
function throttleScopes(url, code, headers) {
  if (Number(code) === 4) return ['app'];
  const scopes = new Set([accountScope(url)]);
  for (const [id, entries] of businessUseCaseUsage(headers)) {
    if ([entries].flat().some((entry) => Number(entry?.estimated_time_to_regain_access) > 0)) scopes.add(`account:${id}`);
  }
  scopes.delete(null);
  return [...scopes];
}

function businessUseCaseUsage(headers) {
  try {
    return Object.entries(JSON.parse(headers?.get?.('x-business-use-case-usage'))).filter(([id]) => /^\d+$/.test(id));
  } catch {
    return [];
  }
}

export function parseUsageHeaders(headers) {
  const values = [
    parseUsageValue(headers?.get?.('x-app-usage')),
    parseUsageValue(headers?.get?.('x-ad-account-usage')),
    parseUsageValue(headers?.get?.('x-business-use-case-usage'))
  ].filter((value) => value !== null);
  return values.length ? Math.max(...values) : null;
}

export function policyForUsage(usage, timestamp = Date.now()) {
  if (usage === null || timestamp === undefined) return { concurrency: UNKNOWN_USAGE_CONCURRENCY, delayMs: 0, pauseMs: 0 };
  if (usage >= 95) return { concurrency: 1, delayMs: 0, pauseMs: 120_000 };
  if (usage >= 85) return { concurrency: 1, delayMs: 0, pauseMs: 30_000 };
  if (usage >= 70) return { concurrency: 1, delayMs: 2_000, pauseMs: 0 };
  if (usage >= 50) return { concurrency: 2, delayMs: 500, pauseMs: 0 };
  return { concurrency: MAX_CONCURRENCY, delayMs: 0, pauseMs: 0 };
}

function parseUsageValue(raw) {
  if (!raw) return null;
  try {
    const numbers = usageNumbers(JSON.parse(raw));
    return numbers.length ? Math.max(...numbers) : null;
  } catch {
    return null;
  }
}

function usageNumbers(value) {
  if (!value || typeof value !== 'object') return [];
  if (Array.isArray(value)) return value.flatMap(usageNumbers);
  const numbers = [];
  for (const [key, child] of Object.entries(value)) {
    if ((['call_count', 'total_cputime', 'total_time'].includes(key) || /_pct$/.test(key)) && Number.isFinite(Number(child))) {
      numbers.push(Number(child));
    } else if (typeof child === 'object') {
      numbers.push(...usageNumbers(child));
    }
  }
  return numbers;
}

const MAX_CONCURRENCY = 5;
// Chưa có header usage (mới khởi động, nghỉ >10 phút, hoặc endpoint không trả header) thì chạy 2 luồng thay vì tuần tự.
const UNKNOWN_USAGE_CONCURRENCY = 2;
const HEADER_MAX_AGE_MS = 10 * 60_000;

export function createMetaRateLimiter({ now = Date.now } = {}) {
  let usage = null;
  let usageAt = 0;
  let concurrency = MAX_CONCURRENCY;
  let recoverBelow = -Infinity;
  let nextStartAt = 0;
  let forcedPauseUntil = 0;
  let active = 0;

  return {
    async acquire(signal) {
      while (true) {
        if (signal?.aborted) throw signal.reason ?? new DOMException('The operation was aborted', 'AbortError');
        const waitMs = Math.max(0, nextStartAt - now(), forcedPauseUntil - now());
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

    observe(response) {
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
    },

    recordThrottle(retryAfterMs) {
      const waitMs = Math.max(0, Number(retryAfterMs) || 0);
      concurrency = 1;
      recoverBelow = Math.max((usage ?? 100) - 10, 0);
      forcedPauseUntil = Math.max(forcedPauseUntil, now() + waitMs);
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

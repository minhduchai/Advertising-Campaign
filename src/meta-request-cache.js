const DEFAULT_MAX_ENTRIES = 1000;

export function createMetaRequestCache({ now = Date.now, maxEntries = DEFAULT_MAX_ENTRIES } = {}) {
  const entries = new Map();
  const pending = new Map();

  function prune() {
    const currentTime = now();
    for (const [key, entry] of entries) {
      if (entry.expiresAt <= currentTime) entries.delete(key);
    }
    const overflow = entries.size - maxEntries;
    if (overflow <= 0) return;
    const oldestKeys = [...entries.entries()]
      .sort((left, right) => left[1].expiresAt - right[1].expiresAt)
      .slice(0, overflow)
      .map(([key]) => key);
    for (const key of oldestKeys) entries.delete(key);
  }

  async function load(key, ttlMs, loader) {
    prune();
    const cached = entries.get(key);
    if (cached && cached.expiresAt > now()) return cached.value;
    if (pending.has(key)) return pending.get(key);

    const request = Promise.resolve()
      .then(loader)
      .then((value) => {
        entries.set(key, { value, expiresAt: now() + ttlMs });
        prune();
        return value;
      })
      .finally(() => pending.delete(key));
    pending.set(key, request);
    return request;
  }

  function invalidatePrefix(prefix) {
    for (const key of entries.keys()) {
      if (key.startsWith(prefix)) entries.delete(key);
    }
    for (const key of pending.keys()) {
      if (key.startsWith(prefix)) pending.delete(key);
    }
  }

  return { load, invalidatePrefix };
}

import { createHash, randomUUID } from 'node:crypto';
import { mkdir, open, readFile, writeFile, rename, unlink, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { encryptToken, decryptToken } from './crypto.js';
import { createMetaRequestCache } from './meta-request-cache.js';

// ponytail: one hosted server; move to a shared store if workers span hosts.
export function createMetaReadCache({ directory, encryptionKey, now = Date.now }) {
  const memory = createMetaRequestCache({ now });
  return {
    async load(identity, ttlMs, loader) {
      const key = createHash('sha256').update(identity).digest('hex');
      const loadEntry = async () => {
        if (!directory) return { value: await loader(), expiresAt: now() + ttlMs };
        await mkdir(directory, { recursive: true, mode: 0o700 });
        const path = join(directory, `${key}.json`);
        const read = async () => {
          let ciphertext;
          try {
            ciphertext = await readFile(path, 'utf8');
          } catch (error) {
            if (error.code !== 'ENOENT') throw error;
            return null;
          }
          try {
            const entry = JSON.parse(decryptToken(ciphertext, encryptionKey));
            return entry.expiresAt > now() ? entry : null;
          } catch {
            return null;
          }
        };
        const cached = await read();
        if (cached) return cached;
        const lockPath = `${path}.lock`;
        const waitingUntil = Date.now() + 15_000;
        let lock;
        while (!lock) {
          try {
            lock = await open(lockPath, 'wx', 0o600);
          } catch (error) {
            if (error.code !== 'EEXIST') throw error;
            const ready = await read();
            if (ready) return ready;
            // Loaders have a 60-second timeout; recover locks left by killed cron jobs.
            const info = await stat(lockPath).catch(error => {
              if (error.code !== 'ENOENT') throw error;
              return null;
            });
            if (info && Date.now() - info.mtimeMs > 120_000) {
              await unlink(lockPath).catch(error => { if (error.code !== 'ENOENT') throw error; });
            }
            if (Date.now() >= waitingUntil) {
              const busy = new Error('Meta resource refresh is already running');
              Object.assign(busy, { name: 'MetaThrottleError', statusCode: 429, retryable: true, retryAfterMs: 15_000 });
              throw busy;
            }
            await sleep(100);
          }
        }
        const temporary = `${path}.${randomUUID()}.tmp`;
        try {
          const ready = await read();
          if (ready) return ready;
          const value = await loader();
          const entry = { expiresAt: now() + ttlMs, value };
          const encrypted = encryptToken(JSON.stringify(entry), encryptionKey);
          await writeFile(temporary, encrypted, { mode: 0o600 });
          await rename(temporary, path);
          return entry;
        } finally {
          await lock.close();
          await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; });
          await unlink(lockPath).catch(error => { if (error.code !== 'ENOENT') throw error; });
        }
      };
      let entry = await memory.load(key, ttlMs, loadEntry);
      if (entry.expiresAt <= now()) {
        memory.invalidatePrefix(key);
        entry = await memory.load(key, ttlMs, loadEntry);
      }
      return structuredClone(entry.value);
    }
  };
}

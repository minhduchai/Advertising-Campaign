import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';

export function createAccessControl(config) {
  const admins = new Set(config.accessAdminMetaUserIds ?? []);
  const labelsPath = `${config.accessControlFile}.labels.json`;
  function labels() {
    try {
      const data = JSON.parse(readFileSync(labelsPath, 'utf8'));
      if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Invalid access labels file');
      return data;
    } catch (error) {
      if (error.code === 'ENOENT') return {};
      throw error;
    }
  }
  function save(path, data) {
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    const temporary = `${path}.${randomUUID()}.tmp`;
    writeFileSync(temporary, JSON.stringify(data), { mode: 0o600, flag: 'wx' });
    renameSync(temporary, path);
  }
  function list() {
    try {
      const ids = JSON.parse(readFileSync(config.accessControlFile, 'utf8'));
      if (!Array.isArray(ids) || !ids.every(id => typeof id === 'string' && /^\d{1,40}$/.test(id))) {
        throw new Error('Invalid access control file');
      }
      return ids;
    } catch (error) {
      if (error.code === 'ENOENT') return [];
      throw error;
    }
  }
  return {
    enabled: admins.size > 0,
    isAdmin: id => admins.has(String(id ?? '')),
    allows(id) {
      return admins.size === 0 || admins.has(String(id ?? '')) || list().includes(String(id ?? ''));
    },
    list() {
      const notes = labels();
      return [...new Set([...admins, ...list()])].map(id => ({ id, admin: admins.has(id),
        label: notes[id]?.label ?? '', facebookUrl: notes[id]?.facebookUrl ?? '' }));
    },
    update(id, allowed, details = {}) {
      if (typeof id !== 'string' || !/^\d{1,40}$/.test(id) || typeof allowed !== 'boolean' || admins.has(id)) {
        const error = new Error('ID không hợp lệ hoặc là tài khoản quản trị.');
        error.statusCode = 400;
        error.expose = true;
        throw error;
      }
      const ids = new Set(list());
      if (details.label !== undefined || details.facebookUrl !== undefined) {
        if (details.label !== undefined && (typeof details.label !== 'string' || details.label.length > 80)) {
          throw invalidInput('Tên gợi nhớ tối đa 80 ký tự.');
        }
        const notes = labels();
        notes[id] = { label: details.label === undefined ? notes[id]?.label ?? '' : details.label.trim(),
          facebookUrl: details.facebookUrl === undefined ? notes[id]?.facebookUrl ?? '' : facebookProfileUrl(details.facebookUrl) };
        save(labelsPath, notes);
      }
      allowed ? ids.add(id) : ids.delete(id);
      // shortcut: one app process writes this small allowlist; use DB transactions before running multiple web instances.
      save(config.accessControlFile, [...ids]);
    }
  };
}

function invalidInput(message) {
  return Object.assign(new Error(message), { statusCode: 400, expose: true });
}

function facebookProfileUrl(value) {
  if (typeof value !== 'string' || value.length > 2048) throw invalidInput('Link Facebook không hợp lệ.');
  const text = value.trim();
  if (!text) return '';
  if (/^\d{1,40}$/.test(text)) return `https://www.facebook.com/profile.php?id=${text}`;
  let url;
  try { url = new URL(text); } catch { throw invalidInput('Nhập link hồ sơ Facebook đầy đủ hoặc ID Facebook.'); }
  if (url.protocol !== 'https:' || !['facebook.com', 'www.facebook.com', 'm.facebook.com'].includes(url.hostname)
    || url.username || url.password || url.port) throw invalidInput('Chỉ nhận link hồ sơ https://www.facebook.com/.');
  if (url.pathname === '/profile.php' && /^\d{1,40}$/.test(url.searchParams.get('id') ?? '')) {
    return `https://www.facebook.com/profile.php?id=${url.searchParams.get('id')}`;
  }
  if (/^\/[a-zA-Z0-9.]+\/?$/.test(url.pathname) && !/\.php\/?$/.test(url.pathname)) {
    return `https://www.facebook.com${url.pathname.replace(/\/$/, '')}`;
  }
  throw invalidInput('Link phải dẫn tới hồ sơ Facebook cá nhân.');
}

export function sendAccessNotFound(response) {
  response.writeHead(404, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'private, no-store',
    'content-security-policy': "default-src 'none'; frame-ancestors 'none'; base-uri 'none'" });
  response.end('<!doctype html><html lang="vi"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>404 — Không tìm thấy trang</title><h1>404 — Không tìm thấy trang</h1><p>Trang này không tồn tại hoặc hiện không khả dụng.</p></html>');
}

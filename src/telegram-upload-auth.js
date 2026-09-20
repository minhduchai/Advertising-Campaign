import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

const TOKEN_PAYLOAD_BYTES = 28;
const TOKEN_SIGNATURE_BYTES = 12;
const TOKEN_BYTES = TOKEN_PAYLOAD_BYTES + TOKEN_SIGNATURE_BYTES;
const DEFAULT_TTL_MS = 60 * 60 * 1000;

export function createTelegramUploadAuth({ secret, now = Date.now, ttlMs = DEFAULT_TTL_MS } = {}) {
  if (!String(secret ?? '')) throw new TypeError('Telegram upload auth requires a secret');

  return {
    createIntent(ownerMetaUserId) {
      const ownerId = normalizeOwnerId(ownerMetaUserId);
      const expiresAt = now() + ttlMs;
      const payload = Buffer.alloc(TOKEN_PAYLOAD_BYTES);
      randomBytes(16).copy(payload, 0);
      payload.writeBigUInt64BE(BigInt(ownerId), 16);
      payload.writeUInt32BE(Math.floor(expiresAt / 1000), 24);
      const code = Buffer.concat([payload, signature(payload, secret)]).toString('base64url');
      return {
        code,
        mediaId: payload.subarray(0, 16).toString('hex'),
        ownerMetaUserId: ownerId,
        expiresAt
      };
    },

    verifyIntent(code) {
      let token;
      try {
        token = Buffer.from(String(code ?? ''), 'base64url');
      } catch {
        return null;
      }
      if (token.length !== TOKEN_BYTES) return null;
      const payload = token.subarray(0, TOKEN_PAYLOAD_BYTES);
      const providedSignature = token.subarray(TOKEN_PAYLOAD_BYTES);
      const expectedSignature = signature(payload, secret);
      if (!timingSafeEqual(expectedSignature, providedSignature)) return null;
      const expiresAt = payload.readUInt32BE(24) * 1000;
      if (expiresAt <= now()) return null;
      return {
        code: String(code),
        mediaId: payload.subarray(0, 16).toString('hex'),
        ownerMetaUserId: payload.readBigUInt64BE(16).toString(),
        expiresAt
      };
    }
  };
}

function signature(payload, secret) {
  return createHmac('sha256', secret).update('telegram-upload:').update(payload).digest().subarray(0, TOKEN_SIGNATURE_BYTES);
}

function normalizeOwnerId(value) {
  const normalized = String(value ?? '').trim();
  if (!/^\d{1,20}$/.test(normalized)) throw new TypeError('Telegram upload requires a numeric Meta user ID');
  const ownerId = BigInt(normalized);
  if (ownerId < 1n || ownerId > 0xffffffffffffffffn) throw new TypeError('Meta user ID is out of range');
  return ownerId.toString();
}

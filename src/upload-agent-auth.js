import {
  createHash,
  createHmac,
  randomBytes,
  randomUUID,
  timingSafeEqual
} from 'node:crypto';

const PAIRING_CODE_TTL_MS = 10 * 60 * 1000;
const TOKEN_PREFIX = 'uat_v1';

export function createUploadAgentAuth({ database, secret, now = Date.now } = {}) {
  if (!database) throw new TypeError('Upload agent auth requires a database');
  if (!String(secret ?? '')) throw new TypeError('Upload agent auth requires a secret');

  return {
    async createPairingCode(ownerMetaUserId) {
      const ownerId = requiredString(ownerMetaUserId, 'ownerMetaUserId');
      const createdAt = now();
      const code = randomBytes(9).toString('base64url');
      const expiresAt = createdAt + PAIRING_CODE_TTL_MS;
      await database.createUploadAgentPairingCode({
        codeHash: pairingCodeHash(code, secret),
        ownerMetaUserId: ownerId,
        expiresAt,
        createdAt
      });
      return { code, expiresAt };
    },

    async exchangePairingCode(code, deviceInput) {
      const device = normalizeDevice(deviceInput);
      const pairing = await database.consumeUploadAgentPairingCode(
        pairingCodeHash(requiredString(code, 'code'), secret),
        now()
      );
      if (!pairing) throw authError('Pairing code is invalid or expired');

      const deviceId = randomUUID();
      const createdAt = now();
      const token = createDeviceToken({
        ownerMetaUserId: pairing.ownerMetaUserId,
        deviceId,
        issuedAt: createdAt,
        nonce: randomBytes(18).toString('base64url')
      }, secret);
      const stored = await database.saveUploadAgentDevice({
        id: deviceId,
        ownerMetaUserId: pairing.ownerMetaUserId,
        tokenHash: hashToken(token),
        device,
        createdAt
      });
      return {
        token,
        ownerMetaUserId: stored.ownerMetaUserId,
        device: publicDevice(stored)
      };
    },

    async authenticateAgentToken(token) {
      const payload = verifyDeviceToken(token, secret);
      if (!payload) return null;

      const stored = await database.getUploadAgentDevice(payload.ownerMetaUserId, payload.deviceId);
      if (!stored || stored.revokedAt !== null || !sameHash(stored.tokenHash, hashToken(token))) return null;
      return {
        ownerMetaUserId: stored.ownerMetaUserId,
        device: publicDevice(stored)
      };
    }
  };
}

function createDeviceToken({ ownerMetaUserId, deviceId, issuedAt, nonce }, secret) {
  const payload = Buffer.from(JSON.stringify({
    ownerMetaUserId,
    deviceId,
    issuedAt,
    nonce
  })).toString('base64url');
  const unsigned = `${TOKEN_PREFIX}.${payload}`;
  return `${unsigned}.${sign(unsigned, secret)}`;
}

function verifyDeviceToken(token, secret) {
  if (typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 3 || parts[0] !== TOKEN_PREFIX) return null;
  const unsigned = `${parts[0]}.${parts[1]}`;
  if (!sameValue(sign(unsigned, secret), parts[2])) return null;

  try {
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    if (!String(payload.ownerMetaUserId ?? '') || !String(payload.deviceId ?? '')) return null;
    if (!Number.isSafeInteger(payload.issuedAt) || !String(payload.nonce ?? '')) return null;
    return payload;
  } catch {
    return null;
  }
}

function pairingCodeHash(code, secret) {
  return createHmac('sha256', secret).update(`pairing:${code}`).digest('hex');
}

function hashToken(token) {
  return createHash('sha256').update(token).digest('hex');
}

function sign(value, secret) {
  return createHmac('sha256', secret).update(value).digest('base64url');
}

function sameHash(expected, provided) {
  return /^[a-f0-9]{64}$/.test(String(expected)) && sameValue(expected, provided);
}

function sameValue(expected, provided) {
  const expectedBuffer = Buffer.from(String(expected));
  const providedBuffer = Buffer.from(String(provided));
  return expectedBuffer.length === providedBuffer.length && timingSafeEqual(expectedBuffer, providedBuffer);
}

function normalizeDevice(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new TypeError('device must be an object');
  }
  const device = { name: boundedString(input.name, 'device.name', 120) };
  for (const field of ['platform', 'version']) {
    if (input[field] !== undefined) device[field] = boundedString(input[field], `device.${field}`, 64);
  }
  return device;
}

function boundedString(value, field, maximumLength) {
  const normalized = requiredString(value, field);
  if (normalized.length > maximumLength) throw new TypeError(`${field} must be at most ${maximumLength} characters`);
  return normalized;
}

function requiredString(value, field) {
  const normalized = typeof value === 'string' ? value.trim() : '';
  if (!normalized) throw new TypeError(`${field} is required`);
  return normalized;
}

function publicDevice(stored) {
  return {
    id: stored.id,
    ...stored.device,
    createdAt: stored.createdAt
  };
}

function authError(message) {
  const error = new Error(message);
  error.statusCode = 401;
  error.expose = true;
  return error;
}

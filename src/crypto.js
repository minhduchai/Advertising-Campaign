import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
  timingSafeEqual
} from 'node:crypto';

export function encryptToken(token, key) {
  const initializationVector = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, initializationVector);
  const ciphertext = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()]);
  const authenticationTag = cipher.getAuthTag();

  return JSON.stringify({
    iv: initializationVector.toString('base64'),
    ciphertext: ciphertext.toString('base64'),
    tag: authenticationTag.toString('base64')
  });
}

export function decryptToken(value, key) {
  const payload = JSON.parse(value);
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(payload.iv, 'base64'));
  decipher.setAuthTag(Buffer.from(payload.tag, 'base64'));
  return Buffer.concat([
    decipher.update(Buffer.from(payload.ciphertext, 'base64')),
    decipher.final()
  ]).toString('utf8');
}

export function signSession(sessionId, secret) {
  return `${sessionId}.${createSignature(sessionId, secret)}`;
}

export function verifySession(value, secret) {
  const separatorIndex = value?.lastIndexOf('.') ?? -1;
  if (separatorIndex <= 0) {
    return null;
  }

  const sessionId = value.slice(0, separatorIndex);
  const signature = value.slice(separatorIndex + 1);
  const expectedSignature = createSignature(sessionId, secret);
  const signatureBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expectedSignature);

  if (signatureBuffer.length !== expectedBuffer.length || !timingSafeEqual(signatureBuffer, expectedBuffer)) {
    return null;
  }

  return sessionId;
}

function createSignature(value, secret) {
  return createHmac('sha256', secret).update(value).digest('base64url');
}

import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

export const WORKFLOW_SIGNATURE_VERSION = 'v1';
export const WORKFLOW_MAX_CLOCK_SKEW_MS = 5 * 60 * 1000;

export function signWorkflowRequest({ method = 'POST', pathname, timestamp, nonce, body = '' }, secret) {
  assertSecret(secret);
  return createHmac('sha256', secret)
    .update(canonicalWorkflowRequest({ method, pathname, timestamp, nonce, body }))
    .digest('hex');
}

export function verifyWorkflowRequest(input, secret, {
  now = Date.now(),
  maxClockSkewMs = WORKFLOW_MAX_CLOCK_SKEW_MS,
  hasNonce = () => false,
  rememberNonce = () => {}
} = {}) {
  assertSecret(secret);
  const timestamp = Number(input.timestamp);
  if (!Number.isFinite(timestamp) || Math.abs(now - timestamp) > maxClockSkewMs) {
    return { valid: false, reason: 'expired' };
  }
  if (!String(input.nonce ?? '') || hasNonce(String(input.nonce))) {
    return { valid: false, reason: 'replay' };
  }
  const expected = signWorkflowRequest(input, secret);
  const provided = String(input.signature ?? '').toLowerCase();
  if (!sameHex(expected, provided)) return { valid: false, reason: 'signature' };
  rememberNonce(String(input.nonce), timestamp + maxClockSkewMs);
  return { valid: true };
}

export function workflowAuthHeaders({ method = 'POST', pathname, body = '', now = Date.now(), nonce }, secret) {
  const timestamp = String(now);
  const requestNonce = String(nonce ?? cryptoRandomNonce());
  return {
    'x-workflow-version': WORKFLOW_SIGNATURE_VERSION,
    'x-workflow-timestamp': timestamp,
    'x-workflow-nonce': requestNonce,
    'x-workflow-signature': signWorkflowRequest({ method, pathname, timestamp, nonce: requestNonce, body }, secret)
  };
}

export function workflowAuthInput(request, pathname, body = '') {
  return {
    method: request.method,
    pathname,
    timestamp: request.headers['x-workflow-timestamp'],
    nonce: request.headers['x-workflow-nonce'],
    signature: request.headers['x-workflow-signature'],
    body
  };
}

function canonicalWorkflowRequest({ method, pathname, timestamp, nonce, body }) {
  const bodyHash = createHash('sha256').update(String(body)).digest('hex');
  return [
    WORKFLOW_SIGNATURE_VERSION,
    String(method).toUpperCase(),
    String(pathname),
    String(timestamp),
    String(nonce),
    bodyHash
  ].join('\n');
}

function sameHex(expected, provided) {
  if (!/^[a-f0-9]{64}$/.test(provided)) return false;
  return timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(provided, 'hex'));
}

function assertSecret(secret) {
  if (!String(secret ?? '')) throw new Error('WORKFLOW_SHARED_SECRET is required');
}

function cryptoRandomNonce() {
  return globalThis.crypto.randomUUID();
}

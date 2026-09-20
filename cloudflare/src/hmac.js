const encoder = new TextEncoder();

export const SIGNATURE_HEADERS = Object.freeze({
  timestamp: "x-workflow-timestamp",
  nonce: "x-workflow-nonce",
  signature: "x-workflow-signature",
});

export async function sha256Hex(value) {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(value));
  return bytesToHex(new Uint8Array(digest));
}

export async function signRequest({ secret, method, pathname, timestamp, nonce, body = "" }) {
  if (!secret) throw new Error("WORKFLOW_SHARED_SECRET chưa được cấu hình.");

  const bodyHash = await sha256Hex(body);
  const canonical = ["v1", method.toUpperCase(), pathname, String(timestamp), nonce, bodyHash].join("\n");
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(canonical));
  return bytesToHex(new Uint8Array(signature));
}

export async function signedHeaders({ secret, method, pathname, body = "", timestamp, nonce }) {
  const resolvedTimestamp = timestamp ?? Date.now();
  const resolvedNonce = nonce ?? crypto.randomUUID();
  const signature = await signRequest({
    secret,
    method,
    pathname,
    timestamp: resolvedTimestamp,
    nonce: resolvedNonce,
    body,
  });

  return {
    [SIGNATURE_HEADERS.timestamp]: String(resolvedTimestamp),
    [SIGNATURE_HEADERS.nonce]: resolvedNonce,
    [SIGNATURE_HEADERS.signature]: signature,
  };
}

export async function verifySignedRequest(request, secret, options = {}) {
  const timestamp = request.headers.get(SIGNATURE_HEADERS.timestamp);
  const nonce = request.headers.get(SIGNATURE_HEADERS.nonce);
  const signature = request.headers.get(SIGNATURE_HEADERS.signature);
  if (!timestamp || !nonce || !signature) return { ok: false, reason: "missing_signature" };

  const now = options.now ?? Date.now();
  const maxAgeMs = options.maxAgeMs ?? 300_000;
  const numericTimestamp = Number(timestamp);
  if (!Number.isFinite(numericTimestamp) || Math.abs(now - numericTimestamp) > maxAgeMs) {
    return { ok: false, reason: "expired_signature" };
  }

  const body = await request.clone().text();
  const pathname = new URL(request.url).pathname;
  const expected = await signRequest({
    secret,
    method: request.method,
    pathname,
    timestamp,
    nonce,
    body,
  });
  return { ok: timingSafeEqual(expected, signature.toLowerCase()), reason: "invalid_signature" };
}

function bytesToHex(bytes) {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function timingSafeEqual(left, right) {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return difference === 0;
}

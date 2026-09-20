import assert from "node:assert/strict";
import test from "node:test";
import { SIGNATURE_HEADERS, signRequest, verifySignedRequest } from "../src/hmac.js";

test("ký HMAC theo canonical contract", async () => {
  const signature = await signRequest({
    secret: "test-secret",
    method: "post",
    pathname: "/runs",
    timestamp: 1_700_000_000_000,
    nonce: "nonce-1",
    body: '{"runId":"run-1"}',
  });

  assert.equal(signature, "54274cf2c164dee1264303f9581d376ac4bfae98957524bee2c9a290b0adcdfe");
});

test("xác minh request hợp lệ và từ chối body bị sửa", async () => {
  const secret = "test-secret";
  const timestamp = 1_700_000_000_000;
  const nonce = "nonce-1";
  const body = '{"runId":"run-1"}';
  const signature = await signRequest({ secret, method: "POST", pathname: "/runs", timestamp, nonce, body });
  const headers = {
    "content-type": "application/json",
    [SIGNATURE_HEADERS.timestamp]: String(timestamp),
    [SIGNATURE_HEADERS.nonce]: nonce,
    [SIGNATURE_HEADERS.signature]: signature,
  };

  const valid = await verifySignedRequest(new Request("https://worker.example/runs", { method: "POST", headers, body }), secret, { now: timestamp });
  assert.equal(valid.ok, true);

  const invalid = await verifySignedRequest(new Request("https://worker.example/runs", { method: "POST", headers, body: '{"runId":"run-2"}' }), secret, { now: timestamp });
  assert.equal(invalid.ok, false);
});

test("từ chối chữ ký quá hạn", async () => {
  const request = new Request("https://worker.example/runs", {
    method: "POST",
    headers: {
      [SIGNATURE_HEADERS.timestamp]: "1000",
      [SIGNATURE_HEADERS.nonce]: "nonce",
      [SIGNATURE_HEADERS.signature]: "00",
    },
  });
  const result = await verifySignedRequest(request, "secret", { now: 400_001, maxAgeMs: 300_000 });
  assert.deepEqual(result, { ok: false, reason: "expired_signature" });
});

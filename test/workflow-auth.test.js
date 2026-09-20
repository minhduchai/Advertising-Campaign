import test from 'node:test';
import assert from 'node:assert/strict';
import { signWorkflowRequest, verifyWorkflowRequest } from '../src/workflow-auth.js';

test('workflow signature verifies an unchanged request once', () => {
  const input = { method: 'POST', pathname: '/runs', timestamp: 1_000, nonce: 'n-1', body: '{"runId":"1"}' };
  input.signature = signWorkflowRequest(input, 'secret');
  const used = new Set();
  const options = { now: 1_000, hasNonce: (nonce) => used.has(nonce), rememberNonce: (nonce) => used.add(nonce) };
  assert.deepEqual(verifyWorkflowRequest(input, 'secret', options), { valid: true });
  assert.equal(verifyWorkflowRequest(input, 'secret', options).reason, 'replay');
});

test('workflow signature rejects changed body and expired timestamp', () => {
  const input = { method: 'POST', pathname: '/runs', timestamp: 1_000, nonce: 'n-2', body: '{}' };
  input.signature = signWorkflowRequest(input, 'secret');
  assert.equal(verifyWorkflowRequest({ ...input, body: '{"changed":true}' }, 'secret', { now: 1_000 }).reason, 'signature');
  assert.equal(verifyWorkflowRequest(input, 'secret', { now: 400_001 }).reason, 'expired');
});

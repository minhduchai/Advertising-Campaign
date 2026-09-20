import test from 'node:test';
import assert from 'node:assert/strict';
import {
  decryptToken,
  encryptToken,
  signSession,
  verifySession
} from '../src/crypto.js';

const key = Buffer.alloc(32, 11);
const differentKey = Buffer.alloc(32, 12);

test('encrypts a Meta token so it cannot be read without the correct key', () => {
  const encrypted = encryptToken('EAAG-test-token', key);

  assert.notEqual(encrypted, 'EAAG-test-token');
  assert.equal(decryptToken(encrypted, key), 'EAAG-test-token');
  assert.throws(() => decryptToken(encrypted, differentKey));
});

test('rejects session cookies whose signature does not match', () => {
  const signed = signSession('session-123', 'session-secret');

  assert.equal(verifySession(signed, 'session-secret'), 'session-123');
  assert.equal(verifySession(`${signed}changed`, 'session-secret'), null);
});

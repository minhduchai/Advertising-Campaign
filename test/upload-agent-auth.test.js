import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createDatabase } from '../src/db.js';
import { createUploadAgentAuth } from '../src/upload-agent-auth.js';

const SECRET = 'upload-agent-test-secret';

test('pairing codes expire after ten minutes and can be exchanged only once', async () => {
  const database = createDatabase(':memory:');
  let currentTime = 1_000;
  const auth = createUploadAgentAuth({ database, secret: SECRET, now: () => currentTime });

  try {
    const pairing = await auth.createPairingCode('owner-a');
    assert.equal(pairing.expiresAt, 601_000);

    const exchanged = await auth.exchangePairingCode(pairing.code, {
      name: 'Studio PC',
      platform: 'win32',
      version: '1.0.0'
    });
    assert.equal(exchanged.ownerMetaUserId, 'owner-a');
    assert.equal(exchanged.device.name, 'Studio PC');
    assert.match(exchanged.token, /^uat_v1\./);

    await assert.rejects(
      auth.exchangePairingCode(pairing.code, { name: 'Second PC' }),
      /invalid or expired/i
    );
  } finally {
    database.close();
  }
});

test('expired pairing codes cannot issue a device token', async () => {
  const database = createDatabase(':memory:');
  let currentTime = 5_000;
  const auth = createUploadAgentAuth({ database, secret: SECRET, now: () => currentTime });

  try {
    const pairing = await auth.createPairingCode('owner-a');
    currentTime = pairing.expiresAt;

    await assert.rejects(
      auth.exchangePairingCode(pairing.code, { name: 'Late PC' }),
      /invalid or expired/i
    );
  } finally {
    database.close();
  }
});

test('authentication rejects a stored token whose HMAC signature is forged', async () => {
  const database = createDatabase(':memory:');
  const auth = createUploadAgentAuth({ database, secret: SECRET, now: () => 10_000 });
  const payload = Buffer.from(JSON.stringify({
    ownerMetaUserId: 'owner-a',
    deviceId: 'forged-device',
    issuedAt: 10_000,
    nonce: 'forged-nonce'
  })).toString('base64url');
  const forgedToken = `uat_v1.${payload}.forged-signature`;

  try {
    await database.saveUploadAgentDevice({
      id: 'forged-device',
      ownerMetaUserId: 'owner-a',
      tokenHash: createHash('sha256').update(forgedToken).digest('hex'),
      device: { name: 'Forged PC' },
      createdAt: 10_000
    });

    assert.equal(await auth.authenticateAgentToken(forgedToken), null);
  } finally {
    database.close();
  }
});

test('device tokens are stored only as hashes and owner-scoped revocation invalidates authentication', async () => {
  const database = createDatabase(':memory:');
  const auth = createUploadAgentAuth({ database, secret: SECRET, now: () => 10_000 });

  try {
    const pairing = await auth.createPairingCode('owner-a');
    const exchanged = await auth.exchangePairingCode(pairing.code, { name: 'Upload PC' });
    const stored = await database.getUploadAgentDevice('owner-a', exchanged.device.id);

    assert.equal(stored.tokenHash, createHash('sha256').update(exchanged.token).digest('hex'));
    assert.equal(Object.hasOwn(stored, 'token'), false);
    assert.equal(JSON.stringify(stored).includes(exchanged.token), false);
    assert.equal(await database.getUploadAgentDevice('owner-b', exchanged.device.id), null);
    assert.equal(await database.revokeUploadAgentDevice('owner-b', exchanged.device.id, 11_000), false);
    assert.equal((await auth.authenticateAgentToken(exchanged.token)).ownerMetaUserId, 'owner-a');
    const tamperedToken = `${exchanged.token.slice(0, -1)}${exchanged.token.endsWith('A') ? 'B' : 'A'}`;
    assert.equal(await auth.authenticateAgentToken(tamperedToken), null);
    assert.equal(await database.revokeUploadAgentDevice('owner-a', exchanged.device.id, 12_000), true);
    assert.equal(await auth.authenticateAgentToken(exchanged.token), null);
  } finally {
    database.close();
  }
});

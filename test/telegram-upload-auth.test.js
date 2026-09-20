import assert from 'node:assert/strict';
import test from 'node:test';

import { createTelegramUploadAuth } from '../src/telegram-upload-auth.js';

test('creates a Telegram deep-link-safe intent and verifies its owner and media ID', () => {
  const auth = createTelegramUploadAuth({ secret: 'test-secret', now: () => 1_000 });
  const intent = auth.createIntent('1643641244');

  assert.match(intent.code, /^[A-Za-z0-9_-]{54}$/);
  assert.ok(`app_${intent.code}`.length <= 64);
  assert.match(intent.mediaId, /^[a-f0-9]{32}$/);
  assert.deepEqual(auth.verifyIntent(intent.code), intent);
});

test('rejects expired or modified Telegram upload intents', () => {
  let currentTime = 1_000;
  const auth = createTelegramUploadAuth({ secret: 'test-secret', now: () => currentTime, ttlMs: 5_000 });
  const intent = auth.createIntent('1643641244');

  const replacement = intent.code.startsWith('A') ? 'B' : 'A';
  assert.equal(auth.verifyIntent(`${replacement}${intent.code.slice(1)}`), null);
  currentTime = 6_001;
  assert.equal(auth.verifyIntent(intent.code), null);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { createMetaClient } from '../src/meta-client.js';

for (const payload of [{}, { id: null }, { id: '' }]) {
  test(`successful HTTP response without Ad ID is uncertain: ${JSON.stringify(payload)}`, async () => {
    let calls = 0;
    const client = createMetaClient({ apiVersion: 'v23.0' }, {
      fetchImpl: async () => { calls++; return Response.json(payload); }
    });
    await assert.rejects(client.createAd('fake', 'act_1', new URLSearchParams()), { name: 'UncertainAdWriteError' });
    assert.equal(calls, 1);
  });
}

for (const code of ['ECONNREFUSED', 'UND_ERR_CONNECT_TIMEOUT', 'EAI_AGAIN', 'ENOTFOUND', 'ECONNRESET', 'UND_ERR_SOCKET', 'UND_ERR_HEADERS_TIMEOUT']) {
  test(`network write retry is limited to pre-connect failures: ${code}`, async () => {
    let calls = 0;
    const waits = [];
    const client = createMetaClient({ apiVersion: 'v23.0' }, {
      fetchImpl: async () => { calls++; throw new TypeError('fetch failed', { cause: { code } }); },
      networkRetryDelay: async ms => waits.push(ms)
    });
    await assert.rejects(client.createAd('token', 'act_1', new URLSearchParams()), /fetch failed/);
    const preConnect = ['ECONNREFUSED', 'UND_ERR_CONNECT_TIMEOUT', 'EAI_AGAIN', 'ENOTFOUND'].includes(code);
    assert.equal(calls, preConnect ? 3 : 1);
    assert.deepEqual(waits, preConnect ? [1000, 3000] : []);
  });
}

test('reconciliation requires matching creative and refuses incomplete pages', async () => {
  let paginated = false;
  const client = createMetaClient({ apiVersion: 'v23.0' }, {
    fetchImpl: async () => Response.json({ data: [
      { id: 'wrong', name: 'Ad', creative: { id: 'other' } },
      { id: 'right', name: 'Ad', creative: { id: 'creative' } }
    ], ...(paginated ? { paging: { next: 'next' } } : {}) })
  });
  const matches = await client.findCreatedObject('token', 'parent', 'ads', 'Ad', { creativeId: 'creative' });
  assert.deepEqual(matches.map(row => row.id), ['right']);
  paginated = true;
  await assert.rejects(client.findCreatedObject('token', 'parent', 'ads', 'Ad', { creativeId: 'creative' }), /incomplete/);
});

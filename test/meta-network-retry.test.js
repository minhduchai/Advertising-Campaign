import test from 'node:test';
import assert from 'node:assert/strict';
import { createMetaClient } from '../src/meta-client.js';

for (const method of ['createCampaign', 'createAdSet', 'createCreative']) {
  for (const body of ['{}', '{broken', 'null', '[]']) test(`${method} rejects missing IDs and malformed responses without replay`, async () => {
    let calls = 0;
    const client = createMetaClient({ apiVersion: 'v24.0' }, { fetchImpl: async () => { calls++; return new Response(body); } });
    await assert.rejects(client[method]('fake', 'act_1', new URLSearchParams()), error => error.uncertainWrite === true);
    assert.equal(calls, 1);
  });
}

test('the request timeout aborts a stalled write without replaying it', async () => {
  let calls = 0;
  const client = createMetaClient({ apiVersion: 'v24.0', metaRequestTimeoutMs: 20 }, {
    fetchImpl: async (_url, { signal }) => {
      calls++;
      return new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }));
    }
  });
  const keepAlive = setTimeout(() => {}, 1000);
  try {
    await assert.rejects(client.createCampaign('fake', 'act_1', new URLSearchParams()), error => error.uncertainWrite === true);
    assert.equal(calls, 1);
  } finally { clearTimeout(keepAlive); }
});

test('cancellation before dispatch is safe and is not reported as an uncertain write', async () => {
  const controller = new AbortController();
  controller.abort();
  const client = createMetaClient({ apiVersion: 'v24.0' }, { fetchImpl: async () => assert.fail('must not send') });
  await assert.rejects(client.createCampaign('fake', 'act_1', new URLSearchParams(), { signal: controller.signal }),
    error => error.name === 'AbortError' && !error.uncertainWrite);
});

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
    assert.equal(calls, preConnect ? 2 : 1);
    assert.deepEqual(waits, preConnect ? [1000] : []);
  });
}

for (const [causes, safe] of [
  [[{ code: 'ENETUNREACH' }, { code: 'ETIMEDOUT', syscall: 'connect' }], true],
  [[{ code: 'EHOSTUNREACH' }], true],
  [[{ code: 'ETIMEDOUT', syscall: 'read' }], false],
  [[{ code: 'ENETUNREACH' }, { code: 'ECONNRESET' }], false],
  [[{ code: 'ENETUNREACH' }, {}], false]
]) test(`aggregate connection failures retry once only if every connection failed before sending: ${JSON.stringify(causes)}`, async () => {
  let calls = 0;
  const waits = [];
  const client = createMetaClient({ apiVersion: 'v23.0' }, {
    fetchImpl: async () => {
      calls++;
      if (calls === 1) throw new TypeError('fetch failed', { cause: new AggregateError(causes) });
      return Response.json({ id: 'campaign' });
    },
    networkRetryDelay: async ms => waits.push(ms)
  });
  const publish = () => client.createCampaign('private-token', 'act_1', new URLSearchParams());
  if (safe) assert.equal(await publish(), 'campaign');
  else await assert.rejects(publish, /fetch failed/);
  assert.equal(calls, safe ? 2 : 1);
  assert.deepEqual(waits, safe ? [1000] : []);
});

test('cancelling a network retry never sends a second write', async () => {
  const controller = new AbortController();
  let calls = 0;
  const client = createMetaClient({ apiVersion: 'v23.0' }, {
    fetchImpl: async () => { calls++; throw new TypeError('fetch failed', { cause: { code: 'ENOTFOUND' } }); },
    networkRetryDelay: async () => controller.abort()
  });
  await assert.rejects(client.createCampaign('fake', 'act_1', new URLSearchParams(), { signal: controller.signal }));
  assert.equal(calls, 1);
});

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

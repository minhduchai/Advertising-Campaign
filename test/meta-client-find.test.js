import test from 'node:test';
import assert from 'node:assert/strict';
import { createMetaClient } from '../src/meta-client.js';

function clientReturning(data, requests = []) {
  return createMetaClient({ apiVersion: 'v25.0' }, {
    fetchImpl: async (url, options = {}) => {
      requests.push({ url: new URL(String(url)), options });
      return Response.json({ data });
    }
  });
}

test('findCreatedObject looks up objects by exact name under the parent and keeps only recent ones', async () => {
  const requests = [];
  const client = clientReturning([
    { id: '1', name: 'Ad 1', created_time: '2026-09-21T10:30:00+0000' },
    { id: '2', name: 'Ad 1', created_time: '2026-09-01T10:30:00+0000' },
    { id: '3', name: 'Ad 10', created_time: '2026-09-21T10:31:00+0000' }
  ], requests);

  const matches = await client.findCreatedObject('EAAG-token', 'adset_9', 'ads', 'Ad 1', {
    sinceMs: Date.parse('2026-09-21T00:00:00+0000')
  });

  assert.deepEqual(matches.map((match) => match.id), ['1']);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url.pathname, '/v25.0/adset_9/ads');
  assert.equal(requests[0].url.searchParams.get('fields'), 'id,name,created_time');
  assert.deepEqual(JSON.parse(requests[0].url.searchParams.get('filtering')), [{ field: 'name', operator: 'EQUAL', value: 'Ad 1' }]);
  assert.equal(requests[0].options.headers.authorization, 'Bearer EAAG-token');
});

test('findCreatedObject returns every exact match when no time bound is given and rejects unknown edges', async () => {
  const client = clientReturning([{ id: '1', name: 'A' }, { id: '2', name: 'A' }, { id: '3', name: 'B' }]);
  const matches = await client.findCreatedObject('token', 'act_1', 'campaigns', 'A');
  assert.deepEqual(matches.map((match) => match.id), ['1', '2']);
  await assert.rejects(() => client.findCreatedObject('token', 'act_1', 'adcreatives', 'A'), /không hợp lệ/);
});

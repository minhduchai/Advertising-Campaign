import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from '../src/server.js';
import { encryptToken, signSession } from '../src/crypto.js';
import { request, testConfig } from './helpers.js';

const region = { key: '3984', name: 'Hồ Chí Minh', type: 'region', countryCode: 'VN' };
const address = {
  key: 'pin:10.842861,106.763027', name: 'Đặng Văn Bi', type: 'custom_location',
  countryCode: 'VN', latitude: 10.8428609, longitude: 106.7630268, source: 'OpenStreetMap'
};

function setup(context, { searchLocations, searchAddresses, connected = true } = {}) {
  const config = testConfig();
  const server = createServer({
    config,
    db: {
      createSession: () => ({ id: 'new-session' }),
      getSession: () => ({ id: 'session-user', metaUserId: connected ? 'meta-user-1' : null }),
      getConnection: () => ({ accessTokenCiphertext: encryptToken('secret-token', config.tokenEncryptionKey) })
    },
    metaClient: { searchLocations: searchLocations ?? (async () => [region]) },
    addressGeocoder: { search: searchAddresses ?? (async () => [address]) }
  });
  context.after(() => server.close());
  const headers = { cookie: `meta_ads_session=${encodeURIComponent(signSession('session-user', config.sessionSecret))}` };
  return (params = '', query = 'Đặng Văn Bi, Hồ Chí Minh') => request(server, `/api/location-search?adAccountId=act_1&query=${encodeURIComponent(query)}${params}`, { headers });
}

test('only searches addresses after explicit opt-in and caches repeated searches separately', async (context) => {
  let metaCalls = 0;
  let addressCalls = 0;
  const search = setup(context, {
    searchLocations: async (token) => {
      assert.equal(token, 'secret-token');
      metaCalls += 1;
      return [region];
    },
    searchAddresses: async (...args) => {
      assert.deepEqual(args, ['Đặng Văn Bi, Hồ Chí Minh']);
      addressCalls += 1;
      return [address];
    }
  });
  assert.deepEqual((await search()).body, { results: [region] });
  assert.equal(addressCalls, 0);
  assert.deepEqual((await search('&includeAddresses=1')).body, { results: [region, address] });
  assert.deepEqual((await search('&includeAddresses=1')).body, { results: [region, address] });
  assert.equal(metaCalls, 1);
  assert.equal(addressCalls, 1);
});

test('keeps Meta locations when address service fails and retries the failed source', async (context) => {
  let calls = 0;
  const search = setup(context, {
    searchAddresses: async () => {
      calls += 1;
      if (calls === 1) throw new Error('timeout');
      return [address];
    }
  });
  const first = await search('&includeAddresses=1');
  assert.equal(first.status, 200);
  assert.deepEqual(first.body.results, [region]);
  assert.match(first.body.warnings[0], /Chưa tải được địa chỉ/);
  assert.deepEqual((await search('&includeAddresses=1')).body, { results: [region, address] });
  assert.equal(calls, 2);
});

test('keeps usable address results when Meta location search temporarily fails', async (context) => {
  const search = setup(context, { searchLocations: async () => { throw new Error('Meta timeout'); } });
  const result = await search('&includeAddresses=1');
  assert.equal(result.status, 200);
  assert.deepEqual(result.body.results, [address]);
  assert.match(result.body.warnings[0], /Chưa tải được tỉnh\/thành phố từ Meta/);
});

test('reports an actionable error when both location sources fail', async (context) => {
  const fail = async () => { throw new Error('Private provider failure'); };
  const search = setup(context, { searchLocations: fail, searchAddresses: fail });
  const result = await search('&includeAddresses=1');
  assert.equal(result.status, 502);
  assert.equal(result.body.error, 'Không tải được vị trí. Vui lòng thử tìm lại.');
});

test('still requires a connected Meta session before geocoding addresses', async (context) => {
  const unexpected = async () => { assert.fail('Search must not run without a connection'); };
  const search = setup(context, { connected: false, searchLocations: unexpected, searchAddresses: unexpected });
  assert.equal((await search('&includeAddresses=1')).status, 401);
});

test('rejects oversized location queries before contacting either provider', async (context) => {
  const unexpected = async () => { assert.fail('Search must not run for invalid queries'); };
  const search = setup(context, { searchLocations: unexpected, searchAddresses: unexpected });
  const result = await search('&includeAddresses=1', 'x'.repeat(251));
  assert.equal(result.status, 400);
});

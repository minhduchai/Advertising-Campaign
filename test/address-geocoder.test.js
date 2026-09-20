import test from 'node:test';
import assert from 'node:assert/strict';
import { createAddressGeocoder } from '../src/address-geocoder.js';

function feature(name, coordinates = [106.7630268, 10.8428609], properties = {}) {
  return {
    type: 'Feature',
    properties: {
      name, countrycode: 'VN', country: 'Việt Nam', district: 'Thủ Đức',
      city: 'Thành phố Hồ Chí Minh', ...properties
    },
    geometry: { type: 'Point', coordinates }
  };
}

test('searches Vietnamese addresses without passing Meta credentials and ranks the exact street first', async () => {
  let requested;
  const geocoder = createAddressGeocoder({}, {
    fetchImpl: async (url, options) => {
      requested = { url, options };
      return Response.json({ features: [
        feature('Hẻm 163 Đặng Văn Bi', [106.7606364, 10.8449751]),
        feature('Đặng Văn Bi'),
        feature('Đặng Văn Bi')
      ] });
    }
  });
  const results = await geocoder.search('Đặng Văn Bi, Hồ Chí Minh');
  assert.equal(requested.url.origin, 'https://photon.komoot.io');
  assert.equal(requested.url.searchParams.get('q'), 'Đặng Văn Bi, Hồ Chí Minh');
  assert.equal(requested.url.searchParams.get('countrycode'), 'VN');
  assert.equal(requested.url.searchParams.get('limit'), '10');
  assert.equal(requested.options.headers.Authorization, undefined);
  assert.equal(requested.options.headers['Accept-Language'], undefined);
  assert.ok(requested.options.signal instanceof AbortSignal);
  assert.equal(results.length, 2);
  assert.deepEqual(results[0], {
    key: 'pin:10.842861,106.763027',
    name: 'Đặng Văn Bi',
    address: 'Đặng Văn Bi, Thủ Đức, Thành phố Hồ Chí Minh, Việt Nam',
    type: 'custom_location',
    countryCode: 'VN',
    latitude: 10.8428609,
    longitude: 106.7630268,
    radius: 1,
    distanceUnit: 'kilometer',
    source: 'OpenStreetMap'
  });
});

test('filters foreign addresses and invalid coordinates instead of creating pins at zero', async () => {
  const geocoder = createAddressGeocoder({}, {
    fetchImpl: async () => Response.json({ features: [
      feature('Foreign', [100, 13], { countrycode: 'TH' }),
      feature('Missing', [null, null]),
      feature('Blank', ['', ' ']),
      feature('Boolean', [true, false]),
      feature('Out of range', [200, 100]),
      feature('Malformed', {}),
      feature('', [106, 10], { district: '' }),
      feature('Valid', ['106.7630268', '10.8428609'], { countrycode: 'vn' })
    ] })
  });
  assert.deepEqual((await geocoder.search('Valid')).map(({ name }) => name), ['Valid']);
});

test('preserves house numbers and street details for places and configurable Photon services', async () => {
  let requested;
  const geocoder = createAddressGeocoder({ photonGeocoderUrl: 'https://geocoder.example/api/' }, {
    fetchImpl: async (url) => {
      requested = url;
      return Response.json({ features: [feature('LG Clinic', undefined, {
        housenumber: '123', street: 'Đặng Văn Bi', locality: 'Khu phố 31'
      })] });
    }
  });
  const [result] = await geocoder.search('123 Đặng Văn Bi');
  assert.equal(requested.origin, 'https://geocoder.example');
  assert.equal(result.address, 'LG Clinic, 123 Đặng Văn Bi, Khu phố 31, Thủ Đức, Thành phố Hồ Chí Minh, Việt Nam');
});

test('treats service failures and malformed responses as errors but permits an empty search', async () => {
  for (const response of [Response.json({}, { status: 503 }), Response.json({ wrong: [] })]) {
    const geocoder = createAddressGeocoder({}, { fetchImpl: async () => response });
    await assert.rejects(geocoder.search('Đặng Văn Bi'), /Vui lòng thử lại/);
  }
  const geocoder = createAddressGeocoder({}, { fetchImpl: async () => Response.json({ features: [] }) });
  assert.deepEqual(await geocoder.search('No match'), []);
});

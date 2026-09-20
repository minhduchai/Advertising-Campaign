const DEFAULT_GEOCODER_URL = 'https://photon.komoot.io/api/';
const ADDRESS_SEARCH_TIMEOUT_MS = 8000;

// Photon supports address searches and permits moderate project use. Keep this
// behind an explicit user search and the request handler's shared result cache.
export function createAddressGeocoder(config = {}, { fetchImpl = fetch } = {}) {
  return {
    async search(query) {
      const url = new URL(config.photonGeocoderUrl || DEFAULT_GEOCODER_URL);
      url.searchParams.set('q', query);
      url.searchParams.set('countrycode', 'VN');
      url.searchParams.set('limit', '10');
      const response = await fetchImpl(url, {
        headers: {
          Accept: 'application/json',
          'User-Agent': 'LGClinicCampaignBuilder/1.0 (address search)'
        },
        signal: AbortSignal.timeout(ADDRESS_SEARCH_TIMEOUT_MS)
      });
      if (!response.ok) throw new Error('Không tải được kết quả địa chỉ. Vui lòng thử lại.');
      const payload = await response.json();
      if (!Array.isArray(payload.features)) {
        throw new Error('Dịch vụ địa chỉ trả về dữ liệu không hợp lệ. Vui lòng thử lại.');
      }
      const seen = new Set();
      return payload.features.flatMap((feature) => {
        const properties = feature?.properties ?? {};
        const coordinates = feature?.geometry?.coordinates;
        const [longitude, latitude] = Array.isArray(coordinates) ? coordinates : [];
        if (feature?.geometry?.type !== 'Point'
          || String(properties.countrycode ?? '').toUpperCase() !== 'VN'
          || !validCoordinate(latitude, -90, 90)
          || !validCoordinate(longitude, -180, 180)) return [];

        const streetAddress = [properties.housenumber, properties.street].filter(Boolean).join(' ');
        const name = String(properties.name || streetAddress || properties.locality || properties.district || '').trim();
        if (!name) return [];
        const address = [...new Set([
          name, streetAddress, properties.locality, properties.district,
          properties.city, properties.county, properties.state, properties.country
        ].filter(Boolean))].join(', ');
        const key = `pin:${Number(latitude).toFixed(6)},${Number(longitude).toFixed(6)}`;
        if (seen.has(key)) return [];
        seen.add(key);
        return [{
          key,
          name,
          address,
          type: 'custom_location',
          countryCode: 'VN',
          latitude: Number(latitude),
          longitude: Number(longitude),
          radius: 1,
          distanceUnit: 'kilometer',
          source: 'OpenStreetMap'
        }];
      }).sort((left, right) => relevance(right.name, query) - relevance(left.name, query));
    }
  };
}

function validCoordinate(value, minimum, maximum) {
  return (typeof value === 'number' || typeof value === 'string')
    && String(value).trim() !== ''
    && Number.isFinite(Number(value))
    && Number(value) >= minimum
    && Number(value) <= maximum;
}

function relevance(name, query) {
  const normalize = (value) => String(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/đ/g, 'd').replace(/\b(duong|street|road)\b/g, '').replace(/\s+/g, ' ').trim();
  const searchName = normalize(query.split(',')[0]);
  const resultName = normalize(name);
  return resultName === searchName ? 2 : resultName.startsWith(searchName) ? 1 : 0;
}

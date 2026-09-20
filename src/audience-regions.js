export function isVietnamRegion(region) {
  return Boolean(
    region
    && scalarRegionKey(region.key)
    && String(region.name ?? '').trim()
    && region.type === 'region'
    && region.countryCode === 'VN'
  );
}

export function hasDuplicateOrOverlappingRegions(includedRegions = [], excludedRegions = []) {
  const includedKeys = includedRegions.map((region) => scalarRegionKey(region?.key));
  const excludedKeys = excludedRegions.map((region) => scalarRegionKey(region?.key));
  const hasDuplicates = new Set(includedKeys).size !== includedKeys.length
    || new Set(excludedKeys).size !== excludedKeys.length;
  const includedSet = new Set(includedKeys);
  return hasDuplicates || excludedKeys.some((key) => includedSet.has(key));
}

function scalarRegionKey(value) {
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) return String(value);
  return '';
}

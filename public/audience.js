export function audienceTemplateContent(adSet) {
  return {
    ageMin: adSet.ageMin,
    ageMax: adSet.ageMax,
    genders: [...(adSet.genders ?? [])],
    locales: [...(adSet.locales ?? [])],
    includedRegions: (adSet.includedRegions ?? []).map(cloneRegion),
    excludedRegions: (adSet.excludedRegions ?? []).map(cloneRegion),
    includedCities: (adSet.includedCities ?? []).map(cloneCity),
    excludedCities: (adSet.excludedCities ?? []).map(cloneCity),
    includedCustomLocations: (adSet.includedCustomLocations ?? []).map(cloneCustomLocation),
    excludedCustomLocations: (adSet.excludedCustomLocations ?? []).map(cloneCustomLocation),
    includedCustomAudienceIds: [...(adSet.includedCustomAudienceIds ?? [])],
    excludedCustomAudienceIds: [...(adSet.excludedCustomAudienceIds ?? [])],
    detailedTargeting: (adSet.detailedTargeting ?? []).map((item) => ({ ...item })),
    advantageAudienceEnabled: Boolean(adSet.advantageAudienceEnabled),
    ...(adSet.advantageAudienceEnabled ? { audienceControlAgeMin: adSet.audienceControlAgeMin ?? 18 } : {})
  };
}

export function applyAudienceTemplate(adSet, template) {
  const content = template.content ?? template;
  adSet.ageMin = content.ageMin ?? adSet.ageMin;
  adSet.ageMax = content.ageMax ?? adSet.ageMax;
  adSet.genders = [...(content.genders ?? [])];
  adSet.locales = [...(content.locales ?? [])];
  adSet.includedRegions = (content.includedRegions ?? []).map(cloneRegion);
  adSet.excludedRegions = (content.excludedRegions ?? []).map(cloneRegion);
  adSet.includedCities = (content.includedCities ?? []).map(cloneCity);
  adSet.excludedCities = (content.excludedCities ?? []).map(cloneCity);
  adSet.includedCustomLocations = (content.includedCustomLocations ?? []).map(cloneCustomLocation);
  adSet.excludedCustomLocations = (content.excludedCustomLocations ?? []).map(cloneCustomLocation);
  adSet.includedCustomAudienceIds = [...(content.includedCustomAudienceIds ?? [])];
  adSet.excludedCustomAudienceIds = [...(content.excludedCustomAudienceIds ?? [])];
  adSet.detailedTargeting = (content.detailedTargeting ?? []).map((item) => ({ ...item }));
  adSet.advantageAudienceEnabled = Boolean(content.advantageAudienceEnabled);
  adSet.audienceControlAgeMin = content.advantageAudienceEnabled ? (content.audienceControlAgeMin ?? 18) : null;
  adSet.audienceTemplateId = template.id ?? null;
  adSet.audienceTemplateName = template.name ?? '';
  return adSet;
}

export function isAudienceModified(adSet, template) {
  if (!template) return true;
  return JSON.stringify(audienceTemplateContent(adSet)) !== JSON.stringify(template.content ?? template);
}

function cloneRegion(region) {
  return {
    key: region.key,
    name: region.name,
    type: region.type,
    countryCode: region.countryCode
  };
}

function cloneCity(city) {
  return {
    key: city.key,
    name: city.name,
    type: 'city',
    countryCode: city.countryCode,
    region: city.region ?? '',
    radius: city.radius == null ? null : Number(city.radius),
    distanceUnit: city.distanceUnit ?? 'kilometer'
  };
}

function cloneCustomLocation(location) {
  const isPlace = location.type === 'place';
  return {
    key: location.key,
    name: location.name,
    type: isPlace ? 'place' : 'custom_location',
    countryCode: location.countryCode ?? 'VN',
    ...(isPlace ? { metaPlaceKey: location.metaPlaceKey } : {}),
    ...(!isPlace || (location.latitude != null && location.longitude != null)
      ? { latitude: Number(location.latitude), longitude: Number(location.longitude) } : {}),
    radius: Number(location.radius ?? 8),
    distanceUnit: location.distanceUnit ?? 'kilometer'
  };
}

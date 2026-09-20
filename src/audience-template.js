import { randomUUID } from 'node:crypto';
import { hasDuplicateOrOverlappingRegions, isVietnamRegion } from './audience-regions.js';

export const AUDIENCE_TEMPLATE_ID_PREFIX = 'tool_audience_';

const supportedContentFields = new Set([
  'sourceAdAccountId',
  'ageMin',
  'ageMax',
  'genders',
  'locales',
  'includedRegions',
  'excludedRegions',
  'includedCities',
  'excludedCities',
  'includedCustomLocations',
  'excludedCustomLocations',
  'includedCustomAudienceIds',
  'excludedCustomAudienceIds',
  'detailedTargeting',
  'advantageAudienceEnabled',
  'audienceControlAgeMin'
]);

const supportedTargetingFields = new Set([
  'interests',
  'behaviors',
  'life_events',
  'industries',
  'income',
  'family_statuses',
  'education_statuses',
  'relationship_statuses'
]);

export function createAudienceTemplateId() {
  return `${AUDIENCE_TEMPLATE_ID_PREFIX}${randomUUID()}`;
}

export function normalizeAudienceTemplateName(name) {
  return name.trim().normalize('NFKC').toLocaleLowerCase('vi-VN');
}

export function validateAudienceTemplate(input) {
  if (!isPlainObject(input)) throw validationError('Audience template must be an object');

  const name = typeof input.name === 'string' ? input.name.trim() : '';
  if (!name) throw validationError('Audience template name is required');
  if (name.length > 120) throw validationError('Audience template name must not exceed 120 characters');

  const source = input.content ?? {};
  if (!isPlainObject(source)) throw validationError('Audience template content must be an object');
  const unsupportedField = Object.keys(source).find((field) => !supportedContentFields.has(field));
  if (unsupportedField) throw validationError(`Unsupported audience template field: ${unsupportedField}`);

  const ageMin = integerField(source.ageMin, 18, 'ageMin');
  const ageMax = integerField(source.ageMax, 65, 'ageMax');
  if (ageMin < 13 || ageMax > 65 || ageMin > ageMax) {
    throw validationError('Audience template ages must be between 13 and 65 with ageMin not greater than ageMax');
  }

  const genders = numericIdArray(source.genders, 'genders');
  if (genders.some((gender) => gender !== 1 && gender !== 2)) {
    throw validationError('Audience template genders only support Meta IDs 1 and 2');
  }

  const locales = numericIdArray(source.locales, 'locales');
  const includedRegions = objectIdArray(source.includedRegions, 'includedRegions', normalizeRegion);
  const excludedRegions = objectIdArray(source.excludedRegions, 'excludedRegions', normalizeRegion);
  if (hasDuplicateOrOverlappingRegions(includedRegions, excludedRegions)) {
    throw validationError('Audience template regions cannot be duplicated or appear in both include and exclude');
  }
  const includedCities = objectIdArray(source.includedCities, 'includedCities', normalizeCity);
  const excludedCities = objectIdArray(source.excludedCities, 'excludedCities', normalizeCity);
  assertNoLocationOverlap(includedCities, excludedCities, 'cities');
  const includedCustomLocations = objectIdArray(
    source.includedCustomLocations,
    'includedCustomLocations',
    normalizeCustomLocation
  );
  const excludedCustomLocations = objectIdArray(
    source.excludedCustomLocations,
    'excludedCustomLocations',
    normalizeCustomLocation
  );
  assertNoLocationOverlap(includedCustomLocations, excludedCustomLocations, 'custom locations');
  const includedCustomAudienceIds = stringIdArray(
    source.includedCustomAudienceIds,
    'includedCustomAudienceIds'
  );
  const excludedCustomAudienceIds = stringIdArray(
    source.excludedCustomAudienceIds,
    'excludedCustomAudienceIds'
  );
  const sourceAdAccountId = optionalString(source.sourceAdAccountId);
  if ((includedCustomAudienceIds.length || excludedCustomAudienceIds.length) && !sourceAdAccountId) {
    throw validationError('Audience templates with custom audiences require sourceAdAccountId');
  }
  const detailedTargeting = objectIdArray(source.detailedTargeting, 'detailedTargeting', normalizeTargetingItem);

  const advantageAudienceEnabled = source.advantageAudienceEnabled ?? false;
  if (typeof advantageAudienceEnabled !== 'boolean') {
    throw validationError('Audience template advantageAudienceEnabled must be a boolean');
  }
  const audienceControlAgeMin = integerField(source.audienceControlAgeMin, 18, 'audienceControlAgeMin');
  if (advantageAudienceEnabled && (audienceControlAgeMin < 13 || audienceControlAgeMin > ageMin)) {
    throw validationError('Audience control minimum age must be between 13 and ageMin');
  }

  return {
    name,
    content: {
      sourceAdAccountId,
      ageMin,
      ageMax,
      genders,
      locales,
      includedRegions,
      excludedRegions,
      includedCities,
      excludedCities,
      includedCustomLocations,
      excludedCustomLocations,
      includedCustomAudienceIds,
      excludedCustomAudienceIds,
      detailedTargeting,
      advantageAudienceEnabled,
      ...(advantageAudienceEnabled ? { audienceControlAgeMin } : {})
    }
  };
}

function numericIdArray(value, field) {
  const values = arrayField(value, field).map((item) => positiveInteger(item, field));
  assertUnique(values, field);
  return values;
}

function stringIdArray(value, field) {
  const values = arrayField(value, field).map((item) => scalarId(item, field));
  assertUnique(values, field);
  return values;
}

function objectIdArray(value, field, normalize) {
  const values = arrayField(value, field).map((item) => normalize(item, field));
  assertUnique(values.map((item) => item.key ?? item.id), field);
  return values;
}

function normalizeRegion(value, field) {
  if (!isPlainObject(value)) throw validationError(`Audience template ${field} must contain objects`);
  const key = scalarId(value.key, `${field}.key`);
  const name = requiredString(value.name, `${field}.name`);
  const type = requiredString(value.type, `${field}.type`);
  const countryCode = requiredString(value.countryCode, `${field}.countryCode`).toUpperCase();
  const region = { key, name, type, countryCode };
  if (!isVietnamRegion(region)) {
    throw validationError(`Audience template ${field} must contain Vietnam Meta regions`);
  }
  return region;
}

function normalizeCity(value, field) {
  if (!isPlainObject(value)) throw validationError(`Audience template ${field} must contain objects`);
  const key = scalarId(value.key, `${field}.key`);
  const name = requiredString(value.name, `${field}.name`);
  const countryCode = requiredString(value.countryCode, `${field}.countryCode`).toUpperCase();
  if (countryCode !== 'VN') throw validationError(`Audience template ${field} must contain Vietnam Meta cities`);
  const distanceUnit = locationDistanceUnit(value.distanceUnit, field);
  const radius = value.radius === null ? null : locationRadius(value.radius, distanceUnit, field);
  return {
    key,
    name,
    type: 'city',
    countryCode,
    region: optionalString(value.region),
    radius,
    distanceUnit
  };
}

function normalizeCustomLocation(value, field) {
  if (!isPlainObject(value)) throw validationError(`Audience template ${field} must contain objects`);
  if (value.type === 'place') {
    const metaPlaceKey = scalarId(value.metaPlaceKey, `${field}.metaPlaceKey`);
    const distanceUnit = locationDistanceUnit(value.distanceUnit, field);
    const countryCode = value.countryCode ?? 'VN';
    if (countryCode !== 'VN') throw validationError(`Audience template ${field} must contain Vietnam Meta places`);
    const hasCoordinates = value.latitude != null && value.longitude != null;
    const latitude = hasCoordinates ? finiteNumber(value.latitude, `${field}.latitude`) : null;
    const longitude = hasCoordinates ? finiteNumber(value.longitude, `${field}.longitude`) : null;
    if (hasCoordinates && (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180)) {
      throw validationError(`Audience template ${field} must contain valid coordinates`);
    }
    return {
      key: `place:${metaPlaceKey}`, metaPlaceKey,
      name: requiredString(value.name, `${field}.name`), type: 'place', countryCode,
      ...(hasCoordinates ? { latitude, longitude } : {}),
      radius: locationRadius(value.radius, distanceUnit, field), distanceUnit
    };
  }
  const latitude = finiteNumber(value.latitude, `${field}.latitude`);
  const longitude = finiteNumber(value.longitude, `${field}.longitude`);
  if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
    throw validationError(`Audience template ${field} must contain valid coordinates`);
  }
  const distanceUnit = locationDistanceUnit(value.distanceUnit, field);
  const radius = locationRadius(value.radius, distanceUnit, field);
  const key = optionalString(value.key) || `pin:${latitude.toFixed(6)},${longitude.toFixed(6)}`;
  return {
    key,
    name: requiredString(value.name, `${field}.name`),
    type: 'custom_location',
    countryCode: 'VN',
    latitude,
    longitude,
    radius,
    distanceUnit
  };
}

function locationDistanceUnit(value = 'kilometer', field) {
  if (!['kilometer', 'mile'].includes(value)) {
    throw validationError(`Audience template ${field}.distanceUnit must be kilometer or mile`);
  }
  return value;
}

function locationRadius(value = 8, unit, field) {
  const radius = Number(value);
  const maximum = unit === 'mile' ? 50 : 80;
  if (!Number.isFinite(radius) || radius <= 0 || radius > maximum) {
    throw validationError(`Audience template ${field}.radius must be greater than 0 and at most ${maximum} ${unit}`);
  }
  return radius;
}

function assertNoLocationOverlap(included, excluded, label) {
  const includedKeys = included.map((item) => item.key);
  const excludedKeys = excluded.map((item) => item.key);
  if (new Set(includedKeys).size !== includedKeys.length
    || new Set(excludedKeys).size !== excludedKeys.length
    || excludedKeys.some((key) => includedKeys.includes(key))) {
    throw validationError(`Audience template ${label} cannot be duplicated or appear in both include and exclude`);
  }
}

function normalizeTargetingItem(value, field) {
  if (!isPlainObject(value)) throw validationError(`Audience template ${field} must contain objects`);
  const targetingField = requiredString(value.targetingField, `${field}.targetingField`);
  if (!supportedTargetingFields.has(targetingField)) {
    throw validationError(`Audience template ${field}.targetingField is not supported: ${targetingField}`);
  }
  return {
    id: requiredString(value.id, `${field}.id`),
    name: requiredString(value.name, `${field}.name`),
    targetingField
  };
}

function arrayField(value, field) {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw validationError(`Audience template ${field} must be an array`);
  return value;
}

function integerField(value, fallback, field) {
  if (value === undefined) return fallback;
  return integerScalar(value, field);
}

function finiteNumber(value, field) {
  const number = Number(value);
  if (!Number.isFinite(number)) throw validationError(`Audience template ${field} must be a number`);
  return number;
}

function positiveInteger(value, field) {
  const number = integerScalar(value, field);
  if (number <= 0) throw validationError(`Audience template ${field} must contain positive integer IDs`);
  return number;
}

function integerScalar(value, field) {
  if (typeof value === 'number') {
    if (Number.isSafeInteger(value)) return value;
  } else if (typeof value === 'string') {
    const normalized = value.trim();
    if (/^-?\d+$/.test(normalized)) {
      const number = Number(normalized);
      if (Number.isSafeInteger(number)) return number;
    }
  }
  throw validationError(`Audience template ${field} must contain integer values`);
}

function scalarId(value, field) {
  if (typeof value === 'string') {
    const normalized = value.trim();
    if (normalized) return normalized;
  } else if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) {
    return String(value);
  }
  throw validationError(`Audience template ${field} must contain string or number IDs`);
}

function requiredString(value, field) {
  const string = typeof value === 'string' ? value.trim() : '';
  if (!string) throw validationError(`Audience template ${field} is required`);
  return string;
}

function optionalString(value) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string') {
    throw validationError('Audience template sourceAdAccountId must be a string');
  }
  return value.trim() || null;
}

function assertUnique(values, field) {
  if (new Set(values).size !== values.length) {
    throw validationError(`Audience template ${field} contains duplicate IDs`);
  }
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function validationError(message) {
  const error = new TypeError(message);
  error.code = 'AUDIENCE_TEMPLATE_VALIDATION';
  return error;
}

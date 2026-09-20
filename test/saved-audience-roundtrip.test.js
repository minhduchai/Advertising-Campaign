import test from 'node:test';
import assert from 'node:assert/strict';
import { createMetaClient } from '../src/meta-client.js';
import { testConfig } from './helpers.js';
import { buildManualTargeting, validateDraft } from '../src/draft.js';
import { validateAudienceTemplate } from '../src/audience-template.js';
import { audienceTemplateContent, applyAudienceTemplate } from '../public/audience.js';
import { createWorkspaceState, setAccountResources } from '../public/state.js';
import { readLocationMapSettings } from '../public/location-map.js';
import { renderWorkspace } from '../public/workspace.js';
import { requirementsForAdSet } from '../public/workspace-progress.js';

async function savedAudience(targeting) {
  const client = createMetaClient(testConfig(), {
    fetchImpl: async () => Response.json({ data: [{
      id: 'saved-example', name: 'Mẫu kiểm thử nữ Thủ Đức', targeting
    }] })
  });
  return (await client.listSavedAudiences('test-token', 'act_25'))[0];
}

// Synthetic API data exercising the two-pin, female 18–45 Advantage+ setup in the user's screenshot.
const twoPins = [
  { address_string: 'Đặng Văn Bi, Thủ Đức', latitude: 10.842861, longitude: 106.763027, radius: 8, distance_unit: 'kilometer' },
  { name: 'Vĩ độ 10,85 Kinh độ 106,76', latitude: 10.85, longitude: 106.76, radius: 8, distance_unit: 'kilometer' }
];

test('round trips saved Advantage+ controls, age suggestions, female gender and both radius pins', async () => {
  const template = await savedAudience({
    age_min: 18, age_max: 65, age_range: [18, 45], genders: [2],
    targeting_automation: { advantage_audience: 1 },
    geo_locations: { custom_locations: twoPins }
  });
  assert.equal(template.compatible, true);
  const state = createWorkspaceState();
  state.connected = true;
  const campaign = state.draft.campaigns[0];
  campaign.adAccountId = 'act_25';
  const adSet = campaign.adSets[0];
  state.selection = { type: 'adSet', clientId: adSet.clientId };
  applyAudienceTemplate(adSet, template);
  assert.equal(adSet.ageMin, 18);
  assert.equal(adSet.ageMax, 45);
  assert.equal(adSet.audienceControlAgeMin, 18);
  assert.equal(adSet.advantageAudienceEnabled, true);
  assert.deepEqual(adSet.genders, [2]);
  assert.equal(adSet.includedCustomLocations.length, 2);
  assert.equal(adSet.includedCustomLocations[0].name, twoPins[0].address_string);
  const targeting = buildManualTargeting(adSet);
  assert.equal(targeting.age_min, 18);
  assert.equal(targeting.age_max, undefined);
  assert.deepEqual(targeting.age_range, [18, 45]);
  assert.deepEqual(targeting.targeting_automation, { advantage_audience: 1 });
  assert.deepEqual(targeting.genders, [2]);
  assert.deepEqual(targeting.geo_locations.custom_locations, twoPins.map(({ latitude, longitude, radius, distance_unit }) => ({ latitude, longitude, radius, distance_unit })));
  assert.equal(validateDraft(state.draft).some((issue) => /ages|advantageAudienceEnabled|Locations/.test(issue.path)), false);
  const progress = requirementsForAdSet(campaign, adSet);
  assert.equal(progress.find((item) => item.field === 'advantageAudienceEnabled')?.complete, true);
  const html = renderWorkspace(state);
  assert.match(html, /Đang bật · Theo đối tượng đã lưu/);
  assert.match(html, /Kiểm soát đối tượng · Độ tuổi tối thiểu: 18/);
  assert.match(html, /Độ tuổi gợi ý/);
  assert.match(html, /Tuổi tối đa: 45/);
  assert.match(html, /Đặng Văn Bi, Thủ Đức/);
  assert.match(html, /2 vị trí bao gồm · 0 vị trí loại trừ/);
  assert.doesNotMatch(html, /data-map-picker="true"/);
  assert.match(html, /Vĩ độ 10,85 Kinh độ 106,76/);
  assert.equal((html.match(/data-radius="8" data-distance-unit="kilometer" data-map-editable="false"/g) ?? []).length, 2);
  const stored = validateAudienceTemplate({ name: 'Bản sao', content: audienceTemplateContent(adSet) });
  assert.equal(stored.content.ageMax, 45);
  assert.equal(stored.content.audienceControlAgeMin, 18);
});

test('preserves fractional miles through import, template copy, map conversion and export', async () => {
  const template = await savedAudience({
    age_range: [23, 45],
    geo_locations: { custom_locations: [{ ...twoPins[0], radius: 4.97, distance_unit: 'mile' }] },
    excluded_geo_locations: { cities: [{ key: 'city-1', name: 'Thành phố loại trừ', radius: 50, distance_unit: 'mile' }] }
  });
  assert.equal(template.compatible, true);
  const adSet = applyAudienceTemplate({}, template);
  assert.equal(adSet.ageMin, 23);
  assert.equal(adSet.ageMax, 45);
  const stored = validateAudienceTemplate({ name: 'Copy', content: audienceTemplateContent(adSet) });
  assert.equal(stored.content.includedCustomLocations[0].radius, 4.97);
  assert.equal(stored.content.includedCustomLocations[0].distanceUnit, 'mile');
  const targeting = buildManualTargeting(adSet);
  assert.equal(targeting.geo_locations.custom_locations[0].radius, 4.97);
  assert.equal(targeting.geo_locations.custom_locations[0].distance_unit, 'mile');
  assert.equal(targeting.excluded_geo_locations.cities[0].distance_unit, 'mile');
  assert.equal(readLocationMapSettings({ latitude: 10, longitude: 106, radius: 4.97, distanceUnit: 'mile' }).radius, 4.97 * 1.609344);
  assert.equal(readLocationMapSettings({ latitude: 10, longitude: 106, radius: 50, distanceUnit: 'mile' }).radius, 80.4672);
});

test('does not invent a radius for a city-only saved audience', async () => {
  const template = await savedAudience({ age_min: 13, age_max: 65,
    geo_locations: { cities: [{ key: 'city-1', name: 'Thủ Đức' }] }
  });
  const adSet = applyAudienceTemplate({}, template);
  assert.equal(adSet.includedCities[0].radius, null);
  assert.deepEqual(buildManualTargeting(adSet).geo_locations.cities, [{ key: 'city-1' }]);
  assert.equal(validateAudienceTemplate({ name: 'Copy', content: audienceTemplateContent(adSet) }).content.includedCities[0].radius, null);
  const state = createWorkspaceState();
  state.connected = true;
  const actual = state.draft.campaigns[0].adSets[0];
  applyAudienceTemplate(actual, template);
  state.selection = { type: 'adSet', clientId: actual.clientId };
  const html = renderWorkspace(state);
  assert.match(html, /Chỉ trong thành phố · Không mở rộng bán kính/);
  assert.match(html, /Tuổi tối thiểu: 13/);
  assert.match(html, /Tuổi tối đa: 65\+/);
});

test('refreshes linked Meta audience snapshots only in the matching account', async () => {
  const template = await savedAudience({ age_min: 18, age_max: 45, geo_locations: { custom_locations: twoPins } });
  const state = createWorkspaceState();
  const campaign = state.draft.campaigns[0];
  campaign.adAccountId = 'act_25';
  const stale = campaign.adSets[0];
  stale.audienceTemplateId = template.id;
  stale.ageMax = 65;
  stale.includedCustomLocations = [];
  const tool = structuredClone(stale);
  tool.audienceTemplateId = 'tool_audience_mine';
  const manual = structuredClone(stale);
  manual.audienceTemplateId = null;
  campaign.adSets.push(tool, manual);
  const other = structuredClone(campaign);
  other.adAccountId = 'act_other';
  state.draft.campaigns.push(other);
  setAccountResources(state, 'act_25', { loaded: true, savedAudiences: [template] });
  assert.equal(stale.ageMax, 45);
  assert.equal(stale.includedCustomLocations.length, 2);
  assert.equal(tool.ageMax, 65);
  assert.equal(manual.ageMax, 65);
  assert.equal(other.adSets[0].ageMax, 65);
});

test('rejects malformed age ranges and missing pin coordinates instead of applying defaults', async () => {
  const age = await savedAudience({ age_range: [45], geo_locations: { custom_locations: twoPins } });
  assert.equal(age.compatible, false);
  const location = await savedAudience({ geo_locations: { custom_locations: [{ ...twoPins[0], latitude: null }] } });
  assert.equal(location.compatible, false);
  assert.equal(location.content.includedCustomLocations.length, 0);
});

test('keeps a Meta place and a coordinate pin as two targets even at the same coordinates', async () => {
  const place = { key: '123456', name: 'Đặng Văn Bi Thủ Đức', country: 'VN', latitude: 10.85, longitude: 106.76, radius: 8, distance_unit: 'kilometer' };
  const pin = { ...twoPins[1] };
  const template = await savedAudience({ age_min: 18, age_range: [18, 45], genders: [2], targeting_automation: { advantage_audience: 1 },
    geo_locations: { places: [place], custom_locations: [pin] },
    excluded_geo_locations: { places: [{ ...place, key: '654321' }] }
  });
  assert.equal(template.compatible, true);
  const adSet = applyAudienceTemplate({}, template);
  assert.equal(adSet.includedCustomLocations.length, 2);
  assert.deepEqual(adSet.includedCustomLocations.map((location) => location.type), ['place', 'custom_location']);
  assert.notEqual(adSet.includedCustomLocations[0].key, adSet.includedCustomLocations[1].key);
  const copy = validateAudienceTemplate({ name: 'Copy', content: audienceTemplateContent(adSet) });
  const targeting = buildManualTargeting(copy.content);
  assert.deepEqual(targeting.geo_locations.places, [{ key: place.key, radius: 8, distance_unit: 'kilometer' }]);
  assert.equal(targeting.geo_locations.custom_locations.length, 1);
  assert.deepEqual(targeting.excluded_geo_locations.places, [{ key: '654321', radius: 8, distance_unit: 'kilometer' }]);
});

test('retains named Meta places without preview coordinates and still counts and exports them', async () => {
  const template = await savedAudience({ age_min: 18, age_max: 45,
    geo_locations: { places: [{ key: '123456', name: 'Đặng Văn Bi Thủ Đức', radius: 8, distance_unit: 'kilometer' }], custom_locations: [twoPins[1]] }
  });
  assert.equal(template.compatible, true);
  const state = createWorkspaceState(); state.connected = true;
  const adSet = state.draft.campaigns[0].adSets[0];
  applyAudienceTemplate(adSet, template);
  state.selection = { type: 'adSet', clientId: adSet.clientId };
  assert.equal(adSet.includedCustomLocations.length, 2);
  const html = renderWorkspace(state);
  assert.match(html, /2 vị trí bao gồm/);
  assert.match(html, /Đặng Văn Bi Thủ Đức/);
  assert.match(html, /Meta không cung cấp tọa độ xem bản đồ/);
  assert.equal((html.match(/class="custom-location-card"/g) ?? []).length, 2);
  assert.equal(validateDraft(state.draft).some((issue) => issue.path.includes('CustomLocations')), false);
  assert.equal(buildManualTargeting(adSet).geo_locations.places[0].key, '123456');
});

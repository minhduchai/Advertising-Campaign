import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildCampaignParams,
  buildConversationAdSetParams,
  buildImageCreativeParams,
  buildManualTargeting,
  buildVideoCreativeParams,
  validateDraft
} from '../src/draft.js';
import { createEmptySeeding } from '../public/seeding.js';

const ad = {
  clientId: 'ad-1',
  name: 'Quảng cáo 1',
  primaryText: 'Nhắn tin để được tư vấn.',
  headline: 'Ưu đãi hôm nay',
  mediaId: 'media-1',
  conversation: {
    sourceTemplateId: null,
    templateName: 'Mẫu tư vấn',
    greeting: 'Chào bạn, chúng tôi có thể giúp gì?',
    quickReplies: [{ id: 'q1', title: 'Tôi cần tư vấn', payload: 'reply_q1' }],
    showBusinessPhoneNumber: false,
    businessPhoneNumber: '',
    customerActions: []
  }
};

ad.conversation.quickReplies = [];
ad.conversation.customerActions = [{
  id: 'button-1',
  label: 'Đăng Ký Ngay',
  type: 'OPEN_URL',
  value: 'https://lgclinic.vn/dang-ky'
}];

const vietnamRegion = {
  key: '3984',
  name: 'Thành phố Hồ Chí Minh',
  type: 'region',
  countryCode: 'VN'
};

const adSet = {
  clientId: 'adset-1',
  name: 'Nhóm TP.HCM',
  dailyBudget: 100000,
  locationMode: 'REGIONS',
  includedRegions: [vietnamRegion],
  excludedRegions: [],
  includedCities: [],
  excludedCities: [],
  includedCustomLocations: [],
  excludedCustomLocations: [],
  ageMin: 18,
  ageMax: 45,
  genders: [2],
  includedCustomAudienceIds: [],
  excludedCustomAudienceIds: [],
  detailedTargeting: [],
  advantageAudienceEnabled: false,
  startTime: '',
  endTime: '',
  ads: [ad]
};

const campaign = {
  clientId: 'campaign-1',
  name: 'Chiến dịch tháng 8',
  adAccountId: 'act_1',
  pageId: 'page_1',
  specialAdCategory: 'NONE',
  budgetStrategy: 'AD_SET',
  dailyBudget: 0,
  adSets: [adSet]
};

function validDraftWith(candidateAdSet) {
  return {
    campaigns: [{ ...campaign, adSets: [candidateAdSet] }]
  };
}

test('accepts multiple nested conversation campaigns with valid ad content', () => {
  const secondAd = { ...ad, clientId: 'ad-2' };
  const secondAdSet = { ...adSet, clientId: 'adset-2', ads: [secondAd] };
  const draft = {
    campaigns: [campaign, {
      ...campaign,
      clientId: 'campaign-2',
      name: 'Chiến dịch tháng 9',
      adAccountId: 'act_2',
      pageId: 'page_2',
      adSets: [secondAdSet]
    }]
  };

  assert.deepEqual(validateDraft(draft), []);
});

test('requires non-blank names for every campaign, ad set, and ad', () => {
  const input = structuredClone(validDraftWith(adSet));
  input.campaigns[0].name = '   ';
  input.campaigns[0].adSets[0].name = '';
  input.campaigns[0].adSets[0].ads[0].name = '\t';

  const issues = validateDraft(input);

  assert.ok(issues.some(({ path, message }) => path === 'campaigns.0.name' && message === 'Nhập tên chiến dịch'));
  assert.ok(issues.some(({ path, message }) => path === 'campaigns.0.adSets.0.name' && message === 'Nhập tên nhóm quảng cáo'));
  assert.ok(issues.some(({ path, message }) => path === 'campaigns.0.adSets.0.ads.0.name' && message === 'Nhập tên quảng cáo'));
});

test('requires a selected template when campaign seeding is enabled', () => {
  const input = structuredClone(validDraftWith(adSet));
  input.campaigns[0].seeding = createEmptySeeding(() => 'item-1');
  input.campaigns[0].seeding.enabled = true;

  assert.ok(validateDraft(input).some(({ path }) => path === 'campaigns.0.seeding.templateId'));
});

test('requires a selected seeding template even when legacy enabled flag is false', () => {
  const input = structuredClone(validDraftWith(adSet));
  input.campaigns[0].seeding = {
    enabled: false,
    templateId: null,
    templateName: '',
    items: [{ id: 'seed-1', message: 'Bình luận seeding', imageMediaId: null }]
  };

  const issues = validateDraft(input);

  assert.ok(issues.some((entry) => entry.path === 'campaigns.0.seeding.templateId'));
});

test('rejects blank and globally duplicated client ids with precise paths', () => {
  const blankIdDraft = {
    campaigns: [{ ...campaign, clientId: '   ' }]
  };
  const duplicateIdDraft = {
    campaigns: [{
      ...campaign,
      adSets: [{
        ...adSet,
        clientId: campaign.clientId,
        ads: [{ ...ad, clientId: campaign.clientId }]
      }]
    }]
  };

  const blankIssues = validateDraft(blankIdDraft);
  const duplicateIssues = validateDraft(duplicateIdDraft);

  assert.ok(blankIssues.some((entry) => entry.path === 'campaigns.0.clientId'));
  assert.ok(duplicateIssues.some((entry) => entry.path === 'campaigns.0.adSets.0.clientId'));
  assert.ok(duplicateIssues.some((entry) => entry.path === 'campaigns.0.adSets.0.ads.0.clientId'));
  assert.ok(duplicateIssues.filter((entry) => /clientId/.test(entry.message)).length >= 2);
});

test('rejects an ad set without a daily budget before it reaches Meta', () => {
  const draft = {
    campaigns: [{ ...campaign, adSets: [{ ...adSet, dailyBudget: 0 }] }]
  };

  assert.deepEqual(validateDraft(draft), [{
    path: 'campaigns.0.adSets.0.dailyBudget',
    message: 'Ngân sách nhóm quảng cáo phải lớn hơn 0'
  }]);
});

test('rejects nationwide targeting and requires an included Vietnam region', () => {
  const countryIssues = validateDraft(validDraftWith({
    ...adSet,
    locationMode: 'COUNTRY',
    includedRegions: []
  }));
  const emptyRegionIssues = validateDraft(validDraftWith({
    ...adSet,
    locationMode: 'REGIONS',
    includedRegions: []
  }));

  assert.ok(countryIssues.some((entry) => entry.path.endsWith('.locationMode')));
  assert.ok(emptyRegionIssues.some((entry) => entry.path.endsWith('.includedRegions')));
});

test('rejects foreign or overlapping regions before they reach Meta', () => {
  const foreignRegion = { key: '1', name: 'California', type: 'region', countryCode: 'US' };
  const issues = validateDraft(validDraftWith({
    ...adSet,
    locationMode: 'REGIONS',
    includedRegions: [foreignRegion, vietnamRegion],
    excludedRegions: [vietnamRegion]
  }));

  assert.ok(issues.some((entry) => entry.path.endsWith('.includedRegions')));
  assert.ok(issues.some((entry) => entry.path.endsWith('.regions')));
});

test('serializes only included and excluded Vietnam regions', () => {
  const targeting = buildManualTargeting({
    ...adSet,
    locationMode: 'REGIONS',
    includedRegions: [vietnamRegion],
    excludedRegions: [{
      key: '3998',
      name: 'Nghệ An',
      type: 'region',
      countryCode: 'VN'
    }]
  });

  assert.deepEqual(targeting.geo_locations, { regions: [{ key: '3984' }] });
  assert.deepEqual(targeting.excluded_geo_locations, { regions: [{ key: '3998' }] });
  assert.equal(targeting.geo_locations.countries, undefined);
});

test('serializes included and excluded city radius targeting for Meta', () => {
  const targeting = buildManualTargeting({
    ...adSet,
    includedRegions: [],
    excludedRegions: [],
    includedCities: [{
      key: '2420605',
      name: 'Thủ Đức',
      type: 'city',
      countryCode: 'VN',
      region: 'Hồ Chí Minh',
      radius: 8,
      distanceUnit: 'kilometer'
    }],
    excludedCities: [{
      key: '2420606',
      name: 'Dĩ An',
      type: 'city',
      countryCode: 'VN',
      region: 'Bình Dương',
      radius: 12,
      distanceUnit: 'kilometer'
    }]
  });

  assert.deepEqual(targeting.geo_locations, {
    cities: [{ key: '2420605', radius: 8, distance_unit: 'kilometer' }]
  });
  assert.deepEqual(targeting.excluded_geo_locations, {
    cities: [{ key: '2420606', radius: 12, distance_unit: 'kilometer' }]
  });
});

test('serializes precise included and excluded pin radius targeting for Meta', () => {
  const targeting = buildManualTargeting({
    ...adSet,
    includedRegions: [],
    includedCustomLocations: [{
      key: 'pin:10.980400,106.651900',
      name: 'Phú Thọ, Thủ Dầu Một',
      type: 'custom_location',
      countryCode: 'VN',
      latitude: 10.9804,
      longitude: 106.6519,
      radius: 10,
      distanceUnit: 'kilometer'
    }],
    excludedCustomLocations: [{
      key: 'pin:10.950000,106.700000',
      name: 'Khu vực loại trừ',
      type: 'custom_location',
      countryCode: 'VN',
      latitude: 10.95,
      longitude: 106.7,
      radius: 5,
      distanceUnit: 'kilometer'
    }]
  });

  assert.deepEqual(targeting.geo_locations, {
    custom_locations: [{
      latitude: 10.9804,
      longitude: 106.6519,
      radius: 10,
      distance_unit: 'kilometer'
    }]
  });
  assert.deepEqual(targeting.excluded_geo_locations, {
    custom_locations: [{
      latitude: 10.95,
      longitude: 106.7,
      radius: 5,
      distance_unit: 'kilometer'
    }]
  });
});

test('serializes locales supplied by a Meta saved audience', () => {
  const targeting = buildManualTargeting({
    ...adSet,
    includedRegions: [vietnamRegion],
    locales: [6, 24]
  });

  assert.deepEqual(targeting.locales, [6, 24]);
});

test('builds an active conversation preset for every campaign and ad set', () => {
  const campaignParams = buildCampaignParams(campaign);
  const adSetParams = buildConversationAdSetParams('remote-campaign', campaign, adSet);

  assert.equal(campaignParams.get('objective'), 'OUTCOME_ENGAGEMENT');
  assert.equal(campaignParams.get('buying_type'), 'AUCTION');
  assert.equal(campaignParams.get('special_ad_categories'), '[]');
  assert.equal(campaignParams.get('status'), 'ACTIVE');
  assert.equal(adSetParams.get('optimization_goal'), 'CONVERSATIONS');
  assert.equal(adSetParams.get('destination_type'), 'MESSENGER');
  assert.equal(adSetParams.get('status'), 'ACTIVE');
  assert.equal(JSON.parse(adSetParams.get('promoted_object')).page_id, 'page_1');
});

test('campaign budget is sent only at campaign level', () => {
  const campaignBudget = {
    ...campaign,
    name: 'Campaign budget',
    budgetStrategy: 'CAMPAIGN',
    dailyBudget: 500000
  };

  const campaignParams = buildCampaignParams(campaignBudget);
  const adSetParams = buildConversationAdSetParams('remote-campaign', campaignBudget, adSet);

  assert.equal(campaignParams.get('daily_budget'), '500000');
  assert.equal(campaignParams.get('bid_strategy'), 'LOWEST_COST_WITHOUT_CAP');
  assert.equal(campaignParams.has('is_adset_budget_sharing_enabled'), false);
  assert.equal(adSetParams.has('daily_budget'), false);
  assert.equal(adSetParams.has('bid_strategy'), false);
});

test('ad set budget disables sharing and is sent at ad set level', () => {
  const campaignParams = buildCampaignParams(campaign);
  const adSetParams = buildConversationAdSetParams('remote-campaign', campaign, adSet);

  assert.equal(campaignParams.has('daily_budget'), false);
  assert.equal(campaignParams.get('is_adset_budget_sharing_enabled'), 'false');
  assert.equal(adSetParams.get('daily_budget'), '100000');
  assert.equal(adSetParams.get('bid_strategy'), 'LOWEST_COST_WITHOUT_CAP');
});

test('builds manual targeting with Advantage off and audience exclusions', () => {
  const targeting = buildManualTargeting({
    ...adSet,
    includedCustomAudienceIds: ['ca-include-1', 'ca-include-2'],
    excludedCustomAudienceIds: ['ca-exclude-1'],
    detailedTargeting: [
      { id: 'interest-1', name: 'Skincare', targetingField: 'interests' },
      { id: 'behavior-1', name: 'Engaged shoppers', targetingField: 'behaviors' }
    ]
  });

  assert.deepEqual(targeting.targeting_automation, { advantage_audience: 0, individual_setting: { geo: 0 } });
  assert.deepEqual(targeting.genders, [2]);
  assert.deepEqual(targeting.custom_audiences, [{ id: 'ca-include-1' }, { id: 'ca-include-2' }]);
  assert.deepEqual(targeting.excluded_custom_audiences, [{ id: 'ca-exclude-1' }]);
  assert.deepEqual(targeting.flexible_spec, [{
    interests: [{ id: 'interest-1', name: 'Skincare' }],
    behaviors: [{ id: 'behavior-1', name: 'Engaged shoppers' }]
  }]);
});

test('rejects missing Campaign account and Page plus duplicate audience intent', () => {
  const invalidAdSet = {
    ...adSet,
    includedCustomAudienceIds: ['ca-1'],
    excludedCustomAudienceIds: ['ca-1']
  };
  const issues = validateDraft({
    campaigns: [{ ...campaign, adAccountId: '', pageId: '', adSets: [invalidAdSet] }]
  });

  assert.ok(issues.some((entry) => entry.path === 'campaigns.0.adAccountId'));
  assert.ok(issues.some((entry) => entry.path === 'campaigns.0.pageId'));
  assert.ok(issues.some((entry) => entry.path.endsWith('.customAudiences')));
});

test('serializes a valid optional schedule and rejects reversed times', () => {
  const scheduled = {
    ...adSet,
    startTime: '2026-08-06T08:00:00+07:00',
    endTime: '2026-08-10T20:00:00+07:00'
  };
  const params = buildConversationAdSetParams('remote-campaign', campaign, scheduled);
  assert.equal(params.get('start_time'), scheduled.startTime);
  assert.equal(params.get('end_time'), scheduled.endTime);

  const issues = validateDraft(validDraftWith({
    ...scheduled,
    endTime: '2026-08-05T20:00:00+07:00'
  }));
  assert.ok(issues.some((entry) => entry.path.endsWith('.schedule')));
});

test('rejects attempts to enable Advantage audience', () => {
  const issues = validateDraft(validDraftWith({ ...adSet, advantageAudienceEnabled: true }));
  assert.ok(issues.some((entry) => entry.path.endsWith('.advantageAudienceEnabled')));
});

test('prefixes conversation validation issues with the Ad path', () => {
  const issues = validateDraft(validDraftWith({
    ...adSet,
    ads: [{ ...ad, conversation: { ...ad.conversation, greeting: '', customerActions: [] } }]
  }));

  assert.ok(issues.some((entry) => entry.path === 'campaigns.0.adSets.0.ads.0.conversation.greeting'));
  assert.ok(!issues.some((entry) => entry.path === 'campaigns.0.adSets.0.ads.0.conversation.customerActions'));
});

test('uses a video thumbnail URL as image_url instead of an image hash', () => {
  const params = buildVideoCreativeParams('page_1', 'video_1', {
    imageUrl: 'https://example.test/thumbnail.jpg'
  }, ad);
  const videoData = JSON.parse(params.get('object_story_spec')).video_data;

  assert.equal(videoData.image_url, 'https://example.test/thumbnail.jpg');
  assert.equal(videoData.image_hash, undefined);
});

test('adds the conversation snapshot to image and video creatives', () => {
  const image = JSON.parse(
    buildImageCreativeParams('page_1', 'hash-1', ad).get('object_story_spec')
  );
  const video = JSON.parse(
    buildVideoCreativeParams('page_1', 'video-1', {
      imageUrl: 'https://example.test/thumbnail.jpg'
    }, ad).get('object_story_spec')
  );

  assert.equal(typeof image.link_data.page_welcome_message, 'string');
  assert.equal(typeof video.video_data.page_welcome_message, 'string');
  assert.equal(JSON.parse(image.link_data.page_welcome_message).type, 'VISUAL_EDITOR');
  assert.equal(JSON.parse(video.video_data.page_welcome_message).landing_screen_type, 'welcome_message');
});

test('opts out of Meta location expansion only when regions or cities are targeted', () => {
  const withRegion = buildManualTargeting({ ...adSet, includedRegions: [{ key: '4', name: 'Ho Chi Minh' }], includedCities: [], includedCustomLocations: [] });
  assert.deepEqual(withRegion.targeting_automation.individual_setting, { geo: 0 });

  const pinsOnly = buildManualTargeting({ ...adSet, includedRegions: [], includedCities: [], includedCustomLocations: [{ latitude: 10.7, longitude: 106.6, radius: 5, distance_unit: 'kilometer' }] });
  assert.equal(pinsOnly.targeting_automation.individual_setting, undefined);
});

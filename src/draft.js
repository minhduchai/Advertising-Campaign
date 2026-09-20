import { WEBSITE_PIXEL_ID } from '../public/website-tracking.js';
import { buildPageWelcomeMessage, validateConversation } from './conversation.js';
import { validateSeedingConfig } from './seeding-template.js';
import { hasDuplicateOrOverlappingRegions, isVietnamRegion } from './audience-regions.js';

const conversationPreset = {
  objective: 'OUTCOME_ENGAGEMENT',
  optimizationGoal: 'CONVERSATIONS',
  destinationType: 'MESSENGER',
  billingEvent: 'IMPRESSIONS',
  bidStrategy: 'LOWEST_COST_WITHOUT_CAP',
  status: 'ACTIVE'
};

export function validateDraft(draft) {
  const issues = [];
  const clientIds = new Map();
  if (!Array.isArray(draft?.campaigns) || draft.campaigns.length === 0) {
    issues.push(issue('campaigns', 'Thêm ít nhất một chiến dịch'));
    return issues;
  }

  draft.campaigns.forEach((campaign, campaignIndex) => {
    const campaignPath = `campaigns.${campaignIndex}`;
    validateClientId(campaign.clientId, `${campaignPath}.clientId`, issues, clientIds);
    if (!campaign.name?.trim()) {
      issues.push(issue(`${campaignPath}.name`, 'Nhập tên chiến dịch'));
    }
    if (!campaign.adAccountId) {
      issues.push(issue(`${campaignPath}.adAccountId`, 'Chọn tài khoản quảng cáo'));
    }
    if (!campaign.pageId) {
      issues.push(issue(`${campaignPath}.pageId`, 'Chọn Facebook Page'));
    }
    if (!['CAMPAIGN', 'AD_SET'].includes(campaign.budgetStrategy)) {
      issues.push(issue(`${campaignPath}.budgetStrategy`, 'Chọn chiến lược ngân sách'));
    }
    if (campaign.budgetStrategy === 'CAMPAIGN' && !isPositiveInteger(campaign.dailyBudget)) {
      issues.push(issue(`${campaignPath}.dailyBudget`, 'Ngân sách chiến dịch phải lớn hơn 0'));
    }
    issues.push(...validateSeedingConfig(campaign.seeding, `${campaignPath}.seeding`));
    if (!Array.isArray(campaign.adSets) || campaign.adSets.length === 0) {
      issues.push(issue(`${campaignPath}.adSets`, 'Thêm ít nhất một nhóm quảng cáo'));
      return;
    }

    campaign.adSets.forEach((adSet, adSetIndex) => {
      const adSetPath = `${campaignPath}.adSets.${adSetIndex}`;
      validateClientId(adSet.clientId, `${adSetPath}.clientId`, issues, clientIds);
      if (!adSet.name?.trim()) {
        issues.push(issue(`${adSetPath}.name`, 'Nhập tên nhóm quảng cáo'));
      }
      if (campaign.budgetStrategy === 'AD_SET' && !isPositiveInteger(adSet.dailyBudget)) {
        issues.push(issue(`${adSetPath}.dailyBudget`, 'Ngân sách nhóm quảng cáo phải lớn hơn 0'));
      }
      if (!Number.isInteger(Number(adSet.ageMin)) || !Number.isInteger(Number(adSet.ageMax)) || Number(adSet.ageMin) < 13 || Number(adSet.ageMax) > 65 || Number(adSet.ageMin) > Number(adSet.ageMax)) {
        issues.push(issue(`${adSetPath}.ages`, 'Độ tuổi phải nằm trong khoảng 13–65'));
      }
      validateLocations(adSet, adSetPath, issues);
      const savedAdvantageAudience = adSet.advantageAudienceEnabled === true
        && Number.isInteger(Number(adSet.audienceControlAgeMin))
        && Number(adSet.audienceControlAgeMin) >= 13
        && Number(adSet.audienceControlAgeMin) <= Number(adSet.ageMin);
      if (adSet.advantageAudienceEnabled !== false && !savedAdvantageAudience) {
        issues.push(issue(`${adSetPath}.advantageAudienceEnabled`, 'Kiểm tra tuổi tối thiểu trong cài đặt Advantage+'));
      }
      if (hasAudienceOverlap(adSet)) {
        issues.push(issue(`${adSetPath}.customAudiences`, 'Một đối tượng tùy chỉnh không thể vừa bao gồm vừa loại trừ'));
      }
      validateSchedule(adSet, adSetPath, issues);
      if (!Array.isArray(adSet.ads) || adSet.ads.length === 0) {
        issues.push(issue(`${adSetPath}.ads`, 'Thêm ít nhất một quảng cáo'));
        return;
      }

      adSet.ads.forEach((ad, adIndex) => {
        const adPath = `${adSetPath}.ads.${adIndex}`;
        validateClientId(ad.clientId, `${adPath}.clientId`, issues, clientIds);
        const publicationMode = ad.publicationMode ?? 'DARK';
        if (!ad.name?.trim()) {
          issues.push(issue(`${adPath}.name`, 'Nhập tên quảng cáo'));
        }
        if (!ad.primaryText?.trim()) {
          issues.push(issue(`${adPath}.primaryText`, 'Nhập văn bản chính'));
        }
        if (!ad.headline?.trim()) {
          issues.push(issue(`${adPath}.headline`, 'Nhập tiêu đề'));
        }
        if (!ad.mediaId) {
          issues.push(issue(`${adPath}.mediaId`, 'Chọn ảnh hoặc video'));
        }
        if (ad.mediaAsset && !isValidMetaAsset(ad.mediaAsset, campaign.adAccountId)) {
          issues.push(issue(`${adPath}.mediaId`, 'Media Meta không thuộc tài khoản quảng cáo của chiến dịch'));
        }
        if (!['DARK', 'PUBLIC_TEST'].includes(publicationMode)) {
          issues.push(issue(`${adPath}.publicationMode`, 'Chọn chế độ bài viết hợp lệ'));
        }
        if (publicationMode === 'PUBLIC_TEST' && ad.mediaKind === 'video') {
          issues.push(issue(`${adPath}.mediaId`, 'Public Test hiện chỉ hỗ trợ ảnh; video cần Meta App Live'));
        }
        if (publicationMode === 'PUBLIC_TEST' && ad.mediaAsset) {
          issues.push(issue(`${adPath}.mediaId`, 'Public Test cần file gốc; media tải trực tiếp Meta chỉ hỗ trợ bài quảng cáo ẩn'));
        }
        issues.push(...validateConversation(ad.conversation, `${adPath}.conversation`));
      });
    });
  });

  return issues;
}

export function buildCampaignParams(campaign) {
  const params = {
    name: campaign.name,
    objective: conversationPreset.objective,
    buying_type: 'AUCTION',
    special_ad_categories: JSON.stringify(categoriesFor(campaign)),
    status: conversationPreset.status
  };

  if (campaign.budgetStrategy === 'CAMPAIGN') {
    params.daily_budget = String(campaign.dailyBudget);
    params.bid_strategy = conversationPreset.bidStrategy;
  } else {
    params.is_adset_budget_sharing_enabled = 'false';
  }

  return createParams(params);
}

export function buildConversationAdSetParams(campaignId, campaign, adSet) {
  const params = {
    name: adSet.name,
    campaign_id: campaignId,
    billing_event: conversationPreset.billingEvent,
    optimization_goal: conversationPreset.optimizationGoal,
    destination_type: conversationPreset.destinationType,
    promoted_object: JSON.stringify({ page_id: campaign.pageId }),
    targeting: JSON.stringify(buildManualTargeting(adSet)),
    status: conversationPreset.status
  };

  if (campaign.budgetStrategy === 'AD_SET') {
    params.daily_budget = String(adSet.dailyBudget);
    params.bid_strategy = conversationPreset.bidStrategy;
  }
  if (adSet.startTime) {
    params.start_time = adSet.startTime;
  }
  if (adSet.endTime) {
    params.end_time = adSet.endTime;
  }

  return createParams(params);
}

export function buildManualTargeting(adSet) {
  const geoLocations = {};
  if (adSet.includedRegions?.length) geoLocations.regions = regionReferences(adSet.includedRegions);
  if (adSet.includedCities?.length) geoLocations.cities = cityReferences(adSet.includedCities);
  addRadiusLocations(geoLocations, adSet.includedCustomLocations);
  // Bỏ tick "Tiếp cận thêm người có khả năng phản hồi" (Meta mặc định bật khi chọn tỉnh/thành phố):
  // chỉ nhắm đúng vị trí đã chọn, không mở rộng sang người "quan tâm" tới vị trí đó.
  const locationExpansion = geoLocations.regions || geoLocations.cities ? { individual_setting: { geo: 0 } } : {};
  const targeting = {
    geo_locations: geoLocations,
    ...(adSet.advantageAudienceEnabled ? {
      age_min: Number(adSet.audienceControlAgeMin),
      age_range: [Number(adSet.ageMin), Number(adSet.ageMax)],
      targeting_automation: { advantage_audience: 1, ...locationExpansion }
    } : {
      age_min: Number(adSet.ageMin),
      age_max: Number(adSet.ageMax),
      targeting_automation: { advantage_audience: 0, ...locationExpansion }
    })
  };

  if (adSet.excludedRegions?.length
    || adSet.excludedCities?.length
    || adSet.excludedCustomLocations?.length) {
    targeting.excluded_geo_locations = {};
    if (adSet.excludedRegions?.length) {
      targeting.excluded_geo_locations.regions = regionReferences(adSet.excludedRegions);
    }
    if (adSet.excludedCities?.length) {
      targeting.excluded_geo_locations.cities = cityReferences(adSet.excludedCities);
    }
    if (adSet.excludedCustomLocations?.length) {
      addRadiusLocations(targeting.excluded_geo_locations, adSet.excludedCustomLocations);
    }
  }

  if (adSet.genders?.length) {
    targeting.genders = adSet.genders.map(Number);
  }
  if (adSet.locales?.length) {
    targeting.locales = adSet.locales.map(Number);
  }
  if (adSet.includedCustomAudienceIds?.length) {
    targeting.custom_audiences = adSet.includedCustomAudienceIds.map((id) => ({ id }));
  }
  if (adSet.excludedCustomAudienceIds?.length) {
    targeting.excluded_custom_audiences = adSet.excludedCustomAudienceIds.map((id) => ({ id }));
  }

  const flexibleGroup = groupDetailedTargeting(adSet.detailedTargeting ?? []);
  if (Object.keys(flexibleGroup).length > 0) {
    targeting.flexible_spec = [flexibleGroup];
  }

  return targeting;
}

export function buildImageCreativeParams(pageId, imageHash, ad) {
  return createParams({
    name: ad.name,
    object_story_spec: JSON.stringify({
      page_id: pageId,
      link_data: {
        image_hash: imageHash,
        link: `https://m.me/${pageId}`,
        message: ad.primaryText,
        name: ad.headline,
        page_welcome_message: buildPageWelcomeMessage(ad.conversation, 'image'),
        call_to_action: {
          type: 'MESSAGE_PAGE',
          value: { app_destination: 'MESSENGER' }
        }
      }
    })
  });
}

export function buildVideoCreativeParams(pageId, videoId, thumbnail, ad) {
  const videoData = {
    video_id: videoId,
    message: ad.primaryText,
    title: ad.headline,
    page_welcome_message: buildPageWelcomeMessage(ad.conversation, 'video'),
    call_to_action: {
      type: 'MESSAGE_PAGE',
      value: { app_destination: 'MESSENGER' }
    }
  };

  if (thumbnail.imageHash) {
    videoData.image_hash = thumbnail.imageHash;
  }
  if (thumbnail.imageUrl) {
    videoData.image_url = thumbnail.imageUrl;
  }

  return createParams({
    name: ad.name,
    object_story_spec: JSON.stringify({ page_id: pageId, video_data: videoData })
  });
}

export function buildPublicPostCreativeParams(postId, ad) {
  return createParams({
    name: ad.name,
    object_story_id: postId,
    call_to_action_type: 'MESSAGE_PAGE',
    page_welcome_message: buildPageWelcomeMessage(ad.conversation, 'image')
  });
}

export function buildAdParams(adSetId, creativeId, ad) {
  const params = createParams({
    name: ad.name,
    adset_id: adSetId,
    creative: JSON.stringify({ creative_id: creativeId }),
    status: conversationPreset.status
  });
  params.set('tracking_specs', JSON.stringify([{
    'action.type': ['offsite_conversion'],
    fb_pixel: [WEBSITE_PIXEL_ID]
  }]));
  return params;
}

function createParams(values) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) {
    params.set(key, value);
  }
  return params;
}

function issue(path, message) {
  return { path, message };
}

function validateClientId(clientId, path, issues, clientIds) {
  if (typeof clientId !== 'string' || !clientId.trim()) {
    issues.push(issue(path, 'clientId phải là chuỗi không rỗng'));
    return;
  }

  const normalizedClientId = clientId.trim();
  const existingPath = clientIds.get(normalizedClientId);
  if (existingPath) {
    issues.push(issue(path, `clientId "${normalizedClientId}" đã được dùng tại ${existingPath}`));
    return;
  }
  clientIds.set(normalizedClientId, path);
}

function categoriesFor(campaign) {
  return campaign.specialAdCategory && campaign.specialAdCategory !== 'NONE'
    ? [campaign.specialAdCategory]
    : [];
}

function isPositiveInteger(value) {
  return Number.isInteger(Number(value)) && Number(value) > 0;
}

function groupDetailedTargeting(items) {
  return items.reduce((group, item) => {
    if (!item.id || !item.targetingField) {
      return group;
    }
    group[item.targetingField] ??= [];
    group[item.targetingField].push({ id: item.id, name: item.name });
    return group;
  }, {});
}

function hasAudienceOverlap(adSet) {
  const included = new Set(adSet.includedCustomAudienceIds ?? []);
  return (adSet.excludedCustomAudienceIds ?? []).some((id) => included.has(id));
}

function validateLocations(adSet, adSetPath, issues) {
  const locationMode = adSet.locationMode ?? 'REGIONS';
  const includedRegions = Array.isArray(adSet.includedRegions) ? adSet.includedRegions : [];
  const excludedRegions = Array.isArray(adSet.excludedRegions) ? adSet.excludedRegions : [];
  const includedCities = Array.isArray(adSet.includedCities) ? adSet.includedCities : [];
  const excludedCities = Array.isArray(adSet.excludedCities) ? adSet.excludedCities : [];
  const includedCustomLocations = Array.isArray(adSet.includedCustomLocations)
    ? adSet.includedCustomLocations
    : [];
  const excludedCustomLocations = Array.isArray(adSet.excludedCustomLocations)
    ? adSet.excludedCustomLocations
    : [];

  if (locationMode !== 'REGIONS') {
    issues.push(issue(`${adSetPath}.locationMode`, 'Chỉ hỗ trợ chọn tỉnh/thành phố Việt Nam'));
  }
  if (includedRegions.length + includedCities.length + includedCustomLocations.length === 0) {
    issues.push(issue(`${adSetPath}.includedRegions`, 'Chọn ít nhất một tỉnh/thành phố hoặc vị trí bán kính tại Việt Nam'));
  }
  if (includedRegions.some((region) => !isVietnamRegion(region))) {
    issues.push(issue(`${adSetPath}.includedRegions`, 'Vị trí bao gồm phải là tỉnh/thành phố Việt Nam từ Meta'));
  }
  if (excludedRegions.some((region) => !isVietnamRegion(region))) {
    issues.push(issue(`${adSetPath}.excludedRegions`, 'Vị trí loại trừ phải là tỉnh/thành phố Việt Nam từ Meta'));
  }
  if (includedCities.some((city) => !isVietnamCity(city))) {
    issues.push(issue(`${adSetPath}.includedCities`, 'Vị trí bán kính bao gồm không hợp lệ'));
  }
  if (excludedCities.some((city) => !isVietnamCity(city))) {
    issues.push(issue(`${adSetPath}.excludedCities`, 'Vị trí bán kính loại trừ không hợp lệ'));
  }
  if (includedCustomLocations.some((location) => !isVietnamCustomLocation(location))) {
    issues.push(issue(`${adSetPath}.includedCustomLocations`, 'Ghim bán kính bao gồm không hợp lệ'));
  }
  if (excludedCustomLocations.some((location) => !isVietnamCustomLocation(location))) {
    issues.push(issue(`${adSetPath}.excludedCustomLocations`, 'Ghim bán kính loại trừ không hợp lệ'));
  }

  if (hasDuplicateOrOverlappingRegions(includedRegions, excludedRegions)) {
    issues.push(issue(`${adSetPath}.regions`, 'Một tỉnh/thành phố không thể xuất hiện nhiều lần hoặc vừa bao gồm vừa loại trừ'));
  }
  if (hasLocationOverlap(includedCities, excludedCities)) {
    issues.push(issue(`${adSetPath}.cities`, 'Một thành phố không thể xuất hiện nhiều lần hoặc vừa bao gồm vừa loại trừ'));
  }
  if (hasLocationOverlap(includedCustomLocations, excludedCustomLocations)) {
    issues.push(issue(`${adSetPath}.customLocations`, 'Một ghim không thể xuất hiện nhiều lần hoặc vừa bao gồm vừa loại trừ'));
  }

}

function regionReferences(regions = []) {
  return regions.map((region) => ({ key: String(region.key) }));
}

function cityReferences(cities = []) {
  return cities.map((city) => ({
    key: String(city.key),
    ...(city.radius == null ? {} : {
      radius: Number(city.radius),
      distance_unit: city.distanceUnit ?? 'kilometer'
    })
  }));
}

function customLocationReferences(locations = []) {
  return locations.map((location) => ({
    latitude: Number(location.latitude),
    longitude: Number(location.longitude),
    radius: Number(location.radius),
    distance_unit: location.distanceUnit ?? 'kilometer'
  }));
}

function addRadiusLocations(target, locations = []) {
  const pins = locations.filter((location) => location.type !== 'place');
  const places = locations.filter((location) => location.type === 'place');
  if (pins.length) target.custom_locations = customLocationReferences(pins);
  if (places.length) target.places = places.map((place) => ({
    key: String(place.metaPlaceKey), radius: Number(place.radius),
    distance_unit: place.distanceUnit ?? 'kilometer'
  }));
}

function isVietnamCity(city) {
  return Boolean(
    city
    && String(city.key ?? '').trim()
    && String(city.name ?? '').trim()
    && city.type === 'city'
    && city.countryCode === 'VN'
    && (city.radius == null || validLocationRadius(city))
  );
}

function isVietnamCustomLocation(location) {
  if (location?.type === 'place') {
    return Boolean(String(location.metaPlaceKey ?? '').trim()
      && String(location.name ?? '').trim() && location.countryCode === 'VN'
      && validLocationRadius(location));
  }
  const latitude = Number(location?.latitude);
  const longitude = Number(location?.longitude);
  return Boolean(
    location
    && String(location.name ?? '').trim()
    && location.type === 'custom_location'
    && location.countryCode === 'VN'
    && Number.isFinite(latitude)
    && latitude >= -90
    && latitude <= 90
    && Number.isFinite(longitude)
    && longitude >= -180
    && longitude <= 180
    && validLocationRadius(location)
  );
}

function hasLocationOverlap(included = [], excluded = []) {
  const includedKeys = included.map((item) => String(item.key));
  const excludedKeys = excluded.map((item) => String(item.key));
  return new Set(includedKeys).size !== includedKeys.length
    || new Set(excludedKeys).size !== excludedKeys.length
    || excludedKeys.some((key) => includedKeys.includes(key));
}

function validLocationRadius(location) {
  const unit = location.distanceUnit ?? 'kilometer';
  const radius = Number(location.radius);
  return ['kilometer', 'mile'].includes(unit) && Number.isFinite(radius)
    && radius > 0 && radius <= (unit === 'mile' ? 50 : 80);
}

function isValidMetaAsset(asset, accountId) {
  if (!asset || asset.accountId !== accountId) return false;
  if (asset.kind === 'image') return typeof asset.imageHash === 'string' && Boolean(asset.imageHash);
  if (asset.kind === 'video') return typeof asset.videoId === 'string' && Boolean(asset.videoId);
  return false;
}

function validateSchedule(adSet, adSetPath, issues) {
  const start = parseOptionalDate(adSet.startTime);
  const end = parseOptionalDate(adSet.endTime);

  if (adSet.startTime && start === null) {
    issues.push(issue(`${adSetPath}.startTime`, 'Thời gian bắt đầu không hợp lệ'));
  }
  if (adSet.endTime && end === null) {
    issues.push(issue(`${adSetPath}.endTime`, 'Thời gian kết thúc không hợp lệ'));
  }
  if (start !== null && end !== null && end <= start) {
    issues.push(issue(`${adSetPath}.schedule`, 'Thời gian kết thúc phải sau thời gian bắt đầu'));
  }
}

function parseOptionalDate(value) {
  if (!value) {
    return null;
  }
  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? null : timestamp;
}

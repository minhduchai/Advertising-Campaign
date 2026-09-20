const stepOrder = ['campaign', 'adSet', 'ad', 'review'];

export function workspaceProgress(state) {
  const campaigns = state?.draft?.campaigns ?? [];
  const selection = findProgressNode(state, state?.selection?.clientId);
  const campaign = selection?.campaign ?? campaigns[0] ?? null;
  const adSet = selection?.adSet ?? campaign?.adSets?.[0] ?? null;
  const ad = selection?.ad ?? adSet?.ads?.[0] ?? null;

  const campaignRequirements = campaign ? requirementsForCampaign(campaign) : [];
  const campaignAdSetRequirements = campaign
    ? (campaign.adSets ?? []).flatMap((entry) => requirementsForAdSet(campaign, entry))
    : [];
  const campaignAdRequirements = campaign
    ? (campaign.adSets ?? []).flatMap((entry) => (
      (entry.ads ?? []).flatMap((item) => requirementsForAd(campaign, entry, item))
    ))
    : [];
  const allRequirements = allDraftRequirements(state);
  const formComplete = campaigns.length > 0 && allRequirements.length > 0
    && campaigns.every((entry) => (
      Array.isArray(entry.adSets)
      && entry.adSets.length > 0
      && entry.adSets.every((group) => Array.isArray(group.ads) && group.ads.length > 0)
    ))
    && allRequirements.every((requirement) => requirement.complete);
  const reviewActive = Boolean(state?.ui?.progressReviewMode);
  const reviewComplete = reviewActive && formComplete && (state?.issues ?? []).length === 0;
  const selectedType = selection?.type ?? 'campaign';

  const steps = [
    progressStep({
      id: 'campaign',
      label: 'Chiến dịch',
      description: 'Tên, tài khoản, Page, ngân sách và seeding',
      requirements: campaignRequirements,
      targetClientId: campaign?.clientId ?? null,
      current: selectedType === 'campaign' && !reviewActive,
      locked: false
    }),
    progressStep({
      id: 'adSet',
      label: 'Nhóm quảng cáo',
      description: 'Ngân sách, đối tượng và vị trí',
      requirements: campaignAdSetRequirements,
      targetClientId: firstIncompleteClientId(campaignAdSetRequirements) ?? adSet?.clientId ?? null,
      current: selectedType === 'adSet' && !reviewActive,
      locked: campaignRequirements.some((requirement) => !requirement.complete),
      gateRequirements: campaignRequirements
    }),
    progressStep({
      id: 'ad',
      label: 'Quảng cáo',
      description: 'Nội dung, media và cuộc trò chuyện',
      requirements: campaignAdRequirements,
      targetClientId: firstIncompleteClientId(campaignAdRequirements) ?? ad?.clientId ?? null,
      current: selectedType === 'ad' && !reviewActive,
      locked: campaignRequirements.some((requirement) => !requirement.complete)
        || campaignAdSetRequirements.some((requirement) => !requirement.complete),
      gateRequirements: [
        ...campaignRequirements,
        ...campaignAdSetRequirements
      ]
    }),
    progressStep({
      id: 'review',
      label: 'Kiểm tra & Đăng',
      description: 'Rà lỗi Meta trước khi kích hoạt',
      requirements: allRequirements,
      targetClientId: null,
      current: reviewActive,
      complete: reviewComplete,
      locked: !formComplete,
      gateRequirements: allRequirements
    })
  ];

  return {
    selection,
    campaign,
    adSet,
    ad,
    steps,
    formComplete,
    reviewActive,
    reviewComplete,
    completedSteps: steps.filter((step) => step.complete).length,
    allRequirements
  };
}

export function requirementsForCampaign(campaign) {
  if (!campaign) return [];
  const requirements = [
    requirement(campaign, 'campaign', 'name', 'Tên chiến dịch', Boolean(String(campaign.name ?? '').trim()), 'Nhập tên chiến dịch'),
    requirement(campaign, 'campaign', 'adAccountId', 'Tài khoản quảng cáo', Boolean(String(campaign.adAccountId ?? '').trim()), 'Chọn tài khoản quảng cáo'),
    requirement(campaign, 'campaign', 'pageId', 'Facebook Page', Boolean(String(campaign.pageId ?? '').trim()), 'Chọn Facebook Page'),
    requirement(campaign, 'campaign', 'budgetStrategy', 'Chiến lược ngân sách', ['CAMPAIGN', 'AD_SET'].includes(campaign.budgetStrategy), 'Chọn nơi quản lý ngân sách')
  ];
  if (campaign.budgetStrategy === 'CAMPAIGN') {
    requirements.push(requirement(
      campaign,
      'campaign',
      'dailyBudget',
      'Ngân sách chiến dịch',
      isPositiveInteger(campaign.dailyBudget),
      'Nhập ngân sách chiến dịch lớn hơn 0'
    ));
  }
  requirements.push(...requirementsForSeeding(campaign));
  return requirements;
}

export function requirementsForAdSet(campaign, adSet) {
  if (!campaign || !adSet) return [];
  const includedLocationCount = [
    ...(adSet.includedRegions ?? []),
    ...(adSet.includedCities ?? []),
    ...(adSet.includedCustomLocations ?? [])
  ].length;
  const ageMin = Number(adSet.ageMin);
  const ageMax = Number(adSet.ageMax);
  const agesValid = Number.isInteger(ageMin) && Number.isInteger(ageMax)
    && ageMin >= 13 && ageMax <= 65 && ageMin <= ageMax;
  const scheduleValid = isScheduleValid(adSet.startTime, adSet.endTime);
  const requirements = [
    requirement(adSet, 'adSet', 'name', 'Tên nhóm quảng cáo', Boolean(String(adSet.name ?? '').trim()), 'Nhập tên nhóm quảng cáo'),
    requirement(adSet, 'adSet', 'includedRegions', 'Vị trí quảng cáo', includedLocationCount > 0, 'Chọn ít nhất một vị trí tại Việt Nam'),
    requirement(adSet, 'adSet', 'ages', 'Độ tuổi', agesValid, 'Chọn độ tuổi hợp lệ từ 13 đến 65'),
    requirement(adSet, 'adSet', 'advantageAudienceEnabled', 'Advantage+', adSet.advantageAudienceEnabled === false || (
      adSet.advantageAudienceEnabled === true
      && Number.isInteger(Number(adSet.audienceControlAgeMin))
      && Number(adSet.audienceControlAgeMin) >= 13 && Number(adSet.audienceControlAgeMin) <= ageMin
    ), 'Kiểm tra cài đặt Advantage+ và tuổi tối thiểu của đối tượng đã lưu'),
    requirement(adSet, 'adSet', 'customAudiences', 'Đối tượng tùy chỉnh', !hasAudienceOverlap(adSet), 'Một đối tượng không thể vừa bao gồm vừa loại trừ'),
    requirement(adSet, 'adSet', 'schedule', 'Lịch chạy', scheduleValid, 'Thời gian kết thúc phải sau thời gian bắt đầu')
  ];
  if (campaign.budgetStrategy === 'AD_SET') {
    requirements.splice(1, 0, requirement(
      adSet,
      'adSet',
      'dailyBudget',
      'Ngân sách nhóm',
      isPositiveInteger(adSet.dailyBudget),
      'Nhập ngân sách nhóm quảng cáo lớn hơn 0'
    ));
  }
  return requirements;
}

export function requirementsForAd(_campaign, _adSet, ad) {
  if (!ad) return [];
  const conversation = ad.conversation ?? {};
  return [
    requirement(ad, 'ad', 'name', 'Tên quảng cáo', Boolean(String(ad.name ?? '').trim()), 'Nhập tên quảng cáo'),
    requirement(ad, 'ad', 'primaryText', 'Văn bản chính', Boolean(String(ad.primaryText ?? '').trim()), 'Nhập văn bản chính'),
    requirement(ad, 'ad', 'headline', 'Tiêu đề', Boolean(String(ad.headline ?? '').trim()), 'Nhập tiêu đề quảng cáo'),
    requirement(ad, 'ad', 'mediaId', 'Ảnh hoặc video', Boolean(ad.mediaId), 'Chọn ảnh hoặc video quảng cáo'),
    requirement(ad, 'ad', 'conversation.templateName', 'Tên mẫu cuộc trò chuyện', Boolean(String(conversation.templateName ?? '').trim()), 'Nhập tên mẫu cuộc trò chuyện'),
    requirement(ad, 'ad', 'conversation.greeting', 'Lời chào cuộc trò chuyện', validGreeting(conversation), greetingMessage(conversation)),
    requirement(ad, 'ad', 'conversation.customerActions', 'Nút mở trang web', validCustomerActions(conversation.customerActions), 'Hoàn tất nhãn và URL https:// cho các nút')
  ];
}

export function requirementsForSeeding(campaign) {
  if (!campaign) return [];
  return [requirement(
    campaign,
    'campaign',
    'seeding.templateId',
    'Mẫu seeding',
    Boolean(String(campaign.seeding?.templateId ?? '').trim()),
    'Chọn mẫu seeding'
  )];
}

export function allDraftRequirements(state) {
  return (state?.draft?.campaigns ?? []).flatMap((campaign) => [
    ...requirementsForCampaign(campaign),
    ...(campaign.adSets ?? []).flatMap((adSet) => [
      ...requirementsForAdSet(campaign, adSet),
      ...(adSet.ads ?? []).flatMap((ad) => requirementsForAd(campaign, adSet, ad))
    ])
  ]);
}

export function navigationGate(state, clientId) {
  const match = findProgressNode(state, clientId);
  if (!match || match.type === 'campaign') return { allowed: Boolean(match), match, missing: [] };
  const campaignMissing = requirementsForCampaign(match.campaign).filter((item) => !item.complete);
  if (campaignMissing.length > 0) return { allowed: false, match, missing: campaignMissing };
  if (match.type === 'adSet') return { allowed: true, match, missing: [] };
  const adSetMissing = requirementsForAdSet(match.campaign, match.adSet).filter((item) => !item.complete);
  return { allowed: adSetMissing.length === 0, match, missing: adSetMissing };
}

export function currentStepRequirements(state) {
  const match = findProgressNode(state, state?.selection?.clientId);
  if (!match) return [];
  if (match.type === 'campaign') return requirementsForCampaign(match.campaign);
  if (match.type === 'adSet') return requirementsForAdSet(match.campaign, match.adSet);
  return requirementsForAd(match.campaign, match.adSet, match.ad);
}

export function firstIncompleteRequirement(state) {
  return allDraftRequirements(state).find((requirement) => !requirement.complete) ?? null;
}

export function progressRequirement(state, clientId, field) {
  return allDraftRequirements(state).find((requirement) => (
    String(requirement.clientId) === String(clientId)
    && normalizeField(requirement.field) === normalizeField(field)
  )) ?? null;
}

export function findProgressNode(state, clientId) {
  for (const campaign of state?.draft?.campaigns ?? []) {
    if (campaign.clientId === clientId) return { node: campaign, type: 'campaign', campaign };
    for (const adSet of campaign.adSets ?? []) {
      if (adSet.clientId === clientId) return { node: adSet, type: 'adSet', campaign, adSet };
      for (const ad of adSet.ads ?? []) {
        if (ad.clientId === clientId) return { node: ad, type: 'ad', campaign, adSet, ad };
      }
    }
  }
  return null;
}

export function stepIndex(type) {
  return stepOrder.indexOf(type);
}

function progressStep({ id, label, description, requirements, targetClientId, current, locked, complete, gateRequirements = [] }) {
  const completed = requirements.filter((requirement) => requirement.complete).length;
  const total = requirements.length;
  return {
    id,
    label,
    description,
    requirements,
    targetClientId,
    current,
    locked,
    complete: complete ?? (total > 0 && completed === total),
    completed,
    total,
    missing: requirements.filter((requirement) => !requirement.complete),
    gateRequirements: gateRequirements.filter((requirement) => !requirement.complete)
  };
}

function requirement(node, type, field, label, complete, message) {
  return {
    key: `${node.clientId}:${field}`,
    clientId: node.clientId,
    type,
    field,
    label,
    complete: Boolean(complete),
    message
  };
}

function firstIncompleteClientId(requirements) {
  return requirements.find((requirement) => !requirement.complete)?.clientId ?? null;
}

function isPositiveInteger(value) {
  return Number.isInteger(Number(value)) && Number(value) > 0;
}

function isScheduleValid(startValue, endValue) {
  const start = parseOptionalDate(startValue);
  const end = parseOptionalDate(endValue);
  if (startValue && start === null) return false;
  if (endValue && end === null) return false;
  return start === null || end === null || end > start;
}

function parseOptionalDate(value) {
  if (!value) return null;
  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? null : timestamp;
}

function hasAudienceOverlap(adSet) {
  const included = new Set((adSet.includedCustomAudienceIds ?? []).map(String));
  return (adSet.excludedCustomAudienceIds ?? []).some((id) => included.has(String(id)));
}

function validGreeting(conversation) {
  const greeting = String(conversation.greeting ?? '').trim();
  const limit = conversation.imageMediaId ? 80 : 640;
  return Boolean(greeting) && greeting.length <= limit;
}

function greetingMessage(conversation) {
  const limit = conversation.imageMediaId ? 80 : 640;
  return String(conversation.greeting ?? '').trim().length > limit
    ? `Lời chào tối đa ${limit} ký tự`
    : 'Nhập lời chào cuộc trò chuyện';
}

function validCustomerActions(actions) {
  if (!Array.isArray(actions) || actions.length > 3) return false;
  return actions.every((action) => (
    String(action?.label ?? '').trim().length > 0
    && String(action?.label ?? '').trim().length <= 20
    && action?.type === 'OPEN_URL'
    && isHttpsUrl(action?.value)
  ));
}

function isHttpsUrl(value) {
  try {
    const raw = String(value ?? '').trim();
    if (!raw) return false;
    const candidate = /^[a-z][a-z\d+.-]*:/i.test(raw) ? raw : `https://${raw}`;
    return new URL(candidate).protocol === 'https:';
  } catch {
    return false;
  }
}

function normalizeField(field) {
  if (['ageMin', 'ageMax'].includes(field)) return 'ages';
  if (['startTime', 'endTime'].includes(field)) return 'schedule';
  return String(field ?? '');
}

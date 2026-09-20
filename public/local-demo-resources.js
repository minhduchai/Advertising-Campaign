const LOCAL_PREVIEW_HOSTS = new Set(['localhost', '127.0.0.1']);

export function shouldUseLocalDemoResources(location, error = null) {
  if (!LOCAL_PREVIEW_HOSTS.has(String(location?.hostname ?? '').toLowerCase())) return false;
  const params = new URLSearchParams(String(location?.search ?? ''));
  if (params.get('realResources') === '1') return false;
  if (params.get('frontend') === 'launch-control' && params.get('demoResources') !== '1') return false;
  return params.get('demoResources') === '1' || Number(error?.status) === 401;
}

export function createLocalDemoResources() {
  const adAccounts = [
    { id: 'act_demo_42', name: 'LG Clinic 42 (Demo) – Triệt lông Bikini Nam', currency: 'VND', canAdvertise: true },
    { id: 'act_demo_43', name: 'LG Clinic 43 (Demo) – Triệt lông Nách Nữ', currency: 'VND', canAdvertise: true },
    { id: 'act_demo_spa', name: 'Spa – LGS 10 (Demo)', currency: 'USD', canAdvertise: true },
    {
      id: 'act_demo_limited',
      name: 'Tài khoản đang hạn chế (Demo)',
      currency: 'VND',
      canAdvertise: false,
      unavailableReason: 'Tài khoản quảng cáo đang bị hạn chế · dữ liệu minh họa'
    }
  ];
  const pages = [
    { id: 'demo_page_luxury', name: 'LG Clinic Luxury (Demo)', canAdvertise: true },
    { id: 'demo_page_bikini', name: 'Hệ Thống Triệt Lông Hàng Đầu Sài Gòn (Demo)', canAdvertise: true },
    { id: 'demo_page_scar', name: 'LG Clinic – Điều Trị Sẹo Rỗ (Demo)', canAdvertise: true },
    { id: 'demo_page_spa', name: 'Little Garden Spa (Demo)', canAdvertise: true },
    { id: 'demo_page_academy', name: 'Legacy Academy – Đào Tạo Spa (Demo)', canAdvertise: true },
    {
      id: 'demo_page_limited',
      name: 'LG Clinic – Page bị hạn chế (Demo)',
      canAdvertise: false,
      unavailableReason: 'Page đang bị hạn chế quảng cáo · dữ liệu minh họa'
    }
  ];
  const accountResourcesById = Object.fromEntries(adAccounts.map((account, index) => [
    account.id,
    createDemoAccountResources(account.id, index)
  ]));

  return {
    adAccounts,
    pages,
    pageDiscovery: {
      loaded: true,
      requiresBusinessReconnect: false,
      warnings: ['Dữ liệu demo chỉ dùng để kiểm tra giao diện local.'],
      counts: {
        total: pages.length,
        available: pages.filter((page) => page.canAdvertise !== false).length,
        unavailable: pages.filter((page) => page.canAdvertise === false).length,
        promotable: pages.filter((page) => page.canAdvertise !== false).length,
        managed: 3,
        businessOwned: 3,
        businessClient: 0
      }
    },
    accountResourcesById,
    audienceTemplates: createDemoToolAudienceTemplates(),
    audienceTemplatesLoaded: true,
    audienceTemplatesError: null,
    conversationTemplates: createDemoConversationTemplates(),
    conversationTemplatesLoaded: true,
    seedingTemplates: createDemoSeedingTemplates(),
    seedingTemplatesLoaded: true,
    seedingTemplatesError: null,
    campaignPresets: createDemoCampaignPresets(),
    campaignPresetsLoaded: true,
    campaignPresetsError: null,
    capabilities: {},
    mediaUploadMode: 'local'
  };
}

export function applyLocalDemoResources(state) {
  state.connected = false;
  state.metaUser = null;
  state.resources = {
    ...state.resources,
    ...createLocalDemoResources()
  };
  state.ui ??= {};
  state.ui.localDemoResources = true;
  return state.resources;
}

function createDemoAccountResources(accountId, index) {
  const suffix = String(index + 1).padStart(2, '0');
  return {
    loaded: true,
    customAudiences: [
      { id: `${accountId}_customers`, name: `Danh sách khách hàng Demo ${suffix}`, subtype: 'CUSTOM' },
      { id: `${accountId}_messages`, name: 'Người đã nhắn tin trong 365 ngày', subtype: 'ENGAGEMENT' },
      { id: `${accountId}_lookalike`, name: 'Đối tượng tương tự khách hàng 1%', subtype: 'LOOKALIKE' },
      { id: `${accountId}_website`, name: 'Người đã truy cập website 180 ngày', subtype: 'WEBSITE' }
    ],
    savedAudiences: [
      {
        id: `${accountId}_saved_female_hcm`,
        name: 'Nữ 22–45 · Hồ Chí Minh (Demo)',
        compatible: true,
        issues: [],
        content: audienceContent({ ageMin: 22, ageMax: 45, genders: [2], regionKey: '3847', regionName: 'Ho Chi Minh City' })
      },
      {
        id: `${accountId}_saved_all_hanoi`,
        name: 'Tất cả 25–50 · Hà Nội (Demo)',
        compatible: true,
        issues: [],
        content: audienceContent({ ageMin: 25, ageMax: 50, genders: [], regionKey: '3843', regionName: 'Hanoi' })
      }
    ],
    targetingResults: [],
    locationResults: [
      {
        key: 'demo_region_hcm',
        name: 'Hồ Chí Minh',
        type: 'region',
        countryCode: 'VN',
        latitude: 10.7769,
        longitude: 106.7009
      },
      {
        key: 'demo_region_binh_duong',
        name: 'Bình Dương',
        type: 'region',
        countryCode: 'VN',
        latitude: 11.3254,
        longitude: 106.4770
      },
      {
        key: 'demo_hcm',
        name: 'Thành phố Hồ Chí Minh',
        type: 'city',
        countryCode: 'VN',
        region: 'Hồ Chí Minh',
        latitude: 10.7769,
        longitude: 106.7009
      },
      {
        key: 'demo_thu_dau_mot',
        name: 'Phú Thọ, Thủ Dầu Một',
        type: 'city',
        countryCode: 'VN',
        region: 'Bình Dương',
        latitude: 10.9804,
        longitude: 106.6519
      }
    ],
    promotablePageIds: [],
    pageEligibilityKnown: false
  };
}

function createDemoToolAudienceTemplates() {
  return [
    {
      id: 'tool_audience_demo_female_2245_hcm',
      name: 'Nữ làm đẹp 22–45 · Hồ Chí Minh',
      content: audienceContent({ ageMin: 22, ageMax: 45, genders: [2], regionKey: '3847', regionName: 'Ho Chi Minh City' })
    },
    {
      id: 'tool_audience_demo_male_2345_hcm',
      name: 'Nam 23–45 · Hồ Chí Minh',
      content: audienceContent({ ageMin: 23, ageMax: 45, genders: [1], regionKey: '3847', regionName: 'Ho Chi Minh City' })
    },
    {
      id: 'tool_audience_demo_all_1865_hanoi',
      name: 'Không target 18–65 · Hà Nội',
      content: audienceContent({ ageMin: 18, ageMax: 65, genders: [], regionKey: '3843', regionName: 'Hanoi' })
    }
  ];
}

function createDemoSeedingTemplates() {
  return [
    {
      id: 'seeding_template_demo_consulting',
      name: 'Tư vấn dịch vụ LG Clinic (Demo)',
      items: [
        {
          id: 'seeding_demo_comment_1',
          message: 'Mình đã gửi thông tin tư vấn cho bạn qua tin nhắn rồi nhé.',
          imageMediaId: null
        },
        {
          id: 'seeding_demo_comment_2',
          message: 'Bạn cần tư vấn dịch vụ nào để mình hỗ trợ chi tiết hơn?',
          imageMediaId: null
        }
      ]
    }
  ];
}

function createDemoConversationTemplates() {
  return [{
    id: 'conversation_template_demo_consulting',
    name: 'Tư vấn triệt bikini nữ (Demo)',
    template: {
      sourceTemplateId: null,
      templateName: 'Tư vấn triệt bikini nữ (Demo)',
      greeting: 'Xin chào {{user_full_name}}, LG Clinic có thể tư vấn liệu trình phù hợp cho mình nhé.',
      quickReplies: [],
      showBusinessPhoneNumber: false,
      businessPhoneNumber: '',
      imageMediaId: null,
      imagePreviewUrl: '',
      imageName: '',
      imageSize: 0,
      customerActions: [],
      dirty: false
    }
  }];
}

function createDemoCampaignPresets() {
  return [{
    id: 'campaign_preset_demo_bikini_female',
    name: 'Triệt bikini nữ (Demo)',
    content: {
      campaignName: 'Triệt Bikini Nữ 990K - Messenger',
      adSetName: 'No Target Nữ 22–45',
      audienceTemplateId: 'tool_audience_demo_female_2245_hcm',
      audienceTemplateName: 'Nữ làm đẹp 22–45 · Hồ Chí Minh',
      audienceContent: {
        ...audienceContent({ ageMin: 22, ageMax: 45, genders: [2], regionKey: '3847', regionName: 'Ho Chi Minh City' }),
        sourceAdAccountId: 'act_demo_42'
      },
      seedingTemplateId: 'seeding_template_demo_consulting',
      seedingTemplateName: 'Tư vấn dịch vụ LG Clinic (Demo)',
      conversationTemplateId: 'conversation_template_demo_consulting',
      conversationTemplateName: 'Tư vấn triệt bikini nữ (Demo)'
    }
  }];
}

function audienceContent({ ageMin, ageMax, genders, regionKey, regionName }) {
  return {
    ageMin,
    ageMax,
    genders,
    locales: [],
    includedRegions: [{ key: regionKey, name: regionName, type: 'region', countryCode: 'VN' }],
    excludedRegions: [],
    includedCities: [],
    excludedCities: [],
    includedCustomLocations: [],
    excludedCustomLocations: [],
    includedCustomAudienceIds: [],
    excludedCustomAudienceIds: [],
    detailedTargeting: [],
    advantageAudienceEnabled: false
  };
}

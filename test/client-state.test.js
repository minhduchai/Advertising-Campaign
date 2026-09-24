import test from 'node:test';
import assert from 'node:assert/strict';
import {
  addAd,
  addAdSet,
  addCampaign,
  activateNode,
  archiveCompletedCampaigns,
  applyAudienceTemplateToAdSet,
  calculateBudgetSummary,
  changeCampaignAccount,
  clearPageCatalogState,
  createAccountResourceLoadCache,
  closeNodeMenu,
  createAccountResourceRequestGate,
  createAdSet,
  createWorkspaceState,
  detachAdSetAudienceTemplate,
  detachAdCreative,
  duplicateAd,
  duplicateAdSet,
  duplicateAdSets,
  duplicateCampaignSettings,
  customizeCustomAudience,
  moveCustomAudience,
  moveCustomLocation,
  moveRegion,
  pageCatalogIssues,
  preserveSelectedPages,
  reconcilePageDiscoveryCounts,
  reconcileAvailableCampaignAccounts,
  relinkMatchingCreative,
  resourcesForCampaign,
  removeCity,
  removeCustomLocation,
  removeNode,
  selectNode,
  setAccountResources,
  sharedCreativeCount,
  updateCustomLocationRadius,
  isToolAudienceTemplateId,
  toolAudienceTemplateCompatibility,
  toggleCampaignCollapsed,
  toggleNodeMenu,
  updateCityRadius,
  updateNodeField
} from '../public/state.js';
import { applyConversationTemplate, isConversationModified } from '../public/conversation.js';
import { audienceTemplateContent } from '../public/audience.js';
import {
  applySeedingTemplate,
  createEmptySeeding,
  isSeedingModified,
  seedingContent
} from '../public/seeding.js';

function idSequence(...ids) {
  let index = 0;
  return () => ids[index++];
}

test('invalidates stale account resource work by sequence and account id', () => {
  const gate = createAccountResourceRequestGate();
  const requestA = gate.begin('act_A');
  const effects = [];

  assert.equal(requestA.isCurrent('act_A'), true);

  gate.invalidate();
  const requestB = gate.begin('act_B');

  if (requestA.isCurrent('act_B')) effects.push('stale-success');
  if (requestA.isCurrent('act_B')) effects.push('stale-failure');
  if (requestA.isCurrent('act_B')) effects.push('stale-finally');

  assert.deepEqual(effects, []);
  assert.equal(requestB.isCurrent('act_B'), true);
  assert.equal(requestB.isCurrent('act_A'), false);

  gate.invalidate();

  assert.equal(requestB.isCurrent(''), false);
});

test('deduplicates in-flight resource loads by advertising account', async () => {
  const cache = createAccountResourceLoadCache();
  let calls = 0;
  let resolveA;
  const loadA = () => {
    calls += 1;
    return new Promise((resolve) => {
      resolveA = resolve;
    });
  };

  const firstA = cache.load('act_A', loadA);
  const secondA = cache.load('act_A', loadA);
  const loadB = cache.load('act_B', async () => {
    calls += 1;
    return 'B';
  });
  const thirdA = cache.load('act_A', loadA);

  assert.strictEqual(firstA, secondA);
  assert.strictEqual(firstA, thirdA);
  assert.equal(calls, 2);
  resolveA('A');
  assert.deepEqual(await Promise.all([firstA, secondA, loadB, thirdA]), ['A', 'A', 'B', 'A']);
  assert.equal(calls, 2);
});

test('clears a disappeared account through account change while preserving Page selection', () => {
  const state = createWorkspaceState({
    randomId: idSequence('campaign-1', 'adset-1', 'ad-1')
  });
  const campaign = state.draft.campaigns[0];
  const adSet = campaign.adSets[0];
  campaign.adAccountId = 'act_missing';
  campaign.pageId = 'page-1';
  adSet.includedCustomAudienceIds = ['audience-1'];
  adSet.excludedCustomAudienceIds = ['audience-2'];
  adSet.detailedTargeting = [{ id: 'interest-1' }];
  adSet.locales = [6];
  adSet.audienceTemplateId = 'saved-audience-1';
  adSet.audienceTemplateName = 'Nữ TP.HCM';

  reconcileAvailableCampaignAccounts(state, new Set(['act_available']));

  assert.equal(campaign.adAccountId, '');
  assert.equal(campaign.pageId, 'page-1');
  assert.deepEqual(adSet.includedCustomAudienceIds, []);
  assert.deepEqual(adSet.excludedCustomAudienceIds, []);
  assert.deepEqual(adSet.detailedTargeting, []);
  assert.deepEqual(adSet.locales, []);
  assert.equal(adSet.audienceTemplateId, null);
  assert.equal(adSet.audienceTemplateName, '');
});

test('preserves a selected Page that disappears and marks it unavailable', () => {
  const adSets = [{ pageId: 'old-page' }];
  const pages = preserveSelectedPages(
    [{ id: 'new-page', name: 'New Page', canAdvertise: true }],
    [{ id: 'old-page', name: 'Old Page', canAdvertise: true }],
    adSets
  );

  assert.deepEqual(pages.find((page) => page.id === 'old-page'), {
    id: 'old-page',
    name: 'Old Page',
    sources: [],
    canAdvertise: false,
    unavailableReason: 'Page không còn trong catalog mới; hãy chọn Page khác'
  });
});

test('reconciles discovery counts after preserving a disappeared selected Page', () => {
  const pages = preserveSelectedPages(
    [{ id: 'new-page', name: 'New Page', canAdvertise: true }],
    [{ id: 'old-page', name: 'Old Page', canAdvertise: true }],
    [{ pageId: 'old-page' }]
  );
  const discovery = reconcilePageDiscoveryCounts({
    loaded: true,
    requiresBusinessReconnect: false,
    warnings: [],
    counts: {
      total: 1,
      available: 1,
      unavailable: 0,
      promotable: 1,
      managed: 2,
      businessOwned: 3,
      businessClient: 4
    }
  }, pages);

  assert.deepEqual(discovery.counts, {
    total: 2,
    available: 1,
    unavailable: 1,
    promotable: 1,
    managed: 2,
    businessOwned: 3,
    businessClient: 4
  });
});

test('clears the shared Page catalog and account compatibility state together', () => {
  const state = createWorkspaceState({
    randomId: idSequence('campaign-1', 'adset-1', 'ad-1')
  });
  state.resources.pages = [{ id: 'page-1', name: 'LG Clinic', canAdvertise: true }];
  state.resources.pageDiscovery = {
    loaded: true,
    counts: {
      total: 1,
      available: 1,
      unavailable: 0,
      promotable: 1,
      managed: 0,
      businessOwned: 0,
      businessClient: 0
    }
  };
  state.resources.accountResourcesById.act_1 = {
    loaded: true,
    customAudiences: [],
    targetingResults: [],
    locationResults: []
  };
  state.resources.conversationTemplates = [{ id: 'template-1' }];
  clearPageCatalogState(state, 'act_1');

  const resources = state.resources.accountResourcesById.act_1;
  assert.deepEqual(state.resources.pages, [{ id: 'page-1', name: 'LG Clinic', canAdvertise: true }]);
  assert.equal(state.resources.pageDiscovery.loaded, true);
  assert.equal(resources.loaded, false);
  assert.deepEqual(state.resources.conversationTemplates, [{ id: 'template-1' }]);

  clearPageCatalogState(state);
  assert.deepEqual(state.resources.accountResourcesById, {});
  assert.deepEqual(state.resources.pages, []);
  assert.equal(state.resources.pageDiscovery.loaded, false);
  assert.deepEqual(state.resources.conversationTemplates, [{ id: 'template-1' }]);
});

test('allows a catalog Page with any selected Campaign account', () => {
  const state = createWorkspaceState({
    randomId: idSequence('campaign-1', 'adset-1', 'ad-1')
  });
  state.draft.campaigns[0].adAccountId = 'act_1';
  state.draft.campaigns[0].pageId = 'page-2';

  assert.deepEqual(pageCatalogIssues(state.draft, [
    { id: 'page-1', name: 'LG Clinic', canAdvertise: true },
    { id: 'page-2', name: 'LG Clinic Quận 7', canAdvertise: true }
  ]), []);
});

test('does not require account compatibility data for a selected catalog Page', () => {
  const state = createWorkspaceState({
    randomId: idSequence('campaign-1', 'adset-1', 'ad-1')
  });
  const campaign = state.draft.campaigns[0];
  campaign.adAccountId = 'act_1';
  campaign.pageId = 'page-1';
  state.resources.pages = [{ id: 'page-1', name: 'LG Clinic', canAdvertise: true }];
  setAccountResources(state, 'act_1', { loaded: false });

  assert.deepEqual(pageCatalogIssues(state.draft, state.resources.pages), []);
  assert.equal(campaign.pageId, 'page-1');
  assert.deepEqual(state.resources.pages, [{ id: 'page-1', name: 'LG Clinic', canAdvertise: true }]);
});

test('creates the approved nested defaults', () => {
  const state = createWorkspaceState({
    randomId: idSequence('campaign-1', 'adset-1', 'ad-1', 'seeding-item-1')
  });
  const campaign = state.draft.campaigns[0];
  const adSet = campaign.adSets[0];
  const ad = adSet.ads[0];

  assert.equal(campaign.name, '');
  assert.equal(adSet.name, '');
  assert.equal(ad.name, '');
  assert.equal(campaign.adAccountId, '');
  assert.equal(campaign.pageId, '');
  assert.equal(campaign.budgetStrategy, 'AD_SET');
  assert.equal(campaign.dailyBudget, 1000000);
  assert.equal(adSet.dailyBudget, 400000);
  assert.deepEqual(campaign.seeding, {
    enabled: true,
    templateId: null,
    templateName: '',
    items: [{
      id: 'seeding-item-1',
      message: '',
      imageMediaId: null,
      imageName: '',
      imageSize: 0,
      imageMimeType: '',
      imagePreviewUrl: ''
    }]
  });
  assert.equal('pageId' in adSet, false);
  assert.equal(adSet.conversionLocation, 'MESSAGING_APPS');
  assert.equal(adSet.optimizationGoal, 'CONVERSATIONS');
  assert.equal(adSet.locationMode, 'REGIONS');
  assert.deepEqual(adSet.includedRegions, []);
  assert.deepEqual(adSet.includedCities, []);
  assert.deepEqual(adSet.excludedCities, []);
  assert.deepEqual(adSet.genders, []);
  assert.equal(adSet.advantageAudienceEnabled, false);
  assert.equal(adSet.ads[0].conversation.quickReplies.length, 0);
  assert.equal(adSet.ads[0].conversation.sourceTemplateId, null);
  assert.equal(adSet.ads[0].conversation.templateName, '');
  assert.equal(adSet.ads[0].conversation.greeting, '');
  assert.deepEqual(adSet.ads[0].conversation.customerActions, []);
  assert.equal(adSet.ads[0].conversation.dirty, false);
  assert.equal(adSet.ads[0].conversation.showBusinessPhoneNumber, false);
  assert.equal(adSet.ads[0].creativeGroupId, 'ad-1');
  assert.equal(ad.mediaFileName, '');
  assert.equal(ad.mediaFileSize, 0);
  assert.deepEqual(state.ui.mediaUploads, {});
  assert.equal(state.selection.clientId, 'campaign-1');
  assert.deepEqual(state.resources.accountResourcesById, {});
  const emptyResources = resourcesForCampaign(state, campaign);
  assert.equal(emptyResources.loaded, false);
});

test('applies an independent seeding template and detects content changes', () => {
  const campaign = { seeding: createEmptySeeding(() => 'local-item') };
  const template = {
    id: 'template-1',
    name: 'Triệt nách nữ',
    items: [{ id: 'template-item', message: 'Đăng ký ngay', imageMediaId: 'media-1' }]
  };

  applySeedingTemplate(campaign, template);
  template.items[0].message = 'Đã đổi trong thư viện';

  assert.deepEqual(seedingContent(campaign.seeding), {
    templateId: 'template-1',
    templateName: 'Triệt nách nữ',
    items: [{ id: 'template-item', message: 'Đăng ký ngay', imageMediaId: 'media-1' }]
  });
  assert.equal(campaign.seeding.enabled, true);
  assert.equal(isSeedingModified(campaign.seeding, template), true);
});

test('keeps the shared Page catalog outside account-specific resources', () => {
  const state = createWorkspaceState({
    randomId: idSequence('campaign-1', 'adset-1', 'ad-1')
  });

  state.resources.pages = [{ id: 'page-1', name: 'LG Clinic', canAdvertise: true }];
  state.resources.pageDiscovery = { loaded: true, counts: { total: 1 } };
  const accountResources = setAccountResources(state, 'act_1', {
    loaded: true
  });

  assert.deepEqual(state.resources.pages, [{ id: 'page-1', name: 'LG Clinic', canAdvertise: true }]);
  assert.deepEqual(state.resources.pageDiscovery, { loaded: true, counts: { total: 1 } });
  assert.equal(accountResources.promotablePageIds, undefined);
  assert.equal(accountResources.pages, undefined);
  assert.equal(accountResources.pageDiscovery, undefined);
});

test('new Campaign starts without account and Page while account changes preserve its Page and clear its subtree', () => {
  const state = createWorkspaceState({
    randomId: idSequence('campaign-1', 'adset-1', 'ad-1')
  });
  const first = state.draft.campaigns[0];
  first.adAccountId = 'act_1';
  first.pageId = 'page_1';
  first.adSets[0].includedCustomAudienceIds = ['audience-1'];

  const second = addCampaign(state, idSequence('campaign-2', 'adset-2', 'ad-2'));
  second.adSets[0].includedCustomAudienceIds = ['audience-2'];
  second.adSets[0].ads[0].mediaId = 'meta-video-1';
  second.adSets[0].ads[0].mediaAsset = { kind: 'video', accountId: 'act_1', videoId: 'video-1' };

  assert.equal(second.adAccountId, '');
  assert.equal(second.pageId, '');
  second.pageId = 'page-2';
  assert.equal(changeCampaignAccount(state, second.clientId, 'act_2'), true);
  assert.equal(second.adAccountId, 'act_2');
  assert.equal(second.pageId, 'page-2');
  assert.deepEqual(second.adSets[0].includedCustomAudienceIds, []);
  assert.equal(second.adSets[0].ads[0].mediaId, null);
  assert.equal(second.adSets[0].ads[0].mediaAsset, null);
  assert.equal(first.adAccountId, 'act_1');
  assert.equal(first.pageId, 'page_1');
  assert.deepEqual(first.adSets[0].includedCustomAudienceIds, ['audience-1']);
});

test('selects a Campaign without collapsing it and toggles only through disclosure', () => {
  const state = createWorkspaceState({
    randomId: idSequence('campaign-1', 'adset-1', 'ad-1')
  });

  assert.deepEqual(state.ui.collapsedCampaignIds, []);
  assert.equal(state.ui.openNodeMenuId, null);

  assert.equal(toggleNodeMenu(state, 'campaign-1'), true);
  assert.equal(state.ui.openNodeMenuId, 'campaign-1');

  assert.equal(activateNode(state, 'campaign-1'), true);
  assert.deepEqual(state.selection, { clientId: 'campaign-1', type: 'campaign' });
  assert.deepEqual(state.ui.collapsedCampaignIds, []);
  assert.equal(state.ui.openNodeMenuId, null);

  assert.equal(toggleCampaignCollapsed(state, 'campaign-1'), true);
  assert.deepEqual(state.ui.collapsedCampaignIds, ['campaign-1']);
  assert.equal(toggleCampaignCollapsed(state, 'campaign-1'), true);
  assert.deepEqual(state.ui.collapsedCampaignIds, []);
  assert.equal(toggleCampaignCollapsed(state, 'missing-campaign'), false);
});

test('adding a Campaign collapses older Campaigns and expands the new Campaign', () => {
  const state = createWorkspaceState({
    randomId: idSequence('campaign-1', 'adset-1', 'ad-1')
  });

  const campaign = addCampaign(state, idSequence('campaign-2', 'adset-2', 'ad-2'));

  assert.deepEqual(state.ui.collapsedCampaignIds, ['campaign-1']);
  assert.deepEqual(state.selection, { clientId: campaign.clientId, type: 'campaign' });
});

test('duplicates Campaign, Ad Set, and Seeding settings while starting fresh Ads', () => {
  const state = createWorkspaceState({
    randomId: idSequence('campaign-1', 'adset-1', 'ad-1')
  });
  const source = state.draft.campaigns[0];
  source.name = 'Chiến dịch nguồn';
  source.adAccountId = 'act-42';
  source.pageId = 'page-42';
  source.specialAdCategory = 'CREDIT';
  source.budgetStrategy = 'CAMPAIGN';
  source.dailyBudget = 9000000;
  source.adSets[0].name = 'Nữ 22–45 Hồ Chí Minh';
  source.adSets[0].dailyBudget = 650000;
  source.adSets[0].includedRegions = [{ key: '3847', name: 'Hồ Chí Minh', type: 'region', countryCode: 'VN' }];
  source.adSets[0].excludedCustomAudienceIds = ['audience-1'];
  source.adSets[0].ads[0].name = 'Quảng cáo nguồn';
  source.adSets[0].ads[0].primaryText = 'Không sao chép nội dung quảng cáo';
  source.seeding.templateId = 'seeding-template-1';
  source.seeding.templateName = 'Seeding tư vấn';
  source.seeding.items = [
    { id: 'seed-source-1', message: 'Bình luận 1', imageMediaId: null },
    { id: 'seed-source-2', message: 'Bình luận 2', imageMediaId: 'media-1' }
  ];

  const copy = duplicateCampaignSettings(
    state,
    'campaign-1',
    idSequence('campaign-2', 'adset-2', 'ad-2', 'seed-copy-1', 'seed-copy-2')
  );

  assert.equal(copy.name, 'Chiến dịch nguồn');
  assert.equal(copy.adAccountId, 'act-42');
  assert.equal(copy.pageId, 'page-42');
  assert.equal(copy.specialAdCategory, 'CREDIT');
  assert.equal(copy.budgetStrategy, 'CAMPAIGN');
  assert.equal(copy.dailyBudget, 9000000);
  assert.equal(copy.adSets.length, 1);
  assert.equal(copy.adSets[0].clientId, 'adset-2');
  assert.equal(copy.adSets[0].name, 'Nữ 22–45 Hồ Chí Minh');
  assert.equal(copy.adSets[0].dailyBudget, 650000);
  assert.deepEqual(copy.adSets[0].includedRegions, source.adSets[0].includedRegions);
  assert.notEqual(copy.adSets[0].includedRegions, source.adSets[0].includedRegions);
  assert.deepEqual(copy.adSets[0].excludedCustomAudienceIds, ['audience-1']);
  assert.equal(copy.adSets[0].ads.length, 1);
  assert.equal(copy.adSets[0].ads[0].clientId, 'ad-2');
  assert.equal(copy.adSets[0].ads[0].name, '');
  assert.equal(copy.adSets[0].ads[0].primaryText, '');
  assert.equal(copy.seeding.templateId, 'seeding-template-1');
  assert.equal(copy.seeding.templateName, 'Seeding tư vấn');
  assert.deepEqual(copy.seeding.items.map(({ id }) => id), ['seed-copy-1', 'seed-copy-2']);
  assert.deepEqual(copy.seeding.items.map(({ message }) => message), ['Bình luận 1', 'Bình luận 2']);
  assert.notEqual(copy.seeding.items, source.seeding.items);
  assert.deepEqual(state.selection, { clientId: 'campaign-2', type: 'campaign' });
});

test('selecting or adding descendants expands their parent Campaign', () => {
  const state = createWorkspaceState({
    randomId: idSequence('campaign-1', 'adset-1', 'ad-1')
  });
  state.ui.collapsedCampaignIds = ['campaign-1'];

  assert.equal(activateNode(state, 'adset-1'), true);
  assert.deepEqual(state.ui.collapsedCampaignIds, []);

  state.ui.collapsedCampaignIds = ['campaign-1'];
  addAd(state, 'adset-1', () => 'ad-2');
  assert.deepEqual(state.ui.collapsedCampaignIds, []);
});

test('removing a Campaign clears its collapse and menu state', () => {
  const state = createWorkspaceState({
    randomId: idSequence('campaign-1', 'adset-1', 'ad-1')
  });
  state.ui.collapsedCampaignIds = ['campaign-1'];
  state.ui.openNodeMenuId = 'campaign-1';

  assert.equal(removeNode(state, 'campaign-1'), true);
  assert.deepEqual(state.ui.collapsedCampaignIds, []);
  assert.equal(state.ui.openNodeMenuId, null);
});

test('removing a Campaign clears menu state for deleted descendants', () => {
  const state = createWorkspaceState({
    randomId: idSequence('campaign-1', 'adset-1', 'ad-1')
  });
  state.ui.collapsedCampaignIds = ['campaign-1'];
  state.ui.openNodeMenuId = 'adset-1';

  assert.equal(removeNode(state, 'campaign-1'), true);
  assert.deepEqual(state.ui.collapsedCampaignIds, []);
  assert.equal(state.ui.openNodeMenuId, null);
});

test('removing an Ad Set clears menu state for deleted ads', () => {
  const state = createWorkspaceState({
    randomId: idSequence('campaign-1', 'adset-1', 'ad-1')
  });
  state.ui.openNodeMenuId = 'ad-1';

  assert.equal(removeNode(state, 'adset-1'), true);
  assert.equal(state.draft.campaigns[0].adSets.length, 0);
  assert.equal(state.ui.openNodeMenuId, null);
});

test('adds and selects nested campaign, ad set, and ad nodes', () => {
  const state = createWorkspaceState({
    randomId: idSequence('campaign-1', 'adset-1', 'ad-1')
  });

  const campaign = addCampaign(state, idSequence('campaign-2', 'adset-2', 'ad-2'));
  const adSet = addAdSet(state, campaign.clientId, idSequence('adset-3', 'ad-3'));
  const ad = addAd(state, adSet.clientId, () => 'ad-4');

  assert.equal(state.draft.campaigns.length, 2);
  assert.equal(campaign.adSets.length, 2);
  assert.equal(adSet.ads.length, 2);
  assert.deepEqual(state.selection, { clientId: 'ad-4', type: 'ad' });
  assert.equal(ad.clientId, 'ad-4');
});

test('duplicates an Ad after its source with an independent snapshot and shared creative group', () => {
  const state = createWorkspaceState({
    randomId: idSequence('campaign-1', 'adset-1', 'ad-1')
  });
  const source = state.draft.campaigns[0].adSets[0].ads[0];
  source.name = 'Quảng cáo gốc';
  source.conversation.greeting = 'Xin chào';
  state.ui.collapsedCampaignIds = ['campaign-1'];
  state.ui.openNodeMenuId = 'ad-1';

  const copy = duplicateAd(state, 'ad-1', () => 'ad-2');

  assert.equal(copy.clientId, 'ad-2');
  assert.equal(copy.name, 'Quảng cáo gốc');
  assert.equal(copy.creativeGroupId, 'ad-1');
  assert.notEqual(copy.conversation, source.conversation);
  assert.deepEqual(state.draft.campaigns[0].adSets[0].ads.map((ad) => ad.clientId), ['ad-1', 'ad-2']);
  assert.deepEqual(state.selection, { clientId: 'ad-2', type: 'ad' });
  assert.deepEqual(state.ui.collapsedCampaignIds, []);
  assert.equal(state.ui.openNodeMenuId, null);
  assert.equal(sharedCreativeCount(state, 'ad-1'), 2);

  copy.conversation.greeting = 'Nội dung bản sao';
  assert.equal(source.conversation.greeting, 'Xin chào');

  removeNode(state, 'ad-1');
  assert.equal(sharedCreativeCount(state, 'ad-2'), 1);
});

test('duplicates a complete Ad Set and preserves each corresponding creative group', () => {
  const state = createWorkspaceState({
    randomId: idSequence('campaign-1', 'adset-1', 'ad-1')
  });
  const source = state.draft.campaigns[0].adSets[0];
  source.name = 'Nhóm miền Nam';
  source.ads[0].name = 'Ảnh ưu đãi';
  const secondAd = addAd(state, 'adset-1', () => 'ad-2');
  secondAd.name = 'Video ưu đãi';

  const copy = duplicateAdSet(
    state,
    'adset-1',
    idSequence('adset-2', 'ad-3', 'ad-4')
  );

  assert.equal(copy.clientId, 'adset-2');
  assert.equal(copy.name, 'Nhóm miền Nam');
  assert.deepEqual(copy.ads.map((ad) => ad.clientId), ['ad-3', 'ad-4']);
  assert.deepEqual(copy.ads.map((ad) => ad.name), [
    'Ảnh ưu đãi',
    'Video ưu đãi'
  ]);
  assert.deepEqual(copy.ads.map((ad) => ad.creativeGroupId), ['ad-1', 'ad-2']);
  assert.notEqual(copy.ads[0].conversation, source.ads[0].conversation);
  assert.deepEqual(state.draft.campaigns[0].adSets.map((adSet) => adSet.clientId), ['adset-1', 'adset-2']);
  assert.deepEqual(state.selection, { clientId: 'adset-2', type: 'adSet' });
  assert.equal(sharedCreativeCount(state, 'ad-1'), 2);
  assert.equal(sharedCreativeCount(state, 'ad-2'), 2);
});

test('duplicates an Ad Set by an explicit quantity and keeps copy order stable', () => {
  const state = createWorkspaceState({
    randomId: idSequence('campaign-1', 'adset-1', 'ad-1')
  });
  state.draft.campaigns[0].adSets[0].name = 'Nhóm nguồn';

  const copies = duplicateAdSets(
    state,
    'adset-1',
    3,
    idSequence('adset-2', 'ad-2', 'adset-3', 'ad-3', 'adset-4', 'ad-4')
  );

  assert.deepEqual(copies.map((copy) => copy.clientId), ['adset-2', 'adset-3', 'adset-4']);
  assert.deepEqual(
    state.draft.campaigns[0].adSets.map((adSet) => adSet.clientId),
    ['adset-1', 'adset-2', 'adset-3', 'adset-4']
  );
  assert.deepEqual(state.selection, { clientId: 'adset-4', type: 'adSet' });
  assert.deepEqual(duplicateAdSets(state, 'adset-1', 0), []);
  assert.deepEqual(duplicateAdSets(state, 'adset-1', 1.5), []);
  assert.deepEqual(duplicateAdSets(state, 'adset-1', 21), []);
});

test('archives only fully successful Campaigns and preserves the final progress snapshot', () => {
  const state = createWorkspaceState({
    randomId: idSequence('campaign-1', 'adset-1', 'ad-1')
  });
  const second = addCampaign(state, idSequence('campaign-2', 'adset-2', 'ad-2'));
  state.selection = { clientId: 'campaign-1', type: 'campaign' };
  const progress = {
    snapshot: state.draft,
    campaigns: [
      { clientId: 'campaign-1', status: 'completed', percent: 100 },
      { clientId: 'campaign-2', status: 'completed_with_errors', percent: 100 }
    ]
  };

  const result = archiveCompletedCampaigns(state, progress);

  assert.deepEqual(result.removed.map((campaign) => campaign.clientId), ['campaign-1']);
  assert.equal(result.replacement, null);
  assert.deepEqual(state.draft.campaigns.map((campaign) => campaign.clientId), [second.clientId]);
  assert.deepEqual(state.selection, { clientId: 'campaign-2', type: 'campaign' });
  assert.notEqual(progress.snapshot, state.draft);
  assert.deepEqual(progress.snapshot.campaigns.map((campaign) => campaign.clientId), ['campaign-1', 'campaign-2']);
});

test('opens a blank Campaign after the last successful Campaign leaves the workspace', () => {
  const state = createWorkspaceState({
    randomId: idSequence('campaign-1', 'adset-1', 'ad-1')
  });
  const progress = {
    snapshot: state.draft,
    campaigns: [{ clientId: 'campaign-1', status: 'completed', percent: 100 }]
  };

  const result = archiveCompletedCampaigns(
    state,
    progress,
    idSequence('campaign-2', 'adset-2', 'ad-2')
  );

  assert.equal(result.removed.length, 1);
  assert.equal(result.replacement.clientId, 'campaign-2');
  assert.deepEqual(state.draft.campaigns.map((campaign) => campaign.clientId), ['campaign-2']);
  assert.deepEqual(state.selection, { clientId: 'campaign-2', type: 'campaign' });
});

test('keeps the original Ad name across repeated similar copies', () => {
  const state = createWorkspaceState({
    randomId: idSequence('campaign-1', 'adset-1', 'ad-1')
  });
  state.draft.campaigns[0].adSets[0].ads[0].name = 'Mẫu quảng cáo';

  const first = duplicateAd(state, 'ad-1', () => 'ad-2');
  const second = duplicateAd(state, 'ad-1', () => 'ad-3');

  assert.equal(first.name, 'Mẫu quảng cáo');
  assert.equal(second.name, 'Mẫu quảng cáo');
});

test('detaches creative changes and Page changes but keeps operational edits shared', () => {
  const state = createWorkspaceState({
    randomId: idSequence('campaign-1', 'adset-1', 'ad-1')
  });
  const adSet = state.draft.campaigns[0].adSets[0];
  const ad = adSet.ads[0];

  updateNodeField(state, 'ad-1', 'name', 'Tên nội bộ', () => 'unused-name-group');
  assert.equal(ad.creativeGroupId, 'ad-1');

  updateNodeField(state, 'ad-1', 'primaryText', 'Nội dung mới', () => 'creative-2');
  assert.equal(ad.creativeGroupId, 'creative-2');

  updateNodeField(state, 'ad-1', 'primaryText', 'Nội dung mới', () => 'unused-same-value');
  assert.equal(ad.creativeGroupId, 'creative-2');

  updateNodeField(state, 'adset-1', 'dailyBudget', 200000, () => 'unused-budget-group');
  assert.equal(ad.creativeGroupId, 'creative-2');

  updateNodeField(state, 'campaign-1', 'pageId', 'page-2', () => 'creative-3');
  assert.equal(ad.creativeGroupId, 'creative-3');

  assert.equal(detachAdCreative(ad, () => 'creative-4'), 'creative-4');
  assert.equal(ad.creativeGroupId, 'creative-4');
});

test('changing a Campaign Page preserves linked creative groups inside that Campaign', () => {
  const state = createWorkspaceState({
    randomId: idSequence('campaign-1', 'adset-1', 'ad-1')
  });
  const copy = duplicateAd(state, 'ad-1', () => 'ad-2');
  let generatedGroups = 0;

  updateNodeField(state, 'campaign-1', 'pageId', 'page-2', () => {
    generatedGroups += 1;
    return `page-group-${generatedGroups}`;
  });

  const [source] = state.draft.campaigns[0].adSets[0].ads;
  assert.equal(source.creativeGroupId, 'page-group-1');
  assert.equal(copy.creativeGroupId, 'page-group-1');
  assert.equal(generatedGroups, 1);
});

test('relinks copied Ads when their final creative content matches again', () => {
  const state = createWorkspaceState({
    randomId: idSequence('campaign-1', 'adset-1', 'ad-1')
  });
  const source = state.draft.campaigns[0].adSets[0].ads[0];
  source.mediaId = 'video-1';
  source.primaryText = 'Nội dung quảng cáo';
  source.headline = 'Tiêu đề';
  source.conversation.greeting = 'Triệt bikini nữ';
  const copy = duplicateAdSet(
    state,
    'adset-1',
    idSequence('adset-2', 'ad-2')
  ).ads[0];

  detachAdCreative(copy, () => 'detached-copy');
  assert.equal(copy.creativeGroupId, 'detached-copy');

  assert.equal(relinkMatchingCreative(state, copy.clientId), true);
  assert.equal(copy.creativeGroupId, source.creativeGroupId);
});

test('updates selected nodes and removes descendants by client id', () => {
  const state = createWorkspaceState({
    randomId: idSequence('campaign-1', 'adset-1', 'ad-1')
  });

  assert.equal(selectNode(state, 'adset-1'), true);
  assert.equal(updateNodeField(state, 'adset-1', 'name', 'Nhóm nữ 18-45'), true);
  assert.equal(state.draft.campaigns[0].adSets[0].name, 'Nhóm nữ 18-45');
  assert.equal(removeNode(state, 'ad-1'), true);
  assert.deepEqual(state.draft.campaigns[0].adSets[0].ads, []);
});

test('moving an audience to exclude removes it from include', () => {
  const adSet = createAdSet(() => 'id');
  adSet.includedCustomAudienceIds = ['ca-1'];

  moveCustomAudience(adSet, 'ca-1', 'exclude');

  assert.deepEqual(adSet.includedCustomAudienceIds, []);
  assert.deepEqual(adSet.excludedCustomAudienceIds, ['ca-1']);
});

test('customizing a saved audience detaches the template and keeps the new exclusion', () => {
  const state = createWorkspaceState({ randomId: idSequence('campaign-1', 'adset-1', 'ad-1') });
  const adSet = state.draft.campaigns[0].adSets[0];
  adSet.audienceTemplateId = 'saved-1';
  adSet.audienceTemplateName = 'Nữ 22-45';
  adSet.includedCustomAudienceIds = ['ca-1'];

  assert.equal(customizeCustomAudience(state, adSet.clientId, 'ca-2', 'exclude'), true);
  assert.equal(adSet.audienceTemplateId, null);
  assert.equal(adSet.audienceTemplateName, '');
  assert.deepEqual(adSet.includedCustomAudienceIds, ['ca-1']);
  assert.deepEqual(adSet.excludedCustomAudienceIds, ['ca-2']);
});

test('customizing a tool audience keeps it linked so it can be updated', () => {
  const state = createWorkspaceState({ randomId: idSequence('campaign-1', 'adset-1', 'ad-1') });
  const adSet = state.draft.campaigns[0].adSets[0];
  adSet.audienceTemplateId = 'tool_audience_1';
  adSet.audienceTemplateName = 'Nữ 22-45';

  assert.equal(customizeCustomAudience(state, adSet.clientId, 'ca-2', 'exclude'), true);
  assert.equal(adSet.audienceTemplateId, 'tool_audience_1');
  assert.equal(adSet.audienceTemplateName, 'Nữ 22-45');
  assert.deepEqual(adSet.excludedCustomAudienceIds, ['ca-2']);
});

test('applies every supported field from a Meta saved audience', () => {
  const state = createWorkspaceState({ randomId: idSequence('campaign-1', 'adset-1', 'ad-1') });
  const adSet = state.draft.campaigns[0].adSets[0];
  const template = {
    id: 'saved-1',
    name: 'Nữ TP.HCM',
    content: {
      ageMin: 22,
      ageMax: 45,
      genders: [2],
      locales: [6],
      includedRegions: [{ key: '3984', name: 'Thành phố Hồ Chí Minh', type: 'region', countryCode: 'VN' }],
      excludedRegions: [],
      includedCustomAudienceIds: ['ca-1'],
      excludedCustomAudienceIds: ['ca-2'],
      detailedTargeting: [{ id: '6003139266461', name: 'Spa', type: 'interests' }]
    }
  };

  assert.equal(applyAudienceTemplateToAdSet(state, adSet.clientId, template), true);
  assert.equal(adSet.audienceTemplateId, 'saved-1');
  assert.equal(adSet.audienceTemplateName, 'Nữ TP.HCM');
  assert.deepEqual(adSet.locales, [6]);
  assert.deepEqual(adSet.genders, [2]);
  assert.deepEqual(adSet.includedCustomAudienceIds, ['ca-1']);
});

test('applies a tool audience with a namespaced id and detaches without losing targeting', () => {
  const state = createWorkspaceState({ randomId: idSequence('campaign-1', 'adset-1', 'ad-1') });
  state.draft.campaigns[0].adAccountId = 'act_1';
  const adSet = state.draft.campaigns[0].adSets[0];
  const template = {
    id: 'tool_audience_shared-1',
    name: 'Nữ làm đẹp 23-45',
    content: {
      sourceAdAccountId: 'act_1',
      ageMin: 23,
      ageMax: 45,
      genders: [2],
      locales: [6],
      includedRegions: [{ key: '3984', name: 'Thành phố Hồ Chí Minh', type: 'region', countryCode: 'VN' }],
      excludedRegions: [{ key: '3998', name: 'Nghệ An', type: 'region', countryCode: 'VN' }],
      includedCustomAudienceIds: ['ca-1'],
      excludedCustomAudienceIds: ['ca-2'],
      detailedTargeting: [{ id: 'interest-1', name: 'Chăm sóc da', targetingField: 'interests' }],
      advantageAudienceEnabled: true
    }
  };
  const customAudiences = [{ id: 'ca-1' }, { id: 'ca-2' }];

  assert.equal(isToolAudienceTemplateId(template.id), true);
  assert.equal(isToolAudienceTemplateId('saved_meta_1'), false);
  assert.deepEqual(toolAudienceTemplateCompatibility(template, 'act_1', customAudiences), {
    compatible: true,
    reason: '',
    warning: '',
    allowedCustomAudienceIds: ['ca-1', 'ca-2'],
    skippedCustomAudienceIds: []
  });
  const otherAccount = toolAudienceTemplateCompatibility(template, 'act_2', customAudiences);
  assert.equal(otherAccount.compatible, true);
  assert.deepEqual(otherAccount.allowedCustomAudienceIds, ['ca-1', 'ca-2']);
  assert.deepEqual(otherAccount.skippedCustomAudienceIds, []);
  assert.equal(otherAccount.warning, '');
  const partlySharedAccount = toolAudienceTemplateCompatibility(template, 'act_2', [{ id: 'ca-2' }]);
  assert.deepEqual(partlySharedAccount.allowedCustomAudienceIds, ['ca-2']);
  assert.deepEqual(partlySharedAccount.skippedCustomAudienceIds, ['ca-1']);
  assert.match(partlySharedAccount.warning, /bỏ qua 1 Custom Audience/);
  const missingAudience = toolAudienceTemplateCompatibility(template, 'act_1', [{ id: 'ca-1' }]);
  assert.equal(missingAudience.compatible, true);
  assert.deepEqual(missingAudience.allowedCustomAudienceIds, ['ca-1']);
  assert.deepEqual(missingAudience.skippedCustomAudienceIds, ['ca-2']);
  assert.match(missingAudience.warning, /ca-2/);
  assert.equal(toolAudienceTemplateCompatibility({
    ...template,
    content: {
      ...template.content,
      includedCustomAudienceIds: [],
      excludedCustomAudienceIds: []
    }
  }, 'act_2', []).compatible, true);
  assert.equal(applyAudienceTemplateToAdSet(state, adSet.clientId, template), true);
  assert.equal(adSet.audienceTemplateId, template.id);
  assert.equal(adSet.ageMin, 23);
  assert.equal(adSet.advantageAudienceEnabled, true);
  assert.equal(audienceTemplateContent(adSet).advantageAudienceEnabled, true);
  assert.deepEqual(adSet.excludedRegions, template.content.excludedRegions);

  assert.equal(detachAdSetAudienceTemplate(state, adSet.clientId), true);
  assert.equal(adSet.audienceTemplateId, null);
  assert.equal(adSet.audienceTemplateName, '');
  assert.equal(adSet.ageMin, 23);
  assert.deepEqual(adSet.excludedRegions, template.content.excludedRegions);
  assert.deepEqual(adSet.detailedTargeting, template.content.detailedTargeting);
});

test('creates Vietnam targeting and moves a region between include and exclude', () => {
  const adSet = createAdSet(() => 'id');
  const region = {
    key: '3984',
    name: 'Thành phố Hồ Chí Minh',
    type: 'region',
    countryCode: 'VN'
  };

  assert.equal(adSet.locationMode, 'REGIONS');
  assert.deepEqual(adSet.includedRegions, []);
  assert.deepEqual(adSet.excludedRegions, []);

  moveRegion(adSet, region, 'include');
  assert.equal(adSet.locationMode, 'REGIONS');
  assert.deepEqual(adSet.includedRegions, [region]);

  moveRegion(adSet, region, 'exclude');
  assert.deepEqual(adSet.includedRegions, []);
  assert.deepEqual(adSet.excludedRegions, [region]);
});

test('creates Vietnam city radius targeting and updates its radius', () => {
  const adSet = createAdSet(() => 'city-id');
  const city = {
    key: '2420605',
    name: 'Thủ Đức',
    type: 'city',
    countryCode: 'VN',
    region: 'Hồ Chí Minh'
  };

  assert.equal(moveRegion(adSet, city, 'include'), true);
  assert.deepEqual(adSet.includedCities, [{
    ...city,
    radius: 8,
    distanceUnit: 'kilometer'
  }]);
  assert.equal(updateCityRadius(adSet, city.key, 'include', 15), true);
  assert.equal(adSet.includedCities[0].radius, 15);

  assert.equal(moveRegion(adSet, city, 'exclude'), true);
  assert.deepEqual(adSet.includedCities, []);
  assert.equal(adSet.excludedCities[0].radius, 8);
  assert.equal(removeCity(adSet, city.key, 'exclude'), true);
  assert.deepEqual(adSet.excludedCities, []);
});

test('creates precise pin radius targeting and moves it between include and exclude', () => {
  const adSet = createAdSet(() => 'pin-id');
  const location = {
    name: 'Phú Thọ, Thủ Dầu Một',
    latitude: 10.9804,
    longitude: 106.6519,
    radius: 10
  };

  assert.equal(moveCustomLocation(adSet, location, 'include'), true);
  assert.deepEqual(adSet.includedCustomLocations, [{
    key: 'pin:10.980400,106.651900',
    name: 'Phú Thọ, Thủ Dầu Một',
    type: 'custom_location',
    countryCode: 'VN',
    latitude: 10.9804,
    longitude: 106.6519,
    radius: 10,
    distanceUnit: 'kilometer'
  }]);

  assert.equal(updateCustomLocationRadius(
    adSet,
    'pin:10.980400,106.651900',
    'include',
    15
  ), true);
  assert.equal(adSet.includedCustomLocations[0].radius, 15);

  assert.equal(moveCustomLocation(adSet, location, 'exclude'), true);
  assert.deepEqual(adSet.includedCustomLocations, []);
  assert.equal(adSet.excludedCustomLocations[0].radius, 10);
  assert.equal(removeCustomLocation(
    adSet,
    'pin:10.980400,106.651900',
    'exclude'
  ), true);
  assert.deepEqual(adSet.excludedCustomLocations, []);
});

test('empty or missing pin coordinates cannot silently become a location at zero', () => {
  const adSet = createAdSet(() => 'pin-id');
  for (const value of [null, undefined, '', ' ']) {
    assert.equal(moveCustomLocation(adSet, { name: 'Address', latitude: value, longitude: 106 }, 'include'), false);
    assert.equal(moveCustomLocation(adSet, { name: 'Address', latitude: 10, longitude: value }, 'include'), false);
  }
  assert.equal(moveCustomLocation(adSet, { name: 'Valid zero', latitude: 0, longitude: 0 }, 'include'), true);
});

test('budget summary counts campaign budget once and ad set budgets separately', () => {
  const campaignBudgetFixture = {
    budgetStrategy: 'CAMPAIGN',
    dailyBudget: 500000,
    adSets: [{ dailyBudget: 900000 }]
  };
  const adSetBudgetFixture = {
    budgetStrategy: 'AD_SET',
    dailyBudget: 900000,
    adSets: [{ dailyBudget: 100000 }, { dailyBudget: 100000 }]
  };

  assert.equal(
    calculateBudgetSummary([campaignBudgetFixture, adSetBudgetFixture]),
    700000
  );
});

test('applies a deep conversation snapshot independent from its source template', () => {
  const state = createWorkspaceState({
    randomId: idSequence('campaign-1', 'adset-1', 'ad-1', 'q1', 'q2', 'q3')
  });
  const ad = state.draft.campaigns[0].adSets[0].ads[0];
  const template = {
    id: 'template-1',
    name: 'Mẫu tư vấn',
    template: {
      sourceTemplateId: null,
      templateName: 'Mẫu tư vấn',
      greeting: 'Chào bạn',
      quickReplies: [{ id: 'reply-1', title: 'Tư vấn', payload: 'reply_reply-1' }],
      showBusinessPhoneNumber: false,
      businessPhoneNumber: '',
      customerActions: []
    }
  };

  applyConversationTemplate(ad, template);
  template.template.greeting = 'Đã thay đổi ở thư viện';
  template.template.quickReplies[0].title = 'Đã đổi';

  assert.equal(ad.conversation.greeting, 'Chào bạn');
  assert.equal(ad.conversation.quickReplies[0].title, 'Tư vấn');
  assert.equal(ad.conversation.sourceTemplateId, 'template-1');
  assert.equal(ad.conversation.dirty, false);
  assert.equal(isConversationModified(ad.conversation, template), true);
});

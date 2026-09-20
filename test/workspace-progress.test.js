import test from 'node:test';
import assert from 'node:assert/strict';
import {
  firstIncompleteRequirement,
  navigationGate,
  requirementsForAd,
  requirementsForAdSet,
  requirementsForCampaign,
  requirementsForSeeding,
  workspaceProgress
} from '../public/workspace-progress.js';

function progressFixture() {
  const ad = {
    clientId: 'ad-1',
    name: '',
    primaryText: '',
    headline: '',
    mediaId: null,
    conversation: {
      templateName: '',
      greeting: '',
      imageMediaId: null,
      customerActions: []
    }
  };
  const adSet = {
    clientId: 'adset-1',
    name: '',
    dailyBudget: 400000,
    startTime: '',
    endTime: '',
    includedRegions: [],
    includedCities: [],
    includedCustomLocations: [],
    includedCustomAudienceIds: [],
    excludedCustomAudienceIds: [],
    ageMin: 18,
    ageMax: 65,
    advantageAudienceEnabled: false,
    ads: [ad]
  };
  const campaign = {
    clientId: 'campaign-1',
    name: '',
    adAccountId: '',
    pageId: '',
    budgetStrategy: 'AD_SET',
    dailyBudget: 1000000,
    seeding: {
      enabled: true,
      templateId: null,
      templateName: '',
      items: []
    },
    adSets: [adSet]
  };
  return {
    connected: false,
    issues: [],
    selection: { clientId: campaign.clientId, type: 'campaign' },
    ui: { progressReviewMode: false },
    draft: { campaigns: [campaign] }
  };
}

test('requires campaign fields before opening an ad set', () => {
  const state = progressFixture();
  const gate = navigationGate(state, 'adset-1');

  assert.equal(gate.allowed, false);
  assert.deepEqual(gate.missing.map(({ field }) => field), ['name', 'adAccountId', 'pageId', 'seeding.templateId']);
  assert.equal(firstIncompleteRequirement(state)?.field, 'name');
});

test('opens each level only after its parent level is complete', () => {
  const state = progressFixture();
  const campaign = state.draft.campaigns[0];
  const adSet = campaign.adSets[0];
  campaign.name = 'Chiến dịch tháng 9';
  campaign.adAccountId = 'act_1';
  campaign.pageId = 'page-1';
  campaign.seeding.templateId = 'seeding-template-1';
  campaign.seeding.templateName = 'Mẫu seeding tư vấn';

  assert.equal(requirementsForCampaign(campaign).every(({ complete }) => complete), true);
  assert.equal(navigationGate(state, 'adset-1').allowed, true);
  assert.equal(navigationGate(state, 'ad-1').allowed, false);

  adSet.name = 'Nữ 22–45';
  adSet.includedRegions = [{ key: '3847', name: 'Hồ Chí Minh', type: 'region', countryCode: 'VN' }];
  assert.equal(requirementsForAdSet(campaign, adSet).every(({ complete }) => complete), true);
  assert.equal(navigationGate(state, 'ad-1').allowed, true);
});

test('requires a seeding template before unlocking child editors', () => {
  const state = progressFixture();
  const campaign = state.draft.campaigns[0];
  const adSet = campaign.adSets[0];
  Object.assign(campaign, { name: 'Campaign', adAccountId: 'act_1', pageId: 'page-1' });
  Object.assign(adSet, {
    name: 'Nhóm 1',
    includedRegions: [{ key: '3847', name: 'Hồ Chí Minh', type: 'region', countryCode: 'VN' }]
  });

  const [requirement] = requirementsForSeeding(campaign);
  assert.equal(requirement.field, 'seeding.templateId');
  assert.equal(requirement.complete, false);
  assert.equal(requirement.message, 'Chọn mẫu seeding');
  assert.equal(navigationGate(state, 'adset-1').allowed, false);
  assert.equal(navigationGate(state, 'ad-1').allowed, false);
  assert.equal(firstIncompleteRequirement(state)?.field, 'seeding.templateId');

  Object.assign(campaign.seeding, {
    templateId: 'seeding-template-1',
    templateName: 'Mẫu seeding tư vấn'
  });

  assert.equal(navigationGate(state, 'adset-1').allowed, true);
  assert.equal(navigationGate(state, 'ad-1').allowed, true);
  assert.equal(firstIncompleteRequirement(state)?.field, 'name');
});

test('marks the four-step form complete only after ad creative, conversation and seeding are ready', () => {
  const state = progressFixture();
  const campaign = state.draft.campaigns[0];
  const adSet = campaign.adSets[0];
  const ad = adSet.ads[0];
  Object.assign(campaign, { name: 'Campaign', adAccountId: 'act_1', pageId: 'page-1' });
  Object.assign(adSet, {
    name: 'Nhóm 1',
    includedRegions: [{ key: '3847', name: 'Hồ Chí Minh', type: 'region', countryCode: 'VN' }]
  });
  Object.assign(ad, {
    name: 'Quảng cáo 1',
    primaryText: 'Nội dung chính',
    headline: 'Ưu đãi mới',
    mediaId: 'media-1',
    conversation: {
      templateName: 'Mẫu tư vấn',
      greeting: 'Xin chào, chúng tôi có thể giúp gì cho bạn?',
      imageMediaId: null,
      customerActions: []
    }
  });

  assert.equal(requirementsForAd(campaign, adSet, ad).every(({ complete }) => complete), true);
  assert.equal(firstIncompleteRequirement(state)?.field, 'seeding.templateId');
  assert.equal(workspaceProgress(state).formComplete, false);

  Object.assign(campaign.seeding, {
    templateId: 'seeding-template-1',
    templateName: 'Mẫu seeding tư vấn'
  });

  assert.equal(workspaceProgress(state).formComplete, true);
  assert.equal(workspaceProgress(state).completedSteps, 3);

  state.ui.progressReviewMode = true;
  assert.equal(workspaceProgress(state).reviewComplete, true);
  assert.equal(workspaceProgress(state).completedSteps, 4);
});

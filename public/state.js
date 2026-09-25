import { WEBSITE_PIXEL_ID } from './website-tracking.js';
import { createDefaultConversation } from './conversation.js';
import { createActivityHistoryState } from './activity-history.js';
import { applySeedingTemplate, createEmptySeeding } from './seeding.js';
import { applyAudienceTemplate } from './audience.js';

export const TOOL_AUDIENCE_TEMPLATE_PREFIX = 'tool_audience_';

export function isToolAudienceTemplateId(value) {
  return String(value ?? '').startsWith(TOOL_AUDIENCE_TEMPLATE_PREFIX);
}

export function toolAudienceTemplateCompatibility(template, adAccountId, customAudiences = []) {
  const content = template?.content ?? template ?? {};
  const customAudienceIds = [
    ...(content.includedCustomAudienceIds ?? []),
    ...(content.excludedCustomAudienceIds ?? [])
  ];
  if (customAudienceIds.length === 0) {
    return {
      compatible: true,
      reason: '',
      warning: '',
      allowedCustomAudienceIds: [],
      skippedCustomAudienceIds: []
    };
  }

  const sourceAdAccountId = String(content.sourceAdAccountId ?? '');
  const currentAdAccountId = String(adAccountId ?? '');
  const uniqueIds = [...new Set(customAudienceIds.map(String))];
  const availableIds = new Set(customAudiences.map((audience) => String(audience?.id ?? '')));
  const allowedIds = uniqueIds.filter((id) => availableIds.has(id));
  const missingIds = uniqueIds.filter((id) => !availableIds.has(id));
  if (!sourceAdAccountId) {
    return {
      compatible: true,
      reason: '',
      warning: missingIds.length > 0
        ? `Đã bỏ qua ${missingIds.length} Custom Audience không có trên tài khoản hiện tại: ${missingIds.join(', ')}`
        : '',
      allowedCustomAudienceIds: allowedIds,
      skippedCustomAudienceIds: missingIds
    };
  }
  if (sourceAdAccountId !== currentAdAccountId) {
    return {
      compatible: true,
      reason: '',
      warning: missingIds.length > 0
        ? `Đã bỏ qua ${missingIds.length} Custom Audience thuộc ${sourceAdAccountId} nhưng không có trên ${currentAdAccountId || 'tài khoản hiện tại'}: ${missingIds.join(', ')}`
        : '',
      allowedCustomAudienceIds: allowedIds,
      skippedCustomAudienceIds: missingIds
    };
  }
  if (missingIds.length > 0) {
    return {
      compatible: true,
      reason: '',
      warning: `Đã bỏ qua ${missingIds.length} Custom Audience không còn tồn tại hoặc tài khoản đã mất quyền: ${missingIds.join(', ')}`,
      allowedCustomAudienceIds: allowedIds,
      skippedCustomAudienceIds: missingIds
    };
  }
  return {
    compatible: true,
    reason: '',
    warning: '',
    allowedCustomAudienceIds: uniqueIds,
    skippedCustomAudienceIds: []
  };
}

function defaultRandomId() {
  return globalThis.crypto.randomUUID();
}

function createEmptyPageDiscovery() {
  return {
    loaded: false,
    requiresBusinessReconnect: false,
    warnings: [],
    counts: {
      total: 0,
      available: 0,
      unavailable: 0,
      promotable: 0,
      managed: 0,
      businessOwned: 0,
      businessClient: 0
    }
  };
}

export function createAd(randomId = defaultRandomId) {
  const clientId = randomId();
  return {
    clientId,
    creativeGroupId: clientId,
    name: '',
    primaryText: '',
    headline: '',
    mediaId: null,
    mediaAsset: null,
    mediaKind: '',
    mediaPreviewUrl: '',
    mediaFileName: '',
    mediaFileSize: 0,
    publicationMode: 'DARK',
    websiteEventsEnabled: true,
    websitePixelId: WEBSITE_PIXEL_ID,
    conversation: createDefaultConversation(randomId)
  };
}

export function createAdSet(randomId = defaultRandomId) {
  return {
    clientId: randomId(),
    name: '',
    conversionLocation: 'MESSAGING_APPS',
    destinationType: 'MESSENGER',
    optimizationGoal: 'CONVERSATIONS',
    dailyBudget: 400000,
    startTime: '',
    endTime: '',
    locationMode: 'REGIONS',
    includedRegions: [],
    excludedRegions: [],
    includedCities: [],
    excludedCities: [],
    includedCustomLocations: [],
    excludedCustomLocations: [],
    ageMin: 18,
    ageMax: 65,
    genders: [],
    locales: [],
    advantageAudienceEnabled: false,
    includedCustomAudienceIds: [],
    excludedCustomAudienceIds: [],
    detailedTargeting: [],
    audienceTemplateId: null,
    audienceTemplateName: '',
    audienceTemplateWarning: '',
    ads: [createAd(randomId)]
  };
}

export function createCampaign(randomId = defaultRandomId, defaults = {}) {
  return {
    clientId: randomId(),
    name: defaults.name ?? '',
    adAccountId: defaults.adAccountId ?? '',
    pageId: defaults.pageId ?? '',
    specialAdCategory: 'NONE',
    budgetStrategy: 'AD_SET',
    dailyBudget: 1000000,
    adSets: [createAdSet(randomId)],
    seeding: createEmptySeeding(randomId)
  };
}

export function createAccountResourceRequestGate() {
  let sequence = 0;

  return {
    begin(accountId) {
      const requestSequence = ++sequence;
      return {
        accountId,
        sequence: requestSequence,
        isCurrent(currentAccountId) {
          return requestSequence === sequence && accountId === currentAccountId;
        }
      };
    },
    invalidate() {
      sequence += 1;
    }
  };
}

export function createAccountResourceLoadCache() {
  const promisesByAccountId = new Map();

  return {
    load(accountId, load) {
      const existing = promisesByAccountId.get(accountId);
      if (existing) return existing;
      let promise;
      try {
        promise = Promise.resolve(load());
      } catch (error) {
        promise = Promise.reject(error);
      }
      promisesByAccountId.set(accountId, promise);
      promise.then(
        () => promisesByAccountId.delete(accountId),
        () => promisesByAccountId.delete(accountId)
      );
      return promise;
    }
  };
}

export function createOwnerResourceRequestGate() {
  let generation = 0;
  let ownerId = null;
  let sequence = 0;

  return {
    beginOwnerGeneration() {
      generation += 1;
      ownerId = null;
      sequence += 1;
      return generation;
    },
    acceptOwner(expectedGeneration, nextOwnerId) {
      if (generation !== expectedGeneration) return false;
      ownerId = nextOwnerId ?? null;
      sequence += 1;
      return true;
    },
    isGenerationCurrent(expectedGeneration) {
      return generation === expectedGeneration;
    },
    begin(expectedOwnerId = ownerId) {
      const requestGeneration = generation;
      const requestOwnerId = expectedOwnerId ?? null;
      const requestSequence = ++sequence;
      return {
        isCurrent(currentOwnerId) {
          return generation === requestGeneration
            && sequence === requestSequence
            && ownerId === requestOwnerId
            && requestOwnerId === (currentOwnerId ?? null);
        }
      };
    }
  };
}

export function createWorkspaceState({ randomId = defaultRandomId } = {}) {
  const campaign = createCampaign(randomId);
  return {
    connected: false,
    running: false,
    metaUser: null,
    selection: { clientId: campaign.clientId, type: 'campaign' },
    issues: [],
    publishProgress: null,
    activityHistory: createActivityHistoryState(),
    resources: {
      adAccounts: [],
      pages: [],
      pageDiscovery: createEmptyPageDiscovery(),
      accountResourcesById: {},
      conversationTemplates: [],
      conversationTemplatesLoaded: false,
      seedingTemplates: [],
      seedingTemplatesLoaded: false,
      seedingTemplatesError: null,
      campaignPresets: [],
      campaignPresetsLoaded: false,
      campaignPresetsError: null,
      audienceTemplates: [],
      audienceTemplatesLoaded: false,
      audienceTemplatesError: null,
      capabilities: {}
    },
    ui: {
      activeWorkspace: 'campaign',
      treeOpen: false,
      treeCollapsed: false,
      reviewOpen: false,
      resultsOpen: false,
      resultsCampaignClientId: null,
      targetingCategory: 'interest',
      targetingQuery: '',
      locationSelectionSide: 'include',
      locationQuery: '',
      loadingAccountResources: false,
      loadingAccountId: null,
      searchingTargeting: false,
      searchingLocations: false,
      loadingConversationTemplates: false,
      loadingSeedingTemplates: false,
      loadingCampaignPresets: false,
      loadingAudienceTemplates: false,
      campaignPresetSelectionByCampaignId: {},
      mediaUploads: {},
      seedingUploads: {},
      seedingRevisions: {},
      collapsedCampaignIds: [],
      collapsedAdSetIds: [],
      animatedDisclosureId: null,
      openNodeMenuId: null,
      progressReviewMode: false,
      progressErrors: []
    },
    draft: {
      campaigns: [campaign]
    }
  };
}

export function addCampaign(state, randomId = defaultRandomId) {
  const previousIds = state.draft.campaigns.map((campaign) => campaign.clientId);
  const campaign = createCampaign(randomId);
  state.draft.campaigns.push(campaign);
  state.ui.collapsedCampaignIds = [...new Set([
    ...(state.ui.collapsedCampaignIds ?? []),
    ...previousIds
  ])].filter((id) => id !== campaign.clientId);
  state.ui.openNodeMenuId = null;
  state.selection = { clientId: campaign.clientId, type: 'campaign' };
  return campaign;
}

export function duplicateCampaignSettings(state, sourceCampaignId, randomId = defaultRandomId) {
  const sourceIndex = state.draft.campaigns.findIndex(
    (campaign) => campaign.clientId === sourceCampaignId
  );
  if (sourceIndex < 0) return null;

  const source = state.draft.campaigns[sourceIndex];
  const copy = structuredClone(source);
  copy.clientId = randomId();
  copy.adSets = (source.adSets ?? []).map((sourceAdSet) => {
    const copiedAdSet = structuredClone(sourceAdSet);
    copiedAdSet.clientId = randomId();
    copiedAdSet.ads = [createAd(randomId)];
    return copiedAdSet;
  });
  copy.seeding = structuredClone(source.seeding ?? createEmptySeeding(randomId));
  copy.seeding.items = (copy.seeding.items ?? []).map((item) => ({
    ...item,
    id: randomId()
  }));
  state.draft.campaigns.splice(sourceIndex + 1, 0, copy);
  state.ui.collapsedCampaignIds = [...new Set([
    ...(state.ui.collapsedCampaignIds ?? []),
    source.clientId
  ])].filter((id) => id !== copy.clientId);
  closeNodeMenu(state);
  state.selection = { clientId: copy.clientId, type: 'campaign' };
  return copy;
}

export function addAdSet(state, campaignId, randomId = defaultRandomId) {
  const campaign = state.draft.campaigns.find((entry) => entry.clientId === campaignId);
  if (!campaign) {
    return null;
  }
  const adSet = createAdSet(randomId);
  campaign.adSets.push(adSet);
  setCampaignCollapsed(state, campaign.clientId, false);
  state.selection = { clientId: adSet.clientId, type: 'adSet' };
  return adSet;
}

export function addAd(state, adSetId, randomId = defaultRandomId) {
  const match = findNode(state, adSetId);
  if (!match || match.type !== 'adSet') {
    return null;
  }
  const ad = createAd(randomId);
  match.node.ads.push(ad);
  setCampaignCollapsed(state, match.campaign.clientId, false);
  state.selection = { clientId: ad.clientId, type: 'ad' };
  return ad;
}

export function duplicateAdSet(state, sourceAdSetId, randomId = defaultRandomId) {
  return duplicateAdSets(state, sourceAdSetId, 1, randomId)[0] ?? null;
}

export function duplicateAdSets(
  state,
  sourceAdSetId,
  quantity,
  randomId = defaultRandomId
) {
  const match = findNode(state, sourceAdSetId);
  if (!match || match.type !== 'adSet') {
    return [];
  }
  const normalizedQuantity = Number(quantity);
  if (!Number.isInteger(normalizedQuantity) || normalizedQuantity < 1 || normalizedQuantity > 20) return [];

  const source = match.node;
  const sourceIndex = match.campaign.adSets.findIndex((adSet) => adSet.clientId === sourceAdSetId);
  const copies = [];
  for (let index = 0; index < normalizedQuantity; index += 1) {
    const copy = structuredClone(source);
    copy.clientId = randomId();
    copy.name = source.name;
    copy.ads = source.ads.map((sourceAd) => {
      const copiedAd = structuredClone(sourceAd);
      copiedAd.clientId = randomId();
      copiedAd.creativeGroupId = ensureCreativeGroupId(sourceAd);
      copiedAd.name = sourceAd.name;
      return copiedAd;
    });
    copies.push(copy);
  }

  match.campaign.adSets.splice(sourceIndex + 1, 0, ...copies);
  setCampaignCollapsed(state, match.campaign.clientId, false);
  closeNodeMenu(state);
  state.selection = { clientId: copies.at(-1).clientId, type: 'adSet' };
  return copies;
}

export function archiveCompletedCampaigns(state, progress, randomId = defaultRandomId) {
  const completedIds = new Set(
    (progress?.campaigns ?? [])
      .filter((campaign) => campaign.status === 'completed' && Number(campaign.percent) >= 100)
      .map((campaign) => String(campaign.clientId))
  );
  if (completedIds.size === 0) return { removed: [], replacement: null };

  const removed = state.draft.campaigns.filter(
    (campaign) => completedIds.has(String(campaign.clientId))
  );
  if (removed.length === 0) return { removed: [], replacement: null };

  if (progress?.snapshot === state.draft) {
    progress.snapshot = structuredClone(progress.snapshot);
  }

  const removedNodeIds = new Set();
  for (const campaign of removed) {
    removedNodeIds.add(campaign.clientId);
    for (const adSet of campaign.adSets ?? []) {
      removedNodeIds.add(adSet.clientId);
      for (const ad of adSet.ads ?? []) removedNodeIds.add(ad.clientId);
    }
  }
  state.draft.campaigns = state.draft.campaigns.filter(
    (campaign) => !completedIds.has(String(campaign.clientId))
  );
  state.ui.collapsedCampaignIds = (state.ui.collapsedCampaignIds ?? [])
    .filter((id) => !removedNodeIds.has(id));
  state.ui.collapsedAdSetIds = (state.ui.collapsedAdSetIds ?? [])
    .filter((id) => !removedNodeIds.has(id));
  if (removedNodeIds.has(state.ui.openNodeMenuId)) closeNodeMenu(state);
  state.ui.progressReviewMode = false;
  state.ui.progressErrors = [];
  state.issues = [];

  let replacement = null;
  if (state.draft.campaigns.length === 0) {
    replacement = addCampaign(state, randomId);
  } else if (removedNodeIds.has(state.selection?.clientId)) {
    selectFallback(state);
  }
  return { removed, replacement };
}

export function duplicateAd(state, sourceAdId, randomId = defaultRandomId) {
  const match = findNode(state, sourceAdId);
  if (!match || match.type !== 'ad') {
    return null;
  }

  const source = match.node;
  const copy = structuredClone(source);
  copy.clientId = randomId();
  copy.creativeGroupId = ensureCreativeGroupId(source);
  copy.name = source.name;

  const sourceIndex = match.adSet.ads.findIndex((ad) => ad.clientId === sourceAdId);
  match.adSet.ads.splice(sourceIndex + 1, 0, copy);
  setCampaignCollapsed(state, match.campaign.clientId, false);
  closeNodeMenu(state);
  state.selection = { clientId: copy.clientId, type: 'ad' };
  return copy;
}

export function detachAdCreative(ad, randomId = defaultRandomId) {
  ad.creativeGroupId = randomId();
  return ad.creativeGroupId;
}

export function relinkMatchingCreative(state, adId) {
  const match = findNode(state, adId);
  if (!match || match.type !== 'ad') return false;
  const signature = comparableCreativeSignature(match.node);
  const matchingAd = match.campaign.adSets
    .flatMap((adSet) => adSet.ads)
    .find((ad) => ad.clientId !== adId && comparableCreativeSignature(ad) === signature);
  if (!matchingAd) return false;
  match.node.creativeGroupId = ensureCreativeGroupId(matchingAd);
  return true;
}

export function sharedCreativeCount(state, adId) {
  const match = findNode(state, adId);
  if (!match || match.type !== 'ad') return 0;
  const creativeGroupId = match.node.creativeGroupId ?? match.node.clientId;
  let count = 0;
  for (const campaign of state.draft.campaigns) {
    for (const adSet of campaign.adSets) {
      count += adSet.ads.filter(
        (ad) => (ad.creativeGroupId ?? ad.clientId) === creativeGroupId
      ).length;
    }
  }
  return count;
}

export function removeNode(state, clientId) {
  const match = findNode(state, clientId);
  if (!match) {
    return false;
  }
  closeNodeMenuForRemovedSubtree(state, match);

  const campaignIndex = state.draft.campaigns.findIndex((campaign) => campaign.clientId === clientId);
  if (campaignIndex >= 0) {
    state.draft.campaigns.splice(campaignIndex, 1);
    state.ui.collapsedCampaignIds = (state.ui.collapsedCampaignIds ?? [])
      .filter((id) => id !== clientId);
    selectFallback(state);
    return true;
  }

  for (const campaign of state.draft.campaigns) {
    const adSetIndex = campaign.adSets.findIndex((adSet) => adSet.clientId === clientId);
    if (adSetIndex >= 0) {
      campaign.adSets.splice(adSetIndex, 1);
      state.selection = { clientId: campaign.clientId, type: 'campaign' };
      return true;
    }

    for (const adSet of campaign.adSets) {
      const adIndex = adSet.ads.findIndex((ad) => ad.clientId === clientId);
      if (adIndex >= 0) {
        adSet.ads.splice(adIndex, 1);
        state.selection = { clientId: adSet.clientId, type: 'adSet' };
        return true;
      }
    }
  }

  return false;
}

export function activateNode(state, clientId) {
  const match = findNode(state, clientId);
  if (!match) return false;

  state.selection = { clientId, type: match.type };
  closeNodeMenu(state);
  if (match.type !== 'campaign') {
    setCampaignCollapsed(state, match.campaign.clientId, false);
  }
  if (match.type === 'ad') {
    setAdSetCollapsed(state, match.adSet.clientId, false);
  }
  return true;
}

export function toggleCampaignCollapsed(state, campaignId) {
  const match = findNode(state, campaignId);
  if (match?.type !== 'campaign') return false;
  setCampaignCollapsed(state, campaignId, !isCampaignCollapsed(state, campaignId));
  return true;
}

export function toggleAdSetCollapsed(state, adSetId) {
  const match = findNode(state, adSetId);
  if (match?.type !== 'adSet') return false;
  setAdSetCollapsed(state, adSetId, !isAdSetCollapsed(state, adSetId));
  return true;
}

export function toggleNodeMenu(state, clientId) {
  if (!findNode(state, clientId)) return false;
  state.ui.openNodeMenuId = state.ui.openNodeMenuId === clientId ? null : clientId;
  return true;
}

export function closeNodeMenu(state) {
  if (!state.ui.openNodeMenuId) return false;
  state.ui.openNodeMenuId = null;
  return true;
}

export function selectNode(state, clientId) {
  const match = findNode(state, clientId);
  if (!match) {
    return false;
  }
  state.selection = { clientId, type: match.type };
  return true;
}

export function updateNodeField(state, clientId, field, value, randomId = defaultRandomId) {
  const match = findNode(state, clientId);
  if (!match) {
    return false;
  }
  if (Object.is(match.node[field], value)) {
    return true;
  }
  if (match.type === 'ad' && creativeFields.has(field)) {
    detachAdCreative(match.node, randomId);
  }
  if (match.type === 'campaign' && field === 'pageId') {
    const replacementGroups = new Map();
    for (const ad of match.node.adSets.flatMap((adSet) => adSet.ads)) {
      const creativeGroupId = ad.creativeGroupId ?? ad.clientId;
      if (!replacementGroups.has(creativeGroupId)) {
        replacementGroups.set(creativeGroupId, randomId());
      }
      ad.creativeGroupId = replacementGroups.get(creativeGroupId);
    }
  }
  if (match.type === 'ad' && ['websiteEventsEnabled', 'websitePixelId'].includes(field)) return false;
  match.node[field] = value;
  return true;
}

export function findNode(state, clientId) {
  for (const campaign of state.draft.campaigns) {
    if (campaign.clientId === clientId) {
      return { node: campaign, type: 'campaign', campaign };
    }
    for (const adSet of campaign.adSets) {
      if (adSet.clientId === clientId) {
        return { node: adSet, type: 'adSet', campaign, adSet };
      }
      for (const ad of adSet.ads) {
        if (ad.clientId === clientId) {
          return { node: ad, type: 'ad', campaign, adSet, ad };
        }
      }
    }
  }
  return null;
}

export function activeCampaign(state) {
  return findNode(state, state.selection?.clientId)?.campaign
    ?? state.draft.campaigns[0]
    ?? null;
}

export function resourcesForCampaign(state, campaign) {
  if (!campaign?.adAccountId) return createEmptyAccountResources();
  return state.resources.accountResourcesById?.[campaign.adAccountId]
    ?? createEmptyAccountResources();
}

export function setAccountResources(state, accountId, resources) {
  if (!accountId) return null;
  state.resources.accountResourcesById ??= {};
  const next = {
    loaded: resources?.loaded ?? false,
    customAudiences: resources?.customAudiences ?? [],
    savedAudiences: resources?.savedAudiences ?? [],
    // The account's promote_pages; the Page picker only warns, since Meta can omit Business Portfolio Pages.
    promotablePageIds: (resources?.promotablePageIds ?? []).map(String),
    pageEligibilityKnown: resources?.pageEligibilityKnown === true,
    targetingResults: resources?.targetingResults ?? [],
    locationResults: resources?.locationResults ?? []
  };
  state.resources.accountResourcesById[accountId] = next;
  if (next.loaded) {
    for (const campaign of state.draft.campaigns) {
      if (campaign.adAccountId !== accountId) continue;
      for (const adSet of campaign.adSets) {
        if (!adSet.audienceTemplateId || isToolAudienceTemplateId(adSet.audienceTemplateId)) continue;
        const template = next.savedAudiences.find((item) => item.id === adSet.audienceTemplateId);
        if (template?.compatible === true) applyAudienceTemplate(adSet, template);
      }
    }
  }
  return next;
}

export function changeCampaignAccount(state, campaignId, accountId) {
  const match = findNode(state, campaignId);
  if (match?.type !== 'campaign') return false;
  if (match.node.adAccountId === accountId) return true;
  match.node.adAccountId = accountId;
  for (const adSet of match.node.adSets) {
    adSet.includedCustomAudienceIds = [];
    adSet.excludedCustomAudienceIds = [];
    adSet.detailedTargeting = [];
    adSet.locales = [];
    adSet.audienceTemplateId = null;
    adSet.audienceTemplateName = '';
    for (const ad of adSet.ads) {
      ad.mediaId = null;
      ad.mediaAsset = null;
      ad.mediaKind = '';
      ad.mediaPreviewUrl = '';
      ad.mediaFileName = '';
      ad.mediaFileSize = 0;
    }
  }
  return true;
}

export function reconcileAvailableCampaignAccounts(state, availableAccountIds) {
  for (const campaign of state.draft.campaigns) {
    if (campaign.adAccountId && !availableAccountIds.has(campaign.adAccountId)) {
      changeCampaignAccount(state, campaign.clientId, '');
    }
  }
}

export function updateCampaignSeeding(state, campaignId, field, value) {
  const match = findNode(state, campaignId);
  if (match?.type !== 'campaign') return false;
  match.node.seeding ??= createEmptySeeding();
  if (Object.is(match.node.seeding[field], value)) return true;
  match.node.seeding[field] = value;
  touchCampaignSeeding(state, campaignId);
  return true;
}

export function updateSeedingItem(state, campaignId, itemId, field, value) {
  const match = findNode(state, campaignId);
  const item = match?.type === 'campaign'
    ? match.node.seeding?.items?.find((entry) => entry.id === itemId)
    : null;
  if (!item) return false;
  if (Object.is(item[field], value)) return true;
  item[field] = value;
  touchCampaignSeeding(state, campaignId);
  return true;
}

export function addSeedingItem(state, campaignId, randomId = defaultRandomId) {
  const match = findNode(state, campaignId);
  if (match?.type !== 'campaign') return null;
  match.node.seeding ??= createEmptySeeding(randomId);
  const item = {
    id: randomId(),
    message: '',
    imageMediaId: null,
    imageName: '',
    imageSize: 0,
    imageMimeType: '',
    imagePreviewUrl: ''
  };
  match.node.seeding.items.push(item);
  touchCampaignSeeding(state, campaignId);
  return item;
}

export function removeSeedingItem(state, campaignId, itemId) {
  const match = findNode(state, campaignId);
  const items = match?.type === 'campaign' ? match.node.seeding?.items : null;
  if (!items || items.length <= 1) return false;
  const index = items.findIndex((item) => item.id === itemId);
  if (index < 0) return false;
  items.splice(index, 1);
  touchCampaignSeeding(state, campaignId);
  return true;
}

export function moveSeedingItem(state, campaignId, itemId, offset) {
  if (!Number.isInteger(offset) || ![-1, 1].includes(offset)) return false;
  const match = findNode(state, campaignId);
  const items = match?.type === 'campaign' ? match.node.seeding?.items : null;
  if (!items) return false;
  const index = items.findIndex((item) => item.id === itemId);
  const targetIndex = index + offset;
  if (index < 0 || targetIndex < 0 || targetIndex >= items.length) return false;
  const [item] = items.splice(index, 1);
  items.splice(targetIndex, 0, item);
  touchCampaignSeeding(state, campaignId);
  return true;
}

export function replaceCampaignSeeding(state, campaignId, nextSeeding) {
  const match = findNode(state, campaignId);
  if (match?.type !== 'campaign') return false;
  match.node.seeding = nextSeeding;
  touchCampaignSeeding(state, campaignId);
  return true;
}

export function captureCampaignSeedingSnapshot(state, campaignId) {
  const match = findNode(state, campaignId);
  if (match?.type !== 'campaign') return null;
  return {
    campaignId,
    seeding: match.node.seeding,
    revision: campaignSeedingRevision(state, campaignId)
  };
}

export function isCampaignSeedingSnapshotCurrent(state, snapshot) {
  if (!snapshot) return false;
  const match = findNode(state, snapshot.campaignId);
  return match?.type === 'campaign'
    && match.node.seeding === snapshot.seeding
    && campaignSeedingRevision(state, snapshot.campaignId) === snapshot.revision;
}

export function applyCampaignSeedingTemplate(state, campaignId, template, expectedSnapshot) {
  if (expectedSnapshot && !isCampaignSeedingSnapshotCurrent(state, expectedSnapshot)) return false;
  const match = findNode(state, campaignId);
  if (match?.type !== 'campaign') return false;
  applySeedingTemplate(match.node, template);
  match.node.seeding.items = match.node.seeding.items.map((item) => {
    const sourceItem = template.items?.find((entry) => entry.id === item.id);
    return {
      ...item,
      imageName: sourceItem?.imageName ?? '',
      imageSize: sourceItem?.imageSize ?? 0,
      imageMimeType: sourceItem?.imageMimeType ?? '',
      imagePreviewUrl: sourceItem?.imagePreviewUrl ?? ''
    };
  });
  touchCampaignSeeding(state, campaignId);
  return true;
}

export function captureSeedingUploadTarget(state, campaignId, itemId) {
  const snapshot = captureCampaignSeedingSnapshot(state, campaignId);
  const item = snapshot?.seeding?.items?.find((entry) => entry.id === itemId);
  return item ? { snapshot, item } : null;
}

export function isSeedingUploadTargetCurrent(state, target) {
  if (!target?.snapshot || !target.item) return false;
  const match = findNode(state, target.snapshot.campaignId);
  return match?.type === 'campaign'
    && match.node.seeding === target.snapshot.seeding
    && match.node.seeding.items?.some((item) => item === target.item);
}

export function validateSeedingImageFile(file) {
  if (!['image/jpeg', 'image/png', 'video/mp4', 'video/quicktime'].includes(file?.type)) {
    throw new Error('Media seeding chỉ hỗ trợ JPEG, PNG, MP4 hoặc MOV');
  }
  if (Number(file.size) > 200 * 1024 * 1024) {
    throw new Error('Media seeding tối đa 200 MB');
  }
  return true;
}

function campaignSeedingRevision(state, campaignId) {
  return state.ui?.seedingRevisions?.[campaignId] ?? 0;
}

function touchCampaignSeeding(state, campaignId) {
  state.ui.seedingRevisions ??= {};
  state.ui.seedingRevisions[campaignId] = campaignSeedingRevision(state, campaignId) + 1;
}

export function moveCustomAudience(adSet, audienceId, targetList) {
  adSet.includedCustomAudienceIds = adSet.includedCustomAudienceIds.filter((id) => id !== audienceId);
  adSet.excludedCustomAudienceIds = adSet.excludedCustomAudienceIds.filter((id) => id !== audienceId);
  const key = targetList === 'include'
    ? 'includedCustomAudienceIds'
    : 'excludedCustomAudienceIds';
  adSet[key].push(audienceId);
}

export function customizeCustomAudience(state, adSetId, audienceId, targetList) {
  const match = findNode(state, adSetId);
  if (match?.type !== 'adSet' || !audienceId || !['include', 'exclude'].includes(targetList)) {
    return false;
  }
  if (!isToolAudienceTemplateId(match.node.audienceTemplateId)) {
    detachAdSetAudienceTemplate(state, adSetId);
  }
  moveCustomAudience(match.node, audienceId, targetList);
  return true;
}

export function moveRegion(adSet, region, targetList) {
  if (!['include', 'exclude'].includes(targetList) || (!isVietnamRegion(region) && !isVietnamCity(region))) {
    return false;
  }

  if (region.type === 'city') {
    adSet.includedCities = (adSet.includedCities ?? []).filter((entry) => entry.key !== region.key);
    adSet.excludedCities = (adSet.excludedCities ?? []).filter((entry) => entry.key !== region.key);
    const key = targetList === 'include' ? 'includedCities' : 'excludedCities';
    adSet[key].push({
      key: String(region.key),
      name: region.name,
      type: 'city',
      countryCode: 'VN',
      region: region.region ?? '',
      radius: region.radius === null ? null : normalizeLocationRadius(region.radius, region.distanceUnit),
      distanceUnit: region.distanceUnit ?? 'kilometer'
    });
    return true;
  }

  adSet.includedRegions = (adSet.includedRegions ?? []).filter((entry) => entry.key !== region.key);
  adSet.excludedRegions = (adSet.excludedRegions ?? []).filter((entry) => entry.key !== region.key);

  const key = targetList === 'include' ? 'includedRegions' : 'excludedRegions';
  adSet[key].push({
    key: String(region.key),
    name: region.name,
    type: 'region',
    countryCode: 'VN'
  });
  if (targetList === 'include') {
    adSet.locationMode = 'REGIONS';
  }
  return true;
}

export function removeRegion(adSet, regionKey, targetList) {
  const key = targetList === 'include' ? 'includedRegions' : 'excludedRegions';
  const previousLength = (adSet[key] ?? []).length;
  adSet[key] = (adSet[key] ?? []).filter((entry) => entry.key !== regionKey);
  return adSet[key].length !== previousLength;
}

export function removeCity(adSet, cityKey, targetList) {
  const key = targetList === 'include' ? 'includedCities' : 'excludedCities';
  const previousLength = (adSet[key] ?? []).length;
  adSet[key] = (adSet[key] ?? []).filter((entry) => entry.key !== cityKey);
  return adSet[key].length !== previousLength;
}

export function updateCityRadius(adSet, cityKey, targetList, radius) {
  const key = targetList === 'include' ? 'includedCities' : 'excludedCities';
  const city = (adSet[key] ?? []).find((entry) => entry.key === cityKey);
  if (!city) return false;
  city.radius = normalizeLocationRadius(radius, city.distanceUnit);
  city.distanceUnit ??= 'kilometer';
  return true;
}

export function moveCustomLocation(adSet, location, targetList) {
  if (!['include', 'exclude'].includes(targetList) || !isValidCustomLocation(location)) {
    return false;
  }

  const normalized = normalizeCustomLocation(location);
  adSet.includedCustomLocations = (adSet.includedCustomLocations ?? [])
    .filter((entry) => customLocationIdentity(entry) !== normalized.key);
  adSet.excludedCustomLocations = (adSet.excludedCustomLocations ?? [])
    .filter((entry) => customLocationIdentity(entry) !== normalized.key);
  const key = targetList === 'include' ? 'includedCustomLocations' : 'excludedCustomLocations';
  adSet[key].push(normalized);
  adSet.locationMode = 'REGIONS';
  return true;
}

export function removeCustomLocation(adSet, locationKey, targetList) {
  const key = targetList === 'include' ? 'includedCustomLocations' : 'excludedCustomLocations';
  const previousLength = (adSet[key] ?? []).length;
  adSet[key] = (adSet[key] ?? [])
    .filter((entry) => customLocationIdentity(entry) !== String(locationKey));
  return adSet[key].length !== previousLength;
}

export function updateCustomLocationRadius(adSet, locationKey, targetList, radius) {
  const key = targetList === 'include' ? 'includedCustomLocations' : 'excludedCustomLocations';
  const location = (adSet[key] ?? [])
    .find((entry) => customLocationIdentity(entry) === String(locationKey));
  if (!location) return false;
  location.radius = normalizeLocationRadius(radius, location.distanceUnit);
  location.distanceUnit ??= 'kilometer';
  return true;
}

function isValidCustomLocation(location) {
  const latitude = Number(location?.latitude);
  const longitude = Number(location?.longitude);
  return Boolean(
    String(location?.name ?? '').trim()
    && location?.latitude != null && String(location.latitude).trim() !== ''
    && location?.longitude != null && String(location.longitude).trim() !== ''
    && Number.isFinite(latitude)
    && latitude >= -90
    && latitude <= 90
    && Number.isFinite(longitude)
    && longitude >= -180
    && longitude <= 180
  );
}

function normalizeCustomLocation(location) {
  const latitude = Number(location.latitude);
  const longitude = Number(location.longitude);
  const key = String(location.key || `pin:${latitude.toFixed(6)},${longitude.toFixed(6)}`);
  return {
    key,
    name: String(location.name).trim(),
    type: 'custom_location',
    countryCode: 'VN',
    latitude,
    longitude,
    radius: normalizeLocationRadius(location.radius, location.distanceUnit),
    distanceUnit: location.distanceUnit ?? 'kilometer'
  };
}

function customLocationIdentity(location) {
  if (location?.key) return String(location.key);
  const latitude = Number(location?.latitude);
  const longitude = Number(location?.longitude);
  return `pin:${latitude.toFixed(6)},${longitude.toFixed(6)}`;
}

export function applyAudienceTemplateToAdSet(state, adSetId, template) {
  const match = findNode(state, adSetId);
  if (match?.type !== 'adSet') return false;
  applyAudienceTemplate(match.node, template);
  return true;
}

export function detachAdSetAudienceTemplate(state, adSetId) {
  const match = findNode(state, adSetId);
  if (match?.type !== 'adSet') return false;
  match.node.audienceTemplateId = null;
  match.node.audienceTemplateName = '';
  match.node.audienceTemplateWarning = '';
  return true;
}

export function updateAdSetAudienceTemplateName(state, adSetId, value) {
  const match = findNode(state, adSetId);
  if (match?.type !== 'adSet') return false;
  match.node.audienceTemplateName = value;
  return true;
}

export function calculateBudgetSummary(campaigns) {
  return campaigns.reduce((total, campaign) => {
    if (campaign.budgetStrategy === 'CAMPAIGN') {
      return total + numericBudget(campaign.dailyBudget);
    }
    return total + campaign.adSets.reduce(
      (campaignTotal, adSet) => campaignTotal + numericBudget(adSet.dailyBudget),
      0
    );
  }, 0);
}

export function preserveSelectedPages(nextPages, previousPages, adSets) {
  const merged = [...nextPages];
  const nextIds = new Set(merged.map((page) => page.id));
  const previousById = new Map(previousPages.map((page) => [page.id, page]));
  for (const pageId of new Set(adSets.map((adSet) => adSet.pageId).filter(Boolean))) {
    if (nextIds.has(pageId)) continue;
    const previous = previousById.get(pageId);
    if (!previous) continue;
    merged.push({
      id: previous.id,
      name: previous.name,
      sources: [],
      canAdvertise: false,
      unavailableReason: 'Page không còn trong catalog mới; hãy chọn Page khác'
    });
  }
  return merged;
}

export function reconcilePageDiscoveryCounts(pageDiscovery, pages) {
  const available = pages.filter((page) => page.canAdvertise !== false).length;
  const unavailable = pages.filter((page) => page.canAdvertise === false).length;
  return {
    ...pageDiscovery,
    counts: {
      ...(pageDiscovery.counts ?? {}),
      total: pages.length,
      available,
      unavailable
    }
  };
}

export function clearPageCatalogState(state, accountId) {
  if (!accountId) {
    state.resources.pages = [];
    state.resources.pageDiscovery = createEmptyPageDiscovery();
    state.resources.accountResourcesById = {};
    return;
  }
  const resources = state.resources.accountResourcesById?.[accountId];
  if (resources) {
    resources.loaded = false;
  }
}

export function pageCatalogIssues(draft, pages = []) {
  const issues = [];
  const pagesById = new Map(pages.map((page) => [String(page.id), page]));
  draft.campaigns.forEach((campaign, campaignIndex) => {
    if (!campaign.pageId) return;
    const page = pagesById.get(String(campaign.pageId));
    if (!page || page.canAdvertise === false) {
      issues.push({
        path: `campaigns.${campaignIndex}.pageId`,
        message: 'Page không đủ quyền tạo quảng cáo; hãy chọn Page khác'
      });
    }
  });
  return issues;
}

function createEmptyAccountResources() {
  return {
    loaded: false,
    customAudiences: [],
    savedAudiences: [],
    targetingResults: [],
    locationResults: []
  };
}

function numericBudget(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : 0;
}

const creativeFields = new Set(['primaryText', 'headline', 'mediaId', 'mediaAsset', 'publicationMode']);

function ensureCreativeGroupId(ad) {
  ad.creativeGroupId ??= ad.clientId;
  return ad.creativeGroupId;
}

function comparableCreativeSignature(ad) {
  return JSON.stringify({
    publicationMode: ad.publicationMode ?? 'DARK',
    mediaId: ad.mediaId ?? null,
    primaryText: ad.primaryText ?? '',
    headline: ad.headline ?? '',
    conversation: {
      greeting: ad.conversation?.greeting ?? '',
      quickReplies: (ad.conversation?.quickReplies ?? []).map(({ title, payload }) => ({ title, payload })),
      showBusinessPhoneNumber: Boolean(ad.conversation?.showBusinessPhoneNumber),
      businessPhoneNumber: ad.conversation?.businessPhoneNumber ?? '',
      customerActions: (ad.conversation?.customerActions ?? []).map(({ label, type, value }) => ({ label, type, value }))
    }
  });
}

function isCampaignCollapsed(state, campaignId) {
  return (state.ui.collapsedCampaignIds ?? []).includes(campaignId);
}

function setCampaignCollapsed(state, campaignId, collapsed) {
  const ids = new Set(state.ui.collapsedCampaignIds ?? []);
  if (collapsed) ids.add(campaignId);
  else ids.delete(campaignId);
  state.ui.collapsedCampaignIds = [...ids];
}

function isAdSetCollapsed(state, adSetId) {
  return (state.ui.collapsedAdSetIds ?? []).includes(adSetId);
}

function setAdSetCollapsed(state, adSetId, collapsed) {
  const ids = new Set(state.ui.collapsedAdSetIds ?? []);
  if (collapsed) ids.add(adSetId);
  else ids.delete(adSetId);
  state.ui.collapsedAdSetIds = [...ids];
}

function closeNodeMenuForRemovedSubtree(state, match) {
  const openMatch = findNode(state, state.ui.openNodeMenuId);
  if (!openMatch) return;

  const isInRemovedSubtree = match.type === 'campaign'
    ? openMatch.campaign.clientId === match.campaign.clientId
    : match.type === 'adSet'
      ? openMatch.adSet?.clientId === match.adSet.clientId
      : openMatch.ad?.clientId === match.ad.clientId;
  if (isInRemovedSubtree) closeNodeMenu(state);
}

function isVietnamRegion(region) {
  return Boolean(
    region
    && String(region.key ?? '').trim()
    && String(region.name ?? '').trim()
    && region.type === 'region'
    && region.countryCode === 'VN'
  );
}

function isVietnamCity(city) {
  return Boolean(
    city
    && String(city.key ?? '').trim()
    && String(city.name ?? '').trim()
    && city.type === 'city'
    && city.countryCode === 'VN'
  );
}

function normalizeLocationRadius(value, unit = 'kilometer') {
  const number = Number(value);
  if (!Number.isFinite(number)) return 8;
  return Math.min(unit === 'mile' ? 50 : 80, Math.max(0.01, number));
}

function selectFallback(state) {
  const campaign = state.draft.campaigns[0];
  state.selection = campaign
    ? { clientId: campaign.clientId, type: 'campaign' }
    : { clientId: null, type: null };
}

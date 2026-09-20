import { applyFixedWebsiteTracking } from './website-tracking.js';
const PREFIX = 'meta-ads-workspace-v1:';
const uiKeys = ['activeWorkspace', 'collapsedCampaignIds', 'collapsedAdSetIds', 'treeCollapsed', 'launchSections', 'launchMode'];

function serialize(value) {
  return JSON.stringify(value, (key, entry) => {
    if (/token|secret|password/i.test(key)) return undefined;
    if (typeof entry === 'string' && entry.startsWith('blob:')) return '';
    return entry;
  });
}

function validSnapshot(snapshot) {
  return snapshot?.version === 1 && Array.isArray(snapshot.draft?.campaigns)
    && snapshot.draft.campaigns.every((campaign) => campaign && typeof campaign.clientId === 'string'
      && Array.isArray(campaign.adSets) && campaign.adSets.every((adSet) => adSet
        && typeof adSet.clientId === 'string' && Array.isArray(adSet.ads)
        && adSet.ads.every((ad) => ad && typeof ad.clientId === 'string' && ad.conversation)));
}

export function createDraftStorage({ storage, onError = () => {} }) {
  let key = null;
  let lastSaved = null;
  let warned = false;
  const submittedCampaignIds = new Set();
  function report(error) {
    if (!warned) onError(error);
    warned = true;
  }
  return {
    markSubmitted(state) {
      for (const campaign of state.draft.campaigns) submittedCampaignIds.add(campaign.clientId);
      return this.save(state);
    },
    suspend() { key = null; },
    restore(state, ownerId = 'anonymous') {
      key = PREFIX + encodeURIComponent(ownerId || 'anonymous');
      lastSaved = null;
      try {
        const raw = storage.getItem(key);
        if (!raw) return false;
        const snapshot = JSON.parse(raw);
        if (!validSnapshot(snapshot)) throw new Error('Invalid saved draft');
        state.draft = snapshot.draft;
        for (const campaign of state.draft.campaigns) {
          for (const adSet of campaign.adSets) {
            adSet.ads.forEach(applyFixedWebsiteTracking);
          }
        }
        const nodes = snapshot.draft.campaigns.flatMap((campaign) => [
          { clientId: campaign.clientId, type: 'campaign' },
          ...campaign.adSets.flatMap((adSet) => [
            { clientId: adSet.clientId, type: 'adSet' },
            ...adSet.ads.map((ad) => ({ clientId: ad.clientId, type: 'ad' }))
          ])
        ]);
        state.selection = nodes.find((node) => node.clientId === snapshot.selection?.clientId) ?? nodes[0] ?? null;
        for (const uiKey of uiKeys) {
          if (snapshot.ui && Object.hasOwn(snapshot.ui, uiKey)) state.ui[uiKey] = snapshot.ui[uiKey];
        }
        return true;
      } catch (error) {
        key = null;
        report(error);
        return false;
      }
    },
    save(state) {
      if (!key) return false;
      try {
        const draft = { ...state.draft, campaigns: state.draft.campaigns.filter(
          (campaign) => !submittedCampaignIds.has(campaign.clientId)
        ) };
        const serialized = serialize({ version: 1, draft, selection: state.selection,
          ui: Object.fromEntries(uiKeys.map((uiKey) => [uiKey, state.ui[uiKey]])) });
        if (serialized !== lastSaved) storage.setItem(key, serialized);
        lastSaved = serialized;
        return true;
      } catch (error) {
        report(error);
        return false;
      }
    }
  };
}

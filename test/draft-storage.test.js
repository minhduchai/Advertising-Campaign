import test from 'node:test';
import assert from 'node:assert/strict';
import { createDraftStorage } from '../public/draft-storage.js';
import { createWorkspaceState } from '../public/state.js';

function memoryStorage() {
  const items = new Map();
  return { items, getItem: (key) => items.get(key) ?? null, setItem: (key, value) => items.set(key, value) };
}

test('restores unfinished campaign content, selection and uploaded media after a reload', () => {
  const storage = memoryStorage();
  const writer = createDraftStorage({ storage });
  const state = createWorkspaceState();
  writer.restore(state, 'owner-a');
  const campaign = state.draft.campaigns[0];
  campaign.name = 'Chiến dịch đang soạn';
  campaign.adAccountId = 'act_123';
  campaign.adSets[0].dailyBudget = 750000;
  const ad = campaign.adSets[0].ads[0];
  ad.primaryText = 'Nội dung chưa hoàn tất';
  ad.mediaAsset = { image_hash: 'uploaded-image' };
  ad.mediaPreviewUrl = 'blob:temporary';
  state.selection = { clientId: ad.clientId, type: 'ad' };
  state.ui.launchSections = { [ad.clientId]: 'message' };
  state.connected = true;
  state.running = true;
  state.resources.accessToken = 'must-not-persist';
  assert.equal(writer.save(state), true);
  const restored = createWorkspaceState();
  assert.equal(createDraftStorage({ storage }).restore(restored, 'owner-a'), true);
  assert.equal(restored.draft.campaigns[0].name, campaign.name);
  assert.equal(restored.draft.campaigns[0].adSets[0].dailyBudget, 750000);
  assert.equal(restored.draft.campaigns[0].adSets[0].ads[0].primaryText, ad.primaryText);
  assert.deepEqual(restored.draft.campaigns[0].adSets[0].ads[0].mediaAsset, ad.mediaAsset);
  assert.equal(restored.draft.campaigns[0].adSets[0].ads[0].mediaPreviewUrl, '');
  assert.deepEqual(restored.selection, state.selection);
  assert.equal(restored.connected, false);
  assert.equal(restored.running, false);
  assert.ok(![...storage.items.values()][0].includes('must-not-persist'));
});

test('isolates owners and persists deleting the last campaign', () => {
  const storage = memoryStorage();
  const writer = createDraftStorage({ storage });
  const state = createWorkspaceState();
  writer.restore(state, 'owner-a');
  state.draft.campaigns = [];
  writer.save(state);
  const other = createWorkspaceState();
  assert.equal(createDraftStorage({ storage }).restore(other, 'owner-b'), false);
  assert.equal(other.draft.campaigns.length, 1);
  assert.equal(createDraftStorage({ storage }).restore(other, 'owner-a'), true);
  assert.equal(other.draft.campaigns.length, 0);
});

test('confirmed campaigns stay out of restored drafts while publishing and after later saves', () => {
  const storage = memoryStorage();
  const writer = createDraftStorage({ storage });
  const state = createWorkspaceState();
  writer.restore(state, 'owner');
  const submitted = state.draft.campaigns[0];
  submitted.name = 'Already confirmed';
  writer.save(state);
  assert.equal(writer.markSubmitted(state), true);
  assert.equal(state.draft.campaigns[0], submitted, 'live progress keeps its campaign');
  state.running = true;
  writer.save(state);
  const reload = createWorkspaceState();
  createDraftStorage({ storage }).restore(reload, 'owner');
  assert.deepEqual(reload.draft.campaigns, []);
  const fresh = createWorkspaceState().draft.campaigns[0];
  fresh.name = 'Next unfinished campaign';
  state.draft.campaigns.push(fresh);
  state.running = false;
  writer.save(state);
  createDraftStorage({ storage }).restore(reload, 'owner');
  assert.deepEqual(reload.draft.campaigns.map((campaign) => campaign.name), ['Next unfinished campaign']);
});

test('unconfirmed drafts remain recoverable', () => {
  const storage = memoryStorage();
  const writer = createDraftStorage({ storage });
  const state = createWorkspaceState();
  writer.restore(state, 'owner');
  state.draft.campaigns[0].name = 'Confirmation cancelled';
  writer.save(state);
  const reload = createWorkspaceState();
  createDraftStorage({ storage }).restore(reload, 'owner');
  assert.equal(reload.draft.campaigns[0].name, 'Confirmation cancelled');
});

test('does not overwrite stored content before initialization or after disconnect', () => {
  const storage = memoryStorage();
  const writer = createDraftStorage({ storage });
  const state = createWorkspaceState();
  assert.equal(writer.save(state), false);
  writer.restore(state, 'owner');
  writer.save(state);
  const original = [...storage.items.values()][0];
  writer.suspend();
  state.draft.campaigns = [];
  writer.save(state);
  assert.equal([...storage.items.values()][0], original);
});

test('handles denied storage, corrupt snapshots and quota errors without crashing', () => {
  let warnings = 0;
  const writer = createDraftStorage({ storage: {
    getItem: () => '{broken', setItem: () => { throw new Error('Quota exceeded'); }
  }, onError: () => warnings++ });
  const state = createWorkspaceState();
  assert.equal(writer.restore(state, 'owner'), false);
  assert.equal(writer.save(state), false);
  assert.equal(warnings, 1);
  assert.equal(state.draft.campaigns.length, 1);
});

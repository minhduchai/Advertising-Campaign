import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAdParams, validateDraft } from '../src/draft.js';
import { createMetaClient } from '../src/meta-client.js';
import { testConfig } from './helpers.js';
import { createWorkspaceState, updateNodeField, duplicateAd, setAccountResources } from '../public/state.js';
import { createDraftStorage } from '../public/draft-storage.js';
import { renderWorkspace } from '../public/workspace.js';
import { requirementsForAd } from '../public/workspace-progress.js';

test('every ad payload uses the fixed website Pixel, including legacy or conflicting drafts', () => {
  for (const tracking of [{}, { websiteEventsEnabled: false }, { websiteEventsEnabled: true, websitePixelId: 'wrong' }]) {
    const params = buildAdParams('set', 'creative', { name: 'Ad', ...tracking });
    assert.deepEqual(JSON.parse(params.get('tracking_specs')), [{
      'action.type': ['offsite_conversion'], fb_pixel: ['657921569053875']
    }]);
  }
});

test('new, duplicated and restored ads keep the fixed tracking configuration', () => {
  const state = createWorkspaceState();
  const ad = state.draft.campaigns[0].adSets[0].ads[0];
  assert.equal(ad.websiteEventsEnabled, true);
  assert.equal(ad.websitePixelId, '657921569053875');
  assert.equal(updateNodeField(state, ad.clientId, 'websitePixelId', '123'), false);
  assert.equal(duplicateAd(state, ad.clientId).websitePixelId, '657921569053875');
  const data = new Map();
  const storage = createDraftStorage({ storage: { getItem: key => data.get(key), setItem: (key, value) => data.set(key, value) } });
  storage.restore(state, 'test');
  ad.websiteEventsEnabled = false;
  ad.websitePixelId = '';
  storage.save(state);
  const restored = createWorkspaceState();
  assert.equal(storage.restore(restored, 'test'), true);
  const restoredAd = restored.draft.campaigns[0].adSets[0].ads[0];
  assert.equal(restoredAd.websiteEventsEnabled, true);
  assert.equal(restoredAd.websitePixelId, '657921569053875');
  restored.selection = { type: 'ad', clientId: restoredAd.clientId };
  const html = renderWorkspace(restored);
  assert.match(html, /type="checkbox" checked disabled/);
  assert.match(html, /value="657921569053875" readonly/);
});

test('pixel discovery requests only ids and names from the selected ad account', async () => {
  const client = createMetaClient(testConfig(), { fetchImpl: async (url) => {
    const request = new URL(url);
    assert.equal(request.pathname, '/v25.0/act_25/adspixels');
    assert.equal(request.searchParams.get('fields'), 'id,name');
    return Response.json({ data: [{ id: '123456', name: 'Website LG' }] });
  } });
  assert.deepEqual(await client.listPixels('test-token', 'act_25'), [{ id: '123456', name: 'Website LG' }]);
});

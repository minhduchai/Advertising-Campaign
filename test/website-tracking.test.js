import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAdParams, validateDraft } from '../src/draft.js';
import { createMetaClient } from '../src/meta-client.js';
import { createServer } from '../src/server.js';
import { encryptToken, signSession } from '../src/crypto.js';
import { request, testConfig } from './helpers.js';
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

test('account resources keep promotable Pages but never list Pixels, since ads use the fixed Pixel', async (context) => {
  const config = testConfig();
  const paths = [];
  const server = createServer({
    config,
    db: {
      createSession: () => ({ id: 'new-session' }),
      getSession: () => ({ id: 'session-user', metaUserId: 'meta-user-1' }),
      getConnection: () => ({ accessTokenCiphertext: encryptToken('EAAG-token', config.tokenEncryptionKey) })
    },
    metaClient: createMetaClient(config, { fetchImpl: async (url) => {
      paths.push(new URL(url).pathname);
      return Response.json({ data: [{ id: 'page-1', name: 'Page' }] });
    } })
  });
  context.after(() => server.close());

  const response = await request(server, '/api/ad-account-resources?adAccountId=act_25', {
    headers: { cookie: `meta_ads_session=${encodeURIComponent(signSession('session-user', config.sessionSecret))}` }
  });

  assert.equal(response.status, 200);
  assert.deepEqual(paths.sort(), ['/v25.0/act_25/customaudiences', '/v25.0/act_25/promote_pages', '/v25.0/act_25/saved_audiences']);
  assert.deepEqual(response.body.promotablePageIds, ['page-1']);
  assert.equal('pixels' in response.body, false);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import {
  applyLocalDemoResources,
  createLocalDemoResources,
  shouldUseLocalDemoResources
} from '../public/local-demo-resources.js';

test('enables demo resources only on local preview hosts', () => {
  assert.equal(shouldUseLocalDemoResources({ hostname: 'localhost', search: '' }, { status: 401 }), true);
  assert.equal(shouldUseLocalDemoResources({ hostname: '127.0.0.1', search: '?demoResources=1' }), true);
  assert.equal(shouldUseLocalDemoResources({ hostname: 'creative-campaign-lgclinic.vercel.app', search: '?demoResources=1' }, { status: 401 }), false);
  assert.equal(shouldUseLocalDemoResources({ hostname: 'localhost', search: '' }, { status: 500 }), false);
});

test('provides accounts, Pages, custom audiences and saved audiences for dropdown testing', () => {
  const resources = createLocalDemoResources();

  assert.ok(resources.adAccounts.length >= 3);
  assert.ok(resources.pages.length >= 5);
  assert.ok(resources.audienceTemplates.length >= 3);
  assert.equal(resources.audienceTemplatesLoaded, true);
  assert.equal(resources.seedingTemplatesLoaded, true);
  assert.ok(resources.seedingTemplates.length >= 1);
  assert.ok(resources.seedingTemplates[0].items.length >= 1);
  assert.equal(resources.conversationTemplatesLoaded, true);
  assert.ok(resources.conversationTemplates.length >= 1);
  assert.equal(resources.campaignPresetsLoaded, true);
  assert.ok(resources.campaignPresets.length >= 1);
  assert.equal(resources.campaignPresets[0].content.seedingTemplateId, resources.seedingTemplates[0].id);
  assert.equal(resources.campaignPresets[0].content.conversationTemplateId, resources.conversationTemplates[0].id);
  assert.equal(resources.campaignPresets[0].content.audienceTemplateId, resources.audienceTemplates[0].id);
  assert.equal(resources.campaignPresets[0].content.audienceContent.ageMin, resources.audienceTemplates[0].content.ageMin);

  for (const account of resources.adAccounts) {
    const accountResources = resources.accountResourcesById[account.id];
    assert.equal(accountResources.loaded, true);
    assert.ok(accountResources.customAudiences.length >= 3);
    assert.ok(accountResources.savedAudiences.length >= 2);
  }
});

test('applies demo resources without pretending the user connected to Meta', () => {
  const state = {
    connected: true,
    metaUser: { id: 'real-user' },
    resources: {},
    ui: {}
  };

  applyLocalDemoResources(state);

  assert.equal(state.connected, false);
  assert.equal(state.metaUser, null);
  assert.equal(state.ui.localDemoResources, true);
  assert.ok(state.resources.adAccounts.some((account) => account.canAdvertise === false));
  assert.ok(state.resources.pages.some((page) => page.canAdvertise === false));
});

test('falls back to local demo resources after a disconnected local resource request', async () => {
  const appSource = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');

  assert.match(appSource, /import \{ applyLocalDemoResources, shouldUseLocalDemoResources \} from '\.\/local-demo-resources\.js'/);
  assert.match(appSource, /shouldUseLocalDemoResources\(window\.location, error\)/);
  assert.match(appSource, /applyLocalDemoResources\(state\)/);
  assert.match(appSource, /if \(state\.ui\.localDemoResources\) \{/);
});

test('loads demo resources before clearing the local preview query', async () => {
  const appSource = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');
  const loadIndex = appSource.lastIndexOf('loadResources();');
  const clearQueryIndex = appSource.lastIndexOf("window.history.replaceState({}, '', window.location.pathname);");

  assert.ok(loadIndex >= 0);
  assert.ok(clearQueryIndex >= 0);
  assert.ok(loadIndex < clearQueryIndex);
});

test('keeps demo resource query visible after local initialization', async () => {
  const appSource = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');

  assert.match(appSource, /startupParams\.get\('demoResources'\) === '1'/);
  assert.match(appSource, /!preserveDemoQuery && \(window\.location\.search \|\| window\.location\.hash\)/);
});

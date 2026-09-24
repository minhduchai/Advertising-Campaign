import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createWorkspaceState, addCampaign, addAdSet, activateNode } from '../public/state.js';
import { applyEntrySection, launchSummary, launchSection, renderReadiness, renderUtility, revealField, safePreviewUrl, sectionTarget, setSection } from '../public/launch-preview.js';
import { shouldUseLocalDemoResources } from '../public/local-demo-resources.js';
import { createServer } from '../src/server.js';
import { request, testConfig } from './helpers.js';

test('live Launch Control never silently replaces a disconnected Meta session with mock accounts', () => {
  const location = { hostname: 'localhost', search: '?frontend=launch-control' };
  assert.equal(shouldUseLocalDemoResources(location), false);
  assert.equal(shouldUseLocalDemoResources(location, { status: 401 }), false);
  assert.equal(shouldUseLocalDemoResources({ ...location, search: '?frontend=launch-control&demoResources=1' }), true);
  assert.equal(shouldUseLocalDemoResources({ ...location, search: '?realResources=1&demoResources=1' }, { status: 401 }), false);
});

test('readiness reflects edited draft fields and distinguishes live, demo and disconnected sessions', () => {
  const state = createWorkspaceState();
  const before = launchSummary(state);
  assert.equal(before.mode, 'disconnected');
  assert.deepEqual(before.counts, { campaigns: 1, adSets: 1, ads: 1 });
  state.draft.campaigns[0].name = 'Test Meta';
  const after = launchSummary(state);
  assert.equal(after.complete, before.complete + 1);
  assert.equal(after.missing.length, before.missing.length - 1);
  state.connected = true;
  assert.equal(launchSummary(state).mode, 'live');
  state.ui.localDemoResources = true;
  assert.equal(launchSummary(state).mode, 'demo');
});

test('budget summary respects campaign versus ad set budgets and keeps currencies separate', () => {
  const state = createWorkspaceState();
  const campaign = state.draft.campaigns[0];
  campaign.adAccountId = 'act_vnd';
  state.resources.adAccounts = [{ id: 'act_vnd', currency: 'VND' }, { id: 'act_usd', currency: 'USD' }];
  addAdSet(state, campaign.clientId);
  assert.deepEqual(launchSummary(state).budgets, [{ currency: 'VND', amount: 800000 }]);
  campaign.budgetStrategy = 'CAMPAIGN';
  campaign.dailyBudget = 1500000;
  const second = addCampaign(state);
  second.adAccountId = 'act_usd';
  second.adSets[0].dailyBudget = 30;
  assert.deepEqual(launchSummary(state).budgets, [{ currency: 'VND', amount: 1500000 }, { currency: 'USD', amount: 30 }]);
});

test('four-part navigation uses the selected campaign and existing prerequisite gates', () => {
  const state = createWorkspaceState();
  const campaign = addCampaign(state);
  const group = campaign.adSets[0];
  assert.equal(sectionTarget(state, 'setup').clientId, campaign.clientId);
  assert.equal(sectionTarget(state, 'audience').clientId, group.clientId);
  assert.equal(sectionTarget(state, 'audience').allowed, false);
  Object.assign(campaign, { name: 'Campaign', adAccountId: 'act_1', pageId: 'page_1' });
  campaign.seeding.templateId = 'seed_1';
  assert.equal(sectionTarget(state, 'audience').allowed, true);
  assert.equal(sectionTarget(state, 'content').allowed, false);
  Object.assign(group, { name: 'Ad Set', includedRegions: [{ key: 'hcm' }] });
  assert.equal(sectionTarget(state, 'content').allowed, true);
  assert.equal(sectionTarget(state, 'message').clientId, group.ads[0].clientId);
  assert.equal(sectionTarget(state, 'unknown'), null);
});

test('validation reveals the correct content or Messenger panel without losing another Ad selection', () => {
  const state = createWorkspaceState();
  const first = state.draft.campaigns[0].adSets[0].ads[0];
  activateNode(state, first.clientId);
  assert.equal(launchSection(state), 'content');
  revealField(state, first.clientId, 'conversation.greeting');
  assert.equal(launchSection(state), 'message');
  revealField(state, first.clientId, 'mediaId');
  assert.equal(launchSection(state), 'content');
  const second = addCampaign(state).adSets[0].ads[0];
  setSection(state, 'message', second.clientId);
  activateNode(state, first.clientId);
  assert.equal(launchSection(state), 'content');
  activateNode(state, second.clientId);
  assert.equal(launchSection(state), 'message');
});

test('readiness escapes Meta names and validation errors before rendering', () => {
  const state = createWorkspaceState();
  state.draft.campaigns[0].name = '<img src=x onerror=alert(1)>';
  state.ui.progressReviewMode = true;
  state.issues = [{ message: '<script>alert(1)</script>' }];
  const html = renderReadiness(state);
  assert.ok(html.includes('&lt;img'));
  assert.ok(html.includes('&lt;script&gt;'));
  assert.ok(!html.includes('<script>'));
  assert.ok(html.includes('data-action="progress-requirement"'));
});

test('ad preview only accepts uploaded media and HTTPS image sources', () => {
  assert.equal(safePreviewUrl('javascript:alert(1)'), '');
  assert.equal(safePreviewUrl('//untrusted.test/image'), '');
  assert.equal(safePreviewUrl('file:///D:/private.jpg'), '');
  assert.equal(safePreviewUrl('/api/media/123/preview'), '/api/media/123/preview');
  assert.equal(safePreviewUrl('blob:http://localhost:3001/test'), 'blob:http://localhost:3001/test');
  assert.equal(safePreviewUrl('https://example.test/image.jpg'), 'https://example.test/image.jpg');
});

test('preview assets are public static resources that cannot create or replace an authenticated session', async (context) => {
  let sessions = 0;
  const server = createServer({ config: testConfig(), metaClient: {}, db: { createSession: () => { sessions += 1; return { id: 'new' }; } } });
  context.after(() => server.close());
  for (const path of ['/launch-preview.js', '/launch-preview.css', '/launch-concept.css']) {
    const result = await request(server, path);
    assert.equal(result.status, 200);
    assert.equal(result.sessionCookie, null);
  }
  assert.equal(sessions, 0);
});

test('local entry opens the reference Content screen without inventing or completing draft data', () => {
  const state = createWorkspaceState();
  const before = JSON.stringify(state.draft);
  applyEntrySection(state, '?frontend=launch-control&realResources=1&section=content');
  assert.equal(launchSection(state), 'content');
  assert.equal(state.selection.clientId, state.draft.campaigns[0].adSets[0].ads[0].clientId);
  assert.equal(JSON.stringify(state.draft), before);
  assert.equal(launchSummary(state).progress.formComplete, false);
  assert.equal(state.connected, false);
  assert.equal(state.ui.localDemoResources, undefined);
});

test('the local visual system loads its production stylesheet without the legacy control layer', async () => {
  const adapter = await readFile(new URL('../public/launch-preview.css', import.meta.url), 'utf8');
  assert.ok(adapter.includes("@import url('/app.css') layer(legacy)"));
  assert.ok(adapter.includes("@import url('/launch-concept.css')"));
  assert.ok(!adapter.includes("@import url('/launch-control.css')"));
});

test('overview and library show only supplied resources and escape external names', () => {
  const state = createWorkspaceState();
  assert.ok(renderUtility(state, 'library').includes('Kết nối Meta'));
  state.connected = true;
  state.resources.conversationTemplates = [{ name: '<img src=x onerror=alert(1)>' }];
  const library = renderUtility(state, 'library');
  assert.ok(library.includes('&lt;img'));
  assert.ok(!library.includes('<img'));
  assert.ok(!library.includes('Duck Store'));
  assert.ok(renderUtility(state, 'overview').includes('1</strong><p>Campaign'));
});

test('preview dropdown positioning accounts for the fixed editor header without changing legacy behavior', async () => {
  const app = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');
  assert.ok(app.includes("const scrollRect = launchPreview ? root.closest('.workspace-editor')?.getBoundingClientRect() : null"));
  assert.ok(app.includes("if (launchPreview && target?.matches('.workspace-editor'))"));
  assert.ok(app.includes('if (!launchPreview && !gate.allowed && !movingBack)'));
});

test('small-screen adapter keeps controls usable and content clear of bottom navigation', async () => {
  const css = await readFile(new URL('../public/launch-preview.css', import.meta.url), 'utf8');
  assert.ok(css.includes('.launch-app > .nav-rail { position: static; inset: auto;'));
  assert.ok(css.includes('.connection-account-button.connection-chip { display: flex; width: 42px;'));
  assert.ok(css.includes('.mobile-tree-toggle span { display: none; }'));
  assert.ok(css.includes('.launch-check .button-count { display: inline-flex; color: #fff;'));
});

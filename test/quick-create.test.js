import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorkspaceState } from '../public/state.js';
import { applyLocalDemoResources } from '../public/local-demo-resources.js';
import { applyEntryMode, quickProfile, renderQuickWorkspace } from '../public/quick-create.js';

test('opens quick mode only from its explicit entry URL', () => {
  const state = createWorkspaceState();
  applyEntryMode(state, '?mode=quick');
  assert.equal(state.ui.launchMode, 'quick');
});

test('renders the focused media-and-copy flow without inventing setup values', () => {
  const state = createWorkspaceState();
  applyLocalDemoResources(state);
  const profile = quickProfile(state);
  const html = renderQuickWorkspace(state);
  assert.equal(profile.account, undefined);
  assert.ok(profile.missing.includes('tài khoản quảng cáo'));
  assert.match(html, /Tạo quảng cáo nhanh/);
  assert.match(html, /data-action="upload-media"/);
  assert.match(html, /data-field="primaryText"/);
  assert.match(html, /data-field="headline"/);
  assert.match(html, /data-quick-mode="detail"/);
});

test('escapes reusable profile names in quick-create markup', () => {
  const state = createWorkspaceState();
  applyLocalDemoResources(state);
  state.resources.campaignPresets[0].name = '<img onerror=alert(1)>';
  const html = renderQuickWorkspace(state);
  assert.doesNotMatch(html, /<img onerror/);
  assert.match(html, /&lt;img onerror=alert\(1\)&gt;/);
});

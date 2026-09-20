import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

const appSource = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');
const cssSource = await readFile(new URL('../public/app.css', import.meta.url), 'utf8');

test('handles validation issue navigation from the review panel', () => {
  assert.match(appSource, /action === 'jump-to-validation-issue'/);
  assert.match(appSource, /jumpToValidationIssue\(control\)/);
  assert.match(appSource, /function validationTargetSelectors/);
  assert.match(appSource, /scrollIntoView/);
  assert.match(appSource, /is-validation-highlight/);
});

test('keeps a missing Seeding selection on the Campaign picker', () => {
  assert.match(appSource, /fieldPath === 'seeding\.templateId'/);
  assert.match(appSource, /\[data-client-id="\$\{safeClientId\}"\]\[data-campaign-seeding-template-picker\]/);
  assert.match(appSource, /target\.open = true/);
});

test('styles clickable issues and temporary validation highlights accessibly', () => {
  assert.match(cssSource, /\.issue-item-jump/);
  assert.match(cssSource, /\.issue-item-jump:focus-visible/);
  assert.match(cssSource, /\.is-validation-highlight/);
  assert.match(cssSource, /prefers-reduced-motion/);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const indexSource = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');
const cssSource = await readFile(new URL('../public/app.css', import.meta.url), 'utf8');
const handlerSource = await readFile(new URL('../src/request-handler.js', import.meta.url), 'utf8');

test('theme module resolves saved choice before system preference', async () => {
  const { resolveTheme } = await import('../public/theme.js');
  assert.equal(resolveTheme({ storedTheme: 'light', prefersDark: true }), 'light');
  assert.equal(resolveTheme({ storedTheme: 'dark', prefersDark: false }), 'dark');
  assert.equal(resolveTheme({ storedTheme: null, prefersDark: true }), 'dark');
  assert.equal(resolveTheme({ storedTheme: 'invalid', prefersDark: false }), 'light');
});

test('theme boot runs before the stylesheet and toggle is accessible', () => {
  const bootPosition = indexSource.indexOf('meta-campaign-theme');
  const stylesheetPosition = indexSource.indexOf('rel="stylesheet"');
  assert.ok(bootPosition > -1);
  assert.ok(bootPosition < stylesheetPosition);
  assert.match(indexSource, /id="toggle-theme"/);
  assert.match(indexSource, /data-theme-icon/);
  assert.match(indexSource, /data-theme-label/);
});

test('applyTheme updates root and browser chrome color', async () => {
  const { applyTheme } = await import('../public/theme.js');
  const root = { dataset: {} };
  const themeColorMeta = { content: '' };
  assert.equal(applyTheme('light', { root, themeColorMeta }), 'light');
  assert.equal(root.dataset.theme, 'light');
  assert.equal(themeColorMeta.content, '#f6f8fc');
});

test('theme toggle persists manual choice and updates accessible label', async () => {
  const { initializeThemeToggle, THEME_STORAGE_KEY } = await import('../public/theme.js');
  const values = new Map();
  const storage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value)
  };
  const listeners = new Map();
  const icon = { textContent: '' };
  const label = { textContent: '' };
  const button = {
    attributes: {},
    querySelector: (selector) => selector === '[data-theme-icon]' ? icon : label,
    setAttribute(name, value) { this.attributes[name] = value; },
    addEventListener(name, handler) { listeners.set(name, handler); },
    removeEventListener() {}
  };
  const mediaQuery = { matches: true, addEventListener() {}, removeEventListener() {} };
  const root = { dataset: {} };

  initializeThemeToggle({ root, button, storage, mediaQuery, themeColorMeta: { content: '' } });
  assert.equal(root.dataset.theme, 'dark');
  assert.equal(button.attributes['aria-label'], 'Chuyển sang chế độ sáng');
  listeners.get('click')();
  assert.equal(root.dataset.theme, 'light');
  assert.equal(values.get(THEME_STORAGE_KEY), 'light');
  assert.equal(button.attributes['aria-label'], 'Chuyển sang chế độ tối');
});

test('stylesheet contains light theme tokens and theme control styles', () => {
  assert.match(cssSource, /\[data-theme=['"]light['"]\]/);
  assert.match(cssSource, /\.theme-toggle/);
  assert.match(indexSource, /name="color-scheme" content="light dark"/);
});

test('server exposes the browser theme module', () => {
  assert.match(handlerSource, /'\/theme\.js'/);
});

test('light mode tokenizes locked controls, template cards, uploaders, segments, and review cards', () => {
  assert.match(cssSource, /--color-locked-control:/);
  assert.match(cssSource, /--color-template-panel:/);
  assert.match(cssSource, /--color-dropzone:/);
  assert.match(cssSource, /--color-segment-track:/);
  assert.match(cssSource, /\.locked-control\s*\{[\s\S]*?background:\s*var\(--color-locked-control\)/);
  assert.match(cssSource, /\.template-card-picker\s*\{[\s\S]*?background:\s*var\(--color-template-panel\)/);
  assert.match(cssSource, /\.media-dropzone\s*\{[\s\S]*?background:\s*var\(--color-dropzone\)/);
  assert.match(cssSource, /\.seeding-image-control\s*\{[\s\S]*?background:\s*var\(--color-dropzone\)/);
  assert.match(cssSource, /\.segmented-control\s*\{[\s\S]*?background:\s*var\(--color-segment-track\)/);
});

test('form hover states use theme tokens instead of a dark hard-coded background', () => {
  assert.match(
    cssSource,
    /input:hover:not\(:disabled\),[\s\S]*?textarea:hover:not\(:disabled\)\s*\{[\s\S]*?background:\s*var\(--color-surface-hover\)/
  );
  assert.doesNotMatch(
    cssSource,
    /input:hover:not\(:disabled\),[\s\S]*?textarea:hover:not\(:disabled\)\s*\{[\s\S]*?background:\s*rgba\(30, 41, 59, 0\.9\)/
  );
});

test('valid setup status uses a theme-aware success background', () => {
  assert.match(cssSource, /--color-review-success-gradient:/);
  assert.match(
    cssSource,
    /\.review-section\.validation-summary\.is-valid\s*\{[\s\S]*?background:\s*var\(--color-review-success-gradient\)/
  );
});

test('connected Meta account exposes an accessible account menu and disconnect confirmation', () => {
  assert.match(indexSource, /id="meta-account-menu"/);
  assert.match(indexSource, /data-account-action="reconnect"/);
  assert.match(indexSource, /data-account-action="switch"/);
  assert.match(indexSource, /data-account-action="disconnect"/);
  assert.match(indexSource, /id="disconnect-meta-confirmation"/);
  assert.match(cssSource, /\.connection-account-menu/);
  assert.match(cssSource, /\.disconnect-meta-confirmation/);
});

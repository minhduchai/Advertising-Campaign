# Chế Độ Sáng Tối Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Thêm nút chuyển chế độ sáng/tối trên header, mặc định theo giao diện hệ thống ở lần truy cập đầu và ghi nhớ lựa chọn thủ công.

**Architecture:** Một module trình duyệt độc lập quản lý giá trị `light`/`dark`, lưu trong `localStorage` với khóa `meta-campaign-theme`, cập nhật `data-theme` trên phần tử `<html>` và đồng bộ nút header. Một đoạn script nhỏ chạy trong `<head>` áp dụng theme trước khi CSS hiển thị để tránh nháy màu; `app.css` tiếp tục dùng hệ token hiện có và chỉ ghi đè token cho theme sáng.

**Tech Stack:** HTML, CSS custom properties, JavaScript ES modules, Node.js built-in test runner.

## Global Constraints

- Lần truy cập đầu phải theo `prefers-color-scheme` của hệ điều hành.
- Sau khi người dùng chọn thủ công, chỉ lưu `light` hoặc `dark` trong `localStorage`.
- Nút đổi theme nằm trong khu vực hành động của header, dùng biểu tượng mặt trời/mặt trăng và có nhãn trợ năng tiếng Việt.
- Theme phải được áp dụng trước khi stylesheet hiển thị để tránh chớp giao diện sai màu.
- Không thêm thư viện hoặc framework mới.
- Không thay đổi logic tạo quảng cáo, OAuth, seeding hoặc báo cáo.

---

## File Structure

- Create: `public/theme.js` — đọc/lưu lựa chọn, xác định theme hệ thống, áp dụng theme và gắn sự kiện nút header.
- Modify: `public/index.html` — thêm boot script sớm và nút đổi theme vào header.
- Modify: `public/app.css` — bổ sung token theme sáng và style cho nút đổi theme.
- Modify: `public/app.js` — khởi tạo module theme khi ứng dụng tải.
- Create: `test/theme.test.js` — kiểm tra contract HTML, module theme, lưu lựa chọn và token CSS.

---

### Task 1: Theme State And Boot Contract

**Files:**
- Create: `public/theme.js`
- Modify: `public/index.html:3`
- Test: `test/theme.test.js`

**Interfaces:**
- Produces: `resolveTheme({ storedTheme, prefersDark }): 'light' | 'dark'`.
- Produces: `applyTheme(theme, { root, themeColorMeta }): 'light' | 'dark'`.
- Produces: `initializeThemeToggle({ root, button, storage, mediaQuery, themeColorMeta }): () => void`.
- Uses storage key: `meta-campaign-theme`.

- [ ] **Step 1: Write failing contract tests**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolveTheme } from '../public/theme.js';

const indexSource = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');

test('uses a saved manual theme before the system preference', () => {
  assert.equal(resolveTheme({ storedTheme: 'light', prefersDark: true }), 'light');
  assert.equal(resolveTheme({ storedTheme: 'dark', prefersDark: false }), 'dark');
});

test('falls back to the system preference without a saved theme', () => {
  assert.equal(resolveTheme({ storedTheme: null, prefersDark: true }), 'dark');
  assert.equal(resolveTheme({ storedTheme: null, prefersDark: false }), 'light');
});

test('applies the theme before loading the stylesheet', () => {
  const bootPosition = indexSource.indexOf('meta-campaign-theme');
  const stylesheetPosition = indexSource.indexOf('rel="stylesheet"');
  assert.ok(bootPosition > -1);
  assert.ok(bootPosition < stylesheetPosition);
});
```

- [ ] **Step 2: Run the focused test and confirm failure**

Run: `node --test test/theme.test.js`

Expected: FAIL because `public/theme.js` and the early boot script do not exist.

- [ ] **Step 3: Implement the pure resolver and early boot script**

```js
export const THEME_STORAGE_KEY = 'meta-campaign-theme';

export function resolveTheme({ storedTheme, prefersDark }) {
  if (storedTheme === 'light' || storedTheme === 'dark') return storedTheme;
  return prefersDark ? 'dark' : 'light';
}
```

Add an inline script before `/app.css` that safely reads `meta-campaign-theme`, falls back to `matchMedia('(prefers-color-scheme: dark)')`, and sets `document.documentElement.dataset.theme` to `light` or `dark`. Wrap storage access in `try/catch` so blocked storage cannot prevent rendering.

- [ ] **Step 4: Run the focused test and confirm pass**

Run: `node --test test/theme.test.js`

Expected: PASS for theme resolution and script ordering.

---

### Task 2: Header Toggle And Theme Tokens

**Files:**
- Modify: `public/theme.js`
- Modify: `public/index.html:32`
- Modify: `public/app.css:3`
- Modify: `public/app.js:1`
- Test: `test/theme.test.js`

**Interfaces:**
- Consumes: `resolveTheme` and `THEME_STORAGE_KEY` from Task 1.
- Produces: `applyTheme` and `initializeThemeToggle` exported by `public/theme.js`.
- Produces DOM contract: `#toggle-theme`, `[data-theme-icon]`, `[data-theme-label]`.

- [ ] **Step 1: Add failing tests for toggle markup and state updates**

```js
import { applyTheme, initializeThemeToggle } from '../public/theme.js';

test('renders an accessible theme toggle in the header', () => {
  assert.match(indexSource, /id="toggle-theme"/);
  assert.match(indexSource, /data-theme-icon/);
  assert.match(indexSource, /data-theme-label/);
});

test('applies theme attributes and browser theme color', () => {
  const root = { dataset: {} };
  const themeColorMeta = { content: '' };
  assert.equal(applyTheme('light', { root, themeColorMeta }), 'light');
  assert.equal(root.dataset.theme, 'light');
  assert.equal(themeColorMeta.content, '#f6f8fc');
});
```

- [ ] **Step 2: Run the focused test and confirm failure**

Run: `node --test test/theme.test.js`

Expected: FAIL because the header control and theme application functions are absent.

- [ ] **Step 3: Add the header control and initialize it from the app**

Add this control before the connection status inside `.topbar-actions`:

```html
<button id="toggle-theme" type="button" class="theme-toggle" aria-label="Chuyển sang chế độ sáng" title="Chuyển sang chế độ sáng">
  <span data-theme-icon aria-hidden="true"></span>
  <span data-theme-label class="sr-only">Chuyển sang chế độ sáng</span>
</button>
```

In `public/app.js`, import and initialize the module once:

```js
import { initializeThemeToggle } from './theme.js';

initializeThemeToggle({
  root: document.documentElement,
  button: document.querySelector('#toggle-theme'),
  storage: window.localStorage,
  mediaQuery: window.matchMedia('(prefers-color-scheme: dark)'),
  themeColorMeta: document.querySelector('meta[name="theme-color"]')
});
```

The initializer must update the icon, `aria-label`, `title`, and hidden label after each change; clicking stores the opposite theme. A system theme change only updates the UI when no valid manual preference exists. Return a cleanup function that removes click and media-query listeners.

- [ ] **Step 4: Add light tokens and compact button styling**

Keep current `:root` values as dark defaults. Add `[data-theme='light']` overrides for canvas, surfaces, text, borders, shadows, status colors, browser `color-scheme`, and any currently hard-coded dark background needed for readable core panels. Style `.theme-toggle` as a 40px circular header control with visible hover and `:focus-visible` states; use CSS-drawn sun/moon presentation from the `data-theme` state without loading image assets.

- [ ] **Step 5: Run the focused test and confirm pass**

Run: `node --test test/theme.test.js`

Expected: PASS for markup, state application, persistence contract, labels, and CSS selectors.

---

### Task 3: Regression Validation

**Files:**
- Modify: `test/theme.test.js`

**Interfaces:**
- Consumes: all theme module exports and DOM/CSS contracts from Tasks 1–2.
- Produces: regression coverage proving the feature does not alter workspace behavior.

- [ ] **Step 1: Add tests for invalid storage and system-change behavior**

```js
test('ignores invalid saved values', () => {
  assert.equal(resolveTheme({ storedTheme: 'system', prefersDark: false }), 'light');
  assert.equal(resolveTheme({ storedTheme: 'blue', prefersDark: true }), 'dark');
});

test('declares both supported browser color schemes', () => {
  assert.match(indexSource, /name="color-scheme" content="light dark"/);
});
```

Use small fake objects for `storage`, `button`, and `mediaQuery` to verify: one click writes the opposite theme, button labels describe the next action, and system changes are ignored after manual selection.

- [ ] **Step 2: Run the focused theme suite**

Run: `node --test test/theme.test.js`

Expected: PASS.

- [ ] **Step 3: Run the complete project suite**

Run: `npm test`

Expected: build succeeds and all existing plus new tests pass.

- [ ] **Step 4: Perform browser acceptance checks**

Run: `npm run dev`

Verify at `http://localhost:3001/`:

1. With no `meta-campaign-theme` value, the initial theme matches Windows.
2. The page does not flash dark before light mode or light before dark mode.
3. The header button changes the complete interface without reloading.
4. Reloading preserves the manually selected theme.
5. Header, campaign tree, editor forms, review panel, modal/drawer, Seeding and Lịch sử hoạt động remain readable in both modes.
6. Keyboard focus is visible and the button label announces the action that will occur.

---

## Repository Note

The workspace currently has no `.git` repository, so commit steps are intentionally omitted. Implementation should remain limited to the files listed above.

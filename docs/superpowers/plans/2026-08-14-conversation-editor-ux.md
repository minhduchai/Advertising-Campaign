# Conversation Editor UX Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the flat conversation editor stack with a compact template/library flow, structured composer, and Messenger preview panel.

**Architecture:** Keep `conversationEditor`, `sharedCustomerActionsEditor`, and `conversationPreview` as the existing rendering boundaries. Add semantic wrapper classes and one conditional `open` decision in the renderer; style the wrappers with native CSS Grid and the existing design tokens.

**Tech Stack:** Browser ES modules, template-string HTML, CSS Grid, Node.js built-in test runner.

## Global Constraints

- Preserve all existing `data-*` attributes and action names.
- Preserve the existing `conversation` object shape and all CRUD behavior.
- Use existing color, spacing, radius, and typography variables from `public/app.css`.
- Add no new dependency and no backend change.
- Keep JSON preview collapsed by default.
- Stack composer columns below `900px`.
- This workspace has no `.git` directory, so commit steps are intentionally omitted.

---

### Task 1: Restructure Conversation Markup and Add UX Regression Tests

**Files:**
- Modify: `test/workspace.test.js:450`
- Modify: `public/workspace.js:862`

**Interfaces:**
- Consumes: existing `state`, `campaign`, `adSet`, and `ad` values passed to `conversationEditor`.
- Produces: semantic `.conversation-channel-header`, `.conversation-library`, `.conversation-builder`, `.conversation-form`, and `.conversation-preview` wrappers while retaining existing controls.

- [ ] **Step 1: Add failing renderer tests**

Add assertions covering the approved structure:

```js
test('renders the conversation editor as a compact library plus composer', () => {
  const state = workspaceFixture({ selectedClientId: 'ad-1' });
  const html = renderWorkspace(state);

  assert.match(html, /class="conversation-channel-header"/);
  assert.match(html, /class="conversation-library"/);
  assert.match(html, /class="conversation-builder"/);
  assert.match(html, /class="conversation-form"/);
  assert.match(html, /class="conversation-preview"/);
  assert.match(html, /class="conversation-json-preview"/);
  assert.match(html, /summary>JSON sẽ gửi Meta</);
});

test('opens the conversation library only when a template needs attention', () => {
  const state = workspaceFixture({ selectedClientId: 'ad-1' });
  const html = renderWorkspace(state);
  assert.doesNotMatch(html, /<details class="conversation-library"[^>]* open/);

  state.draft.campaigns[0].adSets[0].ads[0].conversation.dirty = true;
  const modifiedHtml = renderWorkspace(state);
  assert.match(modifiedHtml, /<details class="conversation-library"[^>]* open/);
});
```

- [ ] **Step 2: Run the targeted tests and verify RED**

Run:

```powershell
node --test --test-name-pattern "compact library plus composer|opens the conversation library" test/workspace.test.js
```

Expected: both new tests fail because the current renderer has no `.conversation-channel-header` or `.conversation-library` wrapper and the template library is always expanded.

- [ ] **Step 3: Update the renderer without changing data attributes**

In `conversationEditor`, derive `libraryOpen` from the current state and wrap the existing controls:

```js
const libraryOpen = !selectedTemplate || modified || loading;
```

Use `<div class="conversation-channel-header">` for the Messenger row, `<details class="conversation-library"${libraryOpen ? ' open' : ''}>` for the template controls, and retain the current select/buttons/actions inside the details content. Keep the existing `.conversation-builder`, `.conversation-form`, `.conversation-preview`, `.conversation-subsection`, and all `data-*` attributes.

Keep `<details class="conversation-json-preview">` without `open` and retain its existing `<summary>` and `<pre>`.

- [ ] **Step 4: Run the targeted tests and verify GREEN for markup**

Run:

```powershell
node --test --test-name-pattern "compact library plus composer|opens the conversation library|uses one smart primary save action" test/workspace.test.js
```

Expected: all selected tests pass.

### Task 2: Add the Conversation UX Styles

**Files:**
- Modify: `test/workspace.test.js:450`
- Modify: `public/app.css:1464`

**Interfaces:**
- Consumes: semantic wrappers emitted by Task 1.
- Produces: a token-driven conversation header, library panel, composer grid, action cards, and preview card.

- [ ] **Step 1: Add CSS contract assertions**

Add a test that reads `public/app.css` and asserts the key layout contracts:

```js
test('styles the conversation editor as a two-column composer', async () => {
  const css = await readFile(new URL('../public/app.css', import.meta.url), 'utf8');

  assert.match(css, /\.conversation-builder\s*\{[^}]*display:\s*grid[^}]*grid-template-columns:/s);
  assert.match(css, /\.conversation-action-card\s*\{[^}]*display:\s*grid/s);
  assert.match(css, /\.conversation-preview\s*\{[^}]*position:\s*sticky/s);
  assert.match(css, /@media \(max-width: 900px\)[\s\S]*?\.conversation-builder\s*\{[\s\S]*?grid-template-columns:\s*1fr/s);
});
```

- [ ] **Step 2: Run the CSS test and verify RED**

Run:

```powershell
node --test --test-name-pattern "two-column composer" test/workspace.test.js
```

Expected: the test fails because these conversation-specific selectors do not exist in `public/app.css`.

- [ ] **Step 3: Add the scoped conversation styles**

Insert the rules before the review sidebar styles in `public/app.css`:

```css
.conversation-channel-header {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 14px 16px;
  background: var(--color-primary-soft);
  border: 1px solid rgba(59, 130, 246, 0.28);
  border-radius: var(--radius-control);
}

.conversation-channel-copy { min-width: 0; flex: 1; }
.conversation-channel-copy strong,
.conversation-channel-copy small { display: block; }
.conversation-channel-copy strong { color: var(--color-text); font-size: .9rem; }
.conversation-channel-copy small { margin-top: 3px; color: var(--color-muted); font-size: .74rem; }
.destination-logo,
.messenger-avatar,
.mini-avatar { display: inline-grid; place-items: center; flex: 0 0 auto; border-radius: 50%; background: linear-gradient(135deg, #2563eb, #60a5fa); color: #fff; font-weight: 800; }
.destination-logo { width: 34px; height: 34px; }

.conversation-library { margin-top: 14px; padding: 0; background: var(--bg-dark-card); border: 1px solid var(--color-border); border-radius: var(--radius-control); overflow: hidden; }
.conversation-library summary { display: flex; align-items: center; justify-content: space-between; gap: 16px; min-height: 56px; padding: 12px 16px; cursor: pointer; list-style: none; }
.conversation-library summary::-webkit-details-marker { display: none; }
.conversation-library summary strong,
.conversation-library summary small { display: block; }
.conversation-library summary small { margin-top: 2px; color: var(--color-muted); font-size: .74rem; }
.conversation-library summary::after { content: 'Mở thư viện'; color: var(--color-primary); font-size: .75rem; font-weight: 700; }
.conversation-library[open] summary::after { content: 'Thu gọn'; }
.conversation-library-content { display: grid; gap: 12px; padding: 0 16px 16px; border-top: 1px solid var(--color-border-soft); }
.conversation-library .template-library-heading { padding-top: 14px; }
.conversation-library .template-picker-row { grid-template-columns: minmax(0, 1fr) auto; }
.conversation-library .template-actions { display: flex; flex-wrap: wrap; gap: 8px; }

.conversation-builder { display: grid; grid-template-columns: minmax(0, 1.15fr) minmax(280px, .85fr); align-items: start; gap: 20px; margin-top: 18px; }
.conversation-form { display: grid; gap: 16px; min-width: 0; }
.conversation-subsection { display: grid; gap: 12px; padding: 16px; background: rgba(15, 23, 42, .42); border: 1px solid var(--color-border); border-radius: var(--radius-control); }
.conversation-subsection-heading { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; }
.conversation-subsection-heading strong { color: var(--color-text); font-size: .86rem; }
.conversation-subsection-heading small { display: block; margin-top: 3px; color: var(--color-muted); font-size: .73rem; }
.conversation-action-list { display: grid; gap: 10px; }
.conversation-action-card { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; padding: 13px; background: var(--bg-dark-surface); border: 1px solid var(--color-border); border-radius: var(--radius-control); }
.conversation-action-card .action-card-heading { grid-column: 1 / -1; display: flex; align-items: center; justify-content: space-between; }
.conversation-action-card .action-card-heading strong { color: var(--color-text-soft); font-size: .78rem; }
.conversation-json-preview { border-top: 1px solid var(--color-border-soft); padding-top: 12px; }
.conversation-json-preview summary { cursor: pointer; color: var(--color-muted); font-size: .76rem; font-weight: 700; }
.conversation-json-preview pre { max-height: 220px; margin: 10px 0 0; padding: 12px; overflow: auto; background: rgba(15, 23, 42, .72); border: 1px solid var(--color-border); border-radius: var(--radius-control); color: var(--color-text-soft); font: .72rem/1.55 var(--font-mono); white-space: pre-wrap; }

.conversation-preview { position: sticky; top: 16px; min-width: 0; padding: 14px; background: linear-gradient(180deg, rgba(35, 44, 61, .95), rgba(26, 33, 47, .95)); border: 1px solid var(--color-border); border-radius: var(--radius-panel); box-shadow: var(--shadow-md); }
.conversation-preview-heading { display: flex; align-items: center; gap: 10px; padding-bottom: 12px; border-bottom: 1px solid var(--color-border-soft); }
.conversation-preview-heading strong,
.conversation-preview-heading small { display: block; }
.conversation-preview-heading strong { color: var(--color-text); font-size: .82rem; }
.conversation-preview-heading small { margin-top: 2px; color: var(--color-muted); font-size: .7rem; }
.messenger-avatar { width: 30px; height: 30px; font-size: .78rem; }
.conversation-phone-screen { display: grid; min-height: 350px; align-content: end; gap: 12px; padding: 18px 12px 12px; background: linear-gradient(180deg, rgba(15, 23, 42, .28), rgba(15, 23, 42, .76)); border-radius: 12px; }
.preview-spacer { min-height: 90px; }
.preview-message-row { display: flex; align-items: flex-end; gap: 8px; }
.mini-avatar { width: 22px; height: 22px; font-size: .62rem; }
.preview-bubble { max-width: 86%; padding: 10px 12px; background: #2f3c52; border-radius: 14px 14px 14px 4px; color: var(--color-text-soft); font-size: .78rem; line-height: 1.5; }
.preview-actions { display: grid; gap: 7px; padding-left: 30px; }
.preview-actions button { display: grid; gap: 2px; padding: 9px 10px; background: rgba(59, 130, 246, .12); border: 1px solid rgba(96, 165, 250, .35); border-radius: 9px; color: #bfdbfe; text-align: left; font-size: .76rem; }
.preview-actions small { color: var(--color-muted); font-size: .65rem; }
.preview-composer { display: flex; align-items: center; gap: 8px; padding: 9px 11px; background: rgba(255, 255, 255, .05); border: 1px solid var(--color-border-soft); border-radius: 999px; color: var(--color-muted); font-size: .72rem; }
.preview-composer span { flex: 1; }
.conversation-preview > p { margin: 10px 2px 0; color: var(--color-muted); font-size: .7rem; }

@media (max-width: 900px) {
  .conversation-builder { grid-template-columns: 1fr; }
  .conversation-preview { position: static; }
}
```

- [ ] **Step 4: Run targeted UI tests**

Run:

```powershell
node --test --test-name-pattern "compact library plus composer|opens the conversation library|two-column composer|uses one smart primary save action" test/workspace.test.js
```

Expected: all selected tests pass.

### Task 3: Verify Build and Live UI

**Files:**
- Modify: none

- [ ] **Step 1: Build and run the full suite**

Run:

```powershell
npm run build
npm test
```

Expected: build succeeds; new conversation tests pass. Existing unrelated baseline failures, if still present, must be reported separately and no new failure may appear.

- [ ] **Step 2: Inspect localhost**

Reload `http://localhost:3001/`, select an Ad, and inspect the Conversation section with an empty template and at least one action. Confirm the library is compact, the form and preview are visually separated, and all existing controls remain usable.


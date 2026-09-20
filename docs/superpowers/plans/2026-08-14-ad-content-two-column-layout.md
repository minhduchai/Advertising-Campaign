# Ad Content Two-Column Layout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Place the primary text and headline controls in a 40% left column and the existing media upload/preview in a 60% right column.

**Architecture:** Keep the existing renderer and upload component intact. Reorder the two existing children inside `.creative-layout`, then add narrowly scoped CSS Grid rules so behavior, bindings, validation, and publishing remain unchanged.

**Tech Stack:** Browser ES modules, template-string HTML, CSS Grid, Node.js built-in test runner.

## Global Constraints

- Use a fixed two-column `40% / 60%` layout for this block.
- Left column contains "Văn bản chính" above "Tiêu đề".
- Right column contains the existing image/video upload and preview.
- Do not add a mobile or single-column variant for this block.
- Do not change backend publication, upload, preview, validation, or field-binding behavior.
- This workspace has no `.git` directory, so commit steps are intentionally omitted.

---

### Task 1: Reorder and Style the Ad Content Editor

**Files:**
- Modify: `test/workspace.test.js:170`
- Modify: `public/workspace.js:771`
- Modify: `public/app.css:1398`

**Interfaces:**
- Consumes: `renderWorkspace(state)`, `mediaUploader(state, ad)`, and existing `data-field`/`data-action` attributes.
- Produces: `.creative-layout` with `.creative-copy-fields` first and `.media-dropzone` second.

- [ ] **Step 1: Add failing renderer and CSS tests**

Extend `test/workspace.test.js` with tests that assert the approved DOM order and grid ratio:

```js
test('places Ad copy before the media uploader', () => {
  const html = renderWorkspace(workspaceFixture({ selectedClientId: 'ad-1' }));
  const primaryTextIndex = html.indexOf('data-field="primaryText"');
  const headlineIndex = html.indexOf('data-field="headline"');
  const mediaIndex = html.indexOf('data-action="upload-media"');

  assert.ok(primaryTextIndex >= 0);
  assert.ok(headlineIndex > primaryTextIndex);
  assert.ok(mediaIndex > headlineIndex);
});

test('defines the approved 40/60 Ad content grid', async () => {
  const css = await readFile(new URL('../public/app.css', import.meta.url), 'utf8');

  assert.match(css, /\.creative-layout\s*\{[^}]*display:\s*grid[^}]*grid-template-columns:\s*minmax\(0, 2fr\) minmax\(0, 3fr\)/s);
  assert.match(css, /\.creative-copy-fields\s*\{[^}]*grid-template-rows:\s*minmax\(200px, 1fr\) auto/s);
  assert.doesNotMatch(css, /@media[^}]*\.creative-layout\s*\{[^}]*grid-template-columns:\s*1fr/s);
});
```

- [ ] **Step 2: Run the targeted tests and confirm RED**

Run:

```powershell
node --test --test-name-pattern "places Ad copy before the media uploader|defines the approved 40/60 Ad content grid" test/workspace.test.js
```

Expected: both tests fail because the media uploader currently renders first and `.creative-layout` has no grid definition.

- [ ] **Step 3: Reorder the existing renderer markup**

Change the `.creative-layout` contents in `public/workspace.js` to keep the fields first and media second:

```js
<div class="creative-layout">
  <div class="field-stack creative-copy-fields">
    <label class="field">
      <span class="field-label">Văn bản chính</span>
      <textarea data-client-id="${escapeHtml(ad.clientId)}" data-field="primaryText" rows="5" placeholder="Viết nội dung quảng cáo...">${escapeHtml(ad.primaryText)}</textarea>
    </label>
    ${textField('Tiêu đề', ad, 'headline', { placeholder: 'Tiêu đề ngắn gọn' })}
  </div>
  ${mediaUploader(state, ad)}
</div>
```

- [ ] **Step 4: Add the fixed two-column CSS**

Add these rules immediately before the existing `/* Media Uploader */` section in `public/app.css`:

```css
.creative-layout {
  display: grid;
  grid-template-columns: minmax(0, 2fr) minmax(0, 3fr);
  align-items: stretch;
  gap: 16px;
}

.creative-copy-fields {
  grid-template-rows: minmax(200px, 1fr) auto;
  min-width: 0;
}

.creative-copy-fields .field:first-child textarea {
  height: 100%;
  min-height: 200px;
}

.creative-layout .media-dropzone {
  min-width: 0;
  min-height: 100%;
}
```

Do not add a media query for `.creative-layout`.

- [ ] **Step 5: Run targeted tests and confirm GREEN**

Run:

```powershell
node --test --test-name-pattern "places Ad copy before the media uploader|defines the approved 40/60 Ad content grid|renders Ad content without publication mode choices" test/workspace.test.js
```

Expected: 3 tests pass and 0 fail.

- [ ] **Step 6: Run build and full regression suite**

Run:

```powershell
npm run build
npm test
```

Expected build result: exit code `0`.

Expected test baseline: the new tests pass; the existing unrelated workspace copy/layout assertions may remain at the previously observed total of 3 failures. Any additional failure is a regression and must be fixed before proceeding.

- [ ] **Step 7: Verify the live interface**

Reload `http://localhost:3001/`, select an Ad, and verify:

- "Văn bản chính" and "Tiêu đề" render in the left column.
- The upload/preview area renders in the right column.
- The columns use the approved 40% / 60% proportion.
- Upload, textarea, and headline controls remain present and interactive.


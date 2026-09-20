# Campaign Tree Menus, Collapse, and Region-Only Targeting Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace exposed hierarchy actions with accessible node menus, collapse Campaign descendants from the Campaign row, and require explicit Vietnamese province/city targeting for every Ad Set.

**Architecture:** Keep hierarchy data and interaction state in `public/state.js`, render semantic rows and menus from `public/workspace.js`, and leave `public/app.js` responsible only for DOM event routing. Enforce region-only targeting in both client defaults and `src/draft.js` so a crafted COUNTRY draft cannot publish nationwide.

**Tech Stack:** Browser-native ES modules, HTML/CSS, Node.js test runner, Meta Marketing API request builders, Vercel CLI.

## Global Constraints

- Campaign, Ad Set, and Ad creation must remain PAUSED.
- Never create real Meta Campaign, Ad Set, or Ad objects during verification.
- Keep the tree header `+` shortcut for adding a Campaign.
- Remove exposed hierarchy add/delete buttons from the tree body and editor footer.
- Campaign rows select and toggle collapse from the same primary click target.
- Ad Set and Ad rows select without collapse.
- Node-menu add actions create siblings at the same hierarchy level.
- Only one node menu may be open.
- New and submitted Ad Sets must use `locationMode: 'REGIONS'` and include at least one Vietnamese Meta region.
- Province/city exclusions remain supported.
- Do not add a UI framework or new runtime dependency.
- Do not create Git commits; this workspace is not a Git repository and the user did not request commits.

---

## File Map

- `public/state.js`: hierarchy defaults, Campaign collapse state, menu state, and pure tree interaction helpers.
- `public/workspace.js`: semantic tree rows, three-dot menus, collapsed rendering, and region-only location editor.
- `public/app.js`: menu, selection, delete-confirmation, outside-click, and Escape event routing.
- `public/app.css`: compact node-row, disclosure, menu, destructive-action, and focus styling.
- `src/draft.js`: region-only validation and Meta targeting serialization.
- `test/client-state.test.js`: pure state behavior regressions.
- `test/workspace.test.js`: tree/menu/location HTML and CSS regressions.
- `test/tree-interactions.test.js`: browser event-wiring contract for `public/app.js`.
- `test/draft.test.js`: region-only validation and serialization regressions.
- `test/publisher.test.js`: valid region fixtures for publisher tests.
- `test/publish-routes.test.js`: valid region fixtures for route tests.
- `.superpowers/sdd/2026-08-11-campaign-tree-menus-collapse-region-only/ledger.md`: task checkpoints because Git commits are unavailable.

---

### Task 1: Enforce Region-Only Targeting

**Files:**
- Modify: `test/client-state.test.js`
- Modify: `test/draft.test.js`
- Modify: `test/workspace.test.js`
- Modify: `test/publisher.test.js`
- Modify: `test/publish-routes.test.js`
- Modify: `public/state.js`
- Modify: `public/workspace.js`
- Modify: `public/app.js`
- Modify: `src/draft.js`

**Interfaces:**
- Consumes: existing `createAdSet`, `moveRegion`, `validateDraft`, and `buildManualTargeting` APIs.
- Produces: every new Ad Set has `locationMode: 'REGIONS'`; `buildManualTargeting(adSet)` always returns `geo_locations.regions`; no client code exposes or dispatches `set-location-mode`.

- [ ] **Step 1: Write failing state and draft tests**

Update the approved-default assertion in `test/client-state.test.js`:

```js
assert.equal(adSet.locationMode, 'REGIONS');
assert.deepEqual(adSet.includedRegions, []);
```

Replace the COUNTRY/REGIONS serialization test in `test/draft.test.js` with explicit region-only behavior:

```js
const vietnamRegion = {
  key: '3984',
  name: 'Thành phố Hồ Chí Minh',
  type: 'region',
  countryCode: 'VN'
};

test('rejects nationwide targeting and requires an included Vietnam region', () => {
  const countryIssues = validateDraft(validDraftWith({
    ...adSet,
    locationMode: 'COUNTRY',
    includedRegions: []
  }));
  const emptyRegionIssues = validateDraft(validDraftWith({
    ...adSet,
    locationMode: 'REGIONS',
    includedRegions: []
  }));

  assert.ok(countryIssues.some((entry) => entry.path.endsWith('.locationMode')));
  assert.ok(emptyRegionIssues.some((entry) => entry.path.endsWith('.includedRegions')));
});

test('serializes only included and excluded Vietnam regions', () => {
  const targeting = buildManualTargeting({
    ...adSet,
    locationMode: 'REGIONS',
    includedRegions: [vietnamRegion],
    excludedRegions: [{
      key: '3998',
      name: 'Nghệ An',
      type: 'region',
      countryCode: 'VN'
    }]
  });

  assert.deepEqual(targeting.geo_locations, { regions: [{ key: '3984' }] });
  assert.deepEqual(targeting.excluded_geo_locations, { regions: [{ key: '3998' }] });
  assert.equal(targeting.geo_locations.countries, undefined);
});
```

Change the shared `adSet` fixture to `locationMode: 'REGIONS'` with `includedRegions: [vietnamRegion]` so unrelated valid-draft tests remain valid.

- [ ] **Step 2: Write the failing location-render test**

Change `test/workspace.test.js` to assert the region editor no longer exposes nationwide mode:

```js
test('renders only Vietnam province and city targeting', () => {
  const state = workspaceFixture({ selectedClientId: 'adset-1' });
  const adSet = state.draft.campaigns[0].adSets[0];
  adSet.locationMode = 'REGIONS';
  adSet.includedRegions = [{
    key: '3984',
    name: 'Thành phố Hồ Chí Minh',
    type: 'region',
    countryCode: 'VN'
  }];

  const html = renderWorkspace(state);

  assert.doesNotMatch(html, /Toàn Việt Nam/);
  assert.doesNotMatch(html, /data-action="set-location-mode"/);
  assert.match(html, /Tìm tỉnh hoặc thành phố/);
  assert.match(html, /data-action="set-location-side"/);
  assert.match(html, /data-action="add-region"/);
  assert.match(html, /data-action="remove-region"/);
});
```

- [ ] **Step 3: Run the focused tests and verify RED**

Run:

```powershell
node --test test/client-state.test.js test/draft.test.js test/workspace.test.js
```

Expected: failures show the current `COUNTRY` default, nationwide fallback, `Toàn Việt Nam` card, and `set-location-mode` action still exist.

- [ ] **Step 4: Implement the minimal region-only state and publisher contract**

In `public/state.js`, change the current default field inside `createAdSet` from:

```js
locationMode: 'COUNTRY',
```

to:

```js
locationMode: 'REGIONS',
```

Delete the exported `setLocationMode` helper. Keep `moveRegion` assigning `locationMode = 'REGIONS'` when adding an included region so imported in-memory values normalize as the user edits them.

In `src/draft.js`, replace only the current COUNTRY/REGIONS `geoLocations` branch with:

```js
const geoLocations = { regions: regionReferences(adSet.includedRegions) };
```

Keep the existing `targeting` object and its exclusion, gender, custom-audience, and detailed-targeting blocks unchanged.

function validateLocations(adSet, adSetPath, issues) {
  const locationMode = adSet.locationMode ?? 'REGIONS';
  const includedRegions = Array.isArray(adSet.includedRegions) ? adSet.includedRegions : [];
  const excludedRegions = Array.isArray(adSet.excludedRegions) ? adSet.excludedRegions : [];

  if (locationMode !== 'REGIONS') {
    issues.push(issue(`${adSetPath}.locationMode`, 'Chỉ hỗ trợ chọn tỉnh/thành phố Việt Nam'));
  }
  if (includedRegions.length === 0) {
    issues.push(issue(`${adSetPath}.includedRegions`, 'Chọn ít nhất một tỉnh/thành phố Việt Nam'));
  }
  if (includedRegions.some((region) => !isVietnamRegion(region))) {
    issues.push(issue(`${adSetPath}.includedRegions`, 'Vị trí bao gồm phải là tỉnh/thành phố Việt Nam từ Meta'));
  }
  if (excludedRegions.some((region) => !isVietnamRegion(region))) {
    issues.push(issue(`${adSetPath}.excludedRegions`, 'Vị trí loại trừ phải là tỉnh/thành phố Việt Nam từ Meta'));
  }

  const includedKeys = includedRegions.map((region) => String(region.key));
  const excludedKeys = excludedRegions.map((region) => String(region.key));
  const hasDuplicates = new Set(includedKeys).size !== includedKeys.length
    || new Set(excludedKeys).size !== excludedKeys.length;
  const includedSet = new Set(includedKeys);
  const hasOverlap = excludedKeys.some((key) => includedSet.has(key));
  if (hasDuplicates || hasOverlap) {
    issues.push(issue(`${adSetPath}.regions`, 'Một tỉnh/thành phố không thể xuất hiện nhiều lần hoặc vừa bao gồm vừa loại trừ'));
  }
}
```

Delete the legacy `countries` compatibility check because COUNTRY drafts are now rejected directly.

- [ ] **Step 5: Remove the nationwide client controls**

In `public/workspace.js`, make these exact edits to `locationEditor`:

1. Delete `const mode = adSet.locationMode ?? 'COUNTRY';`.
2. Change the heading copy to `Chọn tỉnh/thành phố Việt Nam muốn bao gồm hoặc loại trừ.`.
3. Delete the complete `.location-mode-grid` block and both `locationModeButton(...)` calls.
4. Keep the existing side tabs, search row, Meta results, and source note unchanged.
5. Call `locationColumn` with four arguments:

```js
${locationColumn(adSet.clientId, 'include', 'Bao gồm', adSet.includedRegions ?? [])}
${locationColumn(adSet.clientId, 'exclude', 'Loại trừ', adSet.excludedRegions ?? [])}
```

Delete `locationModeButton`. Change `locationColumn(clientId, side, title, regions, countryWide)` to `locationColumn(clientId, side, title, regions)`, use `regions.length` for its count, and set `emptyCopy` to:

```js
const emptyCopy = side === 'include'
  ? 'Chưa chọn tỉnh/thành phố'
  : 'Không loại trừ tỉnh/thành phố nào';
```

In `public/app.js`, remove the `setLocationMode` import and the `set-location-mode` click branch.

- [ ] **Step 6: Update valid test fixtures**

In `test/workspace.test.js`, `test/publisher.test.js`, and `test/publish-routes.test.js`, replace every valid COUNTRY fixture with:

```js
locationMode: 'REGIONS',
includedRegions: [{
  key: '3984',
  name: 'Thành phố Hồ Chí Minh',
  type: 'region',
  countryCode: 'VN'
}],
excludedRegions: [],
```

Keep one explicit COUNTRY fixture only in the rejection test.

- [ ] **Step 7: Run focused tests and verify GREEN**

Run:

```powershell
node --test test/client-state.test.js test/draft.test.js test/workspace.test.js test/publisher.test.js test/publish-routes.test.js
```

Expected: all focused tests pass and no rendered HTML contains `Toàn Việt Nam` or `set-location-mode`.

- [ ] **Step 8: Record the checkpoint**

Append the command and pass count to `.superpowers/sdd/2026-08-11-campaign-tree-menus-collapse-region-only/ledger.md` under `Task 1`.

---

### Task 2: Add Pure Menu and Collapse State

**Files:**
- Modify: `test/client-state.test.js`
- Modify: `public/state.js`
- Modify: `.superpowers/sdd/2026-08-11-campaign-tree-menus-collapse-region-only/ledger.md`

**Interfaces:**
- Produces: `activateNode(state, clientId)`, `toggleNodeMenu(state, clientId)`, and `closeNodeMenu(state)` for `public/app.js`.
- State fields: `state.ui.collapsedCampaignIds: string[]` and `state.ui.openNodeMenuId: string | null`.
- Existing `addCampaign`, `addAdSet`, `addAd`, and `removeNode` maintain collapse/menu invariants.

- [ ] **Step 1: Write failing initial-state and activation tests**

Add to `test/client-state.test.js`:

```js
test('tracks one open node menu and toggles Campaign collapse on activation', () => {
  const state = createWorkspaceState({
    randomId: idSequence('campaign-1', 'adset-1', 'ad-1')
  });

  assert.deepEqual(state.ui.collapsedCampaignIds, []);
  assert.equal(state.ui.openNodeMenuId, null);

  assert.equal(toggleNodeMenu(state, 'campaign-1'), true);
  assert.equal(state.ui.openNodeMenuId, 'campaign-1');

  assert.equal(activateNode(state, 'campaign-1'), true);
  assert.deepEqual(state.selection, { clientId: 'campaign-1', type: 'campaign' });
  assert.deepEqual(state.ui.collapsedCampaignIds, ['campaign-1']);
  assert.equal(state.ui.openNodeMenuId, null);

  assert.equal(activateNode(state, 'campaign-1'), true);
  assert.deepEqual(state.ui.collapsedCampaignIds, []);
});
```

Import `activateNode`, `toggleNodeMenu`, and `closeNodeMenu` from `public/state.js`.

- [ ] **Step 2: Write failing hierarchy-invariant tests**

```js
test('adding a Campaign collapses older Campaigns and expands the new Campaign', () => {
  const state = createWorkspaceState({
    randomId: idSequence('campaign-1', 'adset-1', 'ad-1')
  });

  const campaign = addCampaign(state, idSequence('campaign-2', 'adset-2', 'ad-2'));

  assert.deepEqual(state.ui.collapsedCampaignIds, ['campaign-1']);
  assert.deepEqual(state.selection, { clientId: campaign.clientId, type: 'campaign' });
});

test('selecting or adding descendants expands their parent Campaign', () => {
  const state = createWorkspaceState({
    randomId: idSequence('campaign-1', 'adset-1', 'ad-1')
  });
  state.ui.collapsedCampaignIds = ['campaign-1'];

  assert.equal(activateNode(state, 'adset-1'), true);
  assert.deepEqual(state.ui.collapsedCampaignIds, []);

  state.ui.collapsedCampaignIds = ['campaign-1'];
  addAd(state, 'adset-1', () => 'ad-2');
  assert.deepEqual(state.ui.collapsedCampaignIds, []);
});

test('removing a Campaign clears its collapse and menu state', () => {
  const state = createWorkspaceState({
    randomId: idSequence('campaign-1', 'adset-1', 'ad-1')
  });
  state.ui.collapsedCampaignIds = ['campaign-1'];
  state.ui.openNodeMenuId = 'campaign-1';

  assert.equal(removeNode(state, 'campaign-1'), true);
  assert.deepEqual(state.ui.collapsedCampaignIds, []);
  assert.equal(state.ui.openNodeMenuId, null);
});
```

- [ ] **Step 3: Run state tests and verify RED**

Run:

```powershell
node --test test/client-state.test.js
```

Expected: imports or assertions fail because menu/collapse state and helpers do not exist.

- [ ] **Step 4: Implement pure state helpers**

Add to `createWorkspaceState().ui`:

```js
collapsedCampaignIds: [],
openNodeMenuId: null,
```

Add helpers:

```js
export function activateNode(state, clientId) {
  const match = findNode(state, clientId);
  if (!match) return false;

  state.selection = { clientId, type: match.type };
  closeNodeMenu(state);
  if (match.type === 'campaign') {
    setCampaignCollapsed(state, clientId, !isCampaignCollapsed(state, clientId));
  } else {
    setCampaignCollapsed(state, match.campaign.clientId, false);
  }
  return true;
}

export function toggleNodeMenu(state, clientId) {
  if (!findNode(state, clientId)) return false;
  state.ui.openNodeMenuId = state.ui.openNodeMenuId === clientId ? null : clientId;
  return true;
}

export function closeNodeMenu(state) {
  if (!state.ui.openNodeMenuId) return false;
  state.ui.openNodeMenuId = null;
  return true;
}

function isCampaignCollapsed(state, campaignId) {
  return (state.ui.collapsedCampaignIds ?? []).includes(campaignId);
}

function setCampaignCollapsed(state, campaignId, collapsed) {
  const ids = new Set(state.ui.collapsedCampaignIds ?? []);
  if (collapsed) ids.add(campaignId);
  else ids.delete(campaignId);
  state.ui.collapsedCampaignIds = [...ids];
}
```

Update hierarchy mutations:

```js
export function addCampaign(state, randomId = defaultRandomId) {
  const previousIds = state.draft.campaigns.map((campaign) => campaign.clientId);
  const campaign = createCampaign(randomId);
  state.draft.campaigns.push(campaign);
  state.ui.collapsedCampaignIds = [...new Set([
    ...(state.ui.collapsedCampaignIds ?? []),
    ...previousIds
  ])].filter((id) => id !== campaign.clientId);
  state.ui.openNodeMenuId = null;
  state.selection = { clientId: campaign.clientId, type: 'campaign' };
  return campaign;
}
```

Use `setCampaignCollapsed(state, campaign.clientId, false)` in `addAdSet`, `addAd`, and child activation. Remove deleted Campaign IDs and close a deleted node menu in `removeNode`.

Keep `selectNode` unchanged as the programmatic selection helper used by existing state tests. Replace only the `public/app.js` import and tree-click call with `activateNode`.

- [ ] **Step 5: Run state tests and verify GREEN**

Run:

```powershell
node --test test/client-state.test.js
```

Expected: all state tests pass.

- [ ] **Step 6: Record the checkpoint**

Append the state test result to the ledger under `Task 2`.

---

### Task 3: Render Accessible Node Menus and Collapsed Campaigns

**Files:**
- Modify: `test/workspace.test.js`
- Modify: `public/workspace.js`
- Modify: `public/app.css`
- Modify: `.superpowers/sdd/2026-08-11-campaign-tree-menus-collapse-region-only/ledger.md`

**Interfaces:**
- Consumes: `state.ui.collapsedCampaignIds` and `state.ui.openNodeMenuId` from Task 2.
- Produces: semantic tree rows with `select-node`, `toggle-node-menu`, sibling add actions, delete actions, Campaign `aria-expanded`, and no exposed hierarchy action rows/footers.

- [ ] **Step 1: Extend the workspace fixture**

Add to `workspaceFixture().ui`:

```js
collapsedCampaignIds: [],
openNodeMenuId: null,
```

- [ ] **Step 2: Write failing menu-render tests**

Add to `test/workspace.test.js`:

```js
test('renders accessible three-dot menus for every hierarchy level', () => {
  const state = workspaceFixture();
  state.ui.openNodeMenuId = 'adset-1';

  const html = renderWorkspace(state);

  assert.match(html, /data-action="toggle-node-menu"[^>]*data-client-id="campaign-1"/);
  assert.match(html, /data-action="toggle-node-menu"[^>]*data-client-id="adset-1"/);
  assert.match(html, /data-action="toggle-node-menu"[^>]*data-client-id="ad-1"/);
  assert.match(html, /aria-haspopup="menu"/);
  assert.match(html, /role="menu"/);
  assert.match(html, /Thêm nhóm quảng cáo mới/);
  assert.match(html, /Xóa nhóm quảng cáo/);
  assert.match(html, /data-action="add-adset"[^>]*data-client-id="campaign-1"/);
  assert.match(html, /data-action="remove-node"[^>]*data-client-id="adset-1"/);
  assert.doesNotMatch(html, /class="tree-add-row"/);
  assert.doesNotMatch(html, /class="editor-actions"/);
});
```

- [ ] **Step 3: Write failing collapse-render tests**

```js
test('omits Campaign descendants when the Campaign is collapsed', () => {
  const expandedState = workspaceFixture();
  const collapsedState = workspaceFixture();
  collapsedState.ui.collapsedCampaignIds = ['campaign-1'];

  const expandedHtml = renderWorkspace(expandedState);
  const collapsedHtml = renderWorkspace(collapsedState);

  assert.match(expandedHtml, /aria-expanded="true"/);
  assert.match(expandedHtml, /data-client-id="adset-1"/);
  assert.match(collapsedHtml, /aria-expanded="false"/);
  assert.doesNotMatch(collapsedHtml, /data-action="select-node"[^>]*data-client-id="adset-1"/);
});
```

- [ ] **Step 4: Write failing CSS contract assertions**

Extend the existing CSS test:

```js
assert.match(css, /\.tree-node-row\s*\{/);
assert.match(css, /\.node-menu-button\s*\{/);
assert.match(css, /\.node-action-menu\s*\{/);
assert.match(css, /\.node-action-menu-item\.is-destructive\s*\{/);
assert.match(css, /\.node-action-menu-item:focus-visible/);
```

- [ ] **Step 5: Run render tests and verify RED**

Run:

```powershell
node --test test/workspace.test.js
```

Expected: menu, collapse, and CSS assertions fail.

- [ ] **Step 6: Implement semantic tree rows**

Refactor `treeNode` so buttons are siblings rather than nested:

```js
function treeNode({ state, clientId, type, name, selected, meta, addAction }) {
  const menuOpen = state.ui?.openNodeMenuId === clientId;
  const campaignCollapsed = type === 'campaign'
    && (state.ui?.collapsedCampaignIds ?? []).includes(clientId);
  const expandedAttribute = type === 'campaign'
    ? ` aria-expanded="${!campaignCollapsed}"`
    : '';

  return `
    <div class="tree-node-row tree-node-${type}${selected ? ' is-selected' : ''}" data-node-id="${escapeHtml(clientId)}">
      <button type="button" class="tree-node-main" data-action="select-node" data-client-id="${escapeHtml(clientId)}" aria-current="${selected ? 'true' : 'false'}"${expandedAttribute}>
        <span class="node-mark" aria-hidden="true">${type === 'campaign' ? 'C' : type === 'adSet' ? 'N' : 'Q'}</span>
        <span class="node-copy"><strong>${escapeHtml(name || nodeLabels[type])}</strong><small>${escapeHtml(meta)}</small></span>
        ${type === 'campaign' ? `<span class="node-disclosure${campaignCollapsed ? ' is-collapsed' : ''}" aria-hidden="true">⌄</span>` : ''}
      </button>
      <button type="button" class="node-menu-button" data-action="toggle-node-menu" data-client-id="${escapeHtml(clientId)}" aria-label="Tùy chọn ${escapeHtml(name || nodeLabels[type])}" aria-haspopup="menu" aria-expanded="${menuOpen}">•••</button>
      ${menuOpen ? nodeActionMenu(clientId, type, addAction) : ''}
    </div>`;
}
```

Render menu items with exact sibling parent IDs:

```js
function nodeActionMenu(clientId, type, addAction) {
  const copy = {
    campaign: ['Thêm chiến dịch mới', 'Xóa chiến dịch'],
    adSet: ['Thêm nhóm quảng cáo mới', 'Xóa nhóm quảng cáo'],
    ad: ['Thêm quảng cáo mới', 'Xóa quảng cáo']
  }[type];
  return `
    <div class="node-action-menu" role="menu" data-node-menu>
      <button type="button" role="menuitem" class="node-action-menu-item" data-action="${addAction.action}"${addAction.clientId ? ` data-client-id="${escapeHtml(addAction.clientId)}"` : ''}>${copy[0]}</button>
      <button type="button" role="menuitem" class="node-action-menu-item is-destructive" data-action="remove-node" data-client-id="${escapeHtml(clientId)}">${copy[1]}</button>
    </div>`;
}
```

Pass these add targets:

- Campaign: `{ action: 'add-campaign', clientId: null }`
- Ad Set: `{ action: 'add-adset', clientId: campaign.clientId }`
- Ad: `{ action: 'add-ad', clientId: adSet.clientId }`

In `renderCampaignTree`, omit `.tree-children` entirely when the Campaign ID is collapsed. Delete every `.tree-add-row` and each editor `.editor-actions` block.

- [ ] **Step 7: Implement compact menu CSS**

Replace the old `.tree-node`/`.node-menu` rules with focused row styles:

```css
.tree-node-row {
  position: relative;
  display: flex;
  align-items: center;
  min-height: 48px;
  border-radius: 7px;
  transition: background-color 160ms ease, color 160ms ease;
}

.tree-node-main {
  display: flex;
  flex: 1 1 auto;
  align-items: center;
  min-width: 0;
  min-height: 48px;
  padding: 7px 4px 7px 8px;
  color: inherit;
  text-align: left;
}

.node-menu-button {
  display: inline-grid;
  flex: 0 0 36px;
  place-items: center;
  min-height: 36px;
  border-radius: 6px;
  color: var(--color-muted);
}

.node-action-menu {
  position: absolute;
  top: calc(100% - 4px);
  right: 4px;
  z-index: 12;
  display: grid;
  min-width: 190px;
  padding: 5px;
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: 8px;
  box-shadow: 0 12px 28px rgba(15, 23, 42, .16);
}

.node-action-menu-item {
  min-height: 38px;
  padding: 8px 10px;
  border-radius: 6px;
  text-align: left;
}

.node-action-menu-item.is-destructive {
  color: var(--color-danger);
}

.node-action-menu-item:focus-visible {
  outline: 2px solid var(--color-primary);
  outline-offset: 1px;
}
```

Preserve the current selected colors by applying them to `.tree-node-row.is-selected`. Rotate `.node-disclosure` when collapsed and honor the existing reduced-motion rule.

- [ ] **Step 8: Run render tests and verify GREEN**

Run:

```powershell
node --test test/workspace.test.js
```

Expected: all workspace tests pass.

- [ ] **Step 9: Record the checkpoint**

Append the workspace test result to the ledger under `Task 3`.

---

### Task 4: Wire Menu and Whole-Row Interactions

**Files:**
- Create: `test/tree-interactions.test.js`
- Modify: `public/app.js`
- Modify: `.superpowers/sdd/2026-08-11-campaign-tree-menus-collapse-region-only/ledger.md`

**Interfaces:**
- Consumes: `activateNode`, `toggleNodeMenu`, and `closeNodeMenu` from Task 2.
- Produces: whole-row Campaign select/collapse, isolated menu clicks, typed delete confirmation, outside-click close, and Escape close.

- [ ] **Step 1: Write a failing event-wiring contract test**

Create `test/tree-interactions.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const appSource = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');

test('routes tree selection and node menus through pure state helpers', () => {
  assert.match(appSource, /if \(action === 'select-node'\)[\s\S]*?activateNode\(state, clientId\)/);
  assert.match(appSource, /if \(action === 'toggle-node-menu'\)[\s\S]*?toggleNodeMenu\(state, clientId\)/);
  assert.match(appSource, /document\.addEventListener\('click',[\s\S]*?closeNodeMenu\(state\)/);
});

test('Escape closes a node menu before workspace drawers', () => {
  assert.match(
    appSource,
    /if \(event\.key !== 'Escape'\) return;[\s\S]*?if \(closeNodeMenu\(state\)\) \{[\s\S]*?render\(\);[\s\S]*?return;/
  );
});

test('uses hierarchy-specific delete confirmation copy', () => {
  assert.match(appSource, /function removeConfirmation\(match\)/);
  assert.match(appSource, /Xóa chiến dịch này/);
  assert.match(appSource, /Xóa nhóm quảng cáo này/);
  assert.match(appSource, /Xóa quảng cáo này/);
});
```

This source contract only verifies DOM routing. Actual collapse/menu state behavior remains covered by pure state tests from Task 2.

- [ ] **Step 2: Run the interaction test and verify RED**

Run:

```powershell
node --test test/tree-interactions.test.js
```

Expected: failures show the old `selectNode` routing and missing menu/outside-click behavior.

- [ ] **Step 3: Wire tree actions**

Update the state imports in `public/app.js` to use `activateNode`, `toggleNodeMenu`, and `closeNodeMenu`.

Replace the selection branch:

```js
if (action === 'select-node') {
  activateNode(state, clientId);
  state.ui.treeOpen = false;
  render();
  await ensureConversationTemplatesForNode(clientId);
  return;
}
```

Add the menu branch before add/delete actions:

```js
if (action === 'toggle-node-menu') {
  toggleNodeMenu(state, clientId);
  render();
  return;
}
```

Close menu state before or inside every successful add/delete operation.

- [ ] **Step 4: Add typed delete confirmation**

```js
function removeConfirmation(match) {
  if (match?.type === 'campaign') {
    return 'Xóa chiến dịch này và toàn bộ nhóm quảng cáo, quảng cáo bên trong?';
  }
  if (match?.type === 'adSet') {
    return 'Xóa nhóm quảng cáo này và toàn bộ quảng cáo bên trong?';
  }
  return 'Xóa quảng cáo này?';
}
```

Use it in the existing remove branch:

```js
if (action === 'remove-node') {
  const match = findNode(state, clientId);
  if (!match || !window.confirm(removeConfirmation(match))) return;
  removeNode(state, clientId);
  render();
  await validateCurrentDraft();
  return;
}
```

- [ ] **Step 5: Add outside-click and Escape close behavior**

```js
document.addEventListener('click', (event) => {
  if (!state.ui.openNodeMenuId) return;
  if (event.target.closest('[data-node-menu], [data-action="toggle-node-menu"]')) return;
  closeNodeMenu(state);
  render();
});

document.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape') return;
  if (closeNodeMenu(state)) {
    render();
    return;
  }
  state.ui.treeOpen = false;
  state.ui.reviewOpen = false;
  render();
});
```

- [ ] **Step 6: Run interaction and state tests and verify GREEN**

Run:

```powershell
node --test test/tree-interactions.test.js test/client-state.test.js test/workspace.test.js
```

Expected: all tests pass.

- [ ] **Step 7: Record the checkpoint**

Append the test result to the ledger under `Task 4`.

---

### Task 5: Verify, Deploy, and Smoke Test

**Files:**
- Modify: `.superpowers/sdd/2026-08-11-campaign-tree-menus-collapse-region-only/ledger.md`

**Interfaces:**
- Consumes: completed Tasks 1-4.
- Produces: tested production deployment at the stable Vercel alias with no Meta writes.

- [ ] **Step 1: Run all focused regressions**

Run:

```powershell
node --test test/client-state.test.js test/draft.test.js test/workspace.test.js test/tree-interactions.test.js test/publisher.test.js test/publish-routes.test.js
```

Expected: zero failures.

- [ ] **Step 2: Build the client bundle**

Run:

```powershell
npm run build
```

Expected: exit code `0` and a refreshed `public/blob-upload-client.js` only if its source dependency changed.

- [ ] **Step 3: Deploy to production**

Run:

```powershell
npx vercel --prod --yes
```

Expected: deployment completes and aliases to `https://creative-campaign-lgclinic.vercel.app`.

- [ ] **Step 4: Verify production health**

Run:

```powershell
(Invoke-RestMethod 'https://creative-campaign-lgclinic.vercel.app/health').ok
```

Expected: `True`.

- [ ] **Step 5: Browser smoke test without publishing**

Using the authenticated production browser session:

1. Confirm the account catalog still loads.
2. Open each Campaign, Ad Set, and Ad three-dot menu and verify add/delete labels.
3. Click outside and press Escape to verify menus close.
4. Click a Campaign row twice and verify descendants collapse then expand while the Campaign editor remains selected.
5. Add a second Campaign from a menu and verify the previous Campaign collapses and the new Campaign expands.
6. Confirm the location editor has no `Toàn Việt Nam` card.
7. Confirm publishing stays blocked until an included province/city is selected.
8. Add Hồ Chí Minh as included and Nghệ An as excluded; confirm both chips render.
9. Do not press `Kiểm tra & tạo ở PAUSED` and do not create Meta objects.

- [ ] **Step 6: Complete the ledger**

Record focused test count, build result, deployment URL, health result, browser observations, and explicit confirmation that no Meta objects were created.

---

## Completion Checklist

- [ ] Decorative three-dot marks are real accessible menus.
- [ ] Every node menu offers sibling add and typed delete actions.
- [ ] Exposed tree/editor hierarchy actions are removed.
- [ ] Campaign whole-row clicks select and toggle descendants.
- [ ] Adding a Campaign collapses older Campaigns.
- [ ] Ad Set and Ad selection expands their parent Campaign.
- [ ] Only one menu opens and outside/Escape closes it.
- [ ] `Toàn Việt Nam` is absent from UI and publisher logic.
- [ ] Every valid Ad Set includes at least one Vietnamese region.
- [ ] Region exclusions still serialize correctly.
- [ ] Focused tests and build pass.
- [ ] Production health and browser smoke checks pass.
- [ ] No Meta Campaign, Ad Set, or Ad was created during verification.

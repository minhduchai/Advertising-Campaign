# Meta Regions and Conversation Templates Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Vietnam province targeting with include/exclude semantics and a reusable Page-scoped Messenger conversation template library.

**Architecture:** Keep Meta-specific serialization in pure server modules, store reusable templates in SQLite, and expose authenticated JSON routes to the existing browser client. The browser draft owns stable Ad snapshots; saved templates are copied into Ads rather than referenced dynamically during publish.

**Tech Stack:** Node.js ESM, built-in `node:http`, built-in `node:sqlite`, browser ES modules, plain HTML/CSS, Node test runner.

## Global Constraints

- Country support is Vietnam only (`VN`).
- Location search accepts only Meta `adgeolocation` results with `type="region"` and `country_code="VN"`.
- `geo_locations` sends either `countries=['VN']` or `regions`, never both.
- Templates are isolated by connected Meta user and Facebook Page.
- Native Ads Manager saved-template sync and Partner App flows are out of scope.
- All Campaign, Ad Set and Ad writes remain `PAUSED`.
- No new runtime dependency is added.
- Do not make a live Meta write without explicit action-time confirmation.
- This workspace is not a Git repository; replace commit steps with tested checkpoints.

---

## File Map

- Create `src/conversation.js`: conversation defaults, validation and `page_welcome_message` serialization.
- Modify `src/draft.js`: location validation/serialization and conversation validation integration.
- Modify `src/meta-client.js`: Vietnam region search.
- Modify `src/db.js`: conversation template table and owner/Page-scoped CRUD.
- Modify `src/server.js`: location-search and template CRUD routes.
- Modify `public/state.js`: location mutations, conversation snapshot state and template application.
- Modify `public/api.js`: location and template client methods.
- Modify `public/workspace.js`: region selector and conversation editor/preview.
- Modify `public/app.js`: search debounce, template loading/CRUD and editor actions.
- Modify `public/app.css`: location/template layouts and responsive behavior.
- Modify `README.md`: feature and usage documentation.
- Add or modify focused tests under `test/` before each implementation change.

---

### Task 1: Location Draft Model and Targeting Serializer

**Files:**
- Modify: `public/state.js`
- Modify: `src/draft.js`
- Test: `test/client-state.test.js`
- Test: `test/draft.test.js`

**Interfaces:**
- Produces: `moveRegion(adSet, region, side) -> void`
- Produces: `setLocationMode(adSet, mode) -> void`
- Produces: `buildManualTargeting(adSet) -> object` with mutually exclusive country/region payloads.

- [ ] **Step 1: Write failing state tests**

```js
test('creates Vietnam country targeting and moves regions between include and exclude', () => {
  const adSet = createAdSet(() => 'id');
  assert.equal(adSet.locationMode, 'COUNTRY');
  assert.deepEqual(adSet.includedRegions, []);
  assert.deepEqual(adSet.excludedRegions, []);

  const region = { key: '3984', name: 'Thành phố Hồ Chí Minh', type: 'region', countryCode: 'VN' };
  moveRegion(adSet, region, 'include');
  assert.equal(adSet.locationMode, 'REGIONS');
  moveRegion(adSet, region, 'exclude');
  assert.deepEqual(adSet.includedRegions, []);
  assert.deepEqual(adSet.excludedRegions, [region]);
});
```

- [ ] **Step 2: Write failing targeting tests**

```js
test('serializes country and region location modes without widening the audience', () => {
  const country = buildManualTargeting({ ...adSet, locationMode: 'COUNTRY', includedRegions: [], excludedRegions: [{ key: '3998' }] });
  assert.deepEqual(country.geo_locations, { countries: ['VN'] });
  assert.deepEqual(country.excluded_geo_locations, { regions: [{ key: '3998' }] });

  const regions = buildManualTargeting({ ...adSet, locationMode: 'REGIONS', includedRegions: [{ key: '3984' }], excludedRegions: [] });
  assert.deepEqual(regions.geo_locations, { regions: [{ key: '3984' }] });
  assert.equal('countries' in regions.geo_locations, false);
});
```

- [ ] **Step 3: Run focused tests and verify RED**

Run: `node --test --test-name-pattern="region|location mode" test/client-state.test.js test/draft.test.js`

Expected: failures for missing `locationMode`, `moveRegion`, `setLocationMode` and old `countries` serialization.

- [ ] **Step 4: Implement minimal location model**

```js
export function moveRegion(adSet, region, side) {
  adSet.includedRegions = adSet.includedRegions.filter((item) => item.key !== region.key);
  adSet.excludedRegions = adSet.excludedRegions.filter((item) => item.key !== region.key);
  if (side === 'include') {
    adSet.locationMode = 'REGIONS';
    adSet.includedRegions.push(region);
  } else {
    adSet.excludedRegions.push(region);
  }
}

export function setLocationMode(adSet, mode) {
  adSet.locationMode = mode;
  if (mode === 'COUNTRY') adSet.includedRegions = [];
}
```

Update `validateDraft` to reject unsupported modes, empty `REGIONS`, non-VN/non-region items, empty keys and overlaps. Update `buildManualTargeting` to emit the mutually exclusive payloads specified above.

- [ ] **Step 5: Run focused tests and checkpoint GREEN**

Run: `node --test test/client-state.test.js test/draft.test.js`

Expected: all focused tests pass.

---

### Task 2: Meta Vietnam Region Search Route

**Files:**
- Modify: `src/meta-client.js`
- Modify: `src/server.js`
- Modify: `public/api.js`
- Test: `test/meta-client.test.js`
- Test: `test/auth-routes.test.js`
- Test: `test/client-api.test.js`

**Interfaces:**
- Produces: `metaClient.searchLocations(token, query) -> Array<{key,name,type,countryCode}>`
- Produces: `api.searchLocations(adAccountId, query) -> Promise<{results}>`
- Route: `GET /api/location-search?adAccountId=act_...&query=...`

- [ ] **Step 1: Write failing Meta-client test**

```js
test('searches and normalizes only Vietnam regions', async () => {
  const client = createMetaClient(config, { fetchImpl: async (url) => {
    assert.match(String(url), /type=adgeolocation/);
    assert.match(String(url), /country_code=VN/);
    return Response.json({ data: [
      { key: '3984', name: 'Thành phố Hồ Chí Minh', type: 'region', country_code: 'VN' },
      { key: 'city-1', name: 'Bình Thạnh', type: 'city', country_code: 'VN' },
      { key: 'us-1', name: 'Virginia', type: 'region', country_code: 'US' }
    ] });
  }});
  assert.deepEqual(await client.searchLocations('token', 'Hồ Chí Minh'), [
    { key: '3984', name: 'Thành phố Hồ Chí Minh', type: 'region', countryCode: 'VN' }
  ]);
});
```

- [ ] **Step 2: Write failing route and browser-client tests**

Assert that authenticated valid requests proxy the query, invalid account IDs/short queries make zero Graph calls, and `searchLocations()` URL-encodes Vietnamese text.

- [ ] **Step 3: Run focused tests and verify RED**

Run: `node --test --test-name-pattern="location" test/meta-client.test.js test/auth-routes.test.js test/client-api.test.js`

Expected: missing-method and missing-route failures.

- [ ] **Step 4: Implement search and route**

```js
async searchLocations(token, query) {
  const payload = await requestJson(fetchImpl, `${graphBaseUrl}/search`, {
    type: 'adgeolocation',
    location_types: JSON.stringify(['region']),
    country_code: 'VN',
    q: query,
    limit: '50'
  }, token);
  return (payload.data ?? [])
    .filter((item) => item.type === 'region' && item.country_code === 'VN' && item.key)
    .map((item) => ({ key: String(item.key), name: item.name, type: 'region', countryCode: 'VN' }));
}
```

The server route uses the existing connected-session helper, `isAdAccountId`, a two-character query minimum, and `sendJson(response, 200, { results })`.

- [ ] **Step 5: Run focused tests and checkpoint GREEN**

Run: `node --test test/meta-client.test.js test/auth-routes.test.js test/client-api.test.js`

Expected: all focused tests pass.

---

### Task 3: Region Selector UI and Interactions

**Files:**
- Modify: `public/state.js`
- Modify: `public/workspace.js`
- Modify: `public/app.js`
- Modify: `public/app.css`
- Test: `test/workspace.test.js`
- Test: `test/client-state.test.js`

**Interfaces:**
- Consumes: `api.searchLocations`, `moveRegion`, `setLocationMode`.
- Produces UI actions: `set-location-mode`, `set-location-side`, `search-location`, `add-region`, `remove-region`.

- [ ] **Step 1: Write failing renderer tests**

```js
test('renders Vietnam country and region include/exclude controls', () => {
  const state = workspaceFixture({ selectedClientId: 'adset-1' });
  state.draft.campaigns[0].adSets[0].locationMode = 'REGIONS';
  state.draft.campaigns[0].adSets[0].includedRegions = [{ key: '3984', name: 'Thành phố Hồ Chí Minh', type: 'region', countryCode: 'VN' }];
  state.draft.campaigns[0].adSets[0].excludedRegions = [{ key: '3998', name: 'Nghệ An', type: 'region', countryCode: 'VN' }];
  const html = renderWorkspace(state);
  assert.match(html, /Toàn Việt Nam/);
  assert.match(html, /Tỉnh\/Thành phố đã chọn/);
  assert.match(html, /Thành phố Hồ Chí Minh/);
  assert.match(html, /Nghệ An/);
  assert.match(html, /data-action="add-region"/);
});
```

- [ ] **Step 2: Run renderer test and verify RED**

Run: `node --test --test-name-pattern="region include" test/workspace.test.js`

Expected: missing location controls.

- [ ] **Step 3: Implement pure renderer and CSS**

Add `locationEditor(state, adSet)` to `workspace.js`. Use existing chip, segmented-control and search-result styles; add only focused classes for the two-column region panel and mobile collapse.

- [ ] **Step 4: Implement browser orchestration**

Add state fields:

```js
resources: { locationResults: [] },
ui: {
  locationSelectionSide: 'include',
  locationQuery: '',
  searchingLocations: false
}
```

Use a separate `locationSequence` and `locationTimer`, debounce 250 ms, render `Đang tìm...`, and preserve selected chips when requests fail.

- [ ] **Step 5: Run UI/state tests and checkpoint GREEN**

Run: `node --test test/workspace.test.js test/client-state.test.js test/client-api.test.js`

Expected: all focused tests pass.

---

### Task 4: Conversation Domain and Meta Serializer

**Files:**
- Create: `src/conversation.js`
- Modify: `public/state.js`
- Modify: `src/draft.js`
- Test: `test/conversation.test.js`
- Test: `test/draft.test.js`

**Interfaces:**
- Produces: `createDefaultConversation(randomId) -> ConversationSnapshot`
- Produces: `validateConversation(conversation, path) -> Issue[]`
- Produces: `buildPageWelcomeMessage(conversation, mediaKind) -> string`

- [ ] **Step 1: Write failing conversation tests**

```js
test('builds a Visual Editor welcome message string', () => {
  const serialized = buildPageWelcomeMessage({
    greeting: 'Chào bạn, chúng tôi có thể giúp gì?',
    quickReplies: [{ id: 'q1', title: 'Tôi cần tư vấn', payload: 'reply_q1' }],
    showBusinessPhoneNumber: false,
    businessPhoneNumber: '',
    customerActions: [{ id: 'b1', label: 'Đăng ký ngay', type: 'OPEN_URL', value: 'https://example.test' }]
  }, 'image');
  const value = JSON.parse(serialized);
  assert.equal(value.type, 'VISUAL_EDITOR');
  assert.equal(value.version, 2);
  assert.equal(value.landing_screen_type, 'welcome_message');
  assert.equal(value.text_format.message.text, 'Chào bạn, chúng tôi có thể giúp gì?');
});
```

Add validation tests for blank greeting, zero/six quick replies, invalid HTTPS URL, missing action label and enabled phone with an invalid number.

- [ ] **Step 2: Run test and verify RED**

Run: `node --test test/conversation.test.js`

Expected: module-not-found failure.

- [ ] **Step 3: Implement the isolated serializer**

```js
export function buildPageWelcomeMessage(conversation, mediaKind) {
  const quickReplies = conversation.quickReplies.map((item) => ({
    title: item.title,
    content_type: 'text',
    payload: item.payload
  }));
  const message = { text: conversation.greeting, quick_replies: quickReplies };
  return JSON.stringify({
    type: 'VISUAL_EDITOR',
    version: 2,
    landing_screen_type: 'welcome_message',
    media_type: 'text',
    text_format: { customer_action_type: 'none', message },
    user_edit: true,
    surface: 'visual_editor_new',
    template_version: 2,
    is_call_prompt_enabled: conversation.showBusinessPhoneNumber,
    phone_number: conversation.showBusinessPhoneNumber
      ? { number: conversation.businessPhoneNumber }
      : {}
  });
}
```

Keep generic-template button mapping in helper functions in this file so `draft.js` remains unaware of Visual Editor internals.

- [ ] **Step 4: Add default Ad snapshot and draft validation**

`createAd()` receives `conversation: createDefaultConversation(randomId)`. `validateDraft` prefixes returned issues with the exact Ad path.

- [ ] **Step 5: Run conversation and draft tests GREEN**

Run: `node --test test/conversation.test.js test/draft.test.js test/client-state.test.js`

Expected: all focused tests pass.

---

### Task 5: SQLite Conversation Template Repository

**Files:**
- Modify: `src/db.js`
- Test: `test/db.test.js`

**Interfaces:**
- Produces: `listConversationTemplates(ownerMetaUserId, pageId)`
- Produces: `getConversationTemplate(id, ownerMetaUserId)`
- Produces: `createConversationTemplate({ownerMetaUserId,pageId,name,template})`
- Produces: `updateConversationTemplate({id,ownerMetaUserId,name,template})`
- Produces: `duplicateConversationTemplate({id,ownerMetaUserId,name})`
- Produces: `setDefaultConversationTemplate({id,ownerMetaUserId,pageId})`
- Produces: `deleteConversationTemplate({id,ownerMetaUserId})`

- [ ] **Step 1: Write failing repository tests**

Use a temporary SQLite database and assert owner/Page isolation, JSON round-trip, duplicate naming, update timestamps, one default per Page and refusal to delete the current default.

```js
const created = db.createConversationTemplate({
  ownerMetaUserId: 'owner-1',
  pageId: 'page-1',
  name: 'Tư vấn bikini',
  template: conversationFixture
});
db.setDefaultConversationTemplate({ id: created.id, ownerMetaUserId: 'owner-1', pageId: 'page-1' });
assert.equal(db.listConversationTemplates('owner-1', 'page-1')[0].isDefault, true);
assert.deepEqual(db.listConversationTemplates('owner-2', 'page-1'), []);
```

- [ ] **Step 2: Run repository test and verify RED**

Run: `node --test test/db.test.js`

Expected: missing CRUD methods.

- [ ] **Step 3: Add idempotent schema**

Add `conversation_templates` and owner/Page index to the existing startup `database.exec` block. Store `template_json`, `is_default`, `created_at`, `updated_at`.

- [ ] **Step 4: Implement owner-scoped CRUD**

Every `UPDATE` and `DELETE` includes both `id` and `owner_meta_user_id`. `setDefaultConversationTemplate` uses a SQLite transaction to clear the old default and set the new default. Map rows through one `mapConversationTemplate` helper.

- [ ] **Step 5: Run repository test and checkpoint GREEN**

Run: `node --test test/db.test.js`

Expected: all repository tests pass.

---

### Task 6: Authenticated Template CRUD Routes

**Files:**
- Modify: `src/server.js`
- Modify: `public/api.js`
- Test: `test/conversation-template-routes.test.js`
- Test: `test/client-api.test.js`

**Interfaces:**
- Routes: list/create/update/duplicate/default/delete under `/api/conversation-templates`.
- Consumes: DB methods from Task 5 and `validateConversation` from Task 4.

- [ ] **Step 1: Write failing route tests**

Cover disconnected session, invalid ad account/Page, successful list/create/update/duplicate/default/delete, owner isolation, and zero Meta write calls.

```js
const response = await request(server, '/api/conversation-templates', {
  method: 'POST',
  headers: { cookie, 'content-type': 'application/json' },
  body: JSON.stringify({ adAccountId: 'act_1', pageId: 'page-1', name: 'Mẫu 1', template: conversationFixture })
});
assert.equal(response.status, 201);
assert.equal(metaWriteCalls, 0);
```

- [ ] **Step 2: Run route tests and verify RED**

Run: `node --test test/conversation-template-routes.test.js test/client-api.test.js`

Expected: 404/missing-method failures.

- [ ] **Step 3: Implement Page authorization helper**

For each template route, decrypt the session token, load `promote_pages` for `adAccountId`, and require the requested `pageId` to be present before accessing the repository.

- [ ] **Step 4: Implement routes and API client methods**

The browser API exposes `loadConversationTemplates`, `createConversationTemplate`, `updateConversationTemplate`, `duplicateConversationTemplate`, `setDefaultConversationTemplate`, and `deleteConversationTemplate`. JSON write methods use the existing `postJson` pattern; update uses `PUT`, delete uses `DELETE`.

- [ ] **Step 5: Run route/client tests and checkpoint GREEN**

Run: `node --test test/conversation-template-routes.test.js test/client-api.test.js test/auth-routes.test.js`

Expected: all focused tests pass.

---

### Task 7: Conversation Library UI and Ad Snapshots

**Files:**
- Modify: `public/state.js`
- Modify: `public/workspace.js`
- Modify: `public/app.js`
- Modify: `public/app.css`
- Test: `test/client-state.test.js`
- Test: `test/workspace.test.js`

**Interfaces:**
- Produces: `applyConversationTemplate(ad, template) -> void`
- Produces UI actions: `select-conversation-template`, `save-conversation-template`, `update-conversation-template`, `duplicate-conversation-template`, `default-conversation-template`, `delete-conversation-template`, `add-quick-reply`, `remove-quick-reply`, `add-customer-action`, `remove-customer-action`.

- [ ] **Step 1: Write failing snapshot tests**

```js
test('applies a deep snapshot that does not change with the source template', () => {
  const ad = createAd(() => 'ad-1');
  const template = { id: 'tpl-1', name: 'Mẫu 1', template: conversationFixture };
  applyConversationTemplate(ad, template);
  template.template.greeting = 'Changed later';
  assert.equal(ad.conversation.greeting, conversationFixture.greeting);
  assert.equal(ad.conversation.sourceTemplateId, 'tpl-1');
});
```

- [ ] **Step 2: Write failing renderer tests**

Assert the Ad editor contains template select, template-name field, greeting textarea, phone toggle/number, quick-reply rows, action rows, save/default/delete buttons and preview copy.

- [ ] **Step 3: Run focused tests and verify RED**

Run: `node --test --test-name-pattern="conversation|snapshot" test/client-state.test.js test/workspace.test.js`

Expected: missing controls/helpers.

- [ ] **Step 4: Implement state and UI**

Cache templates as `resources.conversationTemplatesByPage[pageId]`. Load on Page selection and when entering an Ad whose Page cache is absent. Apply the Page default only when the Ad snapshot is still the untouched starter. Mark the Ad `conversation.dirty=true` on any nested editor change.

- [ ] **Step 5: Implement CRUD actions and preview**

Each action calls the corresponding API method, replaces only the affected Page cache, reapplies returned data when appropriate, renders a success toast, and reruns draft validation. Confirm delete; disable deleting the current default until another default is set.

- [ ] **Step 6: Run state/renderer tests and checkpoint GREEN**

Run: `node --test test/client-state.test.js test/workspace.test.js test/client-api.test.js`

Expected: all focused tests pass.

---

### Task 8: Publisher Integration, Documentation and Verification

**Files:**
- Modify: `src/draft.js`
- Modify: `src/publisher.js` only if function signatures require explicit media kind forwarding
- Modify: `README.md`
- Test: `test/draft.test.js`
- Test: `test/publisher.test.js`
- Test: `test/publish-routes.test.js`

**Interfaces:**
- Consumes: `buildPageWelcomeMessage` from Task 4.
- Produces: image and video creative payloads with nested string `page_welcome_message`.

- [ ] **Step 1: Write failing creative payload tests**

```js
test('adds the conversation snapshot to image and video creatives', () => {
  const image = JSON.parse(buildImageCreativeParams('page-1', 'hash-1', adWithConversation).get('object_story_spec'));
  const video = JSON.parse(buildVideoCreativeParams('page-1', 'video-1', { imageUrl: 'https://example.test/t.jpg' }, adWithConversation).get('object_story_spec'));
  assert.equal(typeof image.link_data.page_welcome_message, 'string');
  assert.equal(typeof video.video_data.page_welcome_message, 'string');
  assert.equal(JSON.parse(image.link_data.page_welcome_message).type, 'VISUAL_EDITOR');
});
```

- [ ] **Step 2: Run publisher tests and verify RED**

Run: `node --test --test-name-pattern="welcome|conversation" test/draft.test.js test/publisher.test.js test/publish-routes.test.js`

Expected: missing nested welcome message.

- [ ] **Step 3: Integrate serializer and update README**

Call `buildPageWelcomeMessage(ad.conversation, 'image'|'video')` from both creative builders. Document Toàn Việt Nam vs region mode, include/exclude, Page-scoped template snapshots, local-only storage and `PAUSED` safety.

- [ ] **Step 4: Run syntax and full automated suite**

Run:

```powershell
node --check src/conversation.js
node --check src/draft.js
node --check src/server.js
node --check public/state.js
node --check public/api.js
node --check public/workspace.js
node --check public/app.js
npm.cmd test
```

Expected: zero syntax failures and all tests pass.

- [ ] **Step 5: Restart local server and HTTP smoke test**

Restart only the process listening on port `3001`, start `node --env-file=.env src/server.js` hidden, then verify `/health`, `/api/location-search` validation and static module responses.

- [ ] **Step 6: Browser smoke test without Meta writes**

Verify at 1440, 768 and 375 CSS pixels: location search returns Hồ Chí Minh/Nghệ An, include/exclude chips move correctly, template CRUD persists after reload, Ad receives a deep snapshot, preview renders, keyboard focus is visible, no horizontal overflow, and no console errors. Do not click the publish button.

- [ ] **Step 7: Final tested checkpoint**

Record test count, HTTP status, browser checks and server PID. Keep the local app tab open as deliverable. No Git commit is possible in this workspace.

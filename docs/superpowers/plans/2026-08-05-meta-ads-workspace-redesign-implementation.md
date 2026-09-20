# Meta Ads Workspace Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the nested accordion form with a three-column Meta Ads workspace and add correct Campaign/Ad Set budget strategies, per-Ad-Set Pages, manual targeting, Custom Audience include/exclude, and pre-publish validation.

**Architecture:** Keep the dependency-free Node.js server and Meta client, but make `src/draft.js` the single source of truth for validation and payload mapping. Split the browser code into state, API, rendering, and bootstrap modules so workspace behavior can be tested without a browser framework. All Meta writes remain server-side and every created object remains `PAUSED`.

**Tech Stack:** Node.js 24, `node:http`, Web Fetch APIs, `node:sqlite`, built-in `node:test`, HTML, CSS, vanilla ESM JavaScript.

## Global Constraints

- Messenger is the only conversion destination.
- Campaign objective is `OUTCOME_ENGAGEMENT`.
- Ad Set optimization goal is `CONVERSATIONS`; billing event is `IMPRESSIONS`.
- Only daily budgets are supported.
- Every Meta Campaign, Ad Set, and Ad is created with `status=PAUSED`.
- Facebook Page is selected per Ad Set from the selected ad account's `promote_pages`.
- Advantage+ Audience remains off and maps to `targeting_automation: { advantage_audience: 0 }`.
- Custom Audience include/exclude lists are mutually exclusive.
- No new runtime dependency is added.
- Automated tests never create real Meta objects.
- This directory has no `.git`; do not add commit steps. Use passing test checkpoints instead.

## File Structure

- `src/draft.js`: validate the full draft and build Campaign, Ad Set, Creative, and Ad payloads.
- `src/meta-client.js`: Graph API transport, ad-account Pages, Custom Audiences, targeting search, and create methods.
- `src/server.js`: authenticated resource, targeting-search, media, validation, and publish routes.
- `src/publisher.js`: create the hierarchy and use each Ad Set's Page for promoted object and Creative.
- `public/state.js`: draft factories, node selection, updates, audience rules, and budget summaries.
- `public/api.js`: browser HTTP client with normalized errors.
- `public/workspace.js`: pure HTML rendering for tree, editor, review panel, and result log.
- `public/app.js`: DOM event wiring, resource loading, uploads, targeting search, validation, and publishing.
- `public/index.html`: top bar and three-column workspace shell.
- `public/app.css`: light, dense Meta-style design tokens, responsive layout, focus, and interaction states.
- `test/draft.test.js`: domain validation and payload mapping.
- `test/meta-client.test.js`: Graph request and response normalization.
- `test/auth-routes.test.js`: resource and targeting routes.
- `test/publisher.test.js`: hierarchy and per-Ad-Set Page propagation.
- `test/publish-routes.test.js`: server-side validation and publish integration.
- `test/client-state.test.js`: browser-independent state behavior.
- `test/client-api.test.js`: browser API client behavior.
- `test/workspace.test.js`: rendered workspace structure and conditional controls.

---

### Task 1: Budget Strategy Domain Model

**Files:**
- Modify: `test/draft.test.js`
- Modify: `test/publisher.test.js`
- Modify: `test/publish-routes.test.js`
- Modify: `src/draft.js`
- Modify: `src/publisher.js`

**Interfaces:**
- Consumes: draft shape from the approved design spec.
- Produces: `validateDraft(draft): ValidationIssue[]`.
- Produces: `buildCampaignParams(campaign): URLSearchParams`.
- Produces: `buildConversationAdSetParams(campaignId, campaign, adSet): URLSearchParams`.

- [ ] **Step 1: Replace draft fixtures and write failing budget tests**

Use a Page on each Ad Set and define both budget modes:

```js
const validAdSet = {
  clientId: 'adset-1',
  name: 'Nữ 18-45',
  pageId: 'page-1',
  dailyBudget: 100000,
  countries: ['VN'],
  ageMin: 18,
  ageMax: 45,
  genders: [2],
  includedCustomAudienceIds: [],
  excludedCustomAudienceIds: [],
  detailedTargeting: [],
  advantageAudienceEnabled: false,
  startTime: '',
  endTime: '',
  ads: [ad]
};

const adSetBudgetCampaign = {
  clientId: 'campaign-1',
  name: 'Ad set budget',
  specialAdCategory: 'NONE',
  budgetStrategy: 'AD_SET',
  dailyBudget: 0,
  adSets: [validAdSet]
};

test('campaign budget is sent only at campaign level', () => {
  const campaign = {
    clientId: 'campaign-1',
    name: 'Campaign budget',
    specialAdCategory: 'NONE',
    budgetStrategy: 'CAMPAIGN',
    dailyBudget: 500000,
    adSets: [validAdSet]
  };

  const campaignParams = buildCampaignParams(campaign);
  const adSetParams = buildConversationAdSetParams('remote-campaign', campaign, validAdSet);

  assert.equal(campaignParams.get('daily_budget'), '500000');
  assert.equal(campaignParams.get('bid_strategy'), 'LOWEST_COST_WITHOUT_CAP');
  assert.equal(campaignParams.has('is_adset_budget_sharing_enabled'), false);
  assert.equal(adSetParams.has('daily_budget'), false);
  assert.equal(adSetParams.has('bid_strategy'), false);
});

test('ad set budget disables sharing and is sent at ad set level', () => {
  const campaign = {
    clientId: 'campaign-1',
    name: 'Ad set budget',
    specialAdCategory: 'NONE',
    budgetStrategy: 'AD_SET',
    dailyBudget: 0,
    adSets: [validAdSet]
  };

  const campaignParams = buildCampaignParams(campaign);
  const adSetParams = buildConversationAdSetParams('remote-campaign', campaign, validAdSet);

  assert.equal(campaignParams.has('daily_budget'), false);
  assert.equal(campaignParams.get('is_adset_budget_sharing_enabled'), 'false');
  assert.equal(adSetParams.get('daily_budget'), '100000');
  assert.equal(adSetParams.get('bid_strategy'), 'LOWEST_COST_WITHOUT_CAP');
});
```

- [ ] **Step 2: Run the focused tests and verify RED**

Run: `node --test test/draft.test.js`

Expected: FAIL because `budgetStrategy` is ignored, the Campaign omits the sharing flag, and the old Ad Set builder signature always emits `daily_budget`.

- [ ] **Step 3: Implement mutually exclusive payload builders**

Use conditional object construction rather than empty query parameters:

```js
export function buildCampaignParams(campaign) {
  const params = {
    name: campaign.name,
    objective: conversationPreset.objective,
    buying_type: 'AUCTION',
    special_ad_categories: JSON.stringify(categoriesFor(campaign)),
    status: conversationPreset.status
  };

  if (campaign.budgetStrategy === 'CAMPAIGN') {
    params.daily_budget = String(campaign.dailyBudget);
    params.bid_strategy = conversationPreset.bidStrategy;
  } else {
    params.is_adset_budget_sharing_enabled = 'false';
  }

  return createParams(params);
}

export function buildConversationAdSetParams(campaignId, campaign, adSet) {
  const params = {
    name: adSet.name,
    campaign_id: campaignId,
    billing_event: conversationPreset.billingEvent,
    optimization_goal: conversationPreset.optimizationGoal,
    destination_type: conversationPreset.destinationType,
    promoted_object: JSON.stringify({ page_id: adSet.pageId }),
    targeting: JSON.stringify(buildManualTargeting(adSet)),
    status: conversationPreset.status
  };

  if (campaign.budgetStrategy === 'AD_SET') {
    params.daily_budget = String(adSet.dailyBudget);
    params.bid_strategy = conversationPreset.bidStrategy;
  }

  return createParams(params);
}

function categoriesFor(campaign) {
  return campaign.specialAdCategory && campaign.specialAdCategory !== 'NONE'
    ? [campaign.specialAdCategory]
    : [];
}

function isPositiveInteger(value) {
  return Number.isInteger(Number(value)) && Number(value) > 0;
}
```

Validation rules:

```js
if (!['CAMPAIGN', 'AD_SET'].includes(campaign.budgetStrategy)) {
  issues.push(issue(`${campaignPath}.budgetStrategy`, 'Chọn chiến lược ngân sách'));
}
if (campaign.budgetStrategy === 'CAMPAIGN' && !isPositiveInteger(campaign.dailyBudget)) {
  issues.push(issue(`${campaignPath}.dailyBudget`, 'Ngân sách chiến dịch phải lớn hơn 0'));
}
if (campaign.budgetStrategy === 'AD_SET' && !isPositiveInteger(adSet.dailyBudget)) {
  issues.push(issue(`${adSetPath}.dailyBudget`, 'Ngân sách nhóm quảng cáo phải lớn hơn 0'));
}
```

- [ ] **Step 4: Run the focused tests and verify GREEN**

Run: `node --test test/draft.test.js`

Expected: PASS with both budget modes represented by mutually exclusive fields.

- [ ] **Step 5: Migrate publisher calls and fixtures to the new signature**

Change the publisher call immediately so the repository never keeps two competing Ad Set builder signatures:

```js
create: () => metaClient.createAdSet(
  token,
  draft.adAccountId,
  buildConversationAdSetParams(campaignResult.remoteId, campaign, adSet)
)
```

Add `budgetStrategy: 'AD_SET'` and `dailyBudget: 0` to every Campaign fixture. Add `pageId`, `genders`, empty audience arrays, empty `detailedTargeting`, `advantageAudienceEnabled: false`, `startTime: ''`, and `endTime: ''` to every Ad Set fixture.

- [ ] **Step 6: Run the complete backend suite checkpoint**

Run: `npm.cmd test`

Expected: PASS. Task 4 adds the stronger assertion that different Ad Sets can use different Pages.

---

### Task 2: Manual Targeting and Schedule Payloads

**Files:**
- Modify: `test/draft.test.js`
- Modify: `src/draft.js`

**Interfaces:**
- Consumes: `adSet.pageId`, demographic controls, audience ID arrays, `detailedTargeting[]`, and optional times.
- Produces: `buildManualTargeting(adSet): object` as a named export for focused tests.
- Produces: Ad Set `URLSearchParams` with optional `start_time` and `end_time`.

- [ ] **Step 1: Write failing targeting and validation tests**

```js
function validDraftWith(adSet) {
  return {
    adAccountId: 'act_1',
    campaigns: [{ ...adSetBudgetCampaign, adSets: [adSet] }]
  };
}

test('builds manual targeting with Advantage off and audience exclusions', () => {
  const targeting = buildManualTargeting({
    ...validAdSet,
    includedCustomAudienceIds: ['ca-include-1', 'ca-include-2'],
    excludedCustomAudienceIds: ['ca-exclude-1'],
    detailedTargeting: [
      { id: 'interest-1', name: 'Skincare', targetingField: 'interests' },
      { id: 'behavior-1', name: 'Engaged shoppers', targetingField: 'behaviors' }
    ]
  });

  assert.deepEqual(targeting.targeting_automation, { advantage_audience: 0 });
  assert.deepEqual(targeting.genders, [2]);
  assert.deepEqual(targeting.custom_audiences, [{ id: 'ca-include-1' }, { id: 'ca-include-2' }]);
  assert.deepEqual(targeting.excluded_custom_audiences, [{ id: 'ca-exclude-1' }]);
  assert.deepEqual(targeting.flexible_spec, [{
    interests: [{ id: 'interest-1', name: 'Skincare' }],
    behaviors: [{ id: 'behavior-1', name: 'Engaged shoppers' }]
  }]);
});

test('rejects a Page missing from an ad set and duplicate audience intent', () => {
  const invalidAdSet = {
    ...validAdSet,
    pageId: '',
    includedCustomAudienceIds: ['ca-1'],
    excludedCustomAudienceIds: ['ca-1']
  };
  const issues = validateDraft(validDraftWith(invalidAdSet));

  assert.ok(issues.some((entry) => entry.path.endsWith('.pageId')));
  assert.ok(issues.some((entry) => entry.path.endsWith('.customAudiences')));
});

test('serializes a valid optional schedule and rejects reversed times', () => {
  const scheduled = { ...validAdSet, startTime: '2026-08-06T08:00:00+07:00', endTime: '2026-08-10T20:00:00+07:00' };
  const params = buildConversationAdSetParams('remote-campaign', adSetBudgetCampaign, scheduled);
  assert.equal(params.get('start_time'), scheduled.startTime);
  assert.equal(params.get('end_time'), scheduled.endTime);

  const issues = validateDraft(validDraftWith({ ...scheduled, endTime: '2026-08-05T20:00:00+07:00' }));
  assert.ok(issues.some((entry) => entry.path.endsWith('.schedule')));
});
```

- [ ] **Step 2: Run the focused tests and verify RED**

Run: `node --test test/draft.test.js`

Expected: FAIL because manual targeting, per-Ad-Set Page validation, duplicate audience detection, and schedule serialization do not exist.

- [ ] **Step 3: Implement targeting construction and schedule validation**

```js
export function buildManualTargeting(adSet) {
  const targeting = {
    geo_locations: { countries: adSet.countries },
    age_min: Number(adSet.ageMin),
    age_max: Number(adSet.ageMax),
    targeting_automation: { advantage_audience: 0 }
  };

  if (adSet.genders?.length) targeting.genders = adSet.genders.map(Number);
  if (adSet.includedCustomAudienceIds?.length) {
    targeting.custom_audiences = adSet.includedCustomAudienceIds.map((id) => ({ id }));
  }
  if (adSet.excludedCustomAudienceIds?.length) {
    targeting.excluded_custom_audiences = adSet.excludedCustomAudienceIds.map((id) => ({ id }));
  }

  const flexibleGroup = groupDetailedTargeting(adSet.detailedTargeting ?? []);
  if (Object.keys(flexibleGroup).length) targeting.flexible_spec = [flexibleGroup];
  return targeting;
}

function groupDetailedTargeting(items) {
  return items.reduce((group, item) => {
    if (!item.id || !item.targetingField) return group;
    group[item.targetingField] ??= [];
    group[item.targetingField].push({ id: item.id, name: item.name });
    return group;
  }, {});
}
```

Append `start_time` only when present, append `end_time` only after validation, and reject any `advantageAudienceEnabled` value other than `false`.

- [ ] **Step 4: Run the focused tests and verify GREEN**

Run: `node --test test/draft.test.js`

Expected: PASS for targeting, Page, audience conflict, and schedule cases.

- [ ] **Step 5: Run draft coverage checkpoint**

Run: `node --test --test-name-pattern="budget|targeting|Page|schedule|paused" test/draft.test.js`

Expected: PASS with no skipped matching tests.

---

### Task 3: Ad Account Resources and Targeting Search

**Files:**
- Modify: `test/meta-client.test.js`
- Modify: `test/auth-routes.test.js`
- Modify: `src/meta-client.js`
- Modify: `src/server.js`

**Interfaces:**
- Produces: `metaClient.listPromotablePages(token, accountId): Promise<PageSummary[]>`.
- Produces: `metaClient.listCustomAudiences(token, accountId): Promise<CustomAudienceSummary[]>`.
- Produces: `metaClient.searchTargeting(token, { category, query }): Promise<TargetingOption[]>`.
- Produces: `GET /api/ad-account-resources?adAccountId=act_...`.
- Produces: `GET /api/targeting-search?adAccountId=act_...&category=interest&query=skin`.

- [ ] **Step 1: Write failing Meta client tests**

```js
test('loads promotable Pages and Custom Audiences from the selected ad account', async () => {
  const client = createMetaClient(testConfig(), {
    fetchImpl: async (url) => {
      const target = String(url);
      if (target.includes('fields=promote_pages')) {
        return Response.json({ promote_pages: { data: [{ id: 'page-1', name: 'LG Clinic' }] } });
      }
      return Response.json({ data: [{ id: 'ca-1', name: 'Đã nhắn tin', subtype: 'ENGAGEMENT', delivery_status: { code: 200 } }] });
    }
  });

  assert.deepEqual(await client.listPromotablePages('token', 'act_1'), [{ id: 'page-1', name: 'LG Clinic' }]);
  assert.deepEqual(await client.listCustomAudiences('token', 'act_1'), [{
    id: 'ca-1', name: 'Đã nhắn tin', subtype: 'ENGAGEMENT', deliveryStatus: { code: 200 }
  }]);
});

test('normalizes targeting search results with a safe targeting field', async () => {
  const client = createMetaClient(testConfig(), {
    fetchImpl: async () => Response.json({ data: [{ id: '6001', name: 'Skincare', path: ['Beauty'] }] })
  });
  assert.deepEqual(await client.searchTargeting('token', { category: 'interest', query: 'skin' }), [{
    id: '6001', name: 'Skincare', path: ['Beauty'], targetingField: 'interests'
  }]);
});
```

- [ ] **Step 2: Run Meta client tests and verify RED**

Run: `node --test test/meta-client.test.js`

Expected: FAIL because all three methods are undefined.

- [ ] **Step 3: Implement Graph resource methods**

Use these request mappings:

```js
const targetingSearchMap = {
  interest: { type: 'adinterest', targetingField: 'interests' },
  behavior: { type: 'adTargetingCategory', className: 'behaviors', targetingField: 'behaviors' },
  demographic: { type: 'adTargetingCategory', className: 'demographics', targetingField: null }
};

async listPromotablePages(token, accountId) {
  const payload = await requestJson(fetchImpl, `${graphBaseUrl}/${accountId}`, {
    fields: 'promote_pages.limit(100){id,name}'
  }, token);
  return (payload.promote_pages?.data ?? []).map(({ id, name }) => ({ id, name }));
}

async listCustomAudiences(token, accountId) {
  const data = await requestPaged(fetchImpl, `${graphBaseUrl}/${accountId}/customaudiences`, {
    fields: 'id,name,subtype,delivery_status', limit: '100'
  }, token);
  return data.map((item) => ({
    id: item.id,
    name: item.name,
    subtype: item.subtype,
    deliveryStatus: item.delivery_status
  }));
}
```

For demographic results, derive `targetingField` only from an allowlist: `life_events`, `industries`, `income`, `family_statuses`, `education_statuses`, and `relationship_statuses`. Drop any result whose field cannot be mapped safely.

- [ ] **Step 4: Run Meta client tests and verify GREEN**

Run: `node --test test/meta-client.test.js`

Expected: PASS and no token appears in normalized results.

- [ ] **Step 5: Write failing authenticated route tests**

```js
test('returns ad-account Pages and audiences without exposing the token', async (context) => {
  const config = testConfig();
  const server = createServer({
    config,
    db: {
      createSession: () => ({ id: 'new-session' }),
      getSession: () => ({ id: 'session-user', metaUserId: 'meta-user-1' }),
      getConnection: () => ({
        accessTokenCiphertext: encryptToken('EAAG-secret-token', config.tokenEncryptionKey)
      })
    },
    metaClient: {
      listPromotablePages: async () => [{ id: 'page-1', name: 'LG Clinic' }],
      listCustomAudiences: async () => [{ id: 'ca-1', name: 'Đã nhắn tin', subtype: 'ENGAGEMENT' }]
    }
  });
  context.after(() => server.close());

  const session = signSession('session-user', config.sessionSecret);
  const response = await request(server, '/api/ad-account-resources?adAccountId=act_1', {
    headers: { cookie: `meta_ads_session=${encodeURIComponent(session)}` }
  });

  assert.deepEqual(response.body, {
    pages: [{ id: 'page-1', name: 'LG Clinic' }],
    customAudiences: [{ id: 'ca-1', name: 'Đã nhắn tin', subtype: 'ENGAGEMENT' }]
  });
  assert.doesNotMatch(JSON.stringify(response.body), /EAAG/);
});
```

Add route cases for missing session, missing `adAccountId`, query shorter than two characters, and unsupported category.

- [ ] **Step 6: Run route tests and verify RED**

Run: `node --test test/auth-routes.test.js`

Expected: FAIL with 404 for the new routes.

- [ ] **Step 7: Implement authenticated resource routes**

Add exact route branches before static-file handling:

```js
if (url.pathname === '/api/ad-account-resources' && request.method === 'GET') {
  await handleAdAccountResources({ url, response, session, db, config, metaClient });
  return;
}

if (url.pathname === '/api/targeting-search' && request.method === 'GET') {
  await handleTargetingSearch({ url, response, session, db, config, metaClient });
  return;
}
```

Both handlers decrypt the token server-side, validate `act_` account IDs, call only the selected method, and return normalized summaries.

- [ ] **Step 8: Run resource tests and verify GREEN**

Run: `node --test test/meta-client.test.js test/auth-routes.test.js`

Expected: PASS for OAuth, initial ad-account loading, selected-account resources, and targeting search.

---

### Task 4: Publisher Uses Each Ad Set Page

**Files:**
- Modify: `test/publisher.test.js`
- Modify: `test/publish-routes.test.js`
- Modify: `src/publisher.js`

**Interfaces:**
- Consumes: `buildConversationAdSetParams(campaignId, campaign, adSet)`.
- Consumes: `adSet.pageId` for Ad Set promoted object and every child Creative.
- Preserves: `publishDraft({ draft, token, runId, metaClient, getMedia, onNodeUpdate, delay })`.

- [ ] **Step 1: Write a failing per-Ad-Set Page propagation test**

```js
function draftWithTwoAdSets(adSetOverrides) {
  const adSets = adSetOverrides.map((overrides, index) => ({
    clientId: overrides.clientId,
    name: `Ad Set ${index + 1}`,
    pageId: overrides.pageId,
    dailyBudget: 100000,
    countries: ['VN'],
    ageMin: 18,
    ageMax: 45,
    genders: [],
    includedCustomAudienceIds: [],
    excludedCustomAudienceIds: [],
    detailedTargeting: [],
    advantageAudienceEnabled: false,
    startTime: '',
    endTime: '',
    ads: [{ ...ad, clientId: `ad-${index + 1}` }]
  }));
  return {
    adAccountId: 'act_1',
    campaigns: [{
      clientId: 'campaign-1',
      name: 'Campaign 1',
      specialAdCategory: 'NONE',
      budgetStrategy: 'AD_SET',
      dailyBudget: 0,
      adSets
    }]
  };
}

const imageFixture = () => ({
  id: 'media-image',
  mimeType: 'image/jpeg',
  name: 'image.jpg',
  content: Buffer.from('image')
});

function recordingMetaClient(calls) {
  return {
    createCampaign: async (_token, _accountId, params) => { calls.push({ type: 'campaign', params }); return 'remote-campaign'; },
    createAdSet: async (_token, _accountId, params) => { calls.push({ type: 'adset', params }); return `remote-adset-${calls.length}`; },
    uploadImage: async () => 'image-hash',
    createCreative: async (_token, _accountId, params) => { calls.push({ type: 'creative', params }); return `remote-creative-${calls.length}`; },
    createAd: async () => 'remote-ad'
  };
}

test('uses each ad set Page for promoted object and creative', async () => {
  const calls = [];
  const pageDraft = draftWithTwoAdSets([
    { pageId: 'page-1', clientId: 'adset-1' },
    { pageId: 'page-2', clientId: 'adset-2' }
  ]);

  await publishDraft({
    draft: pageDraft,
    token: 'token',
    runId: 'run-1',
    getMedia: imageFixture,
    metaClient: recordingMetaClient(calls)
  });

  const promotedPages = calls
    .filter((call) => call.type === 'adset')
    .map((call) => JSON.parse(call.params.get('promoted_object')).page_id);
  const creativePages = calls
    .filter((call) => call.type === 'creative')
    .map((call) => JSON.parse(call.params.get('object_story_spec')).page_id);

  assert.deepEqual(promotedPages, ['page-1', 'page-2']);
  assert.deepEqual(creativePages, ['page-1', 'page-2']);
});
```

- [ ] **Step 2: Run publisher tests and verify RED**

Run: `node --test test/publisher.test.js`

Expected: FAIL because the publisher still uses `draft.pageId`.

- [ ] **Step 3: Pass Campaign and Ad Set context through publisher**

```js
create: () => metaClient.createAdSet(
  token,
  draft.adAccountId,
  buildConversationAdSetParams(campaignResult.remoteId, campaign, adSet)
)
```

Pass `pageId: adSet.pageId` into `createAd`, then into `createCreativeForMedia`. Remove every read of `draft.pageId` from `src/publisher.js`.

- [ ] **Step 4: Update valid route fixtures to the approved model**

Every test Campaign gets `budgetStrategy`; every test Ad Set gets `pageId`, `genders`, audience arrays, `detailedTargeting`, `advantageAudienceEnabled`, and schedule strings.

- [ ] **Step 5: Run publisher and publish-route tests and verify GREEN**

Run: `node --test test/publisher.test.js test/publish-routes.test.js`

Expected: PASS while preserving parent-failure skip behavior and per-node statuses.

- [ ] **Step 6: Run all backend tests checkpoint**

Run: `npm.cmd test`

Expected: PASS before starting the UI replacement.

---

### Task 5: Browser State and API Modules

**Files:**
- Create: `test/client-state.test.js`
- Create: `test/client-api.test.js`
- Create: `public/state.js`
- Create: `public/api.js`

**Interfaces:**
- Produces: `createWorkspaceState({ randomId }): WorkspaceState`.
- Produces: `addCampaign`, `addAdSet`, `addAd`, `removeNode`, `selectNode`, `updateNodeField`.
- Produces: `moveCustomAudience(adSet, audienceId, targetList)`.
- Produces: `calculateBudgetSummary(campaigns)`.
- Produces: `createApiClient(fetchImpl)` with resource, search, validate, upload, and publish methods.

- [ ] **Step 1: Write failing state tests**

```js
function idSequence(...ids) {
  let index = 0;
  return () => ids[index++];
}

test('creates the approved nested defaults', () => {
  const state = createWorkspaceState({ randomId: idSequence('campaign-1', 'adset-1', 'ad-1') });
  const campaign = state.draft.campaigns[0];
  const adSet = campaign.adSets[0];

  assert.equal(campaign.budgetStrategy, 'AD_SET');
  assert.equal(adSet.pageId, '');
  assert.deepEqual(adSet.genders, []);
  assert.equal(adSet.advantageAudienceEnabled, false);
  assert.equal(state.selection.clientId, 'campaign-1');
});

test('moving an audience to exclude removes it from include', () => {
  const adSet = createAdSet(() => 'id');
  adSet.includedCustomAudienceIds = ['ca-1'];
  moveCustomAudience(adSet, 'ca-1', 'exclude');
  assert.deepEqual(adSet.includedCustomAudienceIds, []);
  assert.deepEqual(adSet.excludedCustomAudienceIds, ['ca-1']);
});

test('budget summary counts campaign budget once and ad set budgets separately', () => {
  const campaignBudgetFixture = {
    budgetStrategy: 'CAMPAIGN',
    dailyBudget: 500000,
    adSets: [{ dailyBudget: 900000 }]
  };
  const adSetBudgetFixture = {
    budgetStrategy: 'AD_SET',
    dailyBudget: 900000,
    adSets: [{ dailyBudget: 100000 }, { dailyBudget: 100000 }]
  };
  assert.equal(calculateBudgetSummary([campaignBudgetFixture, adSetBudgetFixture]), 700000);
});
```

- [ ] **Step 2: Run client-state tests and verify RED**

Run: `node --test test/client-state.test.js`

Expected: ERROR because `public/state.js` does not exist.

- [ ] **Step 3: Implement browser-independent state helpers**

```js
export function createCampaign(randomId = crypto.randomUUID) {
  return {
    clientId: randomId(),
    name: '',
    specialAdCategory: 'NONE',
    budgetStrategy: 'AD_SET',
    dailyBudget: 500000,
    adSets: [createAdSet(randomId)]
  };
}

export function moveCustomAudience(adSet, audienceId, targetList) {
  adSet.includedCustomAudienceIds = adSet.includedCustomAudienceIds.filter((id) => id !== audienceId);
  adSet.excludedCustomAudienceIds = adSet.excludedCustomAudienceIds.filter((id) => id !== audienceId);
  const key = targetList === 'include' ? 'includedCustomAudienceIds' : 'excludedCustomAudienceIds';
  adSet[key].push(audienceId);
}
```

Keep this module free of `document`, `window`, and network calls.

- [ ] **Step 4: Run client-state tests and verify GREEN**

Run: `node --test test/client-state.test.js`

Expected: PASS.

- [ ] **Step 5: Write failing API client tests**

```js
test('encodes targeting queries and normalizes server errors', async () => {
  const requests = [];
  const api = createApiClient(async (url) => {
    requests.push(String(url));
    return Response.json({ error: 'Không có quyền Page' }, { status: 403 });
  });

  await assert.rejects(
    api.searchTargeting('act_1', 'interest', 'chăm sóc da'),
    /Không có quyền Page/
  );
  assert.match(requests[0], /query=ch%C4%83m%20s%C3%B3c%20da/);
});
```

- [ ] **Step 6: Run API tests and verify RED**

Run: `node --test test/client-api.test.js`

Expected: ERROR because `public/api.js` does not exist.

- [ ] **Step 7: Implement the injected-fetch API client**

```js
export function createApiClient(fetchImpl = fetch) {
  const postJson = (body) => ({
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body)
  });

  async function json(url, options) {
    const response = await fetchImpl(url, options);
    const payload = await response.json();
    if (!response.ok) {
      const message = payload.errors?.map((entry) => entry.message).join(' · ')
        ?? payload.message
        ?? payload.error
        ?? 'Yêu cầu thất bại';
      throw new Error(message);
    }
    return payload;
  }

  return {
    loadResources: () => json('/api/resources'),
    loadAdAccountResources: (adAccountId) => json(`/api/ad-account-resources?adAccountId=${encodeURIComponent(adAccountId)}`),
    searchTargeting: (adAccountId, category, query) => json(`/api/targeting-search?adAccountId=${encodeURIComponent(adAccountId)}&category=${encodeURIComponent(category)}&query=${encodeURIComponent(query)}`),
    validateDraft: (draft) => json('/api/drafts/validate', postJson(draft)),
    publishDraft: (draft) => json('/api/runs', postJson(draft)),
    uploadMedia: (formData) => json('/api/media', { method: 'POST', body: formData })
  };
}
```

- [ ] **Step 8: Run both browser module test files and verify GREEN**

Run: `node --test test/client-state.test.js test/client-api.test.js`

Expected: PASS without a DOM environment.

---

### Task 6: Three-Column Workspace Renderer

**Files:**
- Create: `test/workspace.test.js`
- Create: `public/workspace.js`
- Modify: `public/index.html`
- Modify: `public/app.css`

**Interfaces:**
- Consumes: `WorkspaceState`, server validation issues, and run results.
- Produces: `renderWorkspace(state): string`.
- Produces: `renderResults(nodes): string`.
- Uses stable `data-action`, `data-client-id`, and `data-field` attributes for event delegation.

- [ ] **Step 1: Write failing renderer structure tests**

```js
function workspaceFixture({ selectedClientId = 'campaign-1', budgetStrategy = 'AD_SET', issues = [] } = {}) {
  return {
    connected: true,
    running: false,
    selection: { clientId: selectedClientId },
    issues,
    resources: {
      adAccounts: [{ id: 'act_1', name: 'LG Clinic 37', currency: 'VND' }],
      pages: [{ id: 'page-1', name: 'LG Clinic' }],
      customAudiences: [{ id: 'ca-1', name: 'Đã nhắn tin', subtype: 'ENGAGEMENT' }],
      targetingResults: []
    },
    draft: {
      adAccountId: 'act_1',
      campaigns: [{
        clientId: 'campaign-1',
        name: 'Chiến dịch tháng 8',
        specialAdCategory: 'NONE',
        budgetStrategy,
        dailyBudget: 500000,
        adSets: [{
          clientId: 'adset-1',
          name: 'Nữ 18-45',
          pageId: 'page-1',
          dailyBudget: 100000,
          countries: ['VN'],
          ageMin: 18,
          ageMax: 45,
          genders: [2],
          includedCustomAudienceIds: [],
          excludedCustomAudienceIds: [],
          detailedTargeting: [],
          advantageAudienceEnabled: false,
          startTime: '',
          endTime: '',
          ads: [{ clientId: 'ad-1', name: 'Ảnh 01', primaryText: '', headline: '', mediaId: null }]
        }]
      }]
    }
  };
}

test('renders tree, selected editor, and readiness panel', () => {
  const state = workspaceFixture({ selectedClientId: 'adset-1' });
  const html = renderWorkspace(state);

  assert.match(html, /class="workspace-tree"/);
  assert.match(html, /class="workspace-editor"/);
  assert.match(html, /class="workspace-review"/);
  assert.match(html, /Vị trí chuyển đổi/);
  assert.match(html, /Facebook Page/);
  assert.match(html, /Mục tiêu hiệu quả/);
  assert.match(html, /Giới tính/);
  assert.match(html, /Bao gồm/);
  assert.match(html, /Loại trừ/);
});

test('disables ad set budget when campaign budget is selected', () => {
  const html = renderWorkspace(workspaceFixture({ budgetStrategy: 'CAMPAIGN', selectedClientId: 'adset-1' }));
  assert.match(html, /data-field="dailyBudget"[^>]*disabled/);
  assert.match(html, /Ngân sách được quản lý tại cấp chiến dịch/);
});

test('defines desktop workspace columns and responsive drawers', async () => {
  const css = await readFile(new URL('../public/app.css', import.meta.url), 'utf8');
  assert.match(css, /\.workspace-shell\s*\{/);
  assert.match(css, /grid-template-columns:\s*260px minmax\(520px, 1fr\) 300px/);
  assert.match(css, /@media \(max-width: 1199px\)/);
  assert.match(css, /@media \(max-width: 767px\)/);
  assert.match(css, /:focus-visible/);
});
```

Import `readFile` from `node:fs/promises` at the top of `test/workspace.test.js`.

- [ ] **Step 2: Run workspace tests and verify RED**

Run: `node --test test/workspace.test.js`

Expected: ERROR because `public/workspace.js` does not exist.

- [ ] **Step 3: Implement pure workspace rendering**

Use this top-level structure:

```js
export function renderWorkspace(state) {
  return `
    <aside class="workspace-tree" aria-label="Cấu trúc chiến dịch">
      ${renderTree(state)}
    </aside>
    <section class="workspace-editor" aria-label="Trình chỉnh sửa">
      ${renderEditor(state)}
    </section>
    <aside class="workspace-review" aria-label="Kiểm tra thiết lập">
      ${renderReview(state)}
    </aside>`;
}
```

The Ad Set editor renders these sections in order:

1. Identity: name.
2. Conversion: locked Messenger destination, Page select, locked `CONVERSATIONS` goal.
3. Budget and schedule: conditional budget input, start, end.
4. Manual audience: Advantage+ off notice, countries, age, gender segmented control.
5. Custom Audience: searchable include and exclude lists with selected chips.
6. Narrow further: category tabs, search input, result list, and selected targeting chips.

Escape every user-provided value with one exported `escapeHtml` helper. SVG icon buttons require visible text or `aria-label`.

- [ ] **Step 4: Replace the HTML shell**

`public/index.html` keeps only stable mount points:

```html
<header class="topbar">
  <div class="brand">Meta Campaign Builder</div>
  <label class="account-control">Tài khoản quảng cáo <select id="ad-account"></select></label>
  <div id="connection-status" role="status"></div>
  <button id="publish-draft" type="button">Kiểm tra & tạo ở PAUSED</button>
</header>
<main id="workspace" class="workspace-shell"></main>
<section id="run-results" class="results-drawer" aria-live="polite"></section>
<script type="module" src="/app.js"></script>
```

- [ ] **Step 5: Implement the approved design system and responsive layout**

Start with exact layout tokens:

```css
:root {
  --color-primary: #1877f2;
  --color-primary-strong: #0b5ed7;
  --color-canvas: #f0f2f5;
  --color-surface: #ffffff;
  --color-text: #1c1e21;
  --color-muted: #65676b;
  --color-border: #d8dadf;
  --color-danger: #c9362b;
  --color-success: #248a3d;
  --focus-ring: 0 0 0 3px rgba(24, 119, 242, .28);
}

.workspace-shell {
  display: grid;
  grid-template-columns: 260px minmax(520px, 1fr) 300px;
  min-height: calc(100vh - 64px);
  background: var(--color-canvas);
}

@media (max-width: 1199px) {
  .workspace-shell { grid-template-columns: 240px minmax(0, 1fr); }
  .workspace-review { position: fixed; inset: 64px 0 0 auto; width: min(360px, 92vw); }
}

@media (max-width: 767px) {
  .workspace-shell { display: block; }
  .workspace-tree { position: fixed; inset: 64px auto 0 0; width: min(320px, 88vw); }
  .workspace-editor { padding-bottom: 88px; }
}
```

Use 16px body text, 44px interactive height, visible `:focus-visible`, 150–220ms color/transform transitions, and `prefers-reduced-motion` overrides. Remove the current dark neon palette and all inline layout styles.

- [ ] **Step 6: Run workspace tests and verify GREEN**

Run: `node --test test/workspace.test.js`

Expected: PASS for three-column landmarks, required fields, accessibility labels, and budget disabled state.

---

### Task 7: Browser Orchestration, Validation, and Final Verification

**Files:**
- Modify: `public/app.js`
- Modify: `public/workspace.js`
- Modify: `public/app.css`
- Modify: `README.md`
- Modify: `test/workspace.test.js`
- Modify: `test/publish-routes.test.js`

**Interfaces:**
- Consumes: state helpers from `public/state.js` and methods from `public/api.js`.
- Produces: an interactive local workspace at `/`.
- Preserves: OAuth redirect, media upload, run logs, and all objects `PAUSED`.

- [ ] **Step 1: Add failing orchestration-facing renderer tests**

Add string-level contracts for stable event hooks:

```js
test('renders stable actions for account resources and hierarchy edits', () => {
  const html = renderWorkspace(workspaceFixture({ selectedClientId: 'adset-1' }));
  assert.match(html, /data-action="add-adset"/);
  assert.match(html, /data-action="add-ad"/);
  assert.match(html, /data-action="select-node"/);
  assert.match(html, /data-action="move-custom-audience"/);
  assert.match(html, /data-action="search-targeting"/);
});

test('review panel blocks publishing when server issues exist', () => {
  const html = renderWorkspace(workspaceFixture({
    issues: [{ path: 'campaigns.0.adSets.0.pageId', message: 'Chọn Facebook Page' }]
  }));
  assert.match(html, /Chọn Facebook Page/);
  assert.match(html, /data-publish-blocked="true"/);
});
```

- [ ] **Step 2: Run renderer tests and verify RED**

Run: `node --test test/workspace.test.js`

Expected: FAIL until action hooks and blocked-publish state are rendered.

- [ ] **Step 3: Rebuild `public/app.js` as event wiring only**

Use one state instance and rerender after state changes:

```js
import { createApiClient } from './api.js';
import { createWorkspaceState, selectNode, updateNodeField, moveCustomAudience } from './state.js';
import { renderWorkspace, renderResults } from './workspace.js';

const api = createApiClient();
const state = createWorkspaceState();
const workspace = document.querySelector('#workspace');

function render() {
  workspace.innerHTML = renderWorkspace(state);
  document.querySelector('#publish-draft').disabled = state.running || state.issues.length > 0;
}
```

Event behavior:

- Account change clears Page and audience selections that belong to the old account, then loads `/api/ad-account-resources`.
- Field input updates the selected node by `clientId`; number fields remain numbers.
- Budget strategy change immediately disables the inactive budget controls without deleting their draft values.
- Gender segmented controls set `[]`, `[1]`, or `[2]`.
- Moving a Custom Audience uses `moveCustomAudience` so an ID exists on only one side.
- Targeting search waits 250ms, ignores queries shorter than two characters, and uses a request sequence number so stale results cannot replace newer results.
- Media upload preserves image preview and media ID behavior.
- Validation runs on blur and before publish; server errors replace `state.issues`.
- Publish is disabled during a run and results render by node.

- [ ] **Step 4: Write failing draft validation route tests**

Add to `test/publish-routes.test.js`:

```js
function validationServer(context) {
  const config = testConfig();
  const server = createServer({
    config,
    db: {
      createSession: () => ({ id: 'new-session' }),
      getSession: () => ({ id: 'session-user', metaUserId: 'meta-user-1' })
    },
    metaClient: {}
  });
  context.after(() => server.close());
  const session = signSession('session-user', config.sessionSecret);
  return {
    server,
    headers: { cookie: `meta_ads_session=${encodeURIComponent(session)}` }
  };
}

test('validates a draft without making Meta write calls', async (context) => {
  const config = testConfig();
  let metaWrites = 0;
  const server = createServer({
    config,
    db: {
      createSession: () => ({ id: 'new-session' }),
      getSession: () => ({ id: 'session-user', metaUserId: 'meta-user-1' })
    },
    metaClient: new Proxy({}, { get: () => () => { metaWrites += 1; } })
  });
  context.after(() => server.close());

  const session = signSession('session-user', config.sessionSecret);
  const response = await request(server, '/api/drafts/validate', {
    method: 'POST',
    headers: {
      cookie: `meta_ads_session=${encodeURIComponent(session)}`,
      'content-type': 'application/json'
    },
    body: JSON.stringify(draft)
  });

  assert.equal(response.status, 200);
  assert.deepEqual(response.body, { valid: true, errors: [] });
  assert.equal(metaWrites, 0);
});

test('returns path-based errors for an invalid Ad Set Page', async (context) => {
  const invalidDraft = structuredClone(draft);
  invalidDraft.campaigns[0].adSets[0].pageId = '';
  const { server, headers } = validationServer(context);
  const response = await request(server, '/api/drafts/validate', {
    method: 'POST', headers: { ...headers, 'content-type': 'application/json' }, body: JSON.stringify(invalidDraft)
  });

  assert.equal(response.status, 422);
  assert.ok(response.body.errors.some((entry) => entry.path === 'campaigns.0.adSets.0.pageId'));
});
```

- [ ] **Step 5: Run validation route tests and verify RED**

Run: `node --test --test-name-pattern="validates a draft|invalid Ad Set Page" test/publish-routes.test.js`

Expected: FAIL with 404 because `/api/drafts/validate` is absent.

- [ ] **Step 6: Implement the explicit draft validation route**

In `src/server.js`:

```js
if (url.pathname === '/api/drafts/validate' && request.method === 'POST') {
  const draft = await readJson(request);
  const errors = validateDraft(draft);
  sendJson(response, errors.length ? 422 : 200, { valid: errors.length === 0, errors });
  return;
}
```

- [ ] **Step 7: Run validation and renderer tests and verify GREEN**

Run: `node --test test/publish-routes.test.js test/workspace.test.js`

Expected: PASS for path-based server validation and blocked-publish rendering.

- [ ] **Step 8: Update documentation**

Document:

- Page selection now occurs inside each Ad Set.
- Ad-account Page discovery uses `promote_pages`.
- Two daily-budget strategies and their exclusivity.
- Manual targeting and Custom Audience include/exclude.
- Required OAuth permissions and the distinction between Page Admin and advertiser asset access.
- All created objects remain `PAUSED`.

- [ ] **Step 9: Run all automated tests**

Run: `npm.cmd test`

Expected: PASS with zero failing tests and no unhandled rejection warnings.

- [ ] **Step 10: Run a local HTTP smoke test without Meta writes**

Run the server on a temporary port with the configured local environment, then verify:

```powershell
Invoke-WebRequest -UseBasicParsing 'http://127.0.0.1:3100/health'
Invoke-WebRequest -UseBasicParsing 'http://127.0.0.1:3100/'
```

Expected: `/health` returns `{"ok":true}` and `/` contains `workspace-shell`, `workspace-tree`, `workspace-editor`, and `workspace-review`.

- [ ] **Step 11: Perform browser smoke tests at three breakpoints**

At 1440px:

- Tree, editor, and review panel are simultaneously visible.
- Selecting Campaign, Ad Set, and Ad changes the editor without page navigation.
- Campaign Budget disables every Ad Set budget field.
- Ad Set Budget enables each Ad Set budget field.

At 768px:

- Review opens as a drawer and does not cover the editor permanently.

At 375px:

- Tree opens as a drawer, form controls remain one column, and no horizontal page scroll appears.

Keyboard:

- Tab order reaches account, tree nodes, editor controls, review, and publish.
- Every focused control has a visible focus ring.

- [ ] **Step 12: Verify the original Meta error is prevented before handoff**

Run:

```powershell
node --input-type=module -e "import {buildCampaignParams} from './src/draft.js'; console.log(buildCampaignParams({name:'Check',specialAdCategory:'NONE',budgetStrategy:'AD_SET',dailyBudget:0}).toString())"
```

Expected output contains `is_adset_budget_sharing_enabled=false` and does not contain `daily_budget`.

- [ ] **Step 13: Record the final verification checkpoint**

Capture the exact test count, HTTP smoke results, browser breakpoints checked, and any remaining Meta permission limitation. Do not claim real campaign creation succeeded unless a user-approved manual `PAUSED` run was performed.

# Meta Page Discovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the ad-account-only Page list with a safe merged catalog from promotable, user-managed, and Business Portfolio Pages, then use that catalog consistently in the UI, conversation-template authorization, and publish preflight.

**Architecture:** A pure server-side catalog module merges Page records and computes advertising eligibility. The Meta client owns Graph pagination and partial Business-permission recovery, the HTTP server strips private task data before returning resources, and the browser renders a searchable grouped selector while deriving local permission issues from the returned catalog. The publish route reloads the catalog immediately before any Meta write.

**Tech Stack:** Node.js ES modules, built-in `fetch`, built-in `node:test`, server-rendered HTML strings, vanilla browser JavaScript, CSS.

## Global Constraints

- Add OAuth scope `business_management` while retaining `ads_read`, `ads_management`, `pages_show_list`, `pages_read_engagement`, and `pages_manage_ads`.
- Read Pages only from public Graph API connections: `/{ad_account_id}/promote_pages`, `/me/accounts`, `/me/businesses`, `/{business_id}/owned_pages`, and `/{business_id}/client_pages`.
- Follow `paging.next` until exhausted for every Page and Business connection.
- Never send user or Page access tokens to browser responses.
- Treat `promote_pages` and `/me/accounts` failures as fatal resource-discovery errors.
- Treat missing `business_management` as partial success with `requiresBusinessReconnect: true`.
- Continue discovery when one Business Portfolio edge fails and return a warning for that edge.
- A Page is selectable only when it is promotable or has one of `ADVERTISE`, `PROFILE_PLUS_ADVERTISE`, `MANAGE`, `PROFILE_PLUS_MANAGE`, or `PROFILE_PLUS_FULL_CONTROL`.
- Reload and authorize the Page catalog server-side before conversation-template operations and before publish.
- Keep every Meta object creation status `PAUSED` and make no Meta writes during discovery or verification.
- Do not add runtime dependencies and do not create a git commit unless the user explicitly requests one.

---

## File Map

- Create `src/page-catalog.js`: normalize, deduplicate, classify, count, and sanitize Page catalog entries.
- Create `test/page-catalog.test.js`: unit coverage for merge, task union, eligibility, sorting, and public serialization.
- Modify `src/meta-client.js`: request the Business scope; paginate all five Graph connections; recover from Business-only permission failures; expose `listPageCatalog(token, adAccountId)`.
- Modify `test/meta-client.test.js`: verify OAuth scope, pagination, Business recovery, and absence of tokens.
- Modify `src/server.js`: return merged resources, authorize templates with the merged catalog, and preflight every Ad Set Page before publishing.
- Modify `test/auth-routes.test.js`: verify the resource response and token boundary.
- Modify `test/conversation-template-routes.test.js`: verify merged-catalog authorization.
- Modify `test/publish-routes.test.js`: verify denied Pages stop before all Meta writes.
- Modify `public/state.js`: add Page discovery defaults and pure helpers for unavailable selected Pages and permission issues.
- Modify `test/client-state.test.js`: cover selected-Page preservation and local blocking issues.
- Modify `public/app.js`: store discovery metadata, filter the Page selector without rerendering the editor, and combine Page permission issues with schema issues.
- Modify `public/workspace.js`: render searchable available/unavailable Page groups, counts, and reconnect guidance.
- Modify `public/app.css`: style the Page selector, status summary, disabled group, and reconnect warning.
- Modify `test/workspace.test.js`: verify grouping, disabled options, search state, selection preservation, and warning copy.
- Modify `README.md`: document the Page sources, reconnect requirement, and partial-catalog behavior.

---

### Task 1: Pure Page Catalog

**Files:**
- Create: `src/page-catalog.js`
- Create: `test/page-catalog.test.js`

**Interfaces:**
- Consumes: source groups shaped as `{ PROMOTABLE: PageInput[], MANAGED: PageInput[], BUSINESS_OWNED: PageInput[], BUSINESS_CLIENT: PageInput[] }`, where `PageInput` is `{ id: string, name: string, tasks?: string[], access_token?: string }`.
- Produces: `mergePageCatalog(sourceGroups): CatalogPage[]`, `catalogCounts(pages): PageCounts`, and `publicCatalogPage(page): PublicCatalogPage`.
- `CatalogPage` is `{ id, name, sources, tasks, canAdvertise, unavailableReason }`.
- `PublicCatalogPage` intentionally omits `tasks` and every unknown Graph field.

- [ ] **Step 1: Write failing catalog tests**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  catalogCounts,
  mergePageCatalog,
  publicCatalogPage
} from '../src/page-catalog.js';

test('merges duplicate Page IDs and unions sources and tasks', () => {
  const pages = mergePageCatalog({
    PROMOTABLE: [{ id: '2', name: 'Beta' }],
    MANAGED: [
      { id: '1', name: 'Ánh Dương', tasks: ['ADVERTISE'], access_token: 'never-returned' },
      { id: '2', name: 'Beta', tasks: ['MODERATE'] }
    ],
    BUSINESS_OWNED: [{ id: '1', name: 'Ánh Dương', tasks: ['MANAGE'] }],
    BUSINESS_CLIENT: [{ id: '3', name: 'Chưa đủ quyền' }]
  });

  assert.deepEqual(pages.map((page) => page.id), ['1', '2', '3']);
  assert.deepEqual(pages[0].sources, ['MANAGED', 'BUSINESS_OWNED']);
  assert.deepEqual(pages[0].tasks, ['ADVERTISE', 'MANAGE']);
  assert.equal(pages[0].canAdvertise, true);
  assert.equal(pages[1].canAdvertise, true);
  assert.equal(pages[2].canAdvertise, false);
  assert.equal(
    pages[2].unavailableReason,
    'Meta chưa trả quyền tạo quảng cáo cho Page này'
  );
});

test('serializes only browser-safe Page fields and counts catalog status', () => {
  const pages = mergePageCatalog({
    PROMOTABLE: [{ id: '1', name: 'Một' }],
    MANAGED: [{ id: '2', name: 'Hai', tasks: [] }],
    BUSINESS_OWNED: [],
    BUSINESS_CLIENT: []
  });

  assert.deepEqual(catalogCounts(pages), {
    total: 2,
    available: 1,
    unavailable: 1,
    promotable: 1,
    managed: 1,
    businessOwned: 0,
    businessClient: 0
  });
  assert.deepEqual(publicCatalogPage(pages[0]), {
    id: '1',
    name: 'Một',
    sources: ['PROMOTABLE'],
    canAdvertise: true,
    unavailableReason: null
  });
});

test('keeps different Page IDs even when their names are identical', () => {
  const pages = mergePageCatalog({
    PROMOTABLE: [{ id: '1', name: 'LG Clinic' }],
    MANAGED: [{ id: '2', name: 'LG Clinic', tasks: ['ADVERTISE'] }],
    BUSINESS_OWNED: [],
    BUSINESS_CLIENT: []
  });

  assert.deepEqual(pages.map((page) => page.id).sort(), ['1', '2']);
});
```

- [ ] **Step 2: Run the catalog tests and confirm the missing-module failure**

Run: `node --test test/page-catalog.test.js`

Expected: FAIL because `src/page-catalog.js` does not exist.

- [ ] **Step 3: Implement catalog normalization, eligibility, counts, and public serialization**

```js
const SOURCE_ORDER = ['PROMOTABLE', 'MANAGED', 'BUSINESS_OWNED', 'BUSINESS_CLIENT'];
const ADVERTISING_TASKS = new Set([
  'ADVERTISE',
  'PROFILE_PLUS_ADVERTISE',
  'MANAGE',
  'PROFILE_PLUS_MANAGE',
  'PROFILE_PLUS_FULL_CONTROL'
]);
const UNAVAILABLE_REASON = 'Meta chưa trả quyền tạo quảng cáo cho Page này';

export function mergePageCatalog(sourceGroups) {
  const byId = new Map();
  for (const source of SOURCE_ORDER) {
    for (const page of sourceGroups[source] ?? []) {
      if (!page?.id) continue;
      const current = byId.get(String(page.id)) ?? {
        id: String(page.id),
        name: String(page.name ?? page.id),
        sources: new Set(),
        tasks: new Set()
      };
      current.sources.add(source);
      for (const task of page.tasks ?? []) current.tasks.add(String(task));
      if (page.name) current.name = String(page.name);
      byId.set(current.id, current);
    }
  }

  return [...byId.values()].map((page) => {
    const sources = SOURCE_ORDER.filter((source) => page.sources.has(source));
    const tasks = [...page.tasks].sort();
    const canAdvertise = sources.includes('PROMOTABLE')
      || tasks.some((task) => ADVERTISING_TASKS.has(task));
    return {
      id: page.id,
      name: page.name,
      sources,
      tasks,
      canAdvertise,
      unavailableReason: canAdvertise ? null : UNAVAILABLE_REASON
    };
  }).sort((left, right) => left.name.localeCompare(right.name, 'vi'));
}

export function catalogCounts(pages) {
  return {
    total: pages.length,
    available: pages.filter((page) => page.canAdvertise).length,
    unavailable: pages.filter((page) => !page.canAdvertise).length,
    promotable: pages.filter((page) => page.sources.includes('PROMOTABLE')).length,
    managed: pages.filter((page) => page.sources.includes('MANAGED')).length,
    businessOwned: pages.filter((page) => page.sources.includes('BUSINESS_OWNED')).length,
    businessClient: pages.filter((page) => page.sources.includes('BUSINESS_CLIENT')).length
  };
}

export function publicCatalogPage(page) {
  return {
    id: page.id,
    name: page.name,
    sources: [...page.sources],
    canAdvertise: page.canAdvertise,
    unavailableReason: page.unavailableReason
  };
}
```

- [ ] **Step 4: Run the catalog tests and confirm they pass**

Run: `node --test test/page-catalog.test.js`

Expected: PASS with 3 tests and no token string in serialized output.

---

### Task 2: Graph Discovery and OAuth Scope

**Files:**
- Modify: `src/meta-client.js:1`
- Modify: `src/meta-client.js:24`
- Modify: `src/meta-client.js:65`
- Modify: `src/meta-client.js:209`
- Modify: `test/meta-client.test.js:6`
- Modify: `test/meta-client.test.js:16`
- Modify: `test/meta-client.test.js:38`

**Interfaces:**
- Consumes: `mergePageCatalog(sourceGroups)` and `catalogCounts(pages)` from Task 1.
- Produces: `metaClient.listPageCatalog(token, adAccountId): Promise<{ pages: CatalogPage[], discovery: PageDiscovery }>`.
- `PageDiscovery` is `{ requiresBusinessReconnect: boolean, warnings: string[], counts: PageCounts }`.
- Existing `listPages` now preserves `tasks`; existing `listPromotablePages` uses the paged edge and still returns Page records without tokens.

- [ ] **Step 1: Extend OAuth and pagination tests so they fail against the current client**

```js
test('Meta OAuth authorisation URL requests Business Portfolio access', () => {
  const client = createMetaClient(testConfig(), { fetchImpl: async () => undefined });
  const scope = new URL(client.createAuthorizationUrl('state-123')).searchParams.get('scope');
  assert.match(scope, /business_management/);
});

// Update the existing listPages assertion because task signals are now retained server-side.
assert.deepEqual(pages, [{ id: 'page_1', name: 'Page 1', tasks: ['ADVERTISE'] }]);

// Update the existing promotable Page mock because the client now reads the paged edge.
if (target.includes('/act_1/promote_pages')) {
  return Response.json({ data: [{ id: 'page-1', name: 'LG Clinic' }] });
}

test('loads every Page source through paging.next and merges the catalog', async () => {
  const requests = [];
  const client = createMetaClient(testConfig(), {
    fetchImpl: async (url) => {
      const target = String(url);
      requests.push(target);
      if (target.includes('/act_1/promote_pages')) {
        return Response.json({
          data: [{ id: 'page-1', name: 'Promotable' }],
          paging: { next: 'https://graph.test/promote-next' }
        });
      }
      if (target === 'https://graph.test/promote-next') {
        return Response.json({ data: [{ id: 'page-2', name: 'Second' }] });
      }
      if (target.includes('/me/accounts')) {
        return Response.json({
          data: [{ id: 'page-2', name: 'Second', tasks: ['ADVERTISE'] }],
          paging: { next: 'https://graph.test/accounts-next' }
        });
      }
      if (target === 'https://graph.test/accounts-next') {
        return Response.json({ data: [{ id: 'page-5', name: 'Managed next', tasks: ['ADVERTISE'] }] });
      }
      if (target.includes('/me/businesses')) {
        return Response.json({
          data: [{ id: 'business-1', name: 'Portfolio 1' }],
          paging: { next: 'https://graph.test/businesses-next' }
        });
      }
      if (target === 'https://graph.test/businesses-next') {
        return Response.json({ data: [{ id: 'business-2', name: 'Portfolio 2' }] });
      }
      if (target.includes('/business-1/owned_pages')) {
        return Response.json({
          data: [{ id: 'page-3', name: 'Owned', tasks: ['MANAGE'] }],
          paging: { next: 'https://graph.test/owned-next' }
        });
      }
      if (target === 'https://graph.test/owned-next') {
        return Response.json({ data: [{ id: 'page-6', name: 'Owned next', tasks: ['MANAGE'] }] });
      }
      if (target.includes('/business-1/client_pages')) {
        return Response.json({
          data: [{ id: 'page-4', name: 'Client', tasks: [] }],
          paging: { next: 'https://graph.test/client-next' }
        });
      }
      if (target === 'https://graph.test/client-next') {
        return Response.json({ data: [{ id: 'page-7', name: 'Client next', tasks: [] }] });
      }
      if (target.includes('/business-2/owned_pages') || target.includes('/business-2/client_pages')) {
        return Response.json({ data: [] });
      }
      throw new Error(`Unexpected URL: ${target}`);
    }
  });

  const result = await client.listPageCatalog('token', 'act_1');

  assert.deepEqual(result.pages.map((page) => page.id).sort(), [
    'page-1', 'page-2', 'page-3', 'page-4', 'page-5', 'page-6', 'page-7'
  ]);
  assert.deepEqual(result.pages.find((page) => page.id === 'page-2').sources, ['PROMOTABLE', 'MANAGED']);
  assert.equal(result.pages.find((page) => page.id === 'page-4').canAdvertise, false);
  assert.equal(result.discovery.requiresBusinessReconnect, false);
  for (const nextUrl of [
    'https://graph.test/promote-next',
    'https://graph.test/accounts-next',
    'https://graph.test/businesses-next',
    'https://graph.test/owned-next',
    'https://graph.test/client-next'
  ]) {
    assert.equal(requests.filter((url) => url === nextUrl).length, 1);
  }
});

test('returns a partial catalog when Business permission is missing', async () => {
  const client = createMetaClient(testConfig(), {
    fetchImpl: async (url) => {
      const target = String(url);
      if (target.includes('/me/businesses')) {
        return Response.json({ error: { message: '(#100) Missing Permission', code: 100 } }, { status: 400 });
      }
      if (target.includes('/act_1/promote_pages')) {
        return Response.json({ data: [{ id: 'page-1', name: 'Promotable' }] });
      }
      if (target.includes('/me/accounts')) {
        return Response.json({ data: [{ id: 'page-2', name: 'Managed', tasks: ['ADVERTISE'] }] });
      }
      throw new Error(`Unexpected URL: ${target}`);
    }
  });

  const result = await client.listPageCatalog('token', 'act_1');
  assert.deepEqual(result.pages.map((page) => page.id), ['page-2', 'page-1']);
  assert.equal(result.discovery.requiresBusinessReconnect, true);
  assert.match(result.discovery.warnings[0], /Business Portfolio/);
});
```

- [ ] **Step 2: Run the Meta client tests and verify scope/catalog assertions fail**

Run: `node --test test/meta-client.test.js`

Expected: FAIL because `business_management` and `listPageCatalog` are absent and `listPromotablePages` does not use the paged edge.

- [ ] **Step 3: Add the catalog imports, OAuth scope, and paged Page methods**

```js
import { catalogCounts, mergePageCatalog } from './page-catalog.js';

const scopes = [
  'ads_read',
  'ads_management',
  'pages_show_list',
  'pages_read_engagement',
  'pages_manage_ads',
  'business_management'
];

async function fetchManagedPages(fetchImpl, graphBaseUrl, token) {
  const pages = await requestPaged(fetchImpl, `${graphBaseUrl}/me/accounts`, {
    fields: 'id,name,tasks',
    limit: '100'
  }, token);
  return pages.map(({ id, name, tasks = [] }) => ({ id, name, tasks }));
}

async function fetchPromotablePages(fetchImpl, graphBaseUrl, token, adAccountId) {
  const pages = await requestPaged(fetchImpl, `${graphBaseUrl}/${adAccountId}/promote_pages`, {
    fields: 'id,name',
    limit: '100'
  }, token);
  return pages.map(({ id, name }) => ({ id, name }));
}
```

Wire `listPages` and `listPromotablePages` to these helpers so both public methods and catalog discovery share the same pagination behavior.

- [ ] **Step 4: Implement Business Portfolio discovery with permission recovery**

```js
async function fetchBusinessPages(fetchImpl, graphBaseUrl, token) {
  let businesses;
  try {
    businesses = await requestPaged(fetchImpl, `${graphBaseUrl}/me/businesses`, {
      fields: 'id,name',
      limit: '100'
    }, token);
  } catch (error) {
    if (!isMissingBusinessPermission(error)) throw error;
    return {
      ownedPages: [],
      clientPages: [],
      requiresBusinessReconnect: true,
      warnings: ['Kết nối lại Meta để tải Page trong Business Portfolio']
    };
  }

  const ownedPages = [];
  const clientPages = [];
  const warnings = [];
  await Promise.all(businesses.map(async (business) => {
    const edges = await Promise.allSettled([
      requestPaged(fetchImpl, `${graphBaseUrl}/${business.id}/owned_pages`, {
        fields: 'id,name,tasks', limit: '100'
      }, token),
      requestPaged(fetchImpl, `${graphBaseUrl}/${business.id}/client_pages`, {
        fields: 'id,name,tasks', limit: '100'
      }, token)
    ]);
    if (edges[0].status === 'fulfilled') ownedPages.push(...edges[0].value);
    else warnings.push(`Không tải được Page sở hữu của ${business.name ?? business.id}`);
    if (edges[1].status === 'fulfilled') clientPages.push(...edges[1].value);
    else warnings.push(`Không tải được Page đối tác của ${business.name ?? business.id}`);
  }));

  return { ownedPages, clientPages, requiresBusinessReconnect: false, warnings };
}

function isMissingBusinessPermission(error) {
  return [100, 200].includes(Number(error?.meta?.code))
    && /permission|business_management/i.test(String(error?.message ?? error?.meta?.message ?? ''));
}
```

- [ ] **Step 5: Expose the merged `listPageCatalog` result**

```js
async listPageCatalog(token, adAccountId) {
  const [promotablePages, managedPages, businessPages] = await Promise.all([
    fetchPromotablePages(fetchImpl, graphBaseUrl, token, adAccountId),
    fetchManagedPages(fetchImpl, graphBaseUrl, token),
    fetchBusinessPages(fetchImpl, graphBaseUrl, token)
  ]);
  const pages = mergePageCatalog({
    PROMOTABLE: promotablePages,
    MANAGED: managedPages,
    BUSINESS_OWNED: businessPages.ownedPages,
    BUSINESS_CLIENT: businessPages.clientPages
  });
  return {
    pages,
    discovery: {
      requiresBusinessReconnect: businessPages.requiresBusinessReconnect,
      warnings: businessPages.warnings,
      counts: catalogCounts(pages)
    }
  };
}
```

- [ ] **Step 6: Add per-Business recovery and fatal base-source tests**

Add a fixture where `owned_pages` returns a Graph error and `client_pages` succeeds, then assert the client Page is returned and `discovery.warnings` has one entry.

```js
assert.deepEqual(result.pages.map((page) => page.id), ['client-page']);
assert.equal(result.discovery.requiresBusinessReconnect, false);
assert.equal(result.discovery.warnings.length, 1);
```

Add this test for the two fatal base sources:

```js
test('fails discovery when a base Page source fails', async () => {
  for (const failingPath of ['/act_1/promote_pages', '/me/accounts']) {
    const client = createMetaClient(testConfig(), {
      fetchImpl: async (url) => {
        const target = String(url);
        if (target.includes(failingPath)) {
          return Response.json({
            error: { message: 'base source unavailable', code: 2 }
          }, { status: 500 });
        }
        return Response.json({ data: [] });
      }
    });

    await assert.rejects(
      () => client.listPageCatalog('token', 'act_1'),
      /base source unavailable/
    );
  }
});
```

- [ ] **Step 7: Run all Page discovery client tests**

Run: `node --test test/meta-client.test.js test/page-catalog.test.js`

Expected: PASS; all Graph requests use GET with bearer authorization and no returned Page contains `access_token`.

---

### Task 3: Server Resource and Authorization Boundaries

**Files:**
- Modify: `src/server.js:16`
- Modify: `src/server.js:172`
- Modify: `src/server.js:244`
- Modify: `src/server.js:394`
- Modify: `src/server.js:484`
- Modify: `test/auth-routes.test.js:66`
- Modify: `test/conversation-template-routes.test.js:18`
- Modify: `test/publish-routes.test.js:99`

**Interfaces:**
- Consumes: `metaClient.listPageCatalog(token, adAccountId)` from Task 2 and `publicCatalogPage(page)` from Task 1.
- Produces: `/api/ad-account-resources` response `{ pages: PublicCatalogPage[], pageDiscovery: PageDiscovery, customAudiences }`.
- Produces: `authorizeAdvertisablePage(...)` for all conversation-template routes.
- Produces: `pageAuthorizationIssues(draft, pages)` for publish preflight; each issue uses `campaigns.{campaignIndex}.adSets.{adSetIndex}.pageId`.

- [ ] **Step 1: Replace the resource-route fixture with the merged response and run it red**

```js
metaClient: {
  listPageCatalog: async (token, accountId) => {
    calls.push({ type: 'pages', token, accountId });
    return {
      pages: [{
        id: 'page-1',
        name: 'LG Clinic',
        sources: ['MANAGED'],
        tasks: ['ADVERTISE'],
        canAdvertise: true,
        unavailableReason: null
      }],
      discovery: {
        requiresBusinessReconnect: true,
        warnings: ['Kết nối lại Meta để tải Page trong Business Portfolio'],
        counts: {
          total: 1,
          available: 1,
          unavailable: 0,
          promotable: 0,
          managed: 1,
          businessOwned: 0,
          businessClient: 0
        }
      }
    };
  },
  listCustomAudiences: async (token, accountId) => {
    calls.push({ type: 'audiences', token, accountId });
    return [{ id: 'ca-1', name: 'Đã nhắn tin', subtype: 'ENGAGEMENT' }];
  }
}
```

Assert that the response includes `pageDiscovery`, includes no `tasks`, and does not include `EAAG-secret-token`.

Run: `node --test test/auth-routes.test.js`

Expected: FAIL because the route still calls `listPromotablePages` and omits discovery metadata.

- [ ] **Step 2: Return the sanitized merged catalog from the resource route**

```js
import { publicCatalogPage } from './page-catalog.js';

const [pageCatalog, customAudiences] = await Promise.all([
  metaClient.listPageCatalog(token, adAccountId),
  metaClient.listCustomAudiences(token, adAccountId)
]);
sendJson(response, 200, {
  pages: pageCatalog.pages.map(publicCatalogPage),
  pageDiscovery: pageCatalog.discovery,
  customAudiences
});
```

- [ ] **Step 3: Change conversation-template tests to authorize any eligible catalog source**

In `connectedFixture`, replace `listPromotablePages` with this exact stub:

```js
listPageCatalog: async (token, adAccountId) => {
  assert.equal(token, 'EAAG-secret-token');
  assert.equal(adAccountId, 'act_1');
  return {
    pages: pages.map((page) => ({
      sources: ['MANAGED'],
      tasks: ['ADVERTISE'],
      canAdvertise: true,
      unavailableReason: null,
      ...page
    })),
    discovery: { requiresBusinessReconnect: false, warnings: [], counts: {} }
  };
}
```

Add an inaccessible fixture with `{ id: 'page-1', name: 'LG Clinic', canAdvertise: false }` and assert status `403`.

Run: `node --test test/conversation-template-routes.test.js`

Expected: FAIL until server authorization uses `listPageCatalog` and checks `canAdvertise`.

- [ ] **Step 4: Replace template authorization with catalog authorization**

```js
async function authorizeAdvertisablePage({ response, connection, input, config, metaClient }) {
  if (!isAdAccountId(input.adAccountId)) {
    sendJson(response, 400, { error: 'Tài khoản quảng cáo không hợp lệ' });
    return false;
  }
  if (typeof input.pageId !== 'string' || !/^[A-Za-z0-9_-]+$/.test(input.pageId)) {
    sendJson(response, 400, { error: 'Facebook Page không hợp lệ' });
    return false;
  }
  const token = decryptToken(connection.accessTokenCiphertext, config.tokenEncryptionKey);
  const catalog = await metaClient.listPageCatalog(token, input.adAccountId);
  const page = catalog.pages.find((entry) => entry.id === input.pageId);
  if (!page?.canAdvertise) {
    sendJson(response, 403, {
      error: page?.unavailableReason ?? 'Page không còn nằm trong danh sách có thể quảng cáo'
    });
    return false;
  }
  return true;
}
```

Update both collection and item routes to call `authorizeAdvertisablePage`.

- [ ] **Step 5: Write a publish-preflight test that proves zero writes occur**

```js
test('rejects an unavailable Ad Set Page before every Meta write', async (context) => {
  const config = testConfig();
  let metaWrites = 0;
  let runsCreated = 0;
  const server = createServer({
    config,
    db: {
      createSession: () => ({ id: 'new-session' }),
      getSession: () => ({ id: 'session-user', metaUserId: 'meta-user-1' }),
      getConnection: () => ({
        accessTokenCiphertext: encryptToken('EAAG-token', config.tokenEncryptionKey)
      }),
      getMedia: () => ({
        id: 'media-1', ownerMetaUserId: 'meta-user-1', mimeType: 'image/jpeg',
        name: 'creative.jpg', content: Buffer.from('image bytes')
      }),
      createRun: () => { runsCreated += 1; return { id: 'run-1' }; }
    },
    metaClient: new Proxy({
      listPageCatalog: async () => ({
        pages: [{ id: 'page_1', name: 'Page', canAdvertise: false }],
        discovery: { requiresBusinessReconnect: false, warnings: [], counts: {} }
      })
    }, {
      get(target, property) {
        if (property in target) return target[property];
        return async () => { metaWrites += 1; };
      }
    })
  });
  context.after(() => server.close());

  const session = signSession('session-user', config.sessionSecret);
  const response = await request(server, '/api/runs', {
    method: 'POST',
    headers: {
      cookie: `meta_ads_session=${encodeURIComponent(session)}`,
      'content-type': 'application/json'
    },
    body: JSON.stringify(draft)
  });

  assert.equal(response.status, 403);
  assert.equal(response.body.errors[0].path, 'campaigns.0.adSets.0.pageId');
  assert.equal(runsCreated, 0);
  assert.equal(metaWrites, 0);
});
```

- [ ] **Step 6: Add publish Page issue generation before `createRun`**

```js
function pageAuthorizationIssues(draft, pages) {
  const availablePageIds = new Set(
    pages.filter((page) => page.canAdvertise).map((page) => page.id)
  );
  const issues = [];
  draft.campaigns.forEach((campaign, campaignIndex) => {
    campaign.adSets.forEach((adSet, adSetIndex) => {
      if (!availablePageIds.has(adSet.pageId)) {
        issues.push({
          path: `campaigns.${campaignIndex}.adSets.${adSetIndex}.pageId`,
          message: 'Page không còn đủ quyền tạo quảng cáo; hãy chọn Page khác'
        });
      }
    });
  });
  return issues;
}
```

Inside `handleRunCreation`, decrypt the token and call `listPageCatalog` after local draft/media validation but before `db.createRun(...)`. Return `403` with `{ errors: pageIssues }` when any issue exists. Keep the existing `publishDraft` call unchanged so all created Meta objects remain `PAUSED`.

- [ ] **Step 7: Update the successful publish fixture and run server tests**

Add `listPageCatalog: async () => ({ pages: [{ id: 'page_1', canAdvertise: true }], discovery: { requiresBusinessReconnect: false, warnings: [], counts: {} } })` to the valid publish test.

Run: `node --test test/auth-routes.test.js test/conversation-template-routes.test.js test/publish-routes.test.js`

Expected: PASS; denied Page test has `runsCreated === 0` and `metaWrites === 0`.

---

### Task 4: Browser State and Searchable Page Selector

**Files:**
- Modify: `public/state.js:57`
- Modify: `public/state.js:268`
- Modify: `public/app.js:229`
- Modify: `public/app.js:374`
- Modify: `public/app.js:663`
- Modify: `public/app.js:829`
- Modify: `public/workspace.js:226`
- Modify: `public/workspace.js:712`
- Modify: `public/app.css:567`
- Modify: `test/client-state.test.js:3`
- Modify: `test/workspace.test.js:6`

**Interfaces:**
- Consumes: browser-safe `pages` and `pageDiscovery` returned by Task 3.
- Produces: `preserveSelectedPages(nextPages, previousPages, adSets): PublicCatalogPage[]` and `pageCatalogIssues(draft, pages, loaded): ValidationIssue[]` from `public/state.js`.
- Produces: Page picker markup with `data-role="page-query"`, two `<optgroup>` elements, disabled unavailable options, summary counts, and `/api/auth/meta/start` reconnect link.

- [ ] **Step 1: Write state tests for preservation and publish blocking**

Extend the import list in `test/client-state.test.js`, then add:

```js
test('preserves a selected Page that disappears and marks it unavailable', () => {
  const adSets = [{ pageId: 'old-page' }];
  const pages = preserveSelectedPages(
    [{ id: 'new-page', name: 'New Page', canAdvertise: true }],
    [{ id: 'old-page', name: 'Old Page', canAdvertise: true }],
    adSets
  );

  assert.deepEqual(pages.find((page) => page.id === 'old-page'), {
    id: 'old-page',
    name: 'Old Page',
    sources: [],
    canAdvertise: false,
    unavailableReason: 'Page không còn trong catalog mới; hãy chọn Page khác'
  });
});

test('creates path-based issues for missing or unavailable selected Pages', () => {
  const state = createWorkspaceState({
    randomId: idSequence('campaign-1', 'adset-1', 'ad-1')
  });
  state.draft.campaigns[0].adSets[0].pageId = 'locked-page';

  assert.deepEqual(pageCatalogIssues(state.draft, [{
    id: 'locked-page', name: 'Locked', canAdvertise: false
  }], true), [{
    path: 'campaigns.0.adSets.0.pageId',
    message: 'Page không đủ quyền tạo quảng cáo; hãy chọn Page khác'
  }]);
  assert.deepEqual(pageCatalogIssues(state.draft, [], false), []);
});
```

Run: `node --test test/client-state.test.js`

Expected: FAIL because both helpers are absent.

- [ ] **Step 2: Add Page discovery defaults and pure state helpers**

```js
resources: {
  adAccounts: [],
  pages: [],
  pageDiscovery: {
    loaded: false,
    requiresBusinessReconnect: false,
    warnings: [],
    counts: {
      total: 0, available: 0, unavailable: 0, promotable: 0,
      managed: 0, businessOwned: 0, businessClient: 0
    }
  },
  customAudiences: [],
  targetingResults: [],
  locationResults: [],
  conversationTemplatesByPage: {}
},
ui: {
  treeOpen: false,
  reviewOpen: false,
  pageQuery: '',
  targetingCategory: 'interest',
  targetingQuery: '',
  locationSelectionSide: 'include',
  locationQuery: '',
  loadingAccountResources: false,
  searchingTargeting: false,
  searchingLocations: false,
  loadingConversationTemplates: false
}
```

```js
export function preserveSelectedPages(nextPages, previousPages, adSets) {
  const merged = [...nextPages];
  const nextIds = new Set(merged.map((page) => page.id));
  const previousById = new Map(previousPages.map((page) => [page.id, page]));
  for (const pageId of new Set(adSets.map((adSet) => adSet.pageId).filter(Boolean))) {
    if (nextIds.has(pageId)) continue;
    const previous = previousById.get(pageId);
    if (!previous) continue;
    merged.push({
      id: previous.id,
      name: previous.name,
      sources: [],
      canAdvertise: false,
      unavailableReason: 'Page không còn trong catalog mới; hãy chọn Page khác'
    });
  }
  return merged;
}

export function pageCatalogIssues(draft, pages, loaded) {
  if (!loaded) return [];
  const availableIds = new Set(pages.filter((page) => page.canAdvertise).map((page) => page.id));
  const issues = [];
  draft.campaigns.forEach((campaign, campaignIndex) => {
    campaign.adSets.forEach((adSet, adSetIndex) => {
      if (adSet.pageId && !availableIds.has(adSet.pageId)) {
        issues.push({
          path: `campaigns.${campaignIndex}.adSets.${adSetIndex}.pageId`,
          message: 'Page không đủ quyền tạo quảng cáo; hãy chọn Page khác'
        });
      }
    });
  });
  return issues;
}
```

- [ ] **Step 3: Write renderer tests for grouped options, search, disabled state, and reconnect**

Update the workspace fixture with `pageQuery` and `pageDiscovery`, then add:

```js
test('groups available and unavailable Pages and shows reconnect guidance', () => {
  const state = workspaceFixture({ selectedClientId: 'adset-1' });
  state.resources.pages = [
    { id: 'page-1', name: 'LG Clinic', sources: ['MANAGED'], canAdvertise: true, unavailableReason: null },
    { id: 'page-2', name: 'Locked Page', sources: ['BUSINESS_CLIENT'], canAdvertise: false, unavailableReason: 'Meta chưa trả quyền tạo quảng cáo cho Page này' }
  ];
  state.resources.pageDiscovery = {
    loaded: true,
    requiresBusinessReconnect: true,
    warnings: ['Kết nối lại Meta để tải Page trong Business Portfolio'],
    counts: { total: 2, available: 1, unavailable: 1, promotable: 0, managed: 1, businessOwned: 0, businessClient: 1 }
  };

  const html = renderWorkspace(state);
  assert.match(html, /Có thể dùng để quảng cáo/);
  assert.match(html, /Chưa đủ quyền/);
  assert.match(html, /value="page-2"[^>]*disabled/);
  assert.match(html, /1 Page khả dụng · 1 Page cần quyền/);
  assert.match(html, /Nguồn: 0 quảng bá · 1 quản lý · 0 Business sở hữu · 1 Business đối tác/);
  assert.match(html, /href="\/api\/auth\/meta\/start"/);
});

test('Page search hides nonmatches but keeps the selected Page visible', () => {
  const state = workspaceFixture({ selectedClientId: 'adset-1' });
  state.ui.pageQuery = 'không khớp';
  state.resources.pages = [
    { id: 'page-1', name: 'LG Clinic', canAdvertise: true },
    { id: 'page-2', name: 'Khác', canAdvertise: true }
  ];

  const html = renderWorkspace(state);
  assert.doesNotMatch(html, /value="page-1"[^>]*hidden/);
  assert.match(html, /value="page-2"[^>]*hidden/);
});
```

Run: `node --test test/workspace.test.js`

Expected: FAIL because the current editor has only a flat select.

- [ ] **Step 4: Render the Page picker as one focused helper**

Replace the Page `<label>` in `renderAdSetEditor` with `${pagePicker(state, adSet)}` and add:

```js
function pagePicker(state, adSet) {
  const pages = state.resources.pages ?? [];
  const query = String(state.ui?.pageQuery ?? '').trim().toLocaleLowerCase('vi');
  const visible = (page) => page.id === adSet.pageId
    || !query
    || page.name.toLocaleLowerCase('vi').includes(query);
  const available = pages.filter((page) => page.canAdvertise !== false);
  const unavailable = pages.filter((page) => page.canAdvertise === false);
  const counts = state.resources.pageDiscovery?.counts ?? {
    available: available.length,
    unavailable: unavailable.length
  };
  return `
    <div class="field page-picker" data-page-picker>
      <span class="field-label">Facebook Page</span>
      <input type="search" data-role="page-query" value="${escapeHtml(state.ui?.pageQuery ?? '')}" placeholder="Tìm theo tên Page" aria-label="Tìm Facebook Page" />
      <select data-client-id="${escapeHtml(adSet.clientId)}" data-field="pageId" ${state.ui?.loadingAccountResources ? 'disabled' : ''}>
        <option value="">${state.ui?.loadingAccountResources ? 'Đang tải Page...' : 'Chọn Page có thể quảng cáo'}</option>
        ${pageOptionGroup('Có thể dùng để quảng cáo', available, adSet.pageId, visible)}
        ${pageOptionGroup('Chưa đủ quyền', unavailable, adSet.pageId, visible, true)}
      </select>
      <small class="page-summary">${counts.available ?? available.length} Page khả dụng · ${counts.unavailable ?? unavailable.length} Page cần quyền</small>
      <small class="page-source-summary">Nguồn: ${counts.promotable ?? 0} quảng bá · ${counts.managed ?? 0} quản lý · ${counts.businessOwned ?? 0} Business sở hữu · ${counts.businessClient ?? 0} Business đối tác</small>
      ${state.resources.pageDiscovery?.requiresBusinessReconnect ? `
        <div class="page-reconnect-warning">
          <span>Kết nối lại Meta để tải Page trong Business Portfolio.</span>
          <a href="/api/auth/meta/start">Kết nối lại</a>
        </div>` : ''}
    </div>`;
}

function pageOptionGroup(label, pages, selectedId, visible, disabled = false) {
  if (pages.length === 0) return '';
  return `<optgroup label="${escapeHtml(label)}">${pages.map((page) => {
    const reason = disabled && page.unavailableReason ? ` — ${page.unavailableReason}` : '';
    return `<option value="${escapeHtml(page.id)}"${page.id === selectedId ? ' selected' : ''}${disabled ? ' disabled' : ''}${visible(page) ? '' : ' hidden'}>${escapeHtml(`${page.name}${reason}`)}</option>`;
  }).join('')}</optgroup>`;
}
```

- [ ] **Step 5: Store discovery data and filter option elements without a full editor rerender**

Add `preserveSelectedPages` and `pageCatalogIssues` to the `public/state.js` import list. In the `input` handler, place this branch before generic field handling:

```js
if (control.matches('[data-role="page-query"]')) {
  state.ui.pageQuery = control.value;
  filterPagePicker(control.closest('[data-page-picker]'), control.value);
  return;
}
```

```js
function filterPagePicker(picker, query) {
  if (!picker) return;
  const normalizedQuery = query.trim().toLocaleLowerCase('vi');
  const select = picker.querySelector('[data-field="pageId"]');
  for (const option of select?.querySelectorAll('option[value]') ?? []) {
    if (!option.value) continue;
    const matches = !normalizedQuery
      || option.textContent.toLocaleLowerCase('vi').includes(normalizedQuery);
    option.hidden = option.selected ? false : !matches;
  }
  for (const group of select?.querySelectorAll('optgroup') ?? []) {
    group.hidden = ![...group.querySelectorAll('option')].some((option) => !option.hidden);
  }
}
```

Update resource loading exactly in this order so selected Page names can be preserved:

```js
const previousPages = state.resources.pages;
const payload = await api.loadAdAccountResources(state.draft.adAccountId);
state.resources.pages = preserveSelectedPages(
  payload.pages ?? [],
  previousPages,
  allAdSets()
);
state.resources.pageDiscovery = {
  loaded: true,
  requiresBusinessReconnect: false,
  warnings: [],
  counts: {},
  ...(payload.pageDiscovery ?? {})
};
state.resources.customAudiences = payload.customAudiences ?? [];
```

On resource-load failure and in `clearAccountScopedSelections`, reset `pageDiscovery.loaded` to `false` and reset all counts to zero. Change `applyOnlyPageToAdSets` to auto-select only when exactly one `page.canAdvertise === true` exists.

- [ ] **Step 6: Combine schema and catalog issues in browser validation**

```js
const schemaIssues = payload.errors ?? [];
const permissionIssues = pageCatalogIssues(
  state.draft,
  state.resources.pages,
  state.resources.pageDiscovery?.loaded === true
);
state.issues = [...schemaIssues, ...permissionIssues];
render();
return state.issues.length === 0;
```

Apply the same merge in the API error branch when `error.payload.errors` is an array. This blocks the topbar publish button immediately after discovery while Task 3 remains the authoritative server check.

- [ ] **Step 7: Add focused Page picker styles**

```css
.page-picker {
  display: grid;
  gap: 8px;
}

.page-picker input[type="search"] {
  width: 100%;
}

.page-picker optgroup {
  font-weight: 700;
}

.page-picker option:disabled {
  color: var(--color-muted);
}

.page-summary,
.page-source-summary {
  color: var(--color-muted);
}

.page-reconnect-warning {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 12px;
  border: 1px solid color-mix(in srgb, var(--color-warning) 28%, transparent);
  border-radius: 8px;
  background: var(--color-warning-soft);
  color: var(--color-warning);
}

.page-reconnect-warning a {
  flex: none;
  font-weight: 700;
}
```

- [ ] **Step 8: Run browser-state and renderer tests**

Run: `node --test test/client-state.test.js test/workspace.test.js`

Expected: PASS; the selected Page remains visible under a nonmatching query and every unavailable Page option is disabled.

---

### Task 5: Documentation and End-to-End Verification

**Files:**
- Modify: `README.md`
- Verify: `src/publisher.js`
- Verify: `public/app.js`
- Verify: `public/workspace.js`

**Interfaces:**
- Consumes: completed server and browser behavior from Tasks 1–4.
- Produces: operator guidance for reconnecting Meta and a verified local Page-discovery flow with no Meta writes.

- [ ] **Step 1: Document the Page sources and reconnect behavior**

Add this operational section to `README.md`:

```markdown
### Facebook Page discovery

The Page selector merges all paginated results from:

- `/{ad_account_id}/promote_pages`
- `/me/accounts`
- `/me/businesses` → `owned_pages` and `client_pages`

OAuth requests `business_management` for Business Portfolio discovery. Existing tokens must reconnect through **Kết nối lại Meta** before Business-owned and client Pages can appear. If Meta does not grant that scope, the app continues with promotable and user-managed Pages and displays a partial-catalog warning.

Pages without a current advertising permission signal remain visible but disabled. Conversation templates and publish both reload the server-side catalog; browser state is never accepted as proof of Page permission.
```

- [ ] **Step 2: Run the focused feature suite**

Run:

```powershell
node --test `
  test/page-catalog.test.js `
  test/meta-client.test.js `
  test/auth-routes.test.js `
  test/conversation-template-routes.test.js `
  test/publish-routes.test.js `
  test/client-state.test.js `
  test/workspace.test.js
```

Expected: PASS with no skipped or failed tests.

- [ ] **Step 3: Run the full regression suite**

Run: `npm.cmd test`

Expected: PASS for every repository test. Do not change unrelated failures; report them with the exact test name if encountered.

- [ ] **Step 4: Verify PAUSED write safety statically**

Run:

```powershell
rg -n "status.*PAUSED|set\('status', 'PAUSED'\)|status: 'PAUSED'" src test
rg -n "listPageCatalog|promote_pages|owned_pages|client_pages|me/accounts" src
```

Expected: campaign, Ad Set, creative-related write flow, and Ad creation continue to use `PAUSED`; discovery functions call only read helpers.

- [ ] **Step 5: Restart the local server and verify the partial catalog safely**

Run:

```powershell
$listener = Get-NetTCPConnection -LocalPort 3001 -State Listen -ErrorAction SilentlyContinue
if ($listener) { Stop-Process -Id $listener.OwningProcess -Force }
$process = Start-Process -FilePath node -ArgumentList '--env-file=.env','src/server.js' -WorkingDirectory 'D:\Advertising-Campaign' -WindowStyle Hidden -PassThru
Invoke-RestMethod 'http://localhost:3001/health'
```

Expected: `{ ok: true }` and a new process listening on port `3001`.

Open `http://localhost:3001/` in the in-app browser, select `act_61724586`, and verify without pressing the publish button:

1. Before reconnect, the selector contains the deduplicated union of the known 4 `PROMOTABLE` and 12 `MANAGED` Pages.
2. The selector shows `Kết nối lại Meta để tải Page trong Business Portfolio` while the current token lacks `business_management`.
3. Searching by a known Page name filters options without moving the Ad Set editor to the top.
4. The selected Page remains selected when the query does not match its name.
5. Unavailable Pages are visible under **Chưa đủ quyền** and cannot be selected.
6. Do not click `Kiểm tra & tạo ở PAUSED`; this verification must remain read-only.

- [ ] **Step 6: Reconnect once and verify Business Portfolio expansion**

Use the UI reconnect link, approve `business_management`, return to the editor, and select the same ad account. Verify that `requiresBusinessReconnect` disappears when the scope is granted and that any Graph-returned `BUSINESS_OWNED` and `BUSINESS_CLIENT` Pages are merged without duplicate IDs.

If Meta declines the scope, verify the partial catalog remains usable and the reconnect warning remains visible; do not treat this external permission result as an application failure.

- [ ] **Step 7: Record final evidence**

Capture and report:

```text
Focused tests: <passed count>/<total count>
Full tests: <passed count>/<total count>
Health endpoint: ok
Current catalog: <total> total, <available> available, <unavailable> unavailable
Sources: <promotable> promotable, <managed> managed, <businessOwned> business-owned, <businessClient> business-client
Business reconnect required: true|false
Meta writes during verification: 0
```

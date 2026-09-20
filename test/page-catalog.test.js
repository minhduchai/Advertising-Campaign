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
  assert.equal(pages[2].unavailableReason, 'Meta chưa trả quyền tạo quảng cáo cho Page này');
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
  assert.deepEqual(publicCatalogPage(pages.find((page) => page.id === '1')), {
    id: '1',
    name: 'Một',
    sources: ['PROMOTABLE'],
    canAdvertise: true,
    unavailableReason: null
  });
  assert.doesNotMatch(JSON.stringify(publicCatalogPage(pages.find((page) => page.id === '1'))), /access_token|tasks/);
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

test('marks a Page restricted when Meta returns a promotion ineligible reason', () => {
  const [page] = mergePageCatalog({
    MANAGED: [{
      id: '112574058348904',
      name: 'LG Clinic',
      tasks: ['ADVERTISE'],
      promotion_ineligible_reason: 'Page bị hạn chế quảng cáo'
    }]
  });

  assert.equal(page.canAdvertise, false);
  assert.equal(page.unavailableReason, 'Page bị hạn chế quảng cáo');
  assert.equal(publicCatalogPage(page).unavailableReason, 'Page bị hạn chế quảng cáo');
});

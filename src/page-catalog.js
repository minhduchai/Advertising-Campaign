const SOURCE_ORDER = ['PROMOTABLE', 'MANAGED', 'BUSINESS_OWNED', 'BUSINESS_CLIENT'];
const ELIGIBILITY_TASKS = new Set([
  'ADVERTISE',
  'PROFILE_PLUS_ADVERTISE',
  'MANAGE',
  'PROFILE_PLUS_MANAGE',
  'PROFILE_PLUS_FULL_CONTROL'
]);
const UNAVAILABLE_REASON = 'Meta chưa trả quyền tạo quảng cáo cho Page này';

function normalizePromotionIneligibleReason(value) {
  if (Array.isArray(value)) return value.filter(Boolean).join(', ');
  if (value && typeof value === 'object') return value.message ?? value.reason ?? JSON.stringify(value);
  return String(value ?? '').trim();
}

export function mergePageCatalog(sourceGroups) {
  const pagesById = new Map();

  for (const source of SOURCE_ORDER) {
    for (const pageInput of sourceGroups[source] ?? []) {
      if (!pageInput?.id) continue;

      let page = pagesById.get(pageInput.id);
      if (!page) {
        page = {
          id: pageInput.id,
          name: pageInput.name,
          sources: [],
          tasks: [],
          promotionIneligibleReason: null,
          canAdvertise: false,
          unavailableReason: null
        };
        pagesById.set(pageInput.id, page);
      }

      if (!page.sources.includes(source)) page.sources.push(source);
      for (const task of pageInput.tasks ?? []) {
        if (!page.tasks.includes(task)) page.tasks.push(task);
      }
      const promotionIneligibleReason = normalizePromotionIneligibleReason(
        pageInput.promotion_ineligible_reason ?? pageInput.promotionIneligibleReason
      );
      if (promotionIneligibleReason) page.promotionIneligibleReason = promotionIneligibleReason;
    }
  }

  return [...pagesById.values()]
    .map((page) => {
      const hasAdvertisingAccess = page.sources.includes('PROMOTABLE') ||
        page.tasks.some((task) => ELIGIBILITY_TASKS.has(task));
      page.canAdvertise = hasAdvertisingAccess && !page.promotionIneligibleReason;
      page.unavailableReason = page.promotionIneligibleReason ||
        (hasAdvertisingAccess ? null : UNAVAILABLE_REASON);
      return page;
    })
    .sort((page, otherPage) => page.name.localeCompare(otherPage.name, 'vi'));
}

export function catalogCounts(pages) {
  return pages.reduce((counts, page) => {
    counts.total += 1;
    counts.available += page.canAdvertise ? 1 : 0;
    counts.unavailable += page.canAdvertise ? 0 : 1;
    counts.promotable += page.sources.includes('PROMOTABLE') ? 1 : 0;
    counts.managed += page.sources.includes('MANAGED') ? 1 : 0;
    counts.businessOwned += page.sources.includes('BUSINESS_OWNED') ? 1 : 0;
    counts.businessClient += page.sources.includes('BUSINESS_CLIENT') ? 1 : 0;
    return counts;
  }, {
    total: 0,
    available: 0,
    unavailable: 0,
    promotable: 0,
    managed: 0,
    businessOwned: 0,
    businessClient: 0
  });
}

export function publicCatalogPage(page) {
  return {
    id: page.id,
    name: page.name,
    sources: page.sources,
    canAdvertise: page.canAdvertise,
    unavailableReason: page.unavailableReason
  };
}

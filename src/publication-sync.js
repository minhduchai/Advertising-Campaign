import { isMetaThrottleError } from './meta-client.js';

const DEFAULT_MAX_GROUPS = 12;
const DEFAULT_CONCURRENCY = 3; // matches PUBLISH_CONCURRENCY default
// Holds a claimed group while one caller looks it up (a lookup gives up after ~11 s), so the web
// routes and the recovery worker never look up the same Post at the same time.
const LOOKUP_LEASE_MS = 60_000;
const MAX_BACKOFF_MS = 60 * 60_000;
const THROTTLE_FALLBACK_MS = 30_000;

// Post ID lookups for the web routes (seeding, history, Workflow) and the recovery worker alike:
// one lookup per creative group, and the durable publication_recovery schedule decides when it is due.
export async function syncRunPublications({
  run,
  token,
  metaClient,
  db,
  maxGroups = DEFAULT_MAX_GROUPS,
  concurrency = DEFAULT_CONCURRENCY,
  now = Date.now
}) {
  const summary = {
    attemptedGroups: 0,
    resolvedGroups: 0,
    pendingGroups: 0,
    errors: []
  };
  const groups = publicationGroups(run);
  if (groups.length === 0) return summary;

  const schedule = new Map((await db.listPublicationLookups(run.id)).map((row) => [row.clientId, row]));
  const due = [];
  for (const group of groups) {
    const resolvedSibling = group.nodes.find(hasCompletePublication);
    if (resolvedSibling) {
      await db.savePublication(run.id, group.nodes.filter((node) => !hasCompletePublication(node)), resolvedSibling);
      summary.resolvedGroups += 1;
    } else if (due.length < maxGroups && group.nodes.some((node) => (schedule.get(node.clientId)?.nextAt ?? 0) <= now())) {
      due.push(group);
    } else {
      summary.pendingGroups += 1;
    }
  }
  const claimed = new Set(due.length === 0 ? [] : await db.claimPublicationLookups(
    run.id,
    due.flatMap((group) => group.nodes.map((node) => node.clientId)),
    { now: now(), leaseUntil: now() + LOOKUP_LEASE_MS }
  ));
  const toAttempt = due.filter((group) => group.nodes.some((node) => claimed.has(node.clientId)));
  summary.pendingGroups += due.length - toAttempt.length;
  summary.attemptedGroups = toAttempt.length;

  // Graph reads dominate; a small pool keeps a 12-group batch well inside the workflow step deadline.
  let throttle = null;
  await Promise.all(Array.from({ length: Math.min(concurrency, toAttempt.length) }, async () => {
    for (let group; !throttle && (group = toAttempt.shift());) await attempt(group);
  }));
  // Groups claimed but not started keep their short lease and are retried after it.
  if (throttle) throw throttle;
  return summary;

  async function attempt(group) {
    const clientIds = group.nodes.map((node) => node.clientId);
    const attempts = 1 + Math.max(0, ...clientIds.map((clientId) => Number(schedule.get(clientId)?.attempts) || 0));
    try {
      const representative = group.nodes.find((node) => node.remoteId);
      const publication = await metaClient.getAdPublication(token, representative.remoteId);
      if (publication?.postId || publication?.permalinkUrl) await db.savePublication(run.id, group.nodes, publication);
      if (hasCompletePublication(publication)) {
        await db.schedulePublicationLookups(run.id, clientIds, { attempts: 0, nextAt: now(), code: null });
        summary.resolvedGroups += 1;
        return;
      }
      await db.schedulePublicationLookups(run.id, clientIds, { attempts, nextAt: now() + backoffMs(attempts), code: null });
    } catch (error) {
      if (isMetaThrottleError(error)) {
        throttle ??= error;
        await reschedule(clientIds, {
          attempts: attempts - 1,
          nextAt: now() + (Number(error.retryAfterMs) || THROTTLE_FALLBACK_MS),
          code: 'throttled'
        });
        return;
      }
      summary.errors.push(publicationError(error));
      await reschedule(clientIds, {
        attempts,
        nextAt: now() + backoffMs(attempts),
        code: String(error?.meta?.code ?? error?.name ?? 'Error')
      });
    }
    summary.pendingGroups += 1;
  }

  // If even this write fails, the lease expires and the group is retried.
  async function reschedule(clientIds, value) {
    try {
      await db.schedulePublicationLookups(run.id, clientIds, value);
    } catch {}
  }
}

function backoffMs(attempts) {
  return Math.min(MAX_BACKOFF_MS, 60_000 * 2 ** Math.min(attempts - 1, 6));
}

function publicationGroups(run) {
  const adsByClientId = snapshotAds(run?.snapshot);
  const groups = new Map();
  for (const node of run?.nodes ?? []) {
    if (node.type !== 'ad' || node.status !== 'created' || !node.remoteId) continue;
    const key = publicationGroupKey(node, adsByClientId.get(node.clientId));
    const group = groups.get(key) ?? { key, nodes: [] };
    group.nodes.push(node);
    groups.set(key, group);
  }
  return [...groups.values()].filter((group) => group.nodes.some((node) => !hasCompletePublication(node)));
}

// Ads share a Post only through the same Meta creative. Without a stored creative ID, fall back to the
// draft's creative group, scoped to the ad account and Page it was published with.
function publicationGroupKey(node, match) {
  if (node.creativeId) return `creative:${node.creativeId}`;
  if (!match) return `ad:${node.clientId}`;
  const { campaign, ad } = match;
  return `group:${JSON.stringify([campaign.adAccountId ?? null, campaign.pageId ?? null, ad.creativeGroupId ?? ad.clientId])}`;
}

function snapshotAds(snapshot) {
  const ads = new Map();
  for (const campaign of snapshot?.campaigns ?? []) {
    for (const adSet of campaign.adSets ?? []) {
      for (const ad of adSet.ads ?? []) {
        ads.set(ad.clientId, { campaign, ad });
      }
    }
  }
  return ads;
}

function hasCompletePublication(value) {
  return Boolean(value?.postId && value?.permalinkUrl);
}

function publicationError(error) {
  const source = error?.meta ?? error ?? {};
  return {
    message: String(source.message ?? error?.message ?? 'Meta chưa trả dữ liệu bài quảng cáo'),
    code: finiteNumberOrNull(source.code),
    subcode: finiteNumberOrNull(source.subcode)
  };
}

function finiteNumberOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

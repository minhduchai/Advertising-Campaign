import { isMetaThrottleError } from './meta-client.js';
import { withErrorContext, recordError } from './error-journal.js';

const DEFAULT_MAX_GROUPS = 12;
const DEFAULT_CONCURRENCY = 3; // matches PUBLISH_CONCURRENCY default
// Holds a claimed group while one caller looks it up (a lookup gives up after ~11 s), so the web
// routes and the recovery worker never look up the same Post at the same time.
const LOOKUP_LEASE_MS = 60_000;
const MAX_BACKOFF_MS = 60 * 60_000;
const THROTTLE_FALLBACK_MS = 30_000;

// Post ID lookups for the web routes (seeding, history, Workflow) and the recovery worker alike:
// one lookup per creative group, and the durable publication_recovery schedule decides when it is due.
export function syncRunPublications(options) {
  return withErrorContext({ runId: options.run.id, ownerMetaUserId: options.run.ownerMetaUserId, secrets: [options.token] },
    () => syncRunPublicationsWithContext(options));
}

async function syncRunPublicationsWithContext({
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
    } else if (groupNextAt(group) > now()) {
      summary.pendingGroups += 1;
      await followGroupSchedule(group);
    } else if (due.length < maxGroups) {
      due.push(group);
    } else {
      summary.pendingGroups += 1;
    }
  }
  const claimed = new Set(due.length === 0 ? [] : await db.claimPublicationLookups(
    run.id,
    due.map((group) => group.scheduleKey),
    { now: now(), leaseUntil: now() + LOOKUP_LEASE_MS }
  ));
  const toAttempt = due.filter((group) => claimed.has(group.scheduleKey));
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
    // Only the stable group key owns the lease; node rows follow it for the recovery worker's per-Ad query.
    const clientIds = [group.scheduleKey, ...group.nodes.map((node) => node.clientId)];
    const attempts = 1 + Math.max(0, ...clientIds.map((clientId) => Number(schedule.get(clientId)?.attempts) || 0));
    try {
      const representative = group.nodes.find((node) => node.remoteId);
      const publication = await withErrorContext({ clientId: representative.clientId, nodeType: 'ad' },
        () => metaClient.getAdPublication(token, representative.remoteId));
      if (publication?.postId || publication?.permalinkUrl) await db.savePublication(run.id, group.nodes, publication);
      if (hasCompletePublication(publication)) {
        // The group keeps its lease: a caller still holding a run read before this save cannot claim it
        // again at once, and once saved the group is no longer missing a Post.
        summary.resolvedGroups += 1;
        return;
      }
      await db.schedulePublicationLookups(run.id, clientIds, { attempts, nextAt: now() + backoffMs(attempts), code: null });
    } catch (error) {
      recordError(error, { stage: 'publication-sync', clientId: group.scheduleKey });
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

  function groupNextAt(group) {
    const shared = schedule.get(group.scheduleKey);
    if (shared) return shared.nextAt;
    // Preserve cooldowns written by the previous per-Ad implementation on first use.
    return Math.max(0, ...group.nodes.map((node) => schedule.get(node.clientId)?.nextAt ?? 0));
  }

  // An Ad created while its group is leased or backing off takes the group's date, so the recovery
  // worker's per-Ad candidate query does not keep picking this run before the group is due.
  async function followGroupSchedule(group) {
    // Old workers only wrote per-Ad rows. Mirror their backoff too, without
    // upserting a group row that another caller may have just leased.
    const shared = schedule.get(group.scheduleKey) ?? {
      nextAt: groupNextAt(group),
      attempts: Math.max(0, ...group.nodes.map((node) => Number(schedule.get(node.clientId)?.attempts) || 0))
    };
    const behind = group.nodes.filter((node) => (schedule.get(node.clientId)?.nextAt ?? 0) < shared.nextAt);
    if (behind.length === 0) return;
    await db.schedulePublicationLookups(run.id, behind.map((node) => node.clientId), {
      attempts: shared.attempts, nextAt: shared.nextAt, code: null
    });
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
  const groups = new Map();
  for (const node of run?.nodes ?? []) {
    if (node.type !== 'ad' || node.status !== 'created' || !node.remoteId) continue;
    // Draft groups can produce different creatives when content changes; adopted
    // Ads without a confirmed creative ID must each resolve their own Post.
    const key = node.creativeId ? `creative:${node.creativeId}` : `ad:${node.clientId}`;
    const group = groups.get(key) ?? { key, scheduleKey: `publication-group:${key}`, nodes: [] };
    group.nodes.push(node);
    groups.set(key, group);
  }
  return [...groups.values()].filter((group) => group.nodes.some((node) => !hasCompletePublication(node)));
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

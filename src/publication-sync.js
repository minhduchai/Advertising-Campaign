import { isMetaThrottleError } from './meta-client.js';

const DEFAULT_MAX_GROUPS = 12;
const DEFAULT_CONCURRENCY = 5; // matches PUBLISH_CONCURRENCY default

export async function syncRunPublications({
  run,
  token,
  metaClient,
  updateNodeResult,
  maxGroups = DEFAULT_MAX_GROUPS,
  concurrency = DEFAULT_CONCURRENCY
}) {
  const groups = publicationGroups(run);
  const summary = {
    attemptedGroups: 0,
    resolvedGroups: 0,
    pendingGroups: 0,
    errors: []
  };

  const toAttempt = [];
  for (const group of groups) {
    const resolvedSibling = group.nodes.find(hasCompletePublication);
    if (resolvedSibling) {
      await updateGroup(run.id, group.nodes, resolvedSibling, updateNodeResult);
      summary.resolvedGroups += 1;
    } else if (toAttempt.length >= maxGroups) {
      summary.pendingGroups += 1;
    } else {
      toAttempt.push(group);
    }
  }
  summary.attemptedGroups = toAttempt.length;

  // Graph reads dominate; a small pool keeps a 12-group batch well inside the workflow step deadline.
  await Promise.all(Array.from({ length: Math.min(concurrency, toAttempt.length) }, async () => {
    for (let group; (group = toAttempt.shift());) await attempt(group);
  }));

  return summary;

  async function attempt(group) {
    try {
      const representative = group.nodes.find((node) => node.remoteId);
      const publication = representative
        ? await metaClient.getAdPublication(token, representative.remoteId)
        : null;
      if (!publication?.postId && !publication?.permalinkUrl) {
        summary.pendingGroups += 1;
        return;
      }
      await updateGroup(run.id, group.nodes, publication, updateNodeResult);
      if (publication.postId && publication.permalinkUrl) {
        summary.resolvedGroups += 1;
      } else {
        summary.pendingGroups += 1;
      }
    } catch (error) {
      if (isMetaThrottleError(error)) throw error;
      summary.pendingGroups += 1;
      summary.errors.push(publicationError(error));
    }
  }
}

function publicationGroups(run) {
  const creativeGroupByClientId = snapshotCreativeGroups(run?.snapshot);
  const groups = new Map();
  for (const node of run?.nodes ?? []) {
    if (node.type !== 'ad' || node.status !== 'created' || !node.remoteId) continue;
    const key = creativeGroupByClientId.get(node.clientId) ?? node.clientId;
    const group = groups.get(key) ?? { key, nodes: [] };
    group.nodes.push(node);
    groups.set(key, group);
  }
  return [...groups.values()].filter((group) => group.nodes.some((node) => !hasCompletePublication(node)));
}

function snapshotCreativeGroups(snapshot) {
  const groups = new Map();
  for (const campaign of snapshot?.campaigns ?? []) {
    for (const adSet of campaign.adSets ?? []) {
      for (const ad of adSet.ads ?? []) {
        groups.set(ad.clientId, ad.creativeGroupId ?? ad.clientId);
      }
    }
  }
  return groups;
}

function hasCompletePublication(value) {
  return Boolean(value?.postId && value?.permalinkUrl);
}

async function updateGroup(runId, nodes, publication, updateNodeResult) {
  for (const node of nodes) {
    const nextNode = {
      ...node,
      postId: publication.postId ?? node.postId ?? null,
      permalinkUrl: publication.permalinkUrl ?? node.permalinkUrl ?? null
    };
    if (nextNode.postId === node.postId && nextNode.permalinkUrl === node.permalinkUrl) continue;
    await updateNodeResult(runId, nextNode);
  }
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

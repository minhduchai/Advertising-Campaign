const terminalNodeStatuses = new Set(['created', 'failed']);
const terminalRunStatuses = new Set(['completed', 'completed_with_errors', 'failed']);
const terminalSeedingStatuses = new Set(['created', 'succeeded', 'failed', 'needs_review', 'cancelled']);
const activeSeedingStatuses = new Set(['pending', 'posting']);
const unknownCampaignId = '__unknown__';
const unknownCampaignName = 'Không xác định';

export function createPublishProgress(draft) {
  const nodes = [];
  for (const campaign of draft.campaigns ?? []) {
    nodes.push(pendingNode(campaign, 'campaign', null));
    for (const adSet of campaign.adSets ?? []) {
      nodes.push(pendingNode(adSet, 'adSet', campaign.clientId));
      for (const ad of adSet.ads ?? []) {
        nodes.push(pendingNode(ad, 'ad', adSet.clientId));
      }
    }
  }
  return recalculate({
    runId: null,
    status: 'preparing',
    total: nodes.length,
    completed: 0,
    percent: 0,
    currentClientId: null,
    error: null,
    seeding: null,
    seedingError: null,
    snapshot: draft,
    nodes,
    overall: null,
    campaigns: []
  });
}

export function applyPublishEvent(progress, event) {
  if (event.runId) progress.runId = event.runId;
  if (event.type === 'run_started') progress.status = 'creating';
  if (event.type === 'node_updated') {
    mergeNode(progress, event.node);
    if (event.node?.status === 'failed') {
      progress.currentClientId = event.node.clientId ?? progress.currentClientId;
      progress.error = normalizeProgressError(event.node.error ?? event.error);
    }
  }
  if (event.type === 'run_completed') {
    mergeRunSnapshot(progress, event);
    const failedNode = progress.nodes.find((node) => node.status === 'failed' || node.error);
    if (failedNode?.error) progress.error = normalizeProgressError(failedNode.error);
  }
  if (event.type === 'run_failed') markPublishFailure(progress, event.error);
  return recalculate(progress);
}

function normalizeProgressError(error) {
  const details = error?.meta ?? error?.error ?? error ?? {};
  if (typeof details === 'string') return { message: details, code: null, subcode: null, fbtraceId: null, type: null };
  return {
    message: details.message ?? 'Không thể hoàn tất bước tạo trên Meta.',
    code: details.code ?? details.errorCode ?? null,
    subcode: details.subcode ?? details.error_subcode ?? details.errorSubcode ?? null,
    fbtraceId: details.fbtraceId ?? details.fbtrace_id ?? null,
    type: details.type ?? details.name ?? null
  };
}

export function mergeRunSnapshot(progress, run) {
  progress.runId = run.id ?? run.runId ?? progress.runId;
  progress.status = run.status ?? progress.status;
  if (run.seeding !== undefined) progress.seeding = run.seeding;
  if (run.snapshot !== undefined) progress.snapshot = run.snapshot;
  for (const node of run.nodes ?? []) mergeNode(progress, node);
  return recalculate(progress);
}

export function markPublishFailure(progress, error) {
  progress.status = 'failed';
  progress.error = normalizeProgressError(error);
  return recalculate(progress);
}

export function isTerminalRunStatus(status) {
  return terminalRunStatuses.has(status);
}

function pendingNode(node, type, parentClientId) {
  return {
    clientId: node.clientId,
    type,
    name: node.name,
    parentClientId,
    status: 'pending'
  };
}

function mergeNode(progress, node) {
  if (!node?.clientId || !node?.type) return;
  let target = progress.nodes.find(
    (entry) => entry.clientId === node.clientId && entry.type === node.type
  );
  if (!target) {
    target = {
      clientId: node.clientId,
      type: node.type,
      name: node.name,
      parentClientId: node.parentClientId ?? null,
      status: 'pending'
    };
    progress.nodes.push(target);
  }
  const draftName = target.name;
  Object.assign(target, node);
  target.name = draftName ?? node.name;
  if (node.status === 'creating') progress.currentClientId = node.clientId;
  if (isPublishNodeComplete(node.status, true) && progress.currentClientId === node.clientId) {
    progress.currentClientId = null;
  }
}

function recalculate(progress) {
  const model = buildProgressModel(progress);
  progress.overall = model.overall;
  progress.campaigns = model.campaigns;
  progress.completed = model.overall.completed;
  progress.total = model.overall.total;
  progress.percent = model.overall.percent;
  return progress;
}

function buildProgressModel(progress) {
  const context = buildCampaignContext(progress.snapshot, progress.nodes);
  const groups = new Map(context.campaigns.map((campaign) => [campaign.clientId, {
    ...campaign,
    publish: [],
    publication: [],
    seeding: []
  }]));

  const unknown = {
    clientId: unknownCampaignId,
    name: unknownCampaignName,
    publish: [],
    publication: [],
    seeding: []
  };
  const campaignFor = (clientId) => groups.get(clientId) ?? unknown;

  for (const node of progress.nodes) {
    const campaignClientId = resolveNodeCampaign(node, context);
    campaignFor(campaignClientId).publish.push({
      complete: isPublishNodeComplete(node.status, isTerminalRunStatus(progress.status)),
      failed: node.status === 'failed' || node.status === 'skipped'
    });
  }

  appendPostWorkflowSteps(progress, context, groups, unknown);

  const campaignModels = [...groups.values()];
  if (unknown.publish.length > 0 || unknown.publication.length > 0 || unknown.seeding.length > 0) campaignModels.push(unknown);
  const campaignSummaries = campaignModels.map((campaign) => summarizeCampaign(campaign, progress.status));
  const overall = summarizeOverall(campaignSummaries);
  const campaigns = campaignSummaries.map(({ progressUnits, ...campaign }) => campaign);
  return { overall, campaigns };
}

function buildCampaignContext(snapshot, nodes) {
  const campaigns = [];
  const campaignIds = new Set();
  const draftNodeById = new Map();
  const adDetails = new Map();

  for (const campaign of snapshot?.campaigns ?? []) {
    const campaignClientId = String(campaign.clientId ?? '');
    if (!campaignClientId) continue;
    campaignIds.add(campaignClientId);
    campaigns.push({
      clientId: campaignClientId,
      name: campaign.name ?? campaignClientId,
      seedingItemCount: Math.max(1, campaign.seeding?.items?.length ?? 0)
    });
    draftNodeById.set(campaignClientId, { clientId: campaignClientId, type: 'campaign', parentClientId: null });
    for (const adSet of campaign.adSets ?? []) {
      const adSetClientId = String(adSet.clientId ?? '');
      if (!adSetClientId) continue;
      draftNodeById.set(adSetClientId, {
        clientId: adSetClientId,
        type: 'adSet',
        parentClientId: campaignClientId
      });
      for (const ad of adSet.ads ?? []) {
        const adClientId = String(ad.clientId ?? '');
        if (!adClientId) continue;
        draftNodeById.set(adClientId, {
          clientId: adClientId,
          type: 'ad',
          parentClientId: adSetClientId
        });
        adDetails.set(adClientId, {
          campaignClientId,
          creativeGroupId: String(ad.creativeGroupId ?? adClientId),
          seedingEnabled: (campaign.seeding?.items?.length ?? 0) > 0,
          seedingItemCount: campaign.seeding?.items?.length ?? 0
        });
      }
    }
  }

  const nodeById = new Map(draftNodeById);
  for (const node of nodes) {
    if (node?.clientId) nodeById.set(String(node.clientId), { ...nodeById.get(String(node.clientId)), ...node });
  }
  return { campaigns, campaignIds, nodeById, adDetails };
}

function resolveNodeCampaign(node, context) {
  const directCampaignClientId = String(node?.campaignClientId ?? '');
  if (context.campaignIds.has(directCampaignClientId)) return directCampaignClientId;

  let current = node;
  const visited = new Set();
  while (current?.clientId && !visited.has(String(current.clientId))) {
    const clientId = String(current.clientId);
    visited.add(clientId);
    if (current.type === 'campaign' && context.campaignIds.has(clientId)) return clientId;
    const parentClientId = String(current.parentClientId ?? '');
    if (!parentClientId) break;
    if (context.campaignIds.has(parentClientId)) return parentClientId;
    current = context.nodeById.get(parentClientId);
  }
  return unknownCampaignId;
}

function appendPostWorkflowSteps(progress, context, groups, unknown) {
  const jobs = Array.isArray(progress.seeding?.jobs) ? progress.seeding.jobs : [];
  const campaignsByPost = campaignsByPublishedPost(progress.nodes, context);
  const selectedCampaignsByPost = new Map();
  for (const job of jobs) {
    const postId = normalizeId(job?.postId);
    const campaignClientId = normalizeId(job?.campaignClientId);
    if (!postId || !context.campaignIds.has(campaignClientId)) continue;
    if (!selectedCampaignsByPost.has(postId)) selectedCampaignsByPost.set(postId, new Set());
    selectedCampaignsByPost.get(postId).add(campaignClientId);
  }

  const publicationSteps = new Map();
  const seedingSteps = new Map();
  const derivedWaitingKeys = new Set();
  const creativeGroups = new Map();
  for (const [adClientId, detail] of context.adDetails) {
    if (!detail.seedingEnabled) continue;
    const key = `${detail.campaignClientId}\u0000${detail.creativeGroupId}`;
    if (!creativeGroups.has(key)) creativeGroups.set(key, { ...detail, nodes: [] });
    creativeGroups.get(key).nodes.push(context.nodeById.get(adClientId));
  }

  for (const creativeGroup of creativeGroups.values()) {
    const postId = creativeGroup.nodes.map((node) => normalizeId(node?.postId)).find(Boolean) || '';
    const selectedCampaigns = selectedCampaignsByPost.get(postId);
    if (postId && selectedCampaigns?.size > 0 && !selectedCampaigns.has(creativeGroup.campaignClientId)) continue;
    const postKey = postId || `waiting:${creativeGroup.creativeGroupId}`;
    const allTerminalWithoutPost = !postId
      && creativeGroup.nodes.length > 0
      && creativeGroup.nodes.every((node) => isPublishNodeComplete(node?.status, isTerminalRunStatus(progress.status)))
      && creativeGroup.nodes.every((node) => node?.status === 'failed' || node?.status === 'skipped');
    if (!postId) derivedWaitingKeys.add(`${creativeGroup.campaignClientId}\u0000${postKey}`);
    const publicationStep = ensureWorkflowStep(publicationSteps, creativeGroup.campaignClientId, postKey);
    publicationStep.complete = Boolean(postId) || allTerminalWithoutPost;
    publicationStep.failed = allTerminalWithoutPost;
    const seedingStep = ensureWorkflowStep(seedingSteps, creativeGroup.campaignClientId, postKey);
    seedingStep.expectedJobs = Math.max(seedingStep.expectedJobs, creativeGroup.seedingItemCount ?? 0);
    seedingStep.complete = allTerminalWithoutPost;
    seedingStep.failed = allTerminalWithoutPost;
  }

  if (derivedWaitingKeys.size === 0) {
    const legacyWaitingPostCount = positiveInteger(progress.seeding?.waitingPostCount);
    for (let index = 0; index < legacyWaitingPostCount; index += 1) {
      ensureWorkflowStep(publicationSteps, unknownCampaignId, `legacy-waiting:${index}`);
      ensureWorkflowStep(seedingSteps, unknownCampaignId, `legacy-waiting:${index}`);
    }
  }

  for (const job of jobs) {
    const postId = normalizeId(job?.postId) || `legacy:${normalizeId(job?.id) || seedingSteps.size}`;
    const campaignClientId = resolveJobCampaign(job, postId, campaignsByPost, context);
    ensureWorkflowStep(publicationSteps, campaignClientId, postId).complete = Boolean(normalizeId(job?.postId));
    const step = ensureWorkflowStep(seedingSteps, campaignClientId, postId);
    step.jobs.push(job);
    step.expectedJobs = Math.max(step.expectedJobs, step.jobs.length);
  }

  for (const step of publicationSteps.values()) {
    const target = groups.get(step.campaignClientId) ?? unknown;
    target.publication.push({ complete: step.complete, failed: step.failed, needsReview: step.needsReview });
  }
  for (const step of seedingSteps.values()) {
    const target = groups.get(step.campaignClientId) ?? unknown;
    target.seeding.push(step.jobs.length > 0
      ? summarizeSeedingStep(step.jobs, step.expectedJobs)
      : {
          complete: step.complete,
          failed: step.failed,
          needsReview: step.needsReview,
          completedUnits: step.complete ? Math.max(1, step.expectedJobs) : 0,
          totalUnits: Math.max(1, step.expectedJobs)
        });
  }
}

function campaignsByPublishedPost(nodes, context) {
  const result = new Map();
  for (const node of nodes) {
    const postId = normalizeId(node?.postId);
    if (node?.type !== 'ad' || !postId) continue;
    const campaignClientId = resolveNodeCampaign(node, context);
    if (campaignClientId === unknownCampaignId) continue;
    if (!result.has(postId)) result.set(postId, new Set());
    result.get(postId).add(campaignClientId);
  }
  return result;
}

function resolveJobCampaign(job, postId, campaignsByPost, context) {
  const campaignClientId = normalizeId(job?.campaignClientId);
  if (context.campaignIds.has(campaignClientId)) return campaignClientId;
  const matches = campaignsByPost.get(postId);
  return matches?.size === 1 ? [...matches][0] : unknownCampaignId;
}

function ensureWorkflowStep(steps, campaignClientId, postKey) {
  const normalizedCampaignClientId = campaignClientId || unknownCampaignId;
  const key = `${normalizedCampaignClientId}\u0000${postKey}`;
  if (!steps.has(key)) steps.set(key, {
    campaignClientId: normalizedCampaignClientId,
    complete: false,
    failed: false,
    needsReview: false,
    expectedJobs: 0,
    jobs: []
  });
  return steps.get(key);
}

function summarizeSeedingStep(jobs, expectedJobs = jobs.length) {
  if (jobs.length === 0) return { complete: false, failed: false, needsReview: false };
  const statuses = jobs.map((job) => normalizeId(job?.status));
  const hasActive = statuses.some((status) => activeSeedingStatuses.has(status));
  const hasUnknown = statuses.some((status) => !terminalSeedingStatuses.has(status) && !activeSeedingStatuses.has(status));
  const completedUnits = statuses.filter((status) => terminalSeedingStatuses.has(status)).length;
  const totalUnits = Math.max(expectedJobs, jobs.length, 1);
  return {
    complete: completedUnits >= totalUnits && !hasActive,
    failed: statuses.some((status) => status === 'failed' || status === 'cancelled'),
    needsReview: hasUnknown || statuses.includes('needs_review'),
    completedUnits,
    totalUnits
  };
}

function summarizeCampaign(campaign, runStatus) {
  const steps = [...campaign.publish, ...campaign.publication, ...campaign.seeding];
  const publishCompleted = campaign.publish.filter((step) => step.complete).length;
  const publicationCompleted = campaign.publication.filter((step) => step.complete).length;
  const seedingCompleted = campaign.seeding.reduce((sum, step) => sum + (step.completedUnits ?? (step.complete ? 1 : 0)), 0);
  const seedingTotal = campaign.seeding.reduce((sum, step) => sum + (step.totalUnits ?? 1), 0);
  const completed = publishCompleted + publicationCompleted + seedingCompleted;
  const total = campaign.publish.length + campaign.publication.length + seedingTotal;
  const publishComplete = campaign.publish.every((step) => step.complete);
  const publicationComplete = campaign.publication.every((step) => step.complete);
  const seedingComplete = campaign.seeding.every((step) => step.complete);
  const phase = !publishComplete ? 'creating' : !publicationComplete ? 'publishing' : !seedingComplete ? 'seeding' : 'complete';
  return {
    clientId: campaign.clientId,
    name: campaign.name,
    completed,
    total,
    percent: weightedProgressPercent({
      publishCompleted,
      publishTotal: campaign.publish.length,
      publicationCompleted,
      publicationTotal: campaign.publication.length,
      seedingCompleted,
      seedingTotal
    }),
    phase,
    progressUnits: {
      publishCompleted,
      publishTotal: campaign.publish.length,
      publicationCompleted,
      publicationTotal: campaign.publication.length,
      seedingCompleted,
      seedingTotal
    },
    status: progressStatus({
      phase,
      completed,
      runStatus,
      failed: steps.some((step) => step.failed),
      needsReview: steps.some((step) => step.needsReview)
    })
  };
}

function summarizeOverall(campaigns) {
  const completed = campaigns.reduce((sum, campaign) => sum + campaign.completed, 0);
  const total = campaigns.reduce((sum, campaign) => sum + campaign.total, 0);
  const phase = campaigns.some((campaign) => campaign.phase === 'creating')
    ? 'creating'
    : campaigns.some((campaign) => campaign.phase === 'publishing')
      ? 'publishing'
    : campaigns.some((campaign) => campaign.phase === 'seeding')
      ? 'seeding'
      : 'complete';
  let status;
  if (campaigns.some((campaign) => campaign.status === 'needs_review')) {
    status = 'needs_review';
  } else if (phase !== 'complete') {
    status = completed === 0 && campaigns.every((campaign) => campaign.status === 'pending')
      ? 'pending'
      : 'running';
  } else if (campaigns.some((campaign) => campaign.status === 'completed_with_errors')) {
    status = 'completed_with_errors';
  } else {
    status = 'completed';
  }
  const units = campaigns.reduce((result, campaign) => {
    for (const [key, value] of Object.entries(campaign.progressUnits)) result[key] += value;
    return result;
  }, {
    publishCompleted: 0,
    publishTotal: 0,
    publicationCompleted: 0,
    publicationTotal: 0,
    seedingCompleted: 0,
    seedingTotal: 0
  });
  return { completed, total, percent: weightedProgressPercent(units), phase, status };
}

function weightedProgressPercent({
  publishCompleted,
  publishTotal,
  publicationCompleted,
  publicationTotal,
  seedingCompleted,
  seedingTotal
}) {
  const hasPublication = publicationTotal > 0;
  const hasSeeding = seedingTotal > 0;
  const publishWeight = 70 + (hasPublication ? 0 : 10) + (hasSeeding ? 0 : 20);
  const publicationWeight = hasPublication ? 10 + (hasSeeding ? 0 : 20) : 0;
  const seedingWeight = hasSeeding ? 20 : 0;
  const publish = phaseRatio(publishCompleted, publishTotal);
  const publication = phaseRatio(publicationCompleted, publicationTotal);
  const seeding = phaseRatio(seedingCompleted, seedingTotal);
  return Math.min(100, Math.floor(
    publish * publishWeight + publication * publicationWeight + seeding * seedingWeight
  ));
}

function phaseRatio(completed, total) {
  return total > 0 ? Math.min(1, completed / total) : 0;
}

function progressStatus({ phase, completed, runStatus, failed, needsReview }) {
  if (needsReview) return 'needs_review';
  if (phase !== 'complete') {
    return completed === 0 && runStatus === 'preparing' ? 'pending' : 'running';
  }
  if (failed || runStatus === 'failed') return 'completed_with_errors';
  return 'completed';
}

function isPublishNodeComplete(status, runIsTerminal) {
  return terminalNodeStatuses.has(status) || (status === 'skipped' && runIsTerminal);
}

function percentage(completed, total) {
  return total > 0 ? Math.floor(completed / total * 100) : 0;
}

function normalizeId(value) {
  return String(value ?? '').trim();
}

function positiveInteger(value) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : 0;
}

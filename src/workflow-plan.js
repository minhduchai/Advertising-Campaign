// Khớp PUBLISH_BATCH_SIZE trong cloudflare/src/publish-batch.js. Mốc mềm 45s của bước vẫn chặn việc bắt đầu node mới nếu bước chậm.
export const WORKFLOW_PUBLISH_BATCH_SIZE = 8;
// Bước tạo dễ gặp lỗi tạm (mạng, Meta chậm) nên cho thử lại nhiều hơn; 5 là trần Cloudflare cho phép.
const PUBLISH_STEP_RETRY_LIMIT = 5;
export const WORKFLOW_PUBLICATION_BATCH_SIZE = 12;
export const WORKFLOW_SEEDING_BATCH_SIZE = 3;

export function createWorkflowPlan(snapshot) {
  const steps = [];
  for (const campaign of snapshot?.campaigns ?? []) {
    steps.push(step('campaign', campaign.clientId, campaign.name));
    for (const adSet of campaign.adSets ?? []) {
      steps.push(step('adSet', adSet.clientId, adSet.name, campaign.clientId));
      for (const ad of adSet.ads ?? []) {
        steps.push(step('ad', ad.clientId, ad.name, adSet.clientId));
        steps.push(step('publication', ad.clientId, ad.name, adSet.clientId));
      }
    }
    steps.push({
      key: `seeding:${encodeURIComponent(campaign.clientId)}`,
      type: 'seeding',
      clientId: campaign.clientId,
      name: campaign.name,
      parentClientId: null
    });
  }
  return steps;
}

// Dòng log thời lượng cho mỗi bước workflow. Chỉ cho phép các trường bên dưới (không token, không link ký sẵn, không nội dung QC).
const STEP_LOG_FIELDS = ['runId', 'action', 'stepKey', 'status', 'ms', 'attempted', 'complete', 'deadlineHit', 'pending', 'ready', 'total'];

export function workflowStepLogLine(fields = {}) {
  const entry = { evt: 'workflow_step' };
  for (const key of STEP_LOG_FIELDS) {
    const value = fields[key];
    if (value === undefined || value === null) continue;
    if (typeof value === 'number') {
      if (Number.isFinite(value)) entry[key] = value;
    } else if (typeof value === 'boolean') {
      entry[key] = value;
    } else {
      entry[key] = String(value).slice(0, 120);
    }
  }
  return JSON.stringify(entry);
}

export function calculateMonotonicProgress(previousPercent, steps) {
  if (!steps?.length) return Math.max(0, Number(previousPercent) || 0);
  const terminal = new Set(['succeeded', 'failed', 'skipped', 'needs_review']);
  const completed = steps.filter((item) => terminal.has(item.status)).length;
  return Math.max(Number(previousPercent) || 0, Math.min(100, Math.floor((completed / steps.length) * 100)));
}

export function createWorkflowExecutionPlan(run) {
  const draft = run?.execution ?? { campaigns: [] };
  const nodeCount = (draft.campaigns ?? []).reduce((total, campaign) => (
    total + 1 + (campaign.adSets ?? []).reduce((adSetTotal, adSet) => adSetTotal + 1 + (adSet.ads ?? []).length, 0)
  ), 0);
  const ads = (draft.campaigns ?? []).flatMap((campaign) => (
    (campaign.adSets ?? []).flatMap((adSet) => adSet.ads ?? [])
  ));
  const publicationGroupCount = new Set(ads.map((ad) => ad.creativeGroupId ?? ad.clientId)).size;
  const maximumSeedingJobs = (draft.campaigns ?? []).reduce((total, campaign) => (
    total + adsForCampaign(campaign) * (campaign.seeding?.items?.length ?? 0)
  ), 0);
  const runPath = `/api/internal/workflow/runs/${encodeURIComponent(run.id)}`;
  const publishSteps = numberedSteps(batchCount(nodeCount, WORKFLOW_PUBLISH_BATCH_SIZE), 'publish', `${runPath}/continue`, 0, PUBLISH_STEP_RETRY_LIMIT);
  // Chuẩn bị (upload + chờ xử lý) video trước khi tạo để bước tạo không phải chờ video. Máy chủ tự biết media nào là video.
  const mediaSteps = ads.some((ad) => ad.mediaId)
    ? [{ key: 'media:prepare', path: `${runPath}/media/prepare`, retryLimit: 3 }]
    : [];
  const publicationSteps = numberedSteps(batchCount(publicationGroupCount, WORKFLOW_PUBLICATION_BATCH_SIZE), 'publication', `${runPath}/publications/next`);
  return {
    runId: run.id,
    steps: [
      ...mediaSteps,
      ...interleaveRealtimeSeeding(publishSteps, runPath, { syncPublications: true }),
      ...interleaveRealtimeSeeding(publicationSteps, runPath),
      { key: 'seeding:prepare:final', path: `${runPath}/seeding/prepare`, retryLimit: 2 },
      ...numberedSteps(batchCount(maximumSeedingJobs, WORKFLOW_SEEDING_BATCH_SIZE), 'seeding:final', `${runPath}/seeding/next`, 4_000),
      { key: 'run:finalize', path: `${runPath}/finalize`, retryLimit: 2 }
    ]
  };
}

function interleaveRealtimeSeeding(steps, runPath, { syncPublications = false } = {}) {
  return steps.flatMap((plannedStep) => [
    plannedStep,
    ...(syncPublications ? [{
      key: `publication:realtime:${plannedStep.key}`,
      path: `${runPath}/publications/next`,
      retryLimit: 2
    }] : []),
    { key: `seeding:prepare:${plannedStep.key}`, path: `${runPath}/seeding/prepare`, retryLimit: 2 },
    {
      key: `seeding:realtime:${plannedStep.key}`,
      path: `${runPath}/seeding/next`,
      retryLimit: 2,
      delayAfterMs: 4_000
    }
  ]);
}

function batchCount(itemCount, batchSize) {
  return itemCount > 0 ? Math.ceil(itemCount / batchSize) : 0;
}

function numberedSteps(count, prefix, path, delayAfterMs = 0, retryLimit = 2) {
  return Array.from({ length: count }, (_, index) => ({
    key: `${prefix}:${index + 1}`,
    path,
    body: { stepKey: `${prefix}:${index + 1}` },
    retryLimit,
    ...(delayAfterMs ? { delayAfterMs } : {})
  }));
}

function adsForCampaign(campaign) {
  return (campaign.adSets ?? []).reduce((total, adSet) => total + (adSet.ads ?? []).length, 0);
}

function step(type, clientId, name, parentClientId = null) {
  return {
    key: `${type}:${encodeURIComponent(clientId)}`,
    type,
    clientId,
    name,
    parentClientId
  };
}

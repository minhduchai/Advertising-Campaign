import { isMetaThrottleError } from './meta-client.js';
import { withErrorContext, setErrorContext, recordError } from './error-journal.js';

const STALE_JOB_MS = 2 * 60_000;
const DEFAULT_TIMEOUT_MS = 20_000;
const MIN_DELAY_MS = 3_000;
const DELAY_RANGE_MS = 2_001;
const MAX_SEEDING_IMAGE_BYTES = 200 * 1024 * 1024;
const SEEDING_IMAGE_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'video/mp4', 'video/quicktime']);
export function buildSeedingPreparation(run, existingJobs = [], options = {}) {
  const { targets: _targets, ...prepared } = buildPreparation(run, existingJobs, options);
  return prepared;
}

export async function prepareRunSeeding({
  run,
  ownerMetaUserId,
  existingJobs = [],
  insertJobs,
  now = Date.now
}) {
  const prepared = buildSeedingPreparation(run, existingJobs, { now });
  if (prepared.jobs.length > 0) {
    await insertJobs(ownerMetaUserId, prepared.jobs);
  }
  return prepared;
}

export async function resolveSeedingConflict({
  run,
  ownerMetaUserId,
  postId,
  campaignClientId,
  existingJobs = [],
  insertJobs,
  now = Date.now
}) {
  const normalizedPostId = String(postId ?? '').trim();
  const normalizedCampaignClientId = String(campaignClientId ?? '');
  const existingSelections = new Set(existingJobs
    .filter((job) => String(job.runId) === String(run?.id) && String(job.postId) === normalizedPostId)
    .map((job) => String(job.campaignClientId)));
  if (existingSelections.size > 0 && !existingSelections.has(normalizedCampaignClientId)) {
    throw new Error('Post already has a different Campaign selection');
  }

  const prepared = buildPreparation(run, existingJobs, {
    now,
    forcedSelections: new Map([[normalizedPostId, normalizedCampaignClientId]])
  });
  const targetExists = prepared.targets.some((target) =>
    target.postId === normalizedPostId && target.campaign.clientId === normalizedCampaignClientId
  );
  if (!targetExists) {
    throw new Error('Selected Campaign does not contain this Post ID');
  }

  const jobs = prepared.jobs.filter((job) =>
    job.postId === normalizedPostId && job.campaignClientId === normalizedCampaignClientId
  );
  if (jobs.length > 0) await insertJobs(ownerMetaUserId, jobs);
  return {
    jobs,
    conflicts: prepared.conflicts.filter((conflict) => conflict.postId !== normalizedPostId),
    waitingPostCount: prepared.waitingPostCount,
    invalidTargets: prepared.invalidTargets
  };
}

export function processNextSeedingJob(options) {
  return withErrorContext({ runId: options.runId, ownerMetaUserId: options.ownerMetaUserId, secrets: [options.token] },
    () => processNextSeedingJobWithContext(options));
}

async function processNextSeedingJobWithContext({
  runId,
  ownerMetaUserId,
  db,
  metaClient,
  mediaStore,
  token,
  loadPageEngagementContext,
  now = Date.now,
  random = Math.random,
  timeoutMs = DEFAULT_TIMEOUT_MS
}) {
  const claimedAt = readNow(now);
  const job = await db.claimNextSeedingJob({
    ownerMetaUserId,
    runId,
    now: claimedAt,
    staleBefore: claimedAt - STALE_JOB_MS
  });

  if (!job) {
    const jobs = await db.listSeedingJobs(ownerMetaUserId, runId);
    const nextAvailableAt = jobs
      .filter((entry) => entry.status === 'pending' && Number.isFinite(Number(entry.availableAt)))
      .reduce((earliest, entry) => Math.min(earliest, Number(entry.availableAt)), Number.POSITIVE_INFINITY);
    return {
      job: null,
      retryAfterMs: Number.isFinite(nextAvailableAt) ? Math.max(0, nextAvailableAt - claimedAt) : null
    };
  }

  let page;
  setErrorContext({ clientId: job.id, nodeType: 'comment' });
  let attachmentUrl;
  try {
    const context = loadPageEngagementContext
      ? await loadPageEngagementContext(token, String(job.pageId))
      : await metaClient.getPageEngagementContext(token, [String(job.pageId)]);
    page = context?.pages?.get(String(job.pageId));
    requirePageContext(context, page);
    requireMatchingPagePrefix(job.pageId, job.postId);
    attachmentUrl = job.imageMediaId
      ? await getTrustedAttachmentUrl({ mediaStore, ownerMetaUserId, imageMediaId: job.imageMediaId })
      : undefined;
  } catch (error) {
    recordError(error, { stage: 'seeding-prepare', clientId: job.id });
    if (isMetaThrottleError(error)) {
      const deferredAt = readNow(now);
      await db.deferSeedingJob({
        ownerMetaUserId,
        runId,
        jobId: job.id,
        now: deferredAt,
        availableAt: deferredAt + Number(error.retryAfterMs || 30_000)
      });
      throw error;
    }
    const failedAt = readNow(now);
    const finished = await finishClaimedJob({
      db,
      ownerMetaUserId,
      runId,
      job,
      status: 'failed',
      metaCommentId: null,
      error: normalizeError(error),
      now: failedAt,
      nextAvailableAt: failedAt
    });
    return { job: finished, retryAfterMs: null };
  }

  let metaCommentId;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  timer.unref?.();
  try {
    metaCommentId = await metaClient.createPageComment(
      page.accessToken,
      job.postId,
      { message: job.message, attachmentUrl },
      { signal: controller.signal }
    );
  } catch (error) {
    recordError(error, { stage: 'seeding-write', clientId: job.id });
    if (isMetaThrottleError(error)) {
      const deferredAt = readNow(now);
      await db.deferSeedingJob({
        ownerMetaUserId,
        runId,
        jobId: job.id,
        now: deferredAt,
        availableAt: deferredAt + Number(error.retryAfterMs || 30_000)
      });
      throw error;
    }
    const failedAt = readNow(now);
    const finished = await finishClaimedJob({
      db,
      ownerMetaUserId,
      runId,
      job,
      status: error?.meta ? 'failed' : 'needs_review',
      metaCommentId: null,
      error: normalizeError(error),
      now: failedAt,
      nextAvailableAt: failedAt
    });
    return { job: finished, retryAfterMs: null };
  } finally {
    clearTimeout(timer);
  }

  const completedAt = readNow(now);
  const retryAfterMs = MIN_DELAY_MS + Math.floor(normalizeRandom(random()) * DELAY_RANGE_MS);
  const finished = await finishClaimedJob({
    db,
    ownerMetaUserId,
    runId,
    job,
    status: 'created',
    metaCommentId,
    error: null,
    now: completedAt,
    nextAvailableAt: completedAt + retryAfterMs
  });
  return { job: finished, retryAfterMs };
}

export function createSeedingState(run, jobs = []) {
  const scopedJobs = jobs.filter((job) =>
    String(job.runId) === String(run?.id) &&
    (!run?.ownerMetaUserId || !job.ownerMetaUserId || String(job.ownerMetaUserId) === String(run.ownerMetaUserId))
  );
  const prepared = buildSeedingPreparation(run, scopedJobs, { now: 0 });
  const counts = {
    pending: 0,
    posting: 0,
    created: 0,
    failed: 0,
    needs_review: 0,
    cancelled: 0
  };
  for (const job of scopedJobs) {
    if (job.status in counts) counts[job.status] += 1;
  }
  const posts = new Set(scopedJobs.map((job) => `${job.campaignClientId}\u0000${job.postId}`)).size;
  return {
    summary: {
      posts,
      total: scopedJobs.length,
      pending: counts.pending,
      posting: counts.posting,
      created: counts.created,
      failed: counts.failed,
      needsReview: counts.needs_review,
      cancelled: counts.cancelled
    },
    jobs: scopedJobs.map(publicJob),
    conflicts: prepared.conflicts,
    waitingPostCount: prepared.waitingPostCount,
    waitingCampaignCount: prepared.waitingCampaignCount
  };
}

function buildPreparation(run, existingJobs, { now = Date.now, forcedSelections = new Map() } = {}) {
  const timestamp = readNow(now);
  const scopedExistingJobs = existingJobs.filter((job) => String(job.runId) === String(run?.id));
  const campaigns = run?.snapshot?.campaigns ?? [];
  const campaignByAdClientId = new Map();
  const campaignOrder = new Map();
  const adStatuses = new Map((run?.nodes ?? []).filter(node => node.type === 'ad')
    .map(node => [String(node.clientId), node.status]));
  const unfinishedCampaigns = new Set();
  campaigns.forEach((campaign, index) => {
    campaignOrder.set(String(campaign.clientId), index);
    if (campaign.seeding?.enabled && (campaign.adSets ?? []).some(adSet =>
      (adSet.ads ?? []).some(ad => !['created', 'failed', 'skipped'].includes(adStatuses.get(String(ad.clientId))))
    )) unfinishedCampaigns.add(String(campaign.clientId));
    for (const adSet of campaign.adSets ?? []) {
      for (const ad of adSet.ads ?? []) campaignByAdClientId.set(String(ad.clientId), campaign);
    }
  });

  const targetsByKey = new Map();
  const invalidTargetKeys = new Set();
  const invalidTargets = [];
  let waitingPostCount = 0;
  let occurrence = 0;
  for (const node of run?.nodes ?? []) {
    if (node?.type !== 'ad' || node.status !== 'created') continue;
    const campaign = campaignByAdClientId.get(String(node.clientId));
    if (!campaign?.seeding?.enabled) continue;
    const postId = String(node.postId ?? '').trim();
    if (!postId) {
      waitingPostCount += 1;
      continue;
    }
    if (!hasMatchingPagePrefix(campaign.pageId, postId)) {
      const invalidKey = targetKey(campaign.clientId, postId);
      if (!invalidTargetKeys.has(invalidKey)) {
        invalidTargetKeys.add(invalidKey);
        invalidTargets.push({
          campaignClientId: String(campaign.clientId),
          pageId: String(campaign.pageId),
          postId,
          reason: 'page_mismatch'
        });
      }
      continue;
    }
    const key = targetKey(campaign.clientId, postId);
    if (!targetsByKey.has(key)) {
      targetsByKey.set(key, { campaign, postId, occurrence });
      occurrence += 1;
    }
  }

  const targets = [...targetsByKey.values()].sort((left, right) =>
    campaignOrder.get(String(left.campaign.clientId)) - campaignOrder.get(String(right.campaign.clientId)) ||
    left.occurrence - right.occurrence
  );
  targets.forEach((target, sequence) => {
    target.sequence = sequence;
  });
  const targetsByPost = new Map();
  for (const target of targets) {
    if (!targetsByPost.has(target.postId)) targetsByPost.set(target.postId, []);
    targetsByPost.get(target.postId).push(target);
  }

  const existingKeys = new Set(scopedExistingJobs.map(jobKey));
  const existingSelections = new Map();
  for (const job of scopedExistingJobs) {
    const postId = String(job.postId);
    if (!existingSelections.has(postId)) existingSelections.set(postId, new Set());
    existingSelections.get(postId).add(String(job.campaignClientId));
  }

  const selectedTargets = [];
  const conflicts = [];
  for (const [postId, postTargets] of targetsByPost) {
    const forcedCampaignClientId = forcedSelections.get(postId);
    if (forcedCampaignClientId) {
      const forcedTarget = postTargets.find((target) => String(target.campaign.clientId) === forcedCampaignClientId);
      if (forcedTarget) selectedTargets.push(forcedTarget);
      continue;
    }

    if (postTargets.length === 1) {
      selectedTargets.push(postTargets[0]);
      continue;
    }

    const priorCampaigns = existingSelections.get(postId) ?? new Set();
    const priorTargets = postTargets.filter((target) => priorCampaigns.has(String(target.campaign.clientId)));
    if (priorTargets.length === 1) {
      selectedTargets.push(priorTargets[0]);
      continue;
    }
    conflicts.push({
      postId,
      campaignClientIds: postTargets.map((target) => String(target.campaign.clientId))
    });
  }

  selectedTargets.sort((left, right) =>
    campaignOrder.get(String(left.campaign.clientId)) - campaignOrder.get(String(right.campaign.clientId)) ||
    left.occurrence - right.occurrence
  );
  const jobs = [];
  selectedTargets.forEach((target) => {
    if (unfinishedCampaigns.has(String(target.campaign.clientId))) return;
    (target.campaign.seeding.items ?? []).forEach((item, position) => {
      const descriptor = {
        runId: String(run.id),
        campaignClientId: String(target.campaign.clientId),
        postId: target.postId,
        itemId: String(item.id)
      };
      if (existingKeys.has(jobKey(descriptor))) return;
      jobs.push({
        id: seedingJobId(descriptor),
        runId: descriptor.runId,
        campaignClientId: descriptor.campaignClientId,
        pageId: String(target.campaign.pageId),
        postId: descriptor.postId,
        itemId: descriptor.itemId,
        position,
        sequence: target.sequence,
        message: String(item.message ?? ''),
        imageMediaId: item.imageMediaId ?? null,
        status: 'pending',
        metaCommentId: null,
        error: null,
        attemptCount: 0,
        availableAt: timestamp,
        startedAt: null,
        completedAt: null,
        createdAt: timestamp,
        updatedAt: timestamp
      });
    });
  });

  const waitingCampaignCount = ['creating', 'retrying_ad', 'seeding'].includes(run?.status)
    ? unfinishedCampaigns.size : 0;
  return { jobs, conflicts, waitingPostCount, invalidTargets, waitingCampaignCount, targets };
}

async function getTrustedAttachmentUrl({ mediaStore, ownerMetaUserId, imageMediaId }) {
  const media = await mediaStore.getMedia({ ownerMetaUserId, id: imageMediaId });
  if (!media || String(media.ownerMetaUserId) !== String(ownerMetaUserId)) {
    throw new Error('Seeding media is not owned by this Meta user');
  }
  if (!SEEDING_IMAGE_MIME_TYPES.has(media.mimeType)) {
    throw new Error('Seeding media must be JPEG, PNG, MP4 or MOV');
  }
  if (!Number.isSafeInteger(media.sizeBytes) || media.sizeBytes < 0 || media.sizeBytes > MAX_SEEDING_IMAGE_BYTES) {
    throw new Error('Seeding media must be at most 200 MB');
  }
  const attachmentUrl = await mediaStore.getMetaFetchUrl({ ownerMetaUserId, id: imageMediaId });
  let parsed;
  try {
    parsed = new URL(attachmentUrl);
  } catch {
    throw new Error('Seeding media requires an HTTPS Meta fetch URL');
  }
  if (parsed.protocol !== 'https:') {
    throw new Error('Seeding media requires an HTTPS Meta fetch URL');
  }
  return parsed.href;
}

function requirePageContext(context, page) {
  if (!context?.permissionGranted) {
    throw new Error('Meta chưa cấp quyền pages_manage_engagement. Hãy thêm quyền này vào cấu hình Facebook Login for Business rồi kết nối lại Meta.');
  }
  if (!page?.accessToken) {
    throw new Error('Không lấy được Page Access Token. Tài khoản hiện chỉ có thể quảng cáo Page này nhưng chưa có quyền quản lý bình luận.');
  }
  if (!Array.isArray(page.tasks) || !page.tasks.includes('MODERATE')) {
    throw new Error('Tài khoản cần quyền MODERATE hoặc toàn quyền kiểm soát Page để bình luận bằng Page.');
  }
}

function requireMatchingPagePrefix(pageId, postId) {
  if (!hasMatchingPagePrefix(pageId, postId)) {
    throw new Error('Post ID Page prefix does not match the job Page');
  }
}

function hasMatchingPagePrefix(pageId, postId) {
  const separatorIndex = String(postId).indexOf('_');
  return separatorIndex < 0 || String(postId).slice(0, separatorIndex) === String(pageId);
}

async function finishClaimedJob(input) {
  const finished = await input.db.finishSeedingJob({
    ownerMetaUserId: input.ownerMetaUserId,
    runId: input.runId,
    jobId: input.job.id,
    status: input.status,
    metaCommentId: input.metaCommentId,
    error: input.error,
    now: input.now,
    nextAvailableAt: input.nextAvailableAt
  });
  if (!finished) throw new Error('Claimed seeding job could not be finalized');
  return finished;
}

function normalizeError(error) {
  if (error?.meta) return { ...error.meta };
  return {
    message: error?.message ?? 'Seeding comment failed',
    type: error?.name ?? 'Error',
    code: error?.code ?? null,
    subcode: null,
    fbtraceId: null
  };
}

function publicJob(job) {
  return {
    id: job.id,
    campaignClientId: job.campaignClientId,
    pageId: job.pageId,
    postId: job.postId,
    position: job.position,
    message: sanitizePublicString(job.message),
    imageMediaId: job.imageMediaId ?? null,
    status: job.status,
    metaCommentId: job.metaCommentId ?? null,
    error: publicError(job.error)
  };
}

function publicError(error) {
  if (!error || typeof error !== 'object') return null;
  return {
    message: sanitizePublicString(error.message),
    type: sanitizePublicString(error.type),
    code: sanitizePublicScalar(error.code),
    subcode: sanitizePublicScalar(error.subcode),
    fbtraceId: sanitizePublicScalar(error.fbtraceId)
  };
}

function sanitizePublicScalar(value) {
  return typeof value === 'string' ? sanitizePublicString(value) : value ?? null;
}

function sanitizePublicString(value) {
  return String(value ?? '')
    .replace(/blob:[^\s"'<>]*/gi, '[redacted-url]')
    .replace(/https?:\/\/[^\s"'<>]*blob[^\s"'<>]*/gi, '[redacted-url]')
    .replace(/([?&](?:access_token|token|sig|signature)=)[^&\s"'<>]+/gi, '$1[redacted]')
    .replace(/\bBearer\s+[^\s"'<>]+/gi, 'Bearer [redacted]')
    .replace(/\bEA[A-Za-z0-9_-]{12,}\b/g, '[redacted-token]');
}

function readNow(now) {
  const value = typeof now === 'function' ? now() : now;
  if (!Number.isFinite(Number(value))) throw new TypeError('now must resolve to a finite timestamp');
  return Number(value);
}

function normalizeRandom(value) {
  if (!Number.isFinite(value)) return 0;
  return Math.min(Math.max(value, 0), 1 - Number.EPSILON);
}

function targetKey(campaignClientId, postId) {
  return `${campaignClientId}\u0000${postId}`;
}

function jobKey(job) {
  return [job.runId, job.campaignClientId, job.postId, job.itemId].map(String).join('\u0000');
}

function seedingJobId(job) {
  return `seeding:${[job.runId, job.campaignClientId, job.postId, job.itemId].map((value) => encodeURIComponent(value)).join(':')}`;
}

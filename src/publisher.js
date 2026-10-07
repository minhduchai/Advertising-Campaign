import {
  buildAdParams,
  buildCampaignParams,
  buildConversationAdSetParams,
  buildImageCreativeParams,
  buildPublicPostCreativeParams,
  buildVideoCreativeParams
} from './draft.js';
import { isMetaThrottleError } from './meta-client.js';
import { createMetaRequestCache } from './meta-request-cache.js';
import { withErrorContext, recordError } from './error-journal.js';

const PUBLIC_POST_DEADLINE_CLEANUP_MS = 10_000;
const TRANSIENT_CREATIVE_RETRY_DELAYS_MS = [5_000, 12_000];
const READY_VIDEO_TTL_MS = 30 * 60_000;
const activeMetaVideoUploads = new Map();
const activeMetaImageUploads = new Map();
// A video Meta reported ready stays ready, so Workflow media prepare and later publish batches reuse the
// answer (and its thumbnail) instead of polling again. Pending and failed videos are never stored here.
// ponytail: memory of this process; after a restart each video costs one status check again.
const readyMetaVideos = createMetaRequestCache();

export function knownReadyVideo(ownerMetaUserId, accountId, videoId) {
  return readyMetaVideos.peek(JSON.stringify([ownerMetaUserId, accountId, videoId]));
}

export function rememberReadyVideo(ownerMetaUserId, accountId, videoId, video) {
  const thumbnail = { imageHash: video.thumbnail?.imageHash, imageUrl: video.thumbnail?.imageUrl };
  return readyMetaVideos.load(JSON.stringify([ownerMetaUserId, accountId, videoId]), READY_VIDEO_TTL_MS, async () => thumbnail);
}

export function publishDraft(options) {
  return withErrorContext({ runId: options.runId, ownerMetaUserId: options.ownerMetaUserId, secrets: [options.token] },
    () => publishDraftWithContext(options));
}

async function publishDraftWithContext({
  draft,
  token,
  runId,
  ownerMetaUserId,
  metaClient,
  getMedia,
  pagePublishingContexts = new Map(),
  onNodeUpdate = () => {},
  delay = defaultDelay,
  deadlineAt = Number.POSITIVE_INFINITY,
  now = Date.now,
  signal,
  existingNodes = [],
  maxNewNodes = Number.POSITIVE_INFINITY,
  stopStartingAt = Number.POSITIVE_INFINITY,
  concurrency = 1,
  onlyAdClientIds = null,
  getMetaVideoId = async () => null,
  saveMetaVideoId = async () => {},
  deleteMetaVideoId = async () => {},
  // 'throw' (mặc định): quá mốc cứng thì ném PublicationDeadlineError. 'return': đưa node dở về retry_pending rồi trả
  // { complete: false, deadlineHit: true } để workflow làm tiếp ở lần gọi sau thay vì coi là lỗi.
  onDeadline = 'throw',
  waitForThrottle = false,
  // Mốc bắt đầu lượt chạy (ms). Chỉ dùng khi nhận lại đối tượng đã tạo dở: đối tượng cũ hơn mốc này không bao giờ bị nhận nhầm.
  runStartedAt = null
}) {
  const deadlineContext = { deadlineAt, now, signal };
  assertPublicationDeadline(deadlineContext);
  const nodes = existingNodes.map((node) => ({ ...node }));
  // Node còn `creating` từ lần chạy trước nghĩa là yêu cầu tạo bị ngắt giữa chừng (mất mạng, khởi động lại): Meta có thể đã tạo rồi.
  const interruptedClientIds = new Set(nodes.filter((node) => node.status === 'creating').map((node) => String(node.clientId)));
  const adopt = (clientId, parentId, edge, name) => adoptInterruptedNode({
    interruptedClientIds, clientId, runStartedAt, metaClient, token, parentId, edge, name, deadlineContext
  });
  const creativeArtifacts = seedCreativeArtifacts(draft, nodes);
  const metaVideoIds = new Map();
  const metaImageHashes = new Map();
  const readyVideos = new Map();
  let newNodes = 0;
  let bounded = false;
  const canCreateNode = () => newNodes < maxNewNodes && now() < stopStartingAt;
  // Cổng chung cho ad set + ad: tối đa `concurrency` node đang tạo trên Meta cùng lúc.
  // Kiểm tra giới hạn batch ngay lúc bắt đầu tạo (không phải lúc xếp hàng).
  const gate = createGate(concurrency);
  // Tra permalink sau khi tạo ad là đọc Graph thuần: không giữ slot tạo, nhưng cũng bị chặn cùng mức song song.
  const lookupGate = createGate(concurrency);
  // Tối đa `concurrency` Campaign chạy cùng lúc; concurrency = 1 giữ nguyên thứ tự tuần tự cũ.
  const campaignGate = createGate(concurrency);
  const claim = (create) => gate(async () => {
    if (!canCreateNode()) { bounded = true; return null; }
    newNodes += 1;
    return create();
  });
  let persistenceError;
  const report = async (node) => {
    if (persistenceError) throw persistenceError;
    const existingIndex = nodes.findIndex((entry) => entry.clientId === node.clientId);
    if (node.status === 'created' && nodes[existingIndex]?.error) node = { ...node, error: null };
    if (existingIndex >= 0) {
      nodes[existingIndex] = { ...nodes[existingIndex], ...node };
    } else {
      nodes.push(node);
    }
    if (node.error) recordError(node.error, { stage: 'publish-result', clientId: node.clientId,
      nodeType: node.type, nodeName: node.name });
    try { await onNodeUpdate(runId, node); }
    catch (error) {
      recordError(error, { stage: 'publish-save', clientId: node.clientId, nodeType: node.type, nodeName: node.name });
      persistenceError = error;
      throw error;
    }
    return node;
  };

  const publishAll = () => runAll(draft.campaigns, (campaign) => campaignGate(async () => {
    if (onlyAdClientIds && !campaign.adSets.some(adSet => adSet.ads.some(ad => onlyAdClientIds.has(String(ad.clientId))))) return;
    let campaignResult = terminalNode(nodes, campaign.clientId);
    if (!campaignResult) {
      campaignResult = await claim(() => createNode({
        report,
        clientId: campaign.clientId,
        name: campaign.name,
        type: 'campaign',
        deadlineContext,
        create: async () => (await adopt(campaign.clientId, campaign.adAccountId, 'campaigns', campaign.name))
          ?? metaClient.createCampaign(
            token,
            campaign.adAccountId,
            buildCampaignParams(campaign),
            publicationOptions(deadlineContext)
          )
      }));
      if (!campaignResult) return;
    }

    if (!campaignResult.remoteId) {
      await skipCampaignChildren(campaign, report, campaign.clientId, nodes);
      return;
    }

    await runAll(campaign.adSets, async (adSet) => {
      if (onlyAdClientIds && !adSet.ads.some(ad => onlyAdClientIds.has(String(ad.clientId)))) return;
      let adSetResult = terminalNode(nodes, adSet.clientId);
      if (!adSetResult) {
        adSetResult = await claim(() => createNode({
          report,
          clientId: adSet.clientId,
          parentClientId: campaign.clientId,
          name: adSet.name,
          type: 'adSet',
          deadlineContext,
          create: async () => (await adopt(adSet.clientId, campaignResult.remoteId, 'adsets', adSet.name))
            ?? metaClient.createAdSet(
              token,
              campaign.adAccountId,
              buildConversationAdSetParams(campaignResult.remoteId, campaign, adSet),
              publicationOptions(deadlineContext)
            )
        }));
        if (!adSetResult) return;
      }

      if (!adSetResult.remoteId) {
        await skipAds(adSet, report, adSet.clientId, nodes);
        return;
      }

      await runAll(adSet.ads, async (ad) => {
        if (onlyAdClientIds && !onlyAdClientIds.has(String(ad.clientId))) return;
        if (terminalNode(nodes, ad.clientId)) return;
        const lookupPublication = await claim(() => createAd({
          ad,
          canReconcile: adSet.ads.filter(entry => entry.name === ad.name).length === 1,
          adSetId: adSetResult.remoteId,
          parentClientId: adSet.clientId,
          accountId: campaign.adAccountId,
          pageId: campaign.pageId,
          token,
          metaClient,
          pagePublishingContexts,
          getMedia,
          ownerMetaUserId,
          report,
          delay,
          deadlineContext,
          creativeArtifacts,
          metaVideoIds,
          metaImageHashes,
          readyVideos,
          getMetaVideoId,
          saveMetaVideoId,
          deleteMetaVideoId,
          adopt
        }));
        await lookupPublication?.(lookupGate);
      });
    });
  }));

  let deadlineHit = false;
  try {
    while (true) {
      try {
        await publishAll();
        if (persistenceError) throw persistenceError;
        break;
      } catch (error) {
        if (persistenceError) throw persistenceError;
        if (!waitForThrottle || !isMetaThrottleError(error)) throw error;
        // runAll has drained in-flight writes. Keep successful nodes/artifacts and retry only
        // definite throttle rejections after the requested cooldown, never uncertain writes.
        for (const cache of [creativeArtifacts, metaVideoIds, metaImageHashes, readyVideos]) {
          for (const [key, pending] of cache) {
            try { await pending; } catch { cache.delete(key); }
          }
        }
        const retryAfterMs = Number(error.retryAfterMs);
        const waitMs = Math.max(1000, Number.isFinite(retryAfterMs) && retryAfterMs > 0 ? retryAfterMs : 30000);
        if (now() + waitMs >= deadlineAt) throw error;
        await delay(waitMs);
        assertPublicationDeadline(deadlineContext);
      }
    }
    await cleanupUnusedPublicPosts(creativeArtifacts, metaClient, report, deadlineContext);
  } catch (error) {
    if (onDeadline !== 'return' || !isPublicationDeadlineError(error)) throw error;
    deadlineHit = true;
    await releaseInterruptedNodes(nodes, report);
  }

  return {
    id: runId,
    nodes,
    complete: !bounded && !deadlineHit && draftIsComplete(draft, nodes),
    attempted: newNodes,
    ...(deadlineHit ? { deadlineHit: true } : {})
  };
}

// Mốc cứng chỉ ngắt ở các điểm kiểm tra trước/sau lời gọi Meta (lời gọi đang bay vẫn ghi node `created` trước khi kiểm tra),
// nên node còn `creating` lúc này chưa được tạo trên Meta: đưa về retry_pending để giao diện và lần chạy sau xử lý.
async function releaseInterruptedNodes(nodes, report) {
  for (const node of nodes.filter((entry) => entry.status === 'creating')) {
    await report({
      clientId: node.clientId,
      parentClientId: node.parentClientId ?? null,
      type: node.type,
      name: node.name,
      status: 'retry_pending'
    });
  }
}

// Nhận lại đối tượng mà lần chạy trước có thể đã tạo trên Meta trước khi bị ngắt, để không tạo trùng.
// Chỉ nhận khi CHÍNH XÁC 1 đối tượng cùng tên (server đã lọc theo created_time >= mốc bắt đầu lượt chạy).
async function adoptInterruptedNode({
  interruptedClientIds,
  clientId,
  runStartedAt,
  metaClient,
  token,
  parentId,
  edge,
  name,
  deadlineContext
}) {
  const key = String(clientId);
  if (!interruptedClientIds.has(key)) return null;
  // Keep uncertain Ads marked across quota retries; a second pass must not POST blindly.
  if (edge !== 'ads') interruptedClientIds.delete(key);
  const unresolved = () => {
    if (edge === 'ads') {
      const error = new Error('Không xác định được quảng cáo sau khi lượt chạy bị ngắt; hãy kiểm tra trên Meta trước khi thử lại.');
      error.name = 'UncertainAdWriteError';
      throw error;
    }
    return null;
  };
  if (!Number.isFinite(runStartedAt) || typeof metaClient.findCreatedObject !== 'function') return unresolved();
  try {
    const matches = await metaClient.findCreatedObject(token, parentId, edge, name, {
      sinceMs: runStartedAt - 60_000,
      ...publicationOptions(deadlineContext)
    });
    return matches.length === 1 && matches[0]?.id ? String(matches[0].id) : unresolved();
  } catch (error) {
    if (publicationDeadlineError(error, deadlineContext) || isMetaThrottleError(error)) throw error;
    return unresolved();
  }
}

function createAd(options) {
  return withErrorContext({ clientId: options.ad.clientId, nodeType: 'ad', nodeName: options.ad.name },
    () => createAdWithContext(options));
}

async function createAdWithContext({
  ad,
  adSetId,
  parentClientId,
  accountId,
  pageId,
  token,
  metaClient,
  pagePublishingContexts,
  getMedia,
  ownerMetaUserId,
  report,
  delay,
  deadlineContext,
  creativeArtifacts,
  metaVideoIds,
  metaImageHashes,
  readyVideos,
  getMetaVideoId,
  saveMetaVideoId,
  deleteMetaVideoId,
  adopt = async () => null,
  canReconcile = false
}) {
  assertPublicationDeadline(deadlineContext);
  await report({ clientId: ad.clientId, parentClientId, type: 'ad', name: ad.name, status: 'creating' });
  let artifact = null;
  try {
    const adoptedAdId = await adopt(ad.clientId, adSetId, 'ads', ad.name);
    if (adoptedAdId) {
      // Quảng cáo đã được tạo trước khi lượt chạy bị ngắt: không tạo lại mẫu/quảng cáo; bước đồng bộ Post ID sẽ bổ sung Post ID.
      await report({ clientId: ad.clientId, parentClientId, type: 'ad', name: ad.name, status: 'created', remoteId: adoptedAdId });
      return;
    }
    artifact = await getCreativeArtifact({
      creativeArtifacts,
      ad,
      accountId,
      pageId,
      token,
      metaClient,
      pagePublishingContexts,
      getMedia,
      ownerMetaUserId,
      delay,
      deadlineContext,
      metaVideoIds,
      metaImageHashes,
      readyVideos,
      getMetaVideoId,
      saveMetaVideoId,
      deleteMetaVideoId
    });
    assertPublicationDeadline(deadlineContext);
    const writeStartedAt = Math.floor(deadlineContext.now() / 1000) * 1000;
    let remoteId;
    try {
      remoteId = await metaClient.createAd(
        token, accountId, buildAdParams(adSetId, artifact.creativeId, ad), publicationOptions(deadlineContext)
      );
    } catch (error) {
      if (error?.name !== 'TypeError' || error.message !== 'fetch failed') throw error;
      let reconciliation = 'unavailable';
      // A missing read result cannot prove the write failed. Only adopt an exact, unique match.
      try {
        if (!canReconcile || !metaClient.findCreatedObject) throw error;
        for (const waitMs of [1000, 3000]) {
          await delay(waitMs);
          assertPublicationDeadline(deadlineContext);
          const matches = await metaClient.findCreatedObject(token, adSetId, 'ads', ad.name, {
            sinceMs: writeStartedAt, creativeId: artifact.creativeId, ...publicationOptions(deadlineContext)
          });
          reconciliation = matches.length > 1 ? 'ambiguous' : matches.length === 1 ? 'matched' : 'not_found';
          if (matches.length > 1) break;
          if (matches.length === 1 && matches[0].id) { remoteId = String(matches[0].id); break; }
        }
      } catch { reconciliation = 'lookup_failed'; }
      if (!remoteId) {
        const uncertain = new Error('Mất phản hồi tạo quảng cáo; cần kiểm tra trên Meta trước khi thử lại để tránh trùng.');
        uncertain.name = 'UncertainAdWriteError';
        uncertain.reconciliation = reconciliation;
        const networkCode = error.cause?.code;
        if (['ECONNRESET', 'ECONNREFUSED', 'EAI_AGAIN', 'ENOTFOUND', 'ETIMEDOUT',
          'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_HEADERS_TIMEOUT', 'UND_ERR_BODY_TIMEOUT', 'UND_ERR_SOCKET'].includes(networkCode)) {
          uncertain.networkCode = networkCode;
        }
        throw uncertain;
      }
    }
    artifact.successfulAds += 1;
    const createdNode = {
      clientId: ad.clientId,
      parentClientId,
      type: 'ad',
      name: ad.name,
      status: 'created',
      remoteId,
      creativeId: artifact.creativeId,
      creativeArtifactKey: creativeArtifactKey(accountId, pageId, ad),
      ...(artifact.postId ? { postId: artifact.postId } : {}),
      ...(artifact.permalinkUrl ? { permalinkUrl: artifact.permalinkUrl } : {})
    };
    await report(createdNode);
    assertPublicationDeadline(deadlineContext);
    if (artifact.permalinkUrl || typeof metaClient.getAdPublication !== 'function') return;
    // Chạy sau khi nhả slot tạo (xem publishDraft), nên không làm chậm ad kế tiếp.
    // Ads sharing a creative share its Post, so one lookup (and its failure) serves every sibling;
    // a Post that is not ready yet is left to the publication sync and its backoff.
    return (lookupGate) => lookupGate(async () => {
      try {
        artifact.publicationLookup ??= metaClient.getAdPublication(
          token,
          remoteId,
          publicationOptions(deadlineContext)
        );
        const publication = await artifact.publicationLookup;
        artifact.postId = publication?.postId ?? artifact.postId;
        artifact.permalinkUrl = publication?.permalinkUrl ?? artifact.permalinkUrl;
        if (artifact.postId || artifact.permalinkUrl) {
          await report({
            ...createdNode,
            ...(artifact.postId ? { postId: artifact.postId } : {}),
            ...(artifact.permalinkUrl ? { permalinkUrl: artifact.permalinkUrl } : {})
          });
        }
      } catch (error) {
        recordError(error, { stage: 'publish-publication-lookup', clientId: ad.clientId, nodeType: 'ad', nodeName: ad.name });
      }
      assertPublicationDeadline(deadlineContext);
    });
  } catch (error) {
    const deadlineError = publicationDeadlineError(error, deadlineContext);
    if (deadlineError) {
      if (artifact?.postId && artifact.successfulAds === 0) {
        await cleanupArtifactAfterDeadline(artifact, metaClient, deadlineError);
      }
      throw deadlineError;
    }
    if (isMetaThrottleError(error)) {
      await report({
        clientId: ad.clientId,
        parentClientId,
        type: 'ad',
        name: ad.name,
        status: 'retry_pending',
        ...(artifact?.creativeId ? {
          creativeId: artifact.creativeId,
          creativeArtifactKey: creativeArtifactKey(accountId, pageId, ad)
        } : {}),
        ...(artifact?.postId ? { postId: artifact.postId } : {}),
        error: normalizeError(error)
      });
      throw error;
    }
    recordError(error, { stage: 'publish-ad', clientId: ad.clientId, nodeType: 'ad', nodeName: ad.name });
    const normalizedError = { ...normalizeError(error) };
    const failedNode = {
      clientId: ad.clientId,
      parentClientId,
      type: 'ad',
      name: ad.name,
      status: 'failed',
      ...(artifact?.creativeId ? { creativeId: artifact.creativeId } : {}),
      ...((artifact?.postId || error.postId) ? { postId: artifact?.postId ?? error.postId } : {}),
      error: normalizedError
    };
    if (artifact) artifact.failedAds.push(failedNode);
    await report(failedNode);
  }
}

function getCreativeArtifact({ creativeArtifacts, ad, accountId, pageId, ...context }) {
  const key = creativeArtifactKey(accountId, pageId, ad);
  if (!creativeArtifacts.has(key)) {
    creativeArtifacts.set(key, createCreativeArtifact({ ad, accountId, pageId, ...context }));
  }
  return creativeArtifacts.get(key);
}

async function createCreativeArtifact({
  ad,
  accountId,
  pageId,
  token,
  metaClient,
  pagePublishingContexts,
  getMedia,
  ownerMetaUserId,
  delay,
  deadlineContext,
  metaVideoIds,
  metaImageHashes,
  readyVideos,
  getMetaVideoId,
  saveMetaVideoId,
  deleteMetaVideoId
}) {
  assertPublicationDeadline(deadlineContext);
  const media = await getMedia(ownerMetaUserId, ad.mediaId);
  if (!media) {
    throw new Error('Media đã chọn không còn tồn tại');
  }

  if ((ad.publicationMode ?? 'DARK') !== 'PUBLIC_TEST') {
    const creativeId = await createCreativeForMedia({
      ad,
      media,
      accountId,
      pageId,
      token,
      metaClient,
      delay,
      deadlineContext,
      metaVideoIds,
      metaImageHashes,
      readyVideos,
      getMetaVideoId,
      saveMetaVideoId,
      deleteMetaVideoId,
      ownerMetaUserId
    });
    return {
      creativeId,
      postId: null,
      permalinkUrl: null,
      pageAccessToken: '',
      successfulAds: 0,
      failedAds: []
    };
  }

  if (!media.mimeType.startsWith('image/')) {
    throw new Error('Public Test hiện chỉ hỗ trợ ảnh; video cần Meta App Live');
  }
  const pageContext = pagePublishingContexts.get(String(pageId));
  if (!pageContext?.accessToken) {
    throw new Error('Không tìm thấy Page access token để đăng bài Public Test');
  }

  let publicPost;
  try {
    assertPublicationDeadline(deadlineContext);
    publicPost = await metaClient.createPublicPhotoPost(
      pageContext.accessToken,
      pageId,
      media,
      ad.primaryText,
      publicationOptions(deadlineContext)
    );
    assertPublicationDeadline(deadlineContext);
    const creativeId = await metaClient.createCreative(
      token,
      accountId,
      buildPublicPostCreativeParams(publicPost.postId, ad),
      publicationOptions(deadlineContext)
    );
    assertPublicationDeadline(deadlineContext);
    return {
      creativeId,
      postId: publicPost.postId,
      pageAccessToken: pageContext.accessToken,
      successfulAds: 0,
      failedAds: []
    };
  } catch (error) {
    const deadlineError = publicationDeadlineError(error, deadlineContext);
    if (deadlineError) {
      if (publicPost?.postId) {
        await cleanupPublicPostAfterDeadline({
          metaClient,
          pageAccessToken: pageContext.accessToken,
          postId: publicPost.postId,
          deadlineError
        });
      }
      throw deadlineError;
    }
    if (!publicPost?.postId) throw error;
    let postDeleted = false;
    try {
      assertPublicationDeadline(deadlineContext);
      await metaClient.deletePagePost(
        pageContext.accessToken,
        publicPost.postId,
        publicationOptions(deadlineContext)
      );
      postDeleted = true;
      assertPublicationDeadline(deadlineContext);
    } catch (cleanupError) {
      const cleanupDeadlineError = publicationDeadlineError(cleanupError, deadlineContext);
      if (cleanupDeadlineError) {
        if (!postDeleted) {
          await cleanupPublicPostAfterDeadline({
            metaClient,
            pageAccessToken: pageContext.accessToken,
            postId: publicPost.postId,
            deadlineError: cleanupDeadlineError
          });
        }
        throw cleanupDeadlineError;
      }
      throw appendCleanupError(error, cleanupError, publicPost.postId);
    }
    throw error;
  }
}

function creativeArtifactKey(accountId, pageId, ad) {
  return JSON.stringify({
    accountId,
    creativeGroupId: ad.creativeGroupId ?? ad.clientId,
    pageId: String(pageId),
    publicationMode: ad.publicationMode ?? 'DARK',
    mediaId: ad.mediaId,
    primaryText: ad.primaryText ?? '',
    headline: ad.headline ?? '',
    conversation: visibleConversationSignature(ad.conversation)
  });
}

function seedCreativeArtifacts(draft, nodes) {
  const artifacts = new Map();
  const adsByClientId = new Map();
  for (const campaign of draft.campaigns) {
    for (const adSet of campaign.adSets) {
      for (const ad of adSet.ads) {
        adsByClientId.set(ad.clientId, { ad, accountId: campaign.adAccountId, pageId: campaign.pageId });
      }
    }
  }

  for (const node of nodes) {
    if (node.type !== 'ad' || !['created', 'retry_pending'].includes(node.status) || !node.creativeId || !node.creativeArtifactKey) continue;
    const match = adsByClientId.get(node.clientId);
    if (!match) continue;
    const key = creativeArtifactKey(match.accountId, match.pageId, match.ad);
    if (key !== node.creativeArtifactKey) continue;
    const current = artifacts.get(key);
    if (current) {
      if (node.status === 'created') current.then((artifact) => { artifact.successfulAds += 1; });
      continue;
    }
    artifacts.set(key, Promise.resolve({
      creativeId: node.creativeId,
      postId: node.postId ?? null,
      permalinkUrl: node.permalinkUrl ?? null,
      pageAccessToken: '',
      successfulAds: node.status === 'created' ? 1 : 0,
      failedAds: []
    }));
  }
  return artifacts;
}

function visibleConversationSignature(conversation = {}) {
  return {
    greeting: conversation.greeting ?? '',
    quickReplies: (conversation.quickReplies ?? []).map(({ title, payload }) => ({ title, payload })),
    showBusinessPhoneNumber: Boolean(conversation.showBusinessPhoneNumber),
    businessPhoneNumber: conversation.businessPhoneNumber ?? '',
    customerActions: (conversation.customerActions ?? []).map(({ label, type, value }) => ({
      label,
      type,
      value
    }))
  };
}

async function cleanupUnusedPublicPosts(creativeArtifacts, metaClient, report, deadlineContext) {
  for (const artifactPromise of creativeArtifacts.values()) {
    let artifact;
    try {
      artifact = await artifactPromise;
    } catch (error) {
      const deadlineError = publicationDeadlineError(error, deadlineContext);
      if (deadlineError) throw deadlineError;
      continue;
    }
    if (!artifact.postId || artifact.successfulAds > 0 || artifact.failedAds.length === 0) continue;
    let postDeleted = false;
    try {
      assertPublicationDeadline(deadlineContext);
      await metaClient.deletePagePost(
        artifact.pageAccessToken,
        artifact.postId,
        publicationOptions(deadlineContext)
      );
      postDeleted = true;
      assertPublicationDeadline(deadlineContext);
    } catch (cleanupError) {
      const deadlineError = publicationDeadlineError(cleanupError, deadlineContext);
      if (deadlineError) {
        if (!postDeleted) await cleanupArtifactAfterDeadline(artifact, metaClient, deadlineError);
        throw deadlineError;
      }
      const cleanupMessage = normalizeError(cleanupError).message;
      for (const failedNode of artifact.failedAds) {
        await report({
          ...failedNode,
          postId: artifact.postId,
          error: {
            ...failedNode.error,
            message: `${failedNode.error.message} | Không xóa được bài công khai ${artifact.postId}: ${cleanupMessage}`
          }
        });
      }
    }
  }
}

function appendCleanupError(error, cleanupError, postId) {
  const normalizedError = normalizeError(error);
  const cleanupMessage = normalizeError(cleanupError).message;
  const wrapped = new Error(
    `${normalizedError.message} | Không xóa được bài công khai ${postId}: ${cleanupMessage}`
  );
  wrapped.meta = { ...normalizedError, message: wrapped.message };
  wrapped.postId = postId;
  return wrapped;
}

async function createCreativeForMedia({
  ad,
  media,
  accountId,
  pageId,
  token,
  metaClient,
  delay,
  deadlineContext,
  metaVideoIds,
  metaImageHashes,
  readyVideos,
  getMetaVideoId,
  saveMetaVideoId,
  deleteMetaVideoId,
  ownerMetaUserId
}) {
  if (media.mimeType.startsWith('image/')) {
    assertPublicationDeadline(deadlineContext);
    const imageHash = media.metaImageHash ?? await sharedImageHash({
      metaImageHashes,
      ownerMetaUserId,
      accountId,
      media,
      upload: () => metaClient.uploadImage(token, accountId, media, publicationOptions(deadlineContext))
    });
    assertPublicationDeadline(deadlineContext);
    const creativeId = await createCreativeWithRetry({
      metaClient,
      token,
      accountId,
      params: buildImageCreativeParams(pageId, imageHash, ad),
      delay,
      deadlineContext
    });
    assertPublicationDeadline(deadlineContext);
    return creativeId;
  }

  if (!media.mimeType.startsWith('video/')) {
    throw new Error('Chỉ hỗ trợ ảnh hoặc video');
  }

  assertPublicationDeadline(deadlineContext);
  const cacheKey = `${accountId}:${media.id}`;
  let videoIdPromise = metaVideoIds?.get(cacheKey);
  if (!videoIdPromise) {
    const uploadKey = `${ownerMetaUserId}:${cacheKey}`;
    videoIdPromise = activeMetaVideoUploads.get(uploadKey);
    if (!videoIdPromise) {
      videoIdPromise = (async () => {
        const cachedVideoId = media.metaVideoId ?? await getMetaVideoId(ownerMetaUserId, media.id, accountId);
        if (cachedVideoId) return String(cachedVideoId);
        const uploadedVideoId = await metaClient.uploadVideo(
          token,
          accountId,
          media,
          publicationOptions(deadlineContext)
        );
        await saveMetaVideoId(ownerMetaUserId, media.id, accountId, uploadedVideoId);
        return String(uploadedVideoId);
      })();
      activeMetaVideoUploads.set(uploadKey, videoIdPromise);
      void videoIdPromise.then(
        () => activeMetaVideoUploads.delete(uploadKey),
        () => activeMetaVideoUploads.delete(uploadKey)
      );
    }
    metaVideoIds?.set(cacheKey, videoIdPromise);
  }
  const videoId = await videoIdPromise;
  assertPublicationDeadline(deadlineContext);
  let thumbnailPromise = readyVideos?.get(cacheKey);
  if (!thumbnailPromise) {
    const readyThumbnail = knownReadyVideo(ownerMetaUserId, accountId, videoId);
    thumbnailPromise = readyThumbnail
      ? Promise.resolve(readyThumbnail)
      : waitForVideoReady(metaClient, token, videoId, delay, deadlineContext)
        .then((video) => rememberReadyVideo(ownerMetaUserId, accountId, videoId, video));
    readyVideos?.set(cacheKey, thumbnailPromise);
  }
  let thumbnail;
  try {
    thumbnail = await thumbnailPromise;
  } catch (error) {
    if (error?.code === 'META_VIDEO_PROCESSING_FAILED') {
      metaVideoIds?.delete(cacheKey);
      readyVideos?.delete(cacheKey);
      await deleteMetaVideoId(ownerMetaUserId, media.id, accountId, videoId);
    }
    throw error;
  }
  assertPublicationDeadline(deadlineContext);
  const creativeId = await createCreativeWithRetry({
    metaClient,
    token,
    accountId,
    params: buildVideoCreativeParams(pageId, videoId, thumbnail, ad),
    delay,
    deadlineContext
  });
  assertPublicationDeadline(deadlineContext);
  return creativeId;
}

// Same pattern as the video upload above: one upload per owner/account/image at a time, reused by every
// creative in this run. Creatives stay separate. A failed upload is forgotten so the next creative retries.
function sharedImageHash({ metaImageHashes, ownerMetaUserId, accountId, media, upload }) {
  if (!media.id) return upload();
  const cacheKey = `${accountId}:${media.id}`;
  let hashPromise = metaImageHashes.get(cacheKey);
  if (!hashPromise) {
    const uploadKey = `${ownerMetaUserId}:${cacheKey}`;
    hashPromise = activeMetaImageUploads.get(uploadKey);
    if (!hashPromise) {
      hashPromise = upload();
      activeMetaImageUploads.set(uploadKey, hashPromise);
      void hashPromise.then(
        () => activeMetaImageUploads.delete(uploadKey),
        () => activeMetaImageUploads.delete(uploadKey)
      );
    }
    metaImageHashes.set(cacheKey, hashPromise);
    void hashPromise.catch(() => {
      if (metaImageHashes.get(cacheKey) === hashPromise) metaImageHashes.delete(cacheKey);
    });
  }
  return hashPromise;
}

async function createCreativeWithRetry({
  metaClient,
  token,
  accountId,
  params,
  delay,
  deadlineContext
}) {
  for (let attempt = 0; ; attempt += 1) {
    assertPublicationDeadline(deadlineContext);
    try {
      return await metaClient.createCreative(
        token,
        accountId,
        params,
        publicationOptions(deadlineContext)
      );
    } catch (error) {
      const retryDelay = TRANSIENT_CREATIVE_RETRY_DELAYS_MS[attempt];
      if (!isTransientCreativeError(error) || retryDelay === undefined) throw error;
      if (deadlineContext.now() + retryDelay >= deadlineContext.deadlineAt) throw error;
      await delay(retryDelay);
    }
  }
}

function isTransientCreativeError(error) {
  const normalized = normalizeError(error);
  return Number(normalized.code) === 100 && Number(normalized.subcode) === 1487390;
}

async function waitForVideoReady(metaClient, token, videoId, delay, deadlineContext) {
  const videoDeadlineAt = Math.min(deadlineContext.now() + 120_000, deadlineContext.deadlineAt);
  const pollDelays = [0, 2_000, 4_000, 8_000, 15_000, 30_000];
  let pollCount = 0;
  while (true) {
    assertPublicationDeadline(deadlineContext);
    if (deadlineContext.now() >= videoDeadlineAt) {
      throw new Error('Video xử lý quá lâu');
    }
    const pollDelay = pollDelays[Math.min(pollCount, pollDelays.length - 1)];
    pollCount += 1;
    if (pollDelay > 0) await delay(Math.min(pollDelay, videoDeadlineAt - deadlineContext.now()));
    assertPublicationDeadline(deadlineContext);
    const video = await metaClient.getVideoStatus(
      token,
      videoId,
      publicationOptions(deadlineContext)
    );
    assertPublicationDeadline(deadlineContext);
    const status = video.status?.video_status;
    if (status === 'ready') return video;
    if (status === 'error') {
      const error = new Error('Meta không xử lý được video');
      error.code = 'META_VIDEO_PROCESSING_FAILED';
      throw error;
    }
  }
}

async function createNode({ report, clientId, parentClientId = null, name, type, create, deadlineContext }) {
  assertPublicationDeadline(deadlineContext);
  await report({ clientId, parentClientId, type, name, status: 'creating' });
  try {
    assertPublicationDeadline(deadlineContext);
    const remoteId = await withErrorContext({ clientId, nodeType: type, nodeName: name }, create);
    const result = { clientId, parentClientId, type, name, status: 'created', remoteId };
    await report(result);
    assertPublicationDeadline(deadlineContext);
    return result;
  } catch (error) {
    recordError(error, { stage: 'publish-node', clientId, nodeType: type, nodeName: name });
    const deadlineError = publicationDeadlineError(error, deadlineContext);
    if (deadlineError) throw deadlineError;
    if (isMetaThrottleError(error)) {
      await report({ clientId, parentClientId, type, name, status: 'retry_pending', error: normalizeError(error) });
      throw error;
    }
    const result = { clientId, parentClientId, type, name, status: 'failed', error: normalizeError(error) };
    await report(result);
    return result;
  }
}

async function skipCampaignChildren(campaign, report, parentClientId, nodes) {
  for (const adSet of campaign.adSets) {
    if (!terminalNode(nodes, adSet.clientId)) {
      await report({ clientId: adSet.clientId, parentClientId, type: 'adSet', name: adSet.name, status: 'skipped' });
    }
    await skipAds(adSet, report, adSet.clientId, nodes);
  }
}

async function skipAds(adSet, report, parentClientId, nodes) {
  for (const ad of adSet.ads) {
    if (!terminalNode(nodes, ad.clientId)) {
      await report({ clientId: ad.clientId, parentClientId, type: 'ad', name: ad.name, status: 'skipped' });
    }
  }
}

function createGate(limit) {
  let active = 0;
  const waiting = [];
  return async (task) => {
    if (active >= limit) await new Promise((resolve) => waiting.push(resolve));
    active += 1;
    try {
      return await task();
    } finally {
      active -= 1;
      waiting.shift()?.();
    }
  };
}

// Chờ hết mọi task đang chạy rồi mới ném lỗi đầu tiên, để không bỏ rơi request Meta giữa chừng.
async function runAll(items, task) {
  const results = await Promise.allSettled(items.map(task));
  const failed = results.find((result) => result.status === 'rejected');
  if (failed) throw failed.reason;
}

function terminalNode(nodes, clientId) {
  return nodes.find((node) => node.clientId === clientId && ['created', 'failed', 'skipped'].includes(node.status));
}

function draftIsComplete(draft, nodes) {
  return draft.campaigns.every((campaign) => (
    terminalNode(nodes, campaign.clientId)
    && campaign.adSets.every((adSet) => (
      terminalNode(nodes, adSet.clientId)
      && adSet.ads.every((ad) => terminalNode(nodes, ad.clientId))
    ))
  ));
}

function normalizeError(error) {
  return error.meta ?? {
    message: error.message ?? 'Không thể tạo đối tượng quảng cáo',
    type: error.name ?? 'Error',
    code: null,
    subcode: null,
    fbtraceId: null,
    ...(error.diagnosticId ? { diagnosticId: error.diagnosticId } : {}),
    ...(error.networkCodes?.length ? { networkCodes: error.networkCodes } : {}),
    ...(error.name === 'UncertainAdWriteError' ? {
      ...(error.networkCode ? { networkCode: error.networkCode } : {}),
      ...(error.reconciliation ? { reconciliation: error.reconciliation } : {})
    } : {})
  };
}

function assertPublicationDeadline({ deadlineAt, now, signal }) {
  if (!signal?.aborted && now() < deadlineAt) return;
  throw new PublicationDeadlineError();
}

function isPublicationDeadlineError(error) {
  return error?.name === 'PublicationDeadlineError';
}

function publicationDeadlineError(error, deadlineContext) {
  if (isPublicationDeadlineError(error)) return error;
  if (
    deadlineContext.signal?.aborted
    || deadlineContext.now() >= deadlineContext.deadlineAt
    || error?.name === 'AbortError'
  ) {
    return new PublicationDeadlineError(error);
  }
  return null;
}

function publicationOptions(deadlineContext) {
  return { signal: deadlineContext.signal };
}

async function cleanupArtifactAfterDeadline(artifact, metaClient, deadlineError) {
  if (artifact.deadlineCleanupAttempted) return;
  artifact.deadlineCleanupAttempted = true;
  await cleanupPublicPostAfterDeadline({
    metaClient,
    pageAccessToken: artifact.pageAccessToken,
    postId: artifact.postId,
    deadlineError
  });
}

async function cleanupPublicPostAfterDeadline({
  metaClient,
  pageAccessToken,
  postId,
  deadlineError
}) {
  const cleanupController = new AbortController();
  const cleanupTimer = setTimeout(
    () => cleanupController.abort(),
    PUBLIC_POST_DEADLINE_CLEANUP_MS
  );
  cleanupTimer.unref?.();
  try {
    await metaClient.deletePagePost(
      pageAccessToken,
      postId,
      { signal: cleanupController.signal }
    );
  } catch (cleanupError) {
    appendDeadlineCleanupError(deadlineError, cleanupError, postId);
  } finally {
    clearTimeout(cleanupTimer);
  }
}

function appendDeadlineCleanupError(deadlineError, cleanupError, postId) {
  const cleanupMessage = normalizeError(cleanupError).message;
  deadlineError.message = `${deadlineError.message} | Không xóa được bài Public Test ${postId}: ${cleanupMessage}`;
  deadlineError.cleanupError = normalizeError(cleanupError);
}

class PublicationDeadlineError extends Error {
  constructor(cause) {
    super('Lượt tạo đã hết thời gian xử lý an toàn; hệ thống không tiếp tục tạo thêm đối tượng Meta.');
    this.name = 'PublicationDeadlineError';
    this.expose = true;
    this.code = 'PUBLISH_DEADLINE_EXCEEDED';
    if (cause) this.cause = cause;
  }
}

function defaultDelay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

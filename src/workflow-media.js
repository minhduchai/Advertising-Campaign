import { isMetaThrottleError } from './meta-client.js';
import { knownReadyVideo, rememberReadyVideo } from './publisher.js';

const DEFAULT_RETRY_AFTER_MS = 15_000;

// Bước `media:prepare` của workflow: đảm bảo mọi video khác nhau của lượt tạo đã được upload lên Meta (1 lệnh file_url mỗi video)
// và đã xử lý xong, TRƯỚC khi bắt đầu tạo chiến dịch/nhóm/quảng cáo. Mỗi lời gọi chỉ kiểm tra trạng thái một lần (không chờ
// vòng lặp) để không chiếm hết mốc 95s của bước; còn video chưa sẵn sàng thì trả `pending: true` để workflow ngủ rồi gọi lại.
export async function prepareWorkflowMedia({
  runId,
  ownerMetaUserId,
  draft,
  existingNodes = [],
  token,
  metaClient,
  getMedia,
  getMetaVideoId,
  saveMetaVideoId,
  deleteMetaVideoId,
  updateNodeResult,
  now = Date.now,
  stopStartingAt = Number.POSITIVE_INFINITY,
  retryAfterMs = DEFAULT_RETRY_AFTER_MS
}) {
  const groups = collectMediaGroups(draft);
  const terminalClientIds = new Set(existingNodes
    .filter((node) => ['created', 'failed', 'skipped'].includes(node.status))
    .map((node) => String(node.clientId)));

  let total = 0;
  let ready = 0;
  let failed = 0;
  for (const group of groups) {
    // Every Ad using this video already finished (created, or failed with it): nothing left to prepare,
    // and a failed video must not be uploaded again just because another video is still processing.
    if (group.ads.every(({ ad }) => terminalClientIds.has(String(ad.clientId)))) continue;
    let media;
    try {
      media = await getMedia(group.mediaId);
    } catch {
      continue; // media không còn: bước tạo sẽ báo lỗi rõ ràng cho từng quảng cáo
    }
    if (!media || !String(media.mimeType ?? '').startsWith('video/')) continue;
    total += 1;

    try {
      let videoId = media.metaVideoId ?? await getMetaVideoId(ownerMetaUserId, group.mediaId, group.accountId);
      if (!videoId) {
        if (now() >= stopStartingAt) continue; // hết thời gian bắt đầu việc mới: để lần gọi sau
        videoId = String(await metaClient.uploadVideo(token, group.accountId, media));
        await saveMetaVideoId(ownerMetaUserId, group.mediaId, group.accountId, videoId);
      }
      if (knownReadyVideo(ownerMetaUserId, group.accountId, videoId)) {
        ready += 1;
        continue;
      }
      const video = await metaClient.getVideoStatus(token, videoId);
      const status = video.status?.video_status;
      if (status === 'ready') {
        await rememberReadyVideo(ownerMetaUserId, group.accountId, videoId, video);
        ready += 1;
      } else if (status === 'error') {
        await deleteMetaVideoId(ownerMetaUserId, group.mediaId, group.accountId, videoId);
        failed += 1;
        await failGroup(group, `Meta không xử lý được video ${media.name ?? group.mediaId}`, { runId, updateNodeResult, terminalClientIds });
      }
    } catch (error) {
      if (isMetaThrottleError(error)) throw error;
      failed += 1;
      await failGroup(group, error?.meta?.message ?? error?.message ?? 'Không thể chuẩn bị video', { runId, updateNodeResult, terminalClientIds });
    }
  }

  const pending = ready + failed < total;
  return pending
    ? { status: 'media_preparing', pending: true, ready, total, failed, retryAfterMs }
    : { status: 'media_ready', pending: false, ready, total, failed };
}

function collectMediaGroups(draft) {
  const groups = new Map();
  for (const campaign of draft?.campaigns ?? []) {
    for (const adSet of campaign.adSets ?? []) {
      for (const ad of adSet.ads ?? []) {
        if (!ad.mediaId) continue;
        // Media đã nằm sẵn trên Meta (ảnh có image_hash, video có video_id) không cần chuẩn bị.
        if (ad.mediaAsset?.kind === 'image' || ad.mediaAsset?.videoId) continue;
        const key = `${campaign.adAccountId}:${ad.mediaId}`;
        if (!groups.has(key)) groups.set(key, { accountId: campaign.adAccountId, mediaId: ad.mediaId, ads: [] });
        groups.get(key).ads.push({ ad, adSetClientId: adSet.clientId });
      }
    }
  }
  return [...groups.values()];
}

async function failGroup(group, message, { runId, updateNodeResult, terminalClientIds }) {
  for (const { ad, adSetClientId } of group.ads) {
    if (terminalClientIds.has(String(ad.clientId))) continue;
    terminalClientIds.add(String(ad.clientId));
    await updateNodeResult(runId, {
      clientId: ad.clientId,
      parentClientId: adSetClientId,
      type: 'ad',
      name: ad.name,
      status: 'failed',
      error: { message, type: 'MediaPrepareError', code: null, subcode: null, fbtraceId: null }
    });
  }
}

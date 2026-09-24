import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareWorkflowMedia } from '../src/workflow-media.js';

function draftWith(ads) {
  return { campaigns: [{ clientId: 'c1', adAccountId: 'act_1', adSets: [{ clientId: 's1', ads }] }] };
}

function harness({ media, videoIds = {}, statusByVideoId = {}, uploadError, statusError } = {}) {
  const calls = { upload: [], status: [], saved: [], deleted: [], nodes: [] };
  return {
    calls,
    base: {
      runId: 'run-1',
      ownerMetaUserId: 'owner-1',
      token: 'token',
      getMedia: async (mediaId) => {
        if (!media[mediaId]) throw new Error('Media not found');
        return media[mediaId];
      },
      getMetaVideoId: async (_owner, mediaId) => videoIds[mediaId] ?? null,
      saveMetaVideoId: async (_owner, mediaId, accountId, videoId) => { calls.saved.push([mediaId, accountId, videoId]); },
      deleteMetaVideoId: async (_owner, mediaId, accountId, videoId) => { calls.deleted.push([mediaId, accountId, videoId]); },
      updateNodeResult: async (runId, node) => { calls.nodes.push([runId, node]); },
      metaClient: {
        uploadVideo: async (_token, accountId, item) => {
          if (uploadError) throw uploadError;
          calls.upload.push([accountId, item.name]);
          return `video-of-${item.name}`;
        },
        getVideoStatus: async (_token, videoId) => {
          calls.status.push(videoId);
          if (statusError) throw statusError;
          return { status: { video_status: statusByVideoId[videoId] ?? 'processing' } };
        }
      }
    }
  };
}

test('uploads each distinct video once and stays pending until Meta reports ready', async () => {
  const { base, calls } = harness({ media: { m1: { id: 'm1', name: 'a.mp4', mimeType: 'video/mp4' } } });
  const draft = draftWith([{ clientId: 'a1', mediaId: 'm1' }, { clientId: 'a2', mediaId: 'm1' }]);

  const result = await prepareWorkflowMedia({ ...base, draft });

  assert.deepEqual(result, { status: 'media_preparing', pending: true, ready: 0, total: 1, failed: 0, retryAfterMs: 15000 });
  assert.equal(calls.upload.length, 1, 'hai quảng cáo dùng chung video chỉ upload một lần');
  assert.deepEqual(calls.saved, [['m1', 'act_1', 'video-of-a.mp4']]);
  assert.deepEqual(calls.status, ['video-of-a.mp4'], 'chỉ kiểm tra trạng thái đúng một lần, không chờ vòng lặp');
});

test('does not upload again when a video id is already stored, and reports ready', async () => {
  const { base, calls } = harness({
    media: { m1: { id: 'm1', name: 'a.mp4', mimeType: 'video/mp4' } },
    videoIds: { m1: 'stored-video' },
    statusByVideoId: { 'stored-video': 'ready' }
  });

  const result = await prepareWorkflowMedia({ ...base, draft: draftWith([{ clientId: 'a1', mediaId: 'm1' }]) });

  assert.deepEqual(result, { status: 'media_ready', pending: false, ready: 1, total: 1, failed: 0 });
  assert.equal(calls.upload.length, 0);
});

test('a video that Meta fails to process only fails the ads using it', async () => {
  const { base, calls } = harness({
    media: {
      bad: { id: 'bad', name: 'bad.mp4', mimeType: 'video/mp4' },
      good: { id: 'good', name: 'good.mp4', mimeType: 'video/mp4' }
    },
    videoIds: { bad: 'bad-video', good: 'good-video' },
    statusByVideoId: { 'bad-video': 'error', 'good-video': 'ready' }
  });
  const draft = draftWith([
    { clientId: 'a1', name: 'Ad 1', mediaId: 'bad' },
    { clientId: 'a2', name: 'Ad 2', mediaId: 'bad' },
    { clientId: 'a3', name: 'Ad 3', mediaId: 'good' }
  ]);

  const result = await prepareWorkflowMedia({ ...base, draft });

  assert.equal(result.pending, false);
  assert.equal(result.ready, 1);
  assert.equal(result.failed, 1);
  assert.deepEqual(calls.deleted, [['bad', 'act_1', 'bad-video']]);
  assert.deepEqual(calls.nodes.map(([, node]) => [node.clientId, node.status, node.parentClientId]), [
    ['a1', 'failed', 's1'],
    ['a2', 'failed', 's1']
  ]);
  assert.match(calls.nodes[0][1].error.message, /bad\.mp4/);
});

test('skips images, media already on Meta and ads without media', async () => {
  const { base, calls } = harness({ media: { img: { id: 'img', name: 'a.jpg', mimeType: 'image/jpeg' } } });
  const draft = draftWith([
    { clientId: 'a1', mediaId: 'img' },
    { clientId: 'a2', mediaId: 'meta-video-1', mediaAsset: { kind: 'video', videoId: 'v1' } },
    { clientId: 'a3', mediaId: 'meta-image-1', mediaAsset: { kind: 'image', imageHash: 'h' } },
    { clientId: 'a4' }
  ]);

  const result = await prepareWorkflowMedia({ ...base, draft });

  assert.deepEqual(result, { status: 'media_ready', pending: false, ready: 0, total: 0, failed: 0 });
  assert.equal(calls.upload.length + calls.status.length, 0);
});

test('an upload error that is not a throttle fails the affected ads; a throttle error propagates', async () => {
  const media = { m1: { id: 'm1', name: 'a.mp4', mimeType: 'video/mp4' } };
  const draft = draftWith([{ clientId: 'a1', name: 'Ad 1', mediaId: 'm1' }]);

  const failing = harness({ media, uploadError: Object.assign(new Error('Could not download the video from file_url'), { meta: { message: 'Could not download the video from file_url' } }) });
  const result = await prepareWorkflowMedia({ ...failing.base, draft });
  assert.equal(result.failed, 1);
  assert.equal(result.pending, false);
  assert.equal(failing.calls.nodes[0][1].status, 'failed');

  const throttled = harness({ media, uploadError: Object.assign(new Error('Đang chờ hạn mức Meta'), { name: 'MetaThrottleError', statusCode: 429, retryable: true }) });
  await assert.rejects(() => prepareWorkflowMedia({ ...throttled.base, draft }), /Đang chờ hạn mức Meta/);
  assert.equal(throttled.calls.nodes.length, 0);
});

test('stops starting new uploads after the soft deadline and stays pending', async () => {
  const { base, calls } = harness({ media: { m1: { id: 'm1', name: 'a.mp4', mimeType: 'video/mp4' } } });

  const result = await prepareWorkflowMedia({
    ...base,
    draft: draftWith([{ clientId: 'a1', mediaId: 'm1' }]),
    now: () => 1000,
    stopStartingAt: 500
  });

  assert.equal(result.pending, true);
  assert.equal(calls.upload.length, 0);
});

test('does not overwrite ads that already finished', async () => {
  const { base, calls } = harness({
    media: { m1: { id: 'm1', name: 'a.mp4', mimeType: 'video/mp4' } },
    videoIds: { m1: 'video-1' },
    statusByVideoId: { 'video-1': 'error' }
  });

  await prepareWorkflowMedia({
    ...base,
    draft: draftWith([{ clientId: 'a1', name: 'Ad 1', mediaId: 'm1' }, { clientId: 'a2', name: 'Ad 2', mediaId: 'm1' }]),
    existingNodes: [{ clientId: 'a1', type: 'ad', status: 'created', remoteId: 'ad-1' }]
  });

  assert.deepEqual(calls.nodes.map(([, node]) => node.clientId), ['a2']);
});

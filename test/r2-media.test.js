import test from 'node:test';
import assert from 'node:assert/strict';
import { MAX_MEDIA_BYTES } from '../src/media-store.js';
import { createR2MediaStore } from '../src/r2-media.js';

const config = {
  r2Enabled: true,
  r2Endpoint: 'https://account.r2.cloudflarestorage.com',
  r2AccessKeyId: 'access-key',
  r2SecretAccessKey: 'secret-key',
  r2BucketName: 'media-bucket'
};

function createStore({ send, signUrl, saveMedia = (media) => media, registeredR2Keys = async () => [], configOverrides = {}, db = {} } = {}) {
  const client = { send: send ?? (async () => ({})) };
  return createR2MediaStore({
    config: { ...config, ...configOverrides },
    db: { saveMedia, registeredR2Keys, ...db },
    client,
    signUrl: signUrl ?? (async () => 'https://upload.example.test')
  });
}

test('deletes old temporary objects after storage reaches 9 GB', async () => {
  const commands = [];
  const now = Date.parse('2026-08-20T10:00:00Z');
  const oldDate = new Date(now - 7 * 60 * 60 * 1000);
  const recentDate = new Date(now - 60 * 60 * 1000);
  const store = createStore({
    configOverrides: {
      r2CleanupThresholdBytes: 9 * 1024 ** 3,
      r2CleanupMinAgeMs: 6 * 60 * 60 * 1000
    },
    send: async (command) => {
      commands.push(command);
      if (command.constructor.name === 'ListObjectsV2Command') {
        return {
          Contents: [
            { Key: 'ads/old/video.mp4', Size: 8 * 1024 ** 3, LastModified: oldDate },
            { Key: 'ads/recent/video.mp4', Size: 2 * 1024 ** 3, LastModified: recentDate }
          ]
        };
      }
      return { Deleted: [{ Key: 'ads/old/video.mp4' }] };
    }
  });

  const result = await store.enforceStorageLimit({ force: true, now });

  assert.equal(result.totalBytes, 10 * 1024 ** 3);
  assert.equal(result.deletedBytes, 8 * 1024 ** 3);
  assert.equal(result.deletedCount, 1);
  assert.equal(commands[1].constructor.name, 'DeleteObjectsCommand');
  assert.deepEqual(commands[1].input.Delete.Objects, [{ Key: 'ads/old/video.mp4' }]);
});

test('keeps all temporary objects while storage remains below 9 GB', async () => {
  const commands = [];
  const store = createStore({
    send: async (command) => {
      commands.push(command);
      return command.constructor.name === 'ListObjectsV2Command'
        ? { Contents: [{ Key: 'ads/video.mp4', Size: 8 * 1024 ** 3, LastModified: new Date(0) }] }
        : {};
    }
  });

  const result = await store.enforceStorageLimit({ force: true });

  assert.equal(result.deletedCount, 0);
  assert.deepEqual(commands.map((command) => command.constructor.name), ['ListObjectsV2Command']);
});

test('single-part presigning scopes keys to the authenticated owner and completion rejects a different owner', async () => {
  const commands = [];
  let saved;
  const store = createStore({
    send: async (command) => {
      commands.push(command);
      return command.constructor.name === 'HeadObjectCommand' ? { ContentLength: 10, ContentType: 'image/jpeg' } : {};
    },
    signUrl: async (_client, command) => {
      assert.equal(command.input.Key, 'ads/owner-a/image-1/photo.jpg');
      return 'https://upload.example.test';
    },
    saveMedia: (media) => (saved = media)
  });
  const metadata = { mediaId: 'image-1', name: 'photo.jpg', mimeType: 'image/jpeg', sizeBytes: 10 };
  const signed = await store.presignUpload({ ...metadata, ownerMetaUserId: 'owner-a' });
  const input = { ...metadata, key: signed.key };
  await assert.rejects(store.completeUpload({ ownerMetaUserId: 'owner-b', input }), (error) => error.statusCode === 403);
  assert.ok(!commands.some((command) => command.constructor.name === 'HeadObjectCommand'));
  await store.completeUpload({ ownerMetaUserId: 'owner-a', input });
  assert.equal(saved.ownerMetaUserId, 'owner-a');
  assert.equal(saved.blobPathname, signed.key);
  await assert.rejects(store.completeUpload({ ownerMetaUserId: 'owner-b', input: { ...input, key: 'ads/image-1/photo.jpg' } }));
});

test('cleanup protects registered media of every owner and deletes only enough oldest orphans', async () => {
  const deleted = [];
  const now = Date.now();
  const objects = ['oldest', 'second', 'third', 'draft'].map((id, index) => ({
    Key: `ads/${id}/photo.jpg`, Size: 10, LastModified: new Date(now - (100 - index) * 3600_000)
  }));
  const store = createStore({
    configOverrides: { r2CleanupThresholdBytes: 30 },
    registeredR2Keys: async (bucket, keys) => {
      assert.equal(bucket, config.r2BucketName);
      assert.equal(keys.length, 4);
      return ['ads/draft/photo.jpg'];
    },
    send: async (command) => {
      if (command.constructor.name === 'ListObjectsV2Command') return { Contents: objects };
      assert.equal(command.input.Delete.Quiet, false);
      deleted.push(...command.input.Delete.Objects.map(({ Key }) => Key));
      return { Deleted: command.input.Delete.Objects };
    }
  });
  const result = await store.enforceStorageLimit({ force: true, now });
  assert.deepEqual(deleted, ['ads/oldest/photo.jpg']);
  assert.equal(result.remainingBytes, 30);
  assert.equal(result.protectedCount, 1);
  assert.equal(result.aboveLimit, false);
});

test('cleanup never reports a failed deletion as successful and continues with remaining candidates', async () => {
  const now = Date.now();
  const objects = ['first', 'second', 'third'].map((id, index) => ({
    Key: `ads/${id}/photo.jpg`, Size: 10, LastModified: new Date(now - (100 - index) * 3600_000)
  }));
  let deletes = 0;
  const store = createStore({
    configOverrides: { r2CleanupThresholdBytes: 20 },
    send: async (command) => {
      if (command.constructor.name === 'ListObjectsV2Command') return { Contents: objects };
      deletes += 1;
      return deletes === 1
        ? { Errors: [{ Key: objects[0].Key, Code: 'AccessDenied' }] }
        : { Deleted: command.input.Delete.Objects };
    }
  });
  const result = await store.enforceStorageLimit({ force: true, now });
  assert.equal(deletes, 2);
  assert.equal(result.deletedCount, 1);
  assert.equal(result.deletedBytes, 10);
  assert.equal(result.errors.length, 1);
});

test('cleanup retains registered files even when the bucket remains above its target', async () => {
  const now = Date.now();
  const store = createStore({
    configOverrides: { r2CleanupThresholdBytes: 1 },
    registeredR2Keys: async (_bucket, keys) => keys,
    send: async (command) => {
      assert.equal(command.constructor.name, 'ListObjectsV2Command');
      return { Contents: [{ Key: 'ads/owner/media/photo.jpg', Size: 20, LastModified: new Date(0) }] };
    }
  });
  const result = await store.enforceStorageLimit({ force: true, now });
  assert.equal(result.deletedCount, 0);
  assert.equal(result.aboveLimit, true);
});

test('temporary-media deletion removes matching database metadata only after R2 succeeds', async () => {
  const calls = [];
  const media = { id: 'media', ownerMetaUserId: 'owner', blobUrl: 'r2://media-bucket/ads/owner/media/a.jpg', blobPathname: 'ads/owner/media/a.jpg' };
  const store = createStore({
    send: async () => calls.push('object'),
    db: { deleteMedia: async (...args) => calls.push(args) }
  });
  await store.deleteTemporaryMedia(media);
  assert.deepEqual(calls, ['object', ['owner', 'media', media.blobUrl]]);
  const failed = createStore({
    send: async () => { throw new Error('R2 unavailable'); },
    db: { deleteMedia: () => assert.fail('must preserve metadata after failed deletion') }
  });
  await assert.rejects(failed.deleteTemporaryMedia(media), /unavailable/);
});

test('missing R2 objects fail early with an actionable error instead of a signed broken URL', async () => {
  const store = createStore({
    db: { getMedia: async () => ({ blobUrl: 'r2://media-bucket/missing', blobPathname: 'missing' }) },
    send: async () => { throw Object.assign(new Error('Missing'), { name: 'NotFound' }); },
    signUrl: () => assert.fail('must not sign a URL for missing media')
  });
  await assert.rejects(store.getMetaFetchUrl({ ownerMetaUserId: 'owner', id: 'missing' }),
    (error) => error.statusCode === 410 && error.expose);
});

test('creates an owner-scoped R2 multipart upload', async () => {
  let command;
  const store = createStore({
    send: async (value) => {
      command = value;
      return { UploadId: 'upload-1' };
    }
  });

  const result = await store.createMultipartUpload({
    ownerMetaUserId: 'meta-user-1',
    mediaId: 'media-1',
    name: 'Campaign Video.MP4',
    mimeType: 'video/mp4',
    sizeBytes: 64 * 1024 * 1024
  });

  assert.equal(command.constructor.name, 'CreateMultipartUploadCommand');
  assert.deepEqual(command.input, {
    Bucket: 'media-bucket',
    Key: 'ads/meta-user-1/media-1/Campaign-Video.mp4',
    ContentType: 'video/mp4'
  });
  assert.deepEqual(result, {
    mediaId: 'media-1',
    uploadId: 'upload-1',
    key: 'ads/meta-user-1/media-1/Campaign-Video.mp4'
  });
});

test('presigns only a valid part owned by the connected Meta user', async () => {
  let signedCommand;
  const store = createStore({
    signUrl: async (_client, command, options) => {
      signedCommand = { command, options };
      return 'https://upload.example.test/part-2';
    }
  });
  const input = {
    ownerMetaUserId: 'meta-user-1',
    mediaId: 'media-1',
    uploadId: 'upload-1',
    key: 'ads/meta-user-1/media-1/Campaign-Video.mp4',
    partNumber: 2
  };

  const result = await store.presignMultipartPart(input);

  assert.equal(signedCommand.command.constructor.name, 'UploadPartCommand');
  assert.deepEqual(signedCommand.command.input, {
    Bucket: 'media-bucket',
    Key: input.key,
    UploadId: 'upload-1',
    PartNumber: 2
  });
  assert.deepEqual(signedCommand.options, { expiresIn: 900 });
  assert.deepEqual(result, {
    mediaId: 'media-1',
    uploadId: 'upload-1',
    key: input.key,
    partNumber: 2,
    uploadUrl: 'https://upload.example.test/part-2'
  });

  await assert.rejects(
    store.presignMultipartPart({ ...input, ownerMetaUserId: 'meta-user-2' }),
    (error) => error.statusCode === 403 && /session/i.test(error.message)
  );
  await assert.rejects(
    store.presignMultipartPart({ ...input, key: 'ads/meta-user-1/media-2/Campaign-Video.mp4' }),
    (error) => error.statusCode === 400 && /path/i.test(error.message)
  );
  await assert.rejects(
    store.presignMultipartPart({ ...input, partNumber: 10_001 }),
    (error) => error.statusCode === 400 && /part/i.test(error.message)
  );
});

test('completes parts in order, verifies size, and saves owner metadata', async () => {
  const commands = [];
  let savedMedia;
  const store = createStore({
    send: async (command) => {
      commands.push(command);
      if (command.constructor.name === 'HeadObjectCommand') {
        return { ContentLength: 70_000_000, ContentType: 'video/mp4' };
      }
      return { ETag: 'complete-etag' };
    },
    saveMedia: (media) => {
      savedMedia = media;
      return { ...media, createdAt: 123 };
    }
  });
  const input = {
    ownerMetaUserId: 'meta-user-1',
    mediaId: 'media-1',
    uploadId: 'upload-1',
    key: 'ads/meta-user-1/media-1/Campaign-Video.mp4',
    name: 'Campaign Video.MP4',
    mimeType: 'video/mp4',
    sizeBytes: 70_000_000,
    parts: [
      { partNumber: 2, etag: '"etag-2"' },
      { partNumber: 1, etag: '"etag-1"' }
    ]
  };

  const result = await store.completeMultipartUpload(input);

  assert.equal(commands[0].constructor.name, 'CompleteMultipartUploadCommand');
  assert.deepEqual(commands[0].input, {
    Bucket: 'media-bucket',
    Key: input.key,
    UploadId: 'upload-1',
    MultipartUpload: {
      Parts: [
        { PartNumber: 1, ETag: '"etag-1"' },
        { PartNumber: 2, ETag: '"etag-2"' }
      ]
    }
  });
  assert.equal(commands[1].constructor.name, 'HeadObjectCommand');
  assert.deepEqual(savedMedia, {
    id: 'media-1',
    ownerMetaUserId: 'meta-user-1',
    name: 'Campaign Video.MP4',
    mimeType: 'video/mp4',
    blobUrl: 'r2://media-bucket/ads/meta-user-1/media-1/Campaign-Video.mp4',
    blobPathname: input.key,
    sizeBytes: 70_000_000
  });
  assert.equal(result.createdAt, 123);
});

test('aborts only the owner-scoped multipart upload', async () => {
  let command;
  const store = createStore({ send: async (value) => { command = value; return {}; } });
  const input = {
    ownerMetaUserId: 'meta-user-1',
    mediaId: 'media-1',
    uploadId: 'upload-1',
    key: 'ads/meta-user-1/media-1/Campaign-Video.mp4'
  };

  const result = await store.abortMultipartUpload(input);

  assert.equal(command.constructor.name, 'AbortMultipartUploadCommand');
  assert.deepEqual(command.input, {
    Bucket: 'media-bucket',
    Key: input.key,
    UploadId: 'upload-1'
  });
  assert.deepEqual(result, { mediaId: 'media-1', uploadId: 'upload-1', key: input.key, aborted: true });
});

test('rejects unsupported multipart size and completed object metadata mismatch', async () => {
  let sendCalls = 0;
  const store = createStore({
    send: async (command) => {
      sendCalls += 1;
      if (command.constructor.name === 'HeadObjectCommand') {
        return { ContentLength: 9, ContentType: 'video/mp4' };
      }
      return { UploadId: 'upload-1' };
    }
  });

  await assert.rejects(
    store.createMultipartUpload({
      ownerMetaUserId: 'meta-user-1', mediaId: 'media-1', name: 'video.mp4',
      mimeType: 'video/mp4', sizeBytes: MAX_MEDIA_BYTES + 1
    }),
    (error) => error.statusCode === 413
  );
  assert.equal(sendCalls, 0);

  await assert.rejects(
    store.completeMultipartUpload({
      ownerMetaUserId: 'meta-user-1', mediaId: 'media-1', uploadId: 'upload-1',
      key: 'ads/meta-user-1/media-1/video.mp4', name: 'video.mp4', mimeType: 'video/mp4',
      sizeBytes: 10, parts: [{ partNumber: 1, etag: '"etag-1"' }]
    }),
    (error) => error.statusCode === 400 && /metadata/i.test(error.message)
  );
});

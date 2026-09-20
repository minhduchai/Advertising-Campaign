import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { createSqliteDatabase } from '../src/db.js';
import { createLocalMediaStore, createVercelBlobMediaStore } from '../src/media-store.js';

const maxMediaBytes = 500 * 1024 * 1024;

test('stores local image bytes and enforces owner-scoped reads', async () => {
  const database = createSqliteDatabase(':memory:');
  const store = createLocalMediaStore({ db: database });
  const file = {
    name: 'creative.jpg',
    type: 'image/jpeg',
    size: 11,
    arrayBuffer: async () => Buffer.from('image-bytes')
  };

  const saved = await store.saveUpload({ ownerMetaUserId: 'meta-user-1', file });
  const media = await store.getMedia({ ownerMetaUserId: 'meta-user-1', id: saved.id });

  assert.equal(media.content.toString(), 'image-bytes');
  await assert.rejects(
    store.getMedia({ ownerMetaUserId: 'meta-user-2', id: saved.id }),
    /Media not found/
  );
});

test('rejects unsupported local media types', async () => {
  const store = createLocalMediaStore({
    db: { saveMedia: () => assert.fail('unsupported media must not be persisted') }
  });

  await assert.rejects(
    store.saveUpload({
      ownerMetaUserId: 'meta-user-1',
      file: { name: 'brief.pdf', type: 'application/pdf', size: 5, arrayBuffer: async () => new ArrayBuffer(5) }
    }),
    /image or video/
  );
});

test('rejects declared uploads above 500 MB', async () => {
  const store = createLocalMediaStore({
    db: { saveMedia: () => assert.fail('oversized media must not be persisted') }
  });

  await assert.rejects(
    store.saveUpload({
      ownerMetaUserId: 'meta-user-1',
      file: { name: 'large.mp4', type: 'video/mp4', size: maxMediaBytes + 1, arrayBuffer: async () => new ArrayBuffer(0) }
    }),
    /500 MB/
  );
});

test('accepts a local file declared at exactly 500 MB', async () => {
  let savedMedia;
  const store = createLocalMediaStore({
    db: {
      saveMedia: (media) => {
        savedMedia = media;
        return { ...media, id: 'media-1' };
      }
    }
  });

  const media = await store.saveUpload({
    ownerMetaUserId: 'meta-user-1',
    file: {
      name: 'boundary.mp4',
      type: 'video/mp4',
      size: maxMediaBytes,
      arrayBuffer: async () => new ArrayBuffer(0)
    }
  });

  assert.equal(media.id, 'media-1');
  assert.equal(savedMedia.sizeBytes, maxMediaBytes);
});

test('hydrates a private Blob into publisher media', async () => {
  const database = createSqliteDatabase(':memory:');
  await database.saveMedia({
    id: 'media-1',
    ownerMetaUserId: 'meta-user-1',
    name: 'creative.jpg',
    mimeType: 'image/jpeg',
    blobUrl: 'https://private.blob.vercel-storage.com/creative.jpg',
    blobDownloadUrl: 'https://private.blob.vercel-storage.com/creative.jpg?download=1',
    blobPathname: 'meta-ads/media-1/creative-random.jpg',
    sizeBytes: 11
  });
  const store = createVercelBlobMediaStore({
    db: database,
    getBlob: async () => ({
      statusCode: 200,
      stream: Readable.toWeb(Readable.from('image-bytes'))
    })
  });

  const media = await store.getMedia({ ownerMetaUserId: 'meta-user-1', id: 'media-1' });

  assert.equal(media.content.toString(), 'image-bytes');
});

test('gives hosted video a short-lived private URL without hydrating its bytes', async () => {
  const metadata = {
    id: 'media-video',
    ownerMetaUserId: 'meta-user-1',
    name: 'creative.mov',
    mimeType: 'video/quicktime',
    blobUrl: 'https://private.blob.vercel-storage.com/creative.mov',
    blobDownloadUrl: 'https://private.blob.vercel-storage.com/creative.mov?download=1',
    blobPathname: 'meta-ads/media-video/creative-random.mov',
    sizeBytes: 176898426
  };
  const calls = [];
  const store = createVercelBlobMediaStore({
    config: { blobReadWriteToken: 'blob-token' },
    db: { getMedia: () => metadata },
    getBlob: () => assert.fail('hosted video must not be downloaded into the function'),
    issueBlobReadToken: async (options) => {
      calls.push({ type: 'issue', options });
      return {
        delegationToken: 'delegation-token',
        clientSigningToken: 'signing-token',
        validUntil: options.validUntil
      };
    },
    presignBlobUrl: async (token, options) => {
      calls.push({ type: 'presign', token, options });
      return { presignedUrl: `${metadata.blobUrl}?signed=1` };
    },
    now: () => 1_000
  });

  const media = await store.getMedia({ ownerMetaUserId: 'meta-user-1', id: 'media-video' });

  assert.equal(media.sourceUrl, `${metadata.blobUrl}?signed=1`);
  assert.equal('content' in media, false);
  assert.deepEqual(calls[0], {
    type: 'issue',
    options: {
      pathname: metadata.blobPathname,
      operations: ['get'],
      validUntil: 1_801_000,
      token: 'blob-token'
    }
  });
  assert.deepEqual(calls[1].options, {
    operation: 'get',
    pathname: metadata.blobPathname,
    validUntil: 1_801_000,
    access: 'private'
  });
});

test('signs a private Blob URL for Meta without hydrating image bytes', async () => {
  const metadata = {
    id: 'media-image',
    ownerMetaUserId: 'meta-user-1',
    name: 'creative.jpg',
    mimeType: 'image/jpeg',
    blobUrl: 'https://private.blob.vercel-storage.com/image.jpg',
    blobPathname: 'meta-ads/media-image/creative.jpg',
    sizeBytes: 11
  };
  let getBlobCalls = 0;
  const signingCalls = [];
  const store = createVercelBlobMediaStore({
    config: { blobReadWriteToken: 'blob-token' },
    db: { getMedia: () => metadata },
    getBlob: () => { getBlobCalls += 1; },
    issueBlobReadToken: async (options) => {
      signingCalls.push({ type: 'issue', options });
      return { validUntil: options.validUntil };
    },
    presignBlobUrl: async (_token, options) => {
      signingCalls.push({ type: 'presign', options });
      return { presignedUrl: 'https://private.blob.vercel-storage.com/image.jpg?signed=1' };
    },
    now: () => 1_000
  });

  const url = await store.getMetaFetchUrl({ ownerMetaUserId: 'meta-user-1', id: 'media-image' });

  assert.equal(url, 'https://private.blob.vercel-storage.com/image.jpg?signed=1');
  assert.equal(getBlobCalls, 0);
  assert.deepEqual(signingCalls[0].options, {
    pathname: metadata.blobPathname,
    operations: ['get'],
    validUntil: 601_000,
    token: 'blob-token'
  });
  assert.deepEqual(signingCalls[1].options, {
    operation: 'get',
    pathname: metadata.blobPathname,
    validUntil: 601_000,
    access: 'private'
  });
});

test('returns null locally only after confirming media ownership', async () => {
  const store = createLocalMediaStore({
    db: {
      getMedia: (ownerMetaUserId, id) => (
        ownerMetaUserId === 'meta-user-1' && id === 'media-image'
          ? { id, ownerMetaUserId, mimeType: 'image/jpeg', content: Buffer.from('image-bytes') }
          : null
      )
    }
  });

  assert.equal(
    await store.getMetaFetchUrl({ ownerMetaUserId: 'meta-user-1', id: 'media-image' }),
    null
  );
  await assert.rejects(
    store.getMetaFetchUrl({ ownerMetaUserId: 'meta-user-2', id: 'media-image' }),
    /Media not found/
  );
});

test('rejects owner-mismatched private Blob reads', async () => {
  const store = createVercelBlobMediaStore({
    db: {
      getMedia: (ownerMetaUserId, id) => {
        assert.deepEqual([ownerMetaUserId, id], ['meta-user-2', 'media-1']);
        return null;
      }
    },
    getBlob: () => assert.fail('foreign media must not be fetched from Blob')
  });

  await assert.rejects(
    store.getMedia({ ownerMetaUserId: 'meta-user-2', id: 'media-1' }),
    /Media not found/
  );
});

test('rejects every required Blob metadata mismatch without persistence', async (context) => {
  const cases = [
    ['media id', (input) => { input.mediaId = 'media-2'; }],
    ['url', (input) => { input.blob.url = 'https://private.blob.vercel-storage.com/other.jpg'; }],
    ['pathname', (input) => { input.blob.pathname = 'meta-ads/media-1/other.jpg'; }],
    ['content type', (input) => { input.blob.contentType = 'video/mp4'; }],
    ['size', (input) => { input.size = 10; }]
  ];

  for (const [name, mutate] of cases) {
    await context.test(name, async () => {
      let saveCalls = 0;
      const input = blobCompletionInput();
      mutate(input);
      const store = createVercelBlobMediaStore({
        db: {
          saveMedia: () => {
            saveCalls += 1;
          }
        },
        headBlob: async () => blobHead()
      });

      await assert.rejects(
        store.completeUpload({ ownerMetaUserId: 'meta-user-1', input }),
        /metadata mismatch/
      );
      assert.equal(saveCalls, 0);
    });
  }
});

test('persists Blob metadata only after successful head verification', async () => {
  let savedMedia;
  const input = blobCompletionInput();
  const store = createVercelBlobMediaStore({
    db: {
      saveMedia: (media) => {
        savedMedia = media;
        return media;
      }
    },
    headBlob: async () => blobHead()
  });

  const media = await store.completeUpload({ ownerMetaUserId: 'meta-user-1', input });

  assert.equal(media.id, 'media-1');
  assert.deepEqual(savedMedia, {
    id: 'media-1',
    ownerMetaUserId: 'meta-user-1',
    name: 'creative.jpg',
    mimeType: 'image/jpeg',
    blobUrl: input.blob.url,
    blobDownloadUrl: input.blob.downloadUrl,
    blobPathname: input.blob.pathname,
    sizeBytes: 11
  });
});

test('accepts a private Blob path scoped by its opaque media id', async () => {
  let savedMedia;
  const metadata = {
    ...blobHead(),
    pathname: 'meta-ads/media-1/creative-random.jpg'
  };
  const input = {
    ...blobCompletionInput(),
    blob: {
      ...blobCompletionInput().blob,
      pathname: metadata.pathname
    }
  };
  const store = createVercelBlobMediaStore({
    db: {
      saveMedia: (media) => {
        savedMedia = media;
        return media;
      }
    },
    headBlob: async () => metadata
  });

  await store.completeUpload({ ownerMetaUserId: 'meta-user-1', input });

  assert.equal(savedMedia.blobPathname, metadata.pathname);
  assert.equal(savedMedia.ownerMetaUserId, 'meta-user-1');
});

test('rejects Blob content above 500 MB after head verification', async () => {
  const input = blobCompletionInput();
  const store = createVercelBlobMediaStore({
    db: { saveMedia: () => assert.fail('oversized Blob must not be persisted') },
    headBlob: async () => ({ ...blobHead(), size: maxMediaBytes + 1 })
  });

  await assert.rejects(
    store.completeUpload({ ownerMetaUserId: 'meta-user-1', input }),
    /500 MB/
  );
});

function blobCompletionInput() {
  const metadata = blobHead();
  return {
    mediaId: 'media-1',
    name: 'creative.jpg',
    mimeType: 'image/jpeg',
    size: 11,
    blob: {
      url: metadata.url,
      downloadUrl: metadata.downloadUrl,
      pathname: metadata.pathname,
      contentType: metadata.contentType
    }
  };
}

function blobHead() {
  return {
    size: 11,
    uploadedAt: new Date('2026-08-09T00:00:00Z'),
    pathname: 'meta-ads/media-1/creative-random.jpg',
    contentType: 'image/jpeg',
    contentDisposition: 'inline',
    url: 'https://private.blob.vercel-storage.com/creative-random.jpg',
    downloadUrl: 'https://private.blob.vercel-storage.com/creative-random.jpg?download=1',
    cacheControl: 'public, max-age=0',
    etag: 'etag-1'
  };
}

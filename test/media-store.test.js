import test from 'node:test';
import assert from 'node:assert/strict';
import { createSqliteDatabase } from '../src/db.js';
import { createLocalMediaStore, MAX_MEDIA_BYTES } from '../src/media-store.js';

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

test('enforces the 500 MB local media limit', async () => {
  let savedMedia;
  const store = createLocalMediaStore({
    db: {
      saveMedia: (media) => {
        savedMedia = media;
        return { ...media, id: 'media-1' };
      }
    }
  });

  await assert.rejects(
    store.saveUpload({
      ownerMetaUserId: 'meta-user-1',
      file: { name: 'large.mp4', type: 'video/mp4', size: MAX_MEDIA_BYTES + 1, arrayBuffer: async () => new ArrayBuffer(0) }
    }),
    /500 MB/
  );
  const media = await store.saveUpload({
    ownerMetaUserId: 'meta-user-1',
    file: { name: 'boundary.mp4', type: 'video/mp4', size: MAX_MEDIA_BYTES, arrayBuffer: async () => new ArrayBuffer(0) }
  });

  assert.equal(media.id, 'media-1');
  assert.equal(savedMedia.sizeBytes, MAX_MEDIA_BYTES);
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

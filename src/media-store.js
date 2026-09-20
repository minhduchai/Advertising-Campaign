import { get, head, issueSignedToken, presignUrl } from '@vercel/blob';

export const MAX_MEDIA_BYTES = 500 * 1024 * 1024;
const HOSTED_VIDEO_URL_TTL_MS = 30 * 60_000;
const META_FETCH_URL_TTL_MS = 10 * 60_000;

export function createLocalMediaStore({ db }) {
  return {
    async saveUpload({ ownerMetaUserId, file }) {
      requireSupportedMedia(file.type, file.size);
      return db.saveMedia({
        ownerMetaUserId,
        name: file.name,
        mimeType: file.type,
        content: Buffer.from(await file.arrayBuffer()),
        sizeBytes: file.size
      });
    },

    async getMedia({ ownerMetaUserId, id }) {
      const media = requireOwnedMedia(await db.getMedia(ownerMetaUserId, id));
      return { ...media, content: Buffer.from(media.content) };
    },

    async getMetaFetchUrl({ ownerMetaUserId, id }) {
      requireOwnedMedia(await db.getMedia(ownerMetaUserId, id));
      return null;
    }
  };
}

export function createVercelBlobMediaStore({
  config,
  db,
  headBlob = head,
  getBlob = get,
  issueBlobReadToken = issueSignedToken,
  presignBlobUrl = presignUrl,
  now = Date.now
}) {
  return {
    async completeUpload({ ownerMetaUserId, input }) {
      requireSupportedMedia(input?.mimeType, input?.size);
      const verified = await verifyPrivateBlob(headBlob, ownerMetaUserId, input);
      return db.saveMedia({
        id: input.mediaId,
        ownerMetaUserId,
        name: input.name,
        mimeType: verified.contentType,
        blobUrl: verified.url,
        blobDownloadUrl: verified.downloadUrl,
        blobPathname: verified.pathname,
        sizeBytes: verified.size
      });
    },

    async getMedia({ ownerMetaUserId, id }) {
      const metadata = requireOwnedMedia(await db.getMedia(ownerMetaUserId, id));
      if (metadata.mimeType.startsWith('video/') && metadata.blobPathname) {
        return {
          ...metadata,
          sourceUrl: await createPrivateBlobReadUrl({
            config,
            metadata,
            issueBlobReadToken,
            presignBlobUrl,
            now,
            ttlMs: HOSTED_VIDEO_URL_TTL_MS
          })
        };
      }
      const blob = await getBlob(metadata.blobUrl, { access: 'private' });
      if (!blob || blob.statusCode !== 200 || !blob.stream) {
        throw new Error('Media Blob not found');
      }
      return { ...metadata, content: await streamToBuffer(blob.stream) };
    },

    async getMetaFetchUrl({ ownerMetaUserId, id }) {
      const metadata = requireOwnedMedia(await db.getMedia(ownerMetaUserId, id));
      return createPrivateBlobReadUrl({
        config,
        metadata,
        issueBlobReadToken,
        presignBlobUrl,
        now,
        ttlMs: META_FETCH_URL_TTL_MS
      });
    }
  };
}

async function createPrivateBlobReadUrl({
  config,
  metadata,
  issueBlobReadToken,
  presignBlobUrl,
  now,
  ttlMs
}) {
  if (!metadata.blobPathname) {
    throw new Error('Media Blob path not found');
  }
  const validUntil = now() + ttlMs;
  const signedToken = await issueBlobReadToken({
    pathname: metadata.blobPathname,
    operations: ['get'],
    validUntil,
    token: config?.blobReadWriteToken
  });
  const { presignedUrl } = await presignBlobUrl(signedToken, {
    operation: 'get',
    pathname: metadata.blobPathname,
    validUntil,
    access: 'private'
  });
  return presignedUrl;
}

async function verifyPrivateBlob(headBlob, ownerMetaUserId, input) {
  const { mediaId, blob } = input;
  if (!isSafePathSegment(ownerMetaUserId)
    || !isSafePathSegment(mediaId)
    || !blob
    || typeof blob.url !== 'string') {
    throw mediaError(TypeError, 'Invalid Blob completion payload', 400);
  }

  const verified = await headBlob(blob.url);
  requireSupportedMedia(verified.contentType, verified.size);
  const expectedPrefix = `meta-ads/${mediaId}/`;
  const matches = verified.url === blob.url
    && verified.downloadUrl === blob.downloadUrl
    && verified.pathname === blob.pathname
    && verified.pathname.startsWith(expectedPrefix)
    && verified.contentType === blob.contentType
    && verified.contentType === input.mimeType
    && verified.size === input.size;
  if (!matches) {
    throw mediaError(Error, 'Blob metadata mismatch', 400);
  }
  return verified;
}

function requireSupportedMedia(mimeType, size) {
  if (typeof mimeType !== 'string' || (!mimeType.startsWith('image/') && !mimeType.startsWith('video/'))) {
    throw mediaError(TypeError, 'Media must be an image or video', 400);
  }
  if (!Number.isSafeInteger(size) || size < 0) {
    throw mediaError(TypeError, 'Media size is invalid', 400);
  }
  if (size > MAX_MEDIA_BYTES) {
    throw mediaError(RangeError, 'Media exceeds the 500 MB limit', 413);
  }
}

function requireOwnedMedia(media) {
  if (!media) {
    throw new Error('Media not found');
  }
  return media;
}

function isSafePathSegment(value) {
  return typeof value === 'string' && /^[A-Za-z0-9_-]+$/.test(value);
}

function mediaError(ErrorType, message, statusCode) {
  const error = new ErrorType(message);
  error.statusCode = statusCode;
  error.expose = true;
  return error;
}

async function streamToBuffer(stream) {
  const chunks = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

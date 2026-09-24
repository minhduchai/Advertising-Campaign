export const MAX_MEDIA_BYTES = 500 * 1024 * 1024;

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

function mediaError(ErrorType, message, statusCode) {
  const error = new ErrorType(message);
  error.statusCode = statusCode;
  error.expose = true;
  return error;
}

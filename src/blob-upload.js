import { handleUpload } from '@vercel/blob/client';
import { MAX_MEDIA_BYTES } from './media-store.js';

export async function handleBlobUpload({
  request,
  body,
  config,
  ownerMetaUserId,
  handleUploadImpl = handleUpload
}) {
  if (body?.type !== 'blob.generate-client-token') {
    throw validationError('Invalid Blob token request');
  }
  parseAndValidateClientPayload(body.payload?.clientPayload);
  requireSafeOwner(ownerMetaUserId);

  return handleUploadImpl({
    request,
    body,
    token: config.blobReadWriteToken,
    onBeforeGenerateToken: async (requestedPathname, clientPayload) => {
      const verifiedPayload = parseAndValidateClientPayload(clientPayload);
      if (requestedPathname !== uploadPathname(verifiedPayload)) {
        throw validationError('Invalid Blob pathname');
      }
      return {
        allowedContentTypes: ['image/*', 'video/*'],
        maximumSizeInBytes: MAX_MEDIA_BYTES,
        addRandomSuffix: true,
        tokenPayload: JSON.stringify(verifiedPayload)
      };
    }
  });
}

function parseAndValidateClientPayload(clientPayload) {
  let payload;
  try {
    payload = JSON.parse(clientPayload);
  } catch {
    throw validationError('Invalid Blob client payload');
  }

  if (!isSafePathSegment(payload?.mediaId) || typeof payload?.name !== 'string' || !payload.name.trim()) {
    throw validationError('Invalid Blob client payload');
  }
  if (typeof payload.mimeType !== 'string'
    || (!payload.mimeType.startsWith('image/') && !payload.mimeType.startsWith('video/'))) {
    throw validationError('Media must be an image or video');
  }
  if (!Number.isSafeInteger(payload.size) || payload.size < 0) {
    throw validationError('Media size is invalid');
  }
  if (payload.size > MAX_MEDIA_BYTES) {
    const error = validationError('Media exceeds the 500 MB limit');
    error.statusCode = 413;
    throw error;
  }
  return payload;
}

function requireSafeOwner(ownerMetaUserId) {
  if (!isSafePathSegment(ownerMetaUserId)) {
    throw validationError('Invalid media owner');
  }
}

function uploadPathname(payload) {
  return `meta-ads/${payload.mediaId}/${blobUploadFileName(payload.name, payload.mimeType)}`;
}

function blobUploadFileName(_name, mimeType) {
  const knownMimeExtensions = {
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
    'image/gif': 'gif',
    'image/avif': 'avif',
    'video/mp4': 'mp4',
    'video/quicktime': 'mov',
    'video/webm': 'webm'
  };
  const extension = knownMimeExtensions[mimeType];
  return extension ? `media.${extension}` : 'media';
}

function isSafePathSegment(value) {
  return typeof value === 'string' && /^[A-Za-z0-9_-]+$/.test(value);
}

function validationError(message) {
  const error = new TypeError(message);
  error.statusCode = 400;
  error.expose = true;
  return error;
}

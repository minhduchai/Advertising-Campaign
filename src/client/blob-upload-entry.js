import { upload } from '@vercel/blob/client';

export async function uploadPrivateBlob(pathname, file, options) {
  return upload(pathname, file, {
    access: 'private',
    handleUploadUrl: '/api/media/blob-token',
    clientPayload: JSON.stringify(options.clientPayload),
    onUploadProgress: options.onProgress
  });
}

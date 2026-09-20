import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
  DeleteObjectsCommand,
  UploadPartCommand
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { MAX_MEDIA_BYTES } from './media-store.js';

export function createR2MediaStore({ config, db, client, signUrl = getSignedUrl }) {
  if (!config.r2Enabled) return null;
  const s3 = client ?? new S3Client({ region: 'auto', endpoint: config.r2Endpoint, credentials: { accessKeyId: config.r2AccessKeyId, secretAccessKey: config.r2SecretAccessKey } });
  let cleanupPromise = null;
  let lastCleanupCheckAt = 0;

  async function enforceStorageLimit({ force = false, now = Date.now() } = {}) {
    if (!force && now - lastCleanupCheckAt < 5 * 60 * 1000) return { checked: false, deletedCount: 0 };
    if (cleanupPromise) return cleanupPromise;
    lastCleanupCheckAt = now;
    cleanupPromise = cleanupR2Objects({ s3, config, db, now }).finally(() => { cleanupPromise = null; });
    return cleanupPromise;
  }

  return {
    enforceStorageLimit,
    async createMultipartUpload({ ownerMetaUserId, mediaId, name, mimeType, sizeBytes }) {
      requireSupportedMedia(mimeType, sizeBytes);
      requireMediaId(mediaId);
      await enforceStorageLimit();
      const key = multipartMediaKey({ ownerMetaUserId, mediaId, name, mimeType });
      const created = await s3.send(new CreateMultipartUploadCommand({
        Bucket: config.r2BucketName,
        Key: key,
        ContentType: mimeType
      }));
      if (!created.UploadId) throw mediaError('R2 multipart upload could not be created', 502);
      return { mediaId, uploadId: created.UploadId, key };
    },
    async presignMultipartPart({ ownerMetaUserId, mediaId, uploadId, key, partNumber }) {
      requireMultipartPath({ ownerMetaUserId, mediaId, key });
      requireUploadId(uploadId);
      requirePartNumber(partNumber);
      const uploadUrl = await signUrl(s3, new UploadPartCommand({
        Bucket: config.r2BucketName,
        Key: key,
        UploadId: uploadId,
        PartNumber: partNumber
      }), { expiresIn: 900 });
      return { mediaId, uploadId, key, partNumber, uploadUrl };
    },
    async completeMultipartUpload({ ownerMetaUserId, mediaId, uploadId, key, name, mimeType, sizeBytes, parts }) {
      requireSupportedMedia(mimeType, sizeBytes);
      requireMultipartPath({ ownerMetaUserId, mediaId, key, name, mimeType });
      requireUploadId(uploadId);
      const completedParts = normalizeCompletedParts(parts);
      await s3.send(new CompleteMultipartUploadCommand({
        Bucket: config.r2BucketName,
        Key: key,
        UploadId: uploadId,
        MultipartUpload: { Parts: completedParts }
      }));
      const head = await s3.send(new HeadObjectCommand({ Bucket: config.r2BucketName, Key: key }));
      if (Number(head.ContentLength) !== sizeBytes || head.ContentType !== mimeType) throw mediaError('R2 upload metadata mismatch', 400);
      return db.saveMedia({
        id: mediaId,
        ownerMetaUserId,
        name,
        mimeType,
        blobUrl: `r2://${config.r2BucketName}/${key}`,
        blobPathname: key,
        sizeBytes
      });
    },
    async abortMultipartUpload({ ownerMetaUserId, mediaId, uploadId, key }) {
      requireMultipartPath({ ownerMetaUserId, mediaId, key });
      requireUploadId(uploadId);
      await s3.send(new AbortMultipartUploadCommand({
        Bucket: config.r2BucketName,
        Key: key,
        UploadId: uploadId
      }));
      return { mediaId, uploadId, key, aborted: true };
    },
    async presignUpload({ ownerMetaUserId, mediaId, name, mimeType, sizeBytes }) {
      requireSupportedMedia(mimeType, sizeBytes);
      requireMediaId(mediaId);
      const key = multipartMediaKey({ ownerMetaUserId, mediaId, name, mimeType });
      await enforceStorageLimit();
      const uploadUrl = await signUrl(s3, new PutObjectCommand({ Bucket: config.r2BucketName, Key: key, ContentType: mimeType }), { expiresIn: 900 });
      return { mediaId, key, uploadUrl };
    },
    async completeUpload({ ownerMetaUserId, input }) {
      requireSupportedMedia(input?.mimeType, input?.sizeBytes);
      requireMultipartPath({ ownerMetaUserId, mediaId: input.mediaId, key: input.key, name: input.name, mimeType: input.mimeType });
      const head = await s3.send(new HeadObjectCommand({ Bucket: config.r2BucketName, Key: input.key }));
      if (Number(head.ContentLength) !== input.sizeBytes || head.ContentType !== input.mimeType) throw mediaError('R2 upload metadata mismatch', 400);
      return db.saveMedia({ id: input.mediaId, ownerMetaUserId, name: input.name, mimeType: input.mimeType, blobUrl: `r2://${config.r2BucketName}/${input.key}`, blobPathname: input.key, sizeBytes: input.sizeBytes });
    },
    async getMedia({ ownerMetaUserId, id }) {
      const media = await db.getMedia(ownerMetaUserId, id);
      if (!media) throw new Error('Media not found');
      return { ...media, sourceUrl: await this.getMetaFetchUrl({ ownerMetaUserId, id }) };
    },
    async getMetaFetchUrl({ ownerMetaUserId, id }) {
      const media = await db.getMedia(ownerMetaUserId, id);
      if (!media?.blobUrl?.startsWith('r2://')) throw new Error('Media not found');
      try {
        await s3.send(new HeadObjectCommand({ Bucket: config.r2BucketName, Key: media.blobPathname }));
      } catch (error) {
        if (error?.$metadata?.httpStatusCode === 404 || ['NotFound', 'NoSuchKey'].includes(error?.name)) {
          throw mediaError('File media không còn trên R2. Vui lòng tải lại file trước khi đăng.', 410);
        }
        throw error;
      }
      return signUrl(s3, new GetObjectCommand({ Bucket: config.r2BucketName, Key: media.blobPathname }), { expiresIn: 1800 });
    },
    async deleteTemporaryMedia(media) {
      if (!media?.blobUrl?.startsWith('r2://') || !media.blobPathname) return;
      await s3.send(new DeleteObjectCommand({ Bucket: config.r2BucketName, Key: media.blobPathname }));
      await db.deleteMedia(media.ownerMetaUserId, media.id, media.blobUrl);
    }
  };
}

async function cleanupR2Objects({ s3, config, db, now }) {
  const objects = [];
  let continuationToken;
  do {
    const page = await s3.send(new ListObjectsV2Command({
      Bucket: config.r2BucketName,
      Prefix: 'ads/',
      ContinuationToken: continuationToken
    }));
    objects.push(...(page.Contents ?? []).filter((object) => object.Key));
    continuationToken = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (continuationToken);

  const totalBytes = objects.reduce((total, object) => total + Number(object.Size ?? 0), 0);
  const thresholdBytes = config.r2CleanupThresholdBytes ?? 9 * 1024 ** 3;
  if (totalBytes <= thresholdBytes) return { checked: true, totalBytes, deletedBytes: 0, deletedCount: 0 };

  const minimumAgeMs = config.r2CleanupMinAgeMs ?? 72 * 60 * 60 * 1000;
  const candidates = objects.filter((object) => {
    const modifiedAt = new Date(object.LastModified).getTime();
    return Number.isFinite(modifiedAt) && modifiedAt <= now - minimumAgeMs;
  }).sort((left, right) => new Date(left.LastModified) - new Date(right.LastModified));

  let deletedBytes = 0;
  let deletedCount = 0;
  let protectedCount = 0;
  const errors = [];
  for (let index = 0; index < candidates.length; index += 1000) {
    if (totalBytes - deletedBytes <= thresholdBytes) break;
    const group = candidates.slice(index, index + 1000);
    // Browser drafts are not stored in the database. Treat every registered
    // object as potentially in use; only the publish lifecycle can remove it.
    const registered = new Set(await db.registeredR2Keys(config.r2BucketName, group.map((object) => object.Key)));
    protectedCount += registered.size;
    const pending = group.filter((object) => !registered.has(object.Key));
    while (pending.length && totalBytes - deletedBytes > thresholdBytes) {
      let plannedBytes = 0;
      const batch = [];
      while (pending.length && totalBytes - deletedBytes - plannedBytes > thresholdBytes) {
        const object = pending.shift();
        batch.push(object);
        plannedBytes += Number(object.Size ?? 0);
      }
      const result = await s3.send(new DeleteObjectsCommand({
        Bucket: config.r2BucketName,
        Delete: { Objects: batch.map((object) => ({ Key: object.Key })), Quiet: false }
      }));
      const failedKeys = new Set((result.Errors ?? []).map((entry) => entry.Key));
      const deletedKeys = new Set((result.Deleted ?? []).map((entry) => entry.Key));
      errors.push(...(result.Errors ?? []));
      for (const object of batch) {
        if (!deletedKeys.has(object.Key) || failedKeys.has(object.Key)) continue;
        deletedCount += 1;
        deletedBytes += Number(object.Size ?? 0);
      }
    }
  }

  return { checked: true, totalBytes, deletedBytes, deletedCount, protectedCount, errors,
    remainingBytes: totalBytes - deletedBytes, aboveLimit: totalBytes - deletedBytes > thresholdBytes };
}

function multipartMediaKey({ ownerMetaUserId, mediaId, name, mimeType }) {
  const ownerSegment = ownerPathSegment(ownerMetaUserId);
  return `ads/${ownerSegment}/${mediaId}/${safeFileName(name, mimeType)}`;
}

function requireMultipartPath({ ownerMetaUserId, mediaId, key, name, mimeType }) {
  requireMediaId(mediaId);
  const ownerSegment = ownerPathSegment(ownerMetaUserId);
  const path = String(key ?? '');
  const segments = path.split('/');
  if (segments.length !== 4 || segments[0] !== 'ads') throw mediaError('R2 upload path is invalid', 400);
  if (segments[1] !== ownerSegment) throw mediaError('R2 multipart upload does not belong to this session', 403);
  if (segments[2] !== mediaId || !segments[3]) throw mediaError('R2 upload path is invalid', 400);
  if (name !== undefined && path !== multipartMediaKey({ ownerMetaUserId, mediaId, name, mimeType })) {
    throw mediaError('R2 upload path is invalid', 400);
  }
}

function ownerPathSegment(ownerMetaUserId) {
  const owner = String(ownerMetaUserId ?? '').trim();
  if (!owner) throw mediaError('R2 multipart upload does not belong to this session', 403);
  return encodeURIComponent(owner);
}

function requireMediaId(mediaId) {
  if (typeof mediaId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(mediaId)) {
    throw mediaError('Media ID is invalid', 400);
  }
}

function requireUploadId(uploadId) {
  if (typeof uploadId !== 'string' || uploadId.length < 1 || uploadId.length > 2048 || /[\r\n]/.test(uploadId)) {
    throw mediaError('R2 multipart upload ID is invalid', 400);
  }
}

function requirePartNumber(partNumber) {
  if (!Number.isInteger(partNumber) || partNumber < 1 || partNumber > 10_000) {
    throw mediaError('R2 multipart part number is invalid', 400);
  }
}

function normalizeCompletedParts(parts) {
  if (!Array.isArray(parts) || parts.length < 1 || parts.length > 10_000) {
    throw mediaError('R2 multipart parts are invalid', 400);
  }
  const seen = new Set();
  const normalized = parts.map((part) => {
    requirePartNumber(part?.partNumber);
    if (seen.has(part.partNumber)) throw mediaError('R2 multipart parts are invalid', 400);
    seen.add(part.partNumber);
    if (typeof part.etag !== 'string' || !part.etag.trim() || part.etag.length > 1024 || /[\r\n]/.test(part.etag)) {
      throw mediaError('R2 multipart ETag is invalid', 400);
    }
    return { PartNumber: part.partNumber, ETag: part.etag };
  });
  return normalized.sort((left, right) => left.PartNumber - right.PartNumber);
}

function safeFileName(name, mimeType) {
  const extension = String(name).match(/\.[A-Za-z0-9]{1,8}$/)?.[0] ?? (mimeType.startsWith('video/') ? '.mp4' : '.jpg');
  const base = String(name).replace(/\.[^.]*$/, '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'media';
  return `${base}${extension.toLowerCase()}`;
}

function requireSupportedMedia(mimeType, sizeBytes) {
  if (typeof mimeType !== 'string' || (!mimeType.startsWith('image/') && !mimeType.startsWith('video/'))) throw mediaError('Media must be an image or video', 400);
  if (!Number.isSafeInteger(sizeBytes) || sizeBytes < 1 || sizeBytes > MAX_MEDIA_BYTES) throw mediaError('Media size must be between 1 byte and 500 MB', sizeBytes > MAX_MEDIA_BYTES ? 413 : 400);
}

function mediaError(message, statusCode) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.expose = true;
  return error;
}

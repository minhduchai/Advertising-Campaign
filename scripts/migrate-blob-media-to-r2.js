import pg from 'pg';
import { loadConfig } from '../src/config.js';
import { createVercelBlobMediaStore } from '../src/media-store.js';
import { createR2MediaStore } from '../src/r2-media.js';

const config = loadConfig();
if (!config.r2Enabled) throw new Error('R2 is not fully configured.');

const client = new pg.Client({ connectionString: config.databaseUrl });
await client.connect();

const db = {
  async getMedia(ownerMetaUserId, id) {
    const { rows } = await client.query(`
      SELECT id, owner_meta_user_id, name, mime_type, content, blob_url, blob_download_url,
             blob_pathname, size_bytes, created_at
      FROM media WHERE owner_meta_user_id = $1 AND id = $2
    `, [ownerMetaUserId, id]);
    return rows[0] ? mapMedia(rows[0]) : null;
  },
  async registeredR2Keys(bucketName, keys) {
    if (!keys.length) return [];
    const urls = keys.map((key) => `r2://${bucketName}/${key}`);
    const { rows } = await client.query(
      'SELECT blob_pathname FROM media WHERE blob_url = ANY($1::text[])',
      [urls]
    );
    return rows.map((row) => row.blob_pathname);
  },
  async saveMedia(media) {
    const { rows } = await client.query(`
      UPDATE media
      SET blob_url = $1, blob_download_url = $2, blob_pathname = $3, content = NULL
      WHERE owner_meta_user_id = $4 AND id = $5
      RETURNING id
    `, [media.blobUrl, media.blobDownloadUrl ?? null, media.blobPathname, media.ownerMetaUserId, media.id]);
    if (!rows[0]) throw new Error(`Media ${media.id} was not found while updating metadata.`);
    return media;
  }
};

const { rows } = await client.query(`
  SELECT id, owner_meta_user_id, name, mime_type, size_bytes
  FROM media
  WHERE blob_url IS NOT NULL AND blob_url NOT LIKE 'r2://%'
  ORDER BY created_at, id
`);
const blobStore = createVercelBlobMediaStore({ config, db });
const r2Store = createR2MediaStore({ config, db });
let migrated = 0;

try {
  for (const row of rows) {
    const media = await blobStore.getMedia({ ownerMetaUserId: row.owner_meta_user_id, id: row.id });
    const body = media.content ?? await download(media.sourceUrl);
    if (body.byteLength !== Number(row.size_bytes)) {
      throw new Error(`Media ${row.id} size mismatch: got ${body.byteLength}, expected ${row.size_bytes}.`);
    }
    const signed = await r2Store.presignUpload({
      ownerMetaUserId: row.owner_meta_user_id,
      mediaId: row.id,
      name: row.name,
      mimeType: row.mime_type,
      sizeBytes: Number(row.size_bytes)
    });
    const upload = await fetch(signed.uploadUrl, {
      method: 'PUT',
      headers: { 'content-type': row.mime_type },
      body
    });
    if (!upload.ok) throw new Error(`R2 upload failed for ${row.id}: HTTP ${upload.status}`);
    await r2Store.completeUpload({
      ownerMetaUserId: row.owner_meta_user_id,
      input: {
        mediaId: row.id,
        key: signed.key,
        name: row.name,
        mimeType: row.mime_type,
        sizeBytes: Number(row.size_bytes)
      }
    });
    migrated += 1;
    console.log(`migrated ${migrated}/${rows.length} ${row.id}`);
  }
} finally {
  await client.end();
}

console.log(`Migrated ${migrated}/${rows.length} media records to R2.`);

async function download(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Legacy media download failed: HTTP ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}

function mapMedia(row) {
  return {
    id: row.id,
    ownerMetaUserId: row.owner_meta_user_id,
    name: row.name,
    mimeType: row.mime_type,
    content: row.content ? Buffer.from(row.content) : undefined,
    blobUrl: row.blob_url,
    blobDownloadUrl: row.blob_download_url,
    blobPathname: row.blob_pathname,
    sizeBytes: Number(row.size_bytes),
    createdAt: Number(row.created_at)
  };
}

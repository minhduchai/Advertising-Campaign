import { loadConfig } from '../src/config.js';
import { createSqlTransport } from '../src/postgres-transport.js';
import { createPostgresDatabase } from '../src/postgres-db.js';
import { createR2MediaStore } from '../src/r2-media.js';

// Copy first, verify, then update the same media ID. Originals expire via ads/ lifecycle.
const config = loadConfig();
const sql = createSqlTransport(config.databaseUrl);
const store = createR2MediaStore({ config, db: createPostgresDatabase(sql) });
if (!store) throw new Error('R2 is required');
try {
  const rows = await sql`
    WITH refs AS (
      SELECT t.owner_meta_user_id AS owner_id, item->>'imageMediaId' AS media_id
      FROM seeding_templates t CROSS JOIN LATERAL jsonb_array_elements(t.items_json::jsonb) item
      UNION
      SELECT owner_meta_user_id, image_media_id FROM seeding_jobs
      UNION
      SELECT r.owner_meta_user_id, item->>'imageMediaId'
      FROM runs r
      CROSS JOIN LATERAL jsonb_array_elements(COALESCE(r.snapshot_json::jsonb->'campaigns', '[]'::jsonb)) campaign
      CROSS JOIN LATERAL jsonb_array_elements(COALESCE(campaign->'seeding'->'items', '[]'::jsonb)) item
      UNION
      SELECT r.owner_meta_user_id, item->>'imageMediaId'
      FROM runs r
      CROSS JOIN LATERAL jsonb_array_elements(COALESCE(r.execution_json::jsonb->'campaigns', '[]'::jsonb)) campaign
      CROSS JOIN LATERAL jsonb_array_elements(COALESCE(campaign->'seeding'->'items', '[]'::jsonb)) item
    )
    SELECT DISTINCT m.id, m.owner_meta_user_id
    FROM media m JOIN refs ON refs.media_id = m.id AND refs.owner_id = m.owner_meta_user_id
    WHERE m.blob_pathname LIKE 'ads/%' AND m.blob_url LIKE 'r2://%'
  `;
  const report = { candidates: rows.length, migrated: 0, missing: [], failed: [] };
  for (const row of rows) {
    try {
      await store.preserveSeedingMedia({ ownerMetaUserId: row.owner_meta_user_id, id: row.id });
      report.migrated++;
    } catch (error) {
      if (error?.$metadata?.httpStatusCode === 404 || ['NoSuchKey', 'NotFound'].includes(error?.name)) {
        report.missing.push(row.id);
      } else {
        report.failed.push({ id: row.id, name: error.name, status: error.statusCode ?? error?.$metadata?.httpStatusCode });
      }
    }
  }
  console.log(JSON.stringify(report));
  if (report.failed.length) process.exitCode = 1;
} finally {
  await sql.end?.();
}

import {
  createSharedConversationSeed,
  SHARED_CONVERSATION_SEED_MIGRATION
} from './shared-conversation-library.js';
import { normalizeAudienceTemplateName } from './audience-template.js';

export async function applyPostgresSchema(sql) {
  await applyWorkflowNonceSchema(sql);
  await sql`
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      meta_user_id TEXT,
      meta_user_name TEXT,
      created_at BIGINT NOT NULL,
      updated_at BIGINT NOT NULL
    )
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS oauth_states (
      state TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      expires_at BIGINT NOT NULL
    )
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS connections (
      meta_user_id TEXT PRIMARY KEY,
      meta_user_name TEXT NOT NULL,
      access_token_ciphertext TEXT NOT NULL,
      updated_at BIGINT NOT NULL
    )
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS upload_agent_pairing_codes (
      code_hash TEXT PRIMARY KEY,
      owner_meta_user_id TEXT NOT NULL,
      expires_at BIGINT NOT NULL,
      created_at BIGINT NOT NULL
    )
  `;
  await sql`
    CREATE INDEX IF NOT EXISTS upload_agent_pairing_codes_expires_idx
    ON upload_agent_pairing_codes (expires_at)
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS upload_agent_devices (
      id TEXT PRIMARY KEY,
      owner_meta_user_id TEXT NOT NULL,
      token_hash TEXT NOT NULL UNIQUE,
      device_json JSONB NOT NULL,
      revoked_at BIGINT,
      created_at BIGINT NOT NULL,
      updated_at BIGINT NOT NULL
    )
  `;
  await sql`
    CREATE INDEX IF NOT EXISTS upload_agent_devices_owner_idx
    ON upload_agent_devices (owner_meta_user_id, id)
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS telegram_upload_jobs (
      id TEXT PRIMARY KEY,
      owner_meta_user_id TEXT NOT NULL,
      media_id TEXT NOT NULL UNIQUE,
      network_path TEXT NOT NULL,
      intent_code TEXT NOT NULL,
      status TEXT NOT NULL,
      lease_token TEXT,
      lease_expires_at BIGINT,
      error_message TEXT,
      uploaded_bytes BIGINT NOT NULL DEFAULT 0,
      total_bytes BIGINT NOT NULL DEFAULT 0,
      expires_at BIGINT NOT NULL,
      created_at BIGINT NOT NULL,
      updated_at BIGINT NOT NULL
    )
  `;
  await sql`ALTER TABLE telegram_upload_jobs ADD COLUMN IF NOT EXISTS uploaded_bytes BIGINT NOT NULL DEFAULT 0`;
  await sql`ALTER TABLE telegram_upload_jobs ADD COLUMN IF NOT EXISTS total_bytes BIGINT NOT NULL DEFAULT 0`;
  await sql`
    CREATE INDEX IF NOT EXISTS telegram_upload_jobs_queue_idx
    ON telegram_upload_jobs (status, expires_at, created_at)
  `;
  await sql`
    CREATE INDEX IF NOT EXISTS telegram_upload_jobs_owner_media_idx
    ON telegram_upload_jobs (owner_meta_user_id, media_id)
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS media (
      id TEXT PRIMARY KEY,
      owner_meta_user_id TEXT NOT NULL,
      name TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      content BYTEA,
      blob_url TEXT,
      blob_download_url TEXT,
      blob_pathname TEXT,
      size_bytes BIGINT NOT NULL,
      created_at BIGINT NOT NULL
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS media_owner_idx ON media(owner_meta_user_id)`;
  await sql`
    CREATE TABLE IF NOT EXISTS runs (
      id TEXT PRIMARY KEY,
      owner_meta_user_id TEXT NOT NULL,
      status TEXT NOT NULL,
      ad_account_id TEXT,
      snapshot_json JSONB,
      execution_json JSONB,
      workflow_token TEXT,
      workflow_lease_expires_at BIGINT,
      completed_at BIGINT,
      created_at BIGINT NOT NULL
    )
  `;
  await sql`ALTER TABLE runs ADD COLUMN IF NOT EXISTS ad_account_id TEXT`;
  await sql`ALTER TABLE runs ADD COLUMN IF NOT EXISTS snapshot_json JSONB`;
  await sql`ALTER TABLE runs ADD COLUMN IF NOT EXISTS execution_json JSONB`;
  await sql`ALTER TABLE runs ADD COLUMN IF NOT EXISTS workflow_token TEXT`;
  await sql`ALTER TABLE runs ADD COLUMN IF NOT EXISTS workflow_lease_expires_at BIGINT`;
  await sql`ALTER TABLE runs ADD COLUMN IF NOT EXISTS completed_at BIGINT`;
  await sql`CREATE INDEX IF NOT EXISTS runs_owner_created_idx ON runs(owner_meta_user_id, created_at DESC)`;
  await sql`
    CREATE TABLE IF NOT EXISTS node_results (
      run_id TEXT NOT NULL,
      client_id TEXT NOT NULL,
      parent_client_id TEXT,
      type TEXT NOT NULL,
      status TEXT NOT NULL,
      name TEXT,
      remote_id TEXT,
      creative_id TEXT,
      creative_artifact_key TEXT,
      post_id TEXT,
      permalink_url TEXT,
      error_json JSONB,
      PRIMARY KEY (run_id, client_id)
    )
  `;
  await sql`ALTER TABLE node_results ADD COLUMN IF NOT EXISTS name TEXT`;
  await sql`ALTER TABLE node_results ADD COLUMN IF NOT EXISTS creative_id TEXT`;
  await sql`ALTER TABLE node_results ADD COLUMN IF NOT EXISTS creative_artifact_key TEXT`;
  await sql`ALTER TABLE node_results ADD COLUMN IF NOT EXISTS permalink_url TEXT`;
  await sql`
    CREATE TABLE IF NOT EXISTS conversation_templates (
      id TEXT PRIMARY KEY,
      owner_meta_user_id TEXT NOT NULL,
      page_id TEXT NOT NULL,
      name TEXT NOT NULL,
      template_json JSONB NOT NULL,
      is_default BOOLEAN NOT NULL DEFAULT FALSE,
      created_at BIGINT NOT NULL,
      updated_at BIGINT NOT NULL
    )
  `;
  await sql`
    CREATE INDEX IF NOT EXISTS conversation_templates_owner_page
    ON conversation_templates (owner_meta_user_id, page_id)
  `;
  await sql`
    CREATE UNIQUE INDEX IF NOT EXISTS conversation_templates_one_default
    ON conversation_templates (owner_meta_user_id, page_id)
    WHERE is_default = TRUE
  `;
  await applyAudienceTemplateSchema(sql);
  await sql`
    CREATE TABLE IF NOT EXISTS app_migrations (
      key TEXT PRIMARY KEY,
      applied_at BIGINT NOT NULL
    )
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS seeding_templates (
      id TEXT PRIMARY KEY,
      owner_meta_user_id TEXT NOT NULL,
      name TEXT NOT NULL,
      items_json JSONB NOT NULL,
      created_at BIGINT NOT NULL,
      updated_at BIGINT NOT NULL
    )
  `;
  await sql`
    CREATE INDEX IF NOT EXISTS seeding_templates_owner_updated_idx
    ON seeding_templates (owner_meta_user_id, updated_at DESC)
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS campaign_presets (
      id TEXT PRIMARY KEY,
      owner_meta_user_id TEXT NOT NULL,
      name TEXT NOT NULL,
      content_json JSONB NOT NULL,
      created_at BIGINT NOT NULL,
      updated_at BIGINT NOT NULL
    )
  `;
  await sql`
    CREATE INDEX IF NOT EXISTS campaign_presets_owner_updated_idx
    ON campaign_presets (owner_meta_user_id, updated_at DESC)
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS seeding_jobs (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL,
      owner_meta_user_id TEXT NOT NULL,
      campaign_client_id TEXT NOT NULL,
      page_id TEXT NOT NULL,
      post_id TEXT NOT NULL,
      item_id TEXT NOT NULL,
      position INTEGER NOT NULL,
      sequence INTEGER NOT NULL,
      message TEXT NOT NULL,
      image_media_id TEXT,
      status TEXT NOT NULL,
      meta_comment_id TEXT,
      error_json JSONB,
      attempt_count INTEGER NOT NULL DEFAULT 0,
      available_at BIGINT NOT NULL,
      started_at BIGINT,
      completed_at BIGINT,
      created_at BIGINT NOT NULL,
      updated_at BIGINT NOT NULL,
      UNIQUE (run_id, campaign_client_id, post_id, item_id)
    )
  `;
  await sql`
    CREATE INDEX IF NOT EXISTS seeding_jobs_owner_run_status_idx
    ON seeding_jobs (owner_meta_user_id, run_id, status)
  `;

  const seed = createSharedConversationSeed();
  await sql`
    WITH migration AS (
      INSERT INTO app_migrations (key, applied_at)
      VALUES (${SHARED_CONVERSATION_SEED_MIGRATION}, ${seed.createdAt})
      ON CONFLICT (key) DO NOTHING
      RETURNING key
    )
    INSERT INTO conversation_templates (
      id, owner_meta_user_id, page_id, name, template_json, is_default, created_at, updated_at
    )
    SELECT
      ${seed.id}, ${seed.ownerMetaUserId}, ${seed.pageId}, ${seed.name}, ${JSON.stringify(seed.template)},
      TRUE, ${seed.createdAt}, ${seed.updatedAt}
    FROM migration
    ON CONFLICT (id) DO NOTHING
  `;

  return [
    'sessions',
    'oauth_states',
    'workflow_request_nonces',
    'connections',
    'upload_agent_pairing_codes',
    'upload_agent_devices',
    'telegram_upload_jobs',
    'media',
    'runs',
    'node_results',
    'conversation_templates',
    'audience_templates',
    'app_migrations',
    'seeding_templates',
    'campaign_presets',
    'seeding_jobs'
  ];
}

export async function applyWorkflowNonceSchema(sql) {
  await sql`
    CREATE TABLE IF NOT EXISTS workflow_request_nonces (
      nonce_hash TEXT PRIMARY KEY,
      expires_at BIGINT NOT NULL
    )
  `;
  await sql`
    CREATE INDEX IF NOT EXISTS workflow_request_nonces_expires_idx ON workflow_request_nonces (expires_at)
  `;
  return 'workflow_request_nonces';
}

export async function applyAudienceTemplateSchema(sql) {
  await sql`
    CREATE TABLE IF NOT EXISTS audience_templates (
      id TEXT PRIMARY KEY,
      owner_meta_user_id TEXT,
      name TEXT NOT NULL,
      name_key TEXT NOT NULL,
      content_json JSONB NOT NULL,
      created_at BIGINT NOT NULL,
      updated_at BIGINT NOT NULL
    )
  `;
  await sql`ALTER TABLE audience_templates ADD COLUMN IF NOT EXISTS owner_meta_user_id TEXT`;
  await sql`ALTER TABLE audience_templates ADD COLUMN IF NOT EXISTS name_key TEXT`;
  await sql`DROP INDEX IF EXISTS audience_templates_name_lower_idx`;
  await sql`DROP INDEX IF EXISTS audience_templates_name_key_idx`;
  const audienceTemplates = await sql`
    SELECT id, name, name_key FROM audience_templates ORDER BY created_at, id
  `;
  const usedAudienceNameKeys = new Set();
  for (const row of audienceTemplates) {
    const unique = uniqueAudienceTemplateName(row.name, row.id, usedAudienceNameKeys);
    if (row.name !== unique.name || row.name_key !== unique.key) {
      await sql`
        UPDATE audience_templates SET name = ${unique.name}, name_key = ${unique.key} WHERE id = ${row.id}
      `;
    }
  }
  await sql`ALTER TABLE audience_templates ALTER COLUMN name_key SET NOT NULL`;
  await sql`
    CREATE UNIQUE INDEX IF NOT EXISTS audience_templates_owner_name_key_idx
    ON audience_templates (owner_meta_user_id, name_key)
  `;
  return 'audience_templates';
}

function uniqueAudienceTemplateName(name, id, usedKeys) {
  const baseName = String(name ?? '').trim() || `Audience ${id}`;
  let candidate = baseName;
  let key = normalizeAudienceTemplateName(candidate);
  let suffix = 2;
  while (usedKeys.has(key)) {
    const marker = ` (${suffix})`;
    candidate = `${baseName.slice(0, Math.max(1, 120 - marker.length))}${marker}`;
    key = normalizeAudienceTemplateName(candidate);
    suffix += 1;
  }
  usedKeys.add(key);
  return { name: candidate, key };
}

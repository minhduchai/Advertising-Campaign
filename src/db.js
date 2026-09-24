import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { buildCampaignSummaries } from './run-history-summary.js';
import {
  AUDIENCE_TEMPLATE_ID_PREFIX,
  createAudienceTemplateId,
  normalizeAudienceTemplateName,
  validateAudienceTemplate
} from './audience-template.js';
import {
  createSharedConversationSeed,
  SHARED_CONVERSATION_OWNER_ID,
  SHARED_CONVERSATION_SEED_MIGRATION
} from './shared-conversation-library.js';

export function createSqliteDatabase(path) {
  const database = new DatabaseSync(path);
  database.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      meta_user_id TEXT,
      meta_user_name TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS oauth_states (
      state TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      expires_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS workflow_request_nonces (
      nonce_hash TEXT PRIMARY KEY,
      expires_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS workflow_request_nonces_expires_idx ON workflow_request_nonces (expires_at);
    CREATE TABLE IF NOT EXISTS connections (
      meta_user_id TEXT PRIMARY KEY,
      meta_user_name TEXT NOT NULL,
      access_token_ciphertext TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS upload_agent_pairing_codes (
      code_hash TEXT PRIMARY KEY,
      owner_meta_user_id TEXT NOT NULL,
      expires_at INTEGER NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS upload_agent_devices (
      id TEXT PRIMARY KEY,
      owner_meta_user_id TEXT NOT NULL,
      token_hash TEXT NOT NULL UNIQUE,
      device_json TEXT NOT NULL,
      revoked_at INTEGER,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS telegram_upload_jobs (
      id TEXT PRIMARY KEY,
      owner_meta_user_id TEXT NOT NULL,
      media_id TEXT NOT NULL UNIQUE,
      network_path TEXT NOT NULL,
      intent_code TEXT NOT NULL,
      status TEXT NOT NULL,
      lease_token TEXT,
      lease_expires_at INTEGER,
      error_message TEXT,
      uploaded_bytes INTEGER NOT NULL DEFAULT 0,
      total_bytes INTEGER NOT NULL DEFAULT 0,
      expires_at INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS media (
      id TEXT PRIMARY KEY,
      owner_meta_user_id TEXT NOT NULL,
      name TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      content BLOB,
      blob_url TEXT,
      blob_download_url TEXT,
      blob_pathname TEXT,
      size_bytes INTEGER NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS meta_video_assets (
      owner_meta_user_id TEXT NOT NULL,
      media_id TEXT NOT NULL,
      ad_account_id TEXT NOT NULL,
      meta_video_id TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (owner_meta_user_id, media_id, ad_account_id)
    );
    CREATE TABLE IF NOT EXISTS runs (
      id TEXT PRIMARY KEY,
      owner_meta_user_id TEXT NOT NULL,
      status TEXT NOT NULL,
      ad_account_id TEXT,
      snapshot_json TEXT,
      execution_json TEXT,
      workflow_token TEXT,
      workflow_lease_expires_at INTEGER,
      completed_at INTEGER,
      created_at INTEGER NOT NULL
    );
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
      error_json TEXT,
      post_id TEXT,
      permalink_url TEXT,
      PRIMARY KEY (run_id, client_id)
    );
    CREATE TABLE IF NOT EXISTS conversation_templates (
      id TEXT PRIMARY KEY,
      owner_meta_user_id TEXT NOT NULL,
      page_id TEXT NOT NULL,
      name TEXT NOT NULL,
      template_json TEXT NOT NULL,
      is_default INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS audience_templates (
      id TEXT PRIMARY KEY,
      owner_meta_user_id TEXT,
      name TEXT NOT NULL,
      name_key TEXT NOT NULL,
      content_json TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS campaign_presets (
      id TEXT PRIMARY KEY,
      owner_meta_user_id TEXT NOT NULL,
      name TEXT NOT NULL,
      content_json TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS app_migrations (
      key TEXT PRIMARY KEY,
      applied_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS conversation_templates_owner_page
      ON conversation_templates (owner_meta_user_id, page_id);
    CREATE INDEX IF NOT EXISTS campaign_presets_owner_updated_idx
      ON campaign_presets (owner_meta_user_id, updated_at DESC);
    CREATE UNIQUE INDEX IF NOT EXISTS conversation_templates_one_default
      ON conversation_templates (owner_meta_user_id, page_id)
      WHERE is_default = 1;
    CREATE INDEX IF NOT EXISTS upload_agent_pairing_codes_expires_idx
      ON upload_agent_pairing_codes (expires_at);
    CREATE INDEX IF NOT EXISTS upload_agent_devices_owner_idx
      ON upload_agent_devices (owner_meta_user_id, id);
    CREATE INDEX IF NOT EXISTS telegram_upload_jobs_queue_idx
      ON telegram_upload_jobs (status, expires_at, created_at);
    CREATE INDEX IF NOT EXISTS telegram_upload_jobs_owner_media_idx
      ON telegram_upload_jobs (owner_meta_user_id, media_id);
    CREATE INDEX IF NOT EXISTS meta_video_assets_media_idx
      ON meta_video_assets (owner_meta_user_id, media_id);
  `);

  migrateSqliteSchema(database);
  seedSharedConversationLibrary(database);
  const cleanupExpiredStates = database.prepare('DELETE FROM oauth_states WHERE expires_at <= ?');
  cleanupExpiredStates.run(Date.now());

  function getTemplate(ownerMetaUserId, id) {
    const row = database.prepare(`
      SELECT id, owner_meta_user_id, page_id, name, template_json, is_default, created_at, updated_at
      FROM conversation_templates
      WHERE id = ? AND owner_meta_user_id = ?
    `).get(id, ownerMetaUserId);
    return row ? mapConversationTemplate(row) : null;
  }

  function createTemplate(ownerMetaUserId, input) {
    const id = input.id ?? randomUUID();
    const timestamp = input.now ?? Date.now();
    database.prepare(`
      INSERT INTO conversation_templates (
        id, owner_meta_user_id, page_id, name, template_json, is_default, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, 0, ?, ?)
    `).run(id, ownerMetaUserId, input.pageId, input.name, JSON.stringify(input.template), timestamp, timestamp);
    return getTemplate(ownerMetaUserId, id);
  }

  function normalizeTemplateArguments(ownerOrTemplate, id, input) {
    if (typeof ownerOrTemplate === 'object') {
      return { ownerMetaUserId: ownerOrTemplate.ownerMetaUserId, id: ownerOrTemplate.id, input: ownerOrTemplate };
    }
    return { ownerMetaUserId: ownerOrTemplate, id, input };
  }

  return {
    createSession(options = {}) {
      const id = options.id ?? randomUUID();
      const now = options.now ?? Date.now();
      database.prepare('INSERT INTO sessions (id, created_at, updated_at) VALUES (?, ?, ?)').run(id, now, now);
      return mapSession({ id, meta_user_id: null, meta_user_name: null, created_at: now, updated_at: now });
    },

    getSession(id) {
      const row = database.prepare(`
        SELECT id, meta_user_id, meta_user_name, created_at, updated_at FROM sessions WHERE id = ?
      `).get(id);
      return row ? mapSession(row) : null;
    },

    attachMetaUser(sessionId, metaUser) {
      const user = typeof metaUser === 'string' ? { id: metaUser, name: null } : metaUser;
      database.prepare(`
        UPDATE sessions
        SET meta_user_id = ?, meta_user_name = COALESCE(?, meta_user_name), updated_at = ?
        WHERE id = ?
      `).run(user.id, user.name ?? null, Date.now(), sessionId);
      return this.getSession(sessionId);
    },

    disconnectMetaUser(sessionId, metaUserId) {
      database.exec('BEGIN IMMEDIATE');
      try {
        database.prepare(`
          UPDATE sessions
          SET meta_user_id = NULL, meta_user_name = NULL, updated_at = ?
          WHERE id = ? AND (meta_user_id = ? OR meta_user_id IS NULL)
        `).run(Date.now(), sessionId, metaUserId);
        if (metaUserId) {
          database.prepare('DELETE FROM connections WHERE meta_user_id = ?').run(metaUserId);
        }
        database.exec('COMMIT');
      } catch (error) {
        database.exec('ROLLBACK');
        throw error;
      }
      return this.getSession(sessionId);
    },

    claimWorkflowNonce(nonceHash, expiresAt, now = Date.now()) {
      database.prepare('DELETE FROM workflow_request_nonces WHERE expires_at < ?').run(now);
      return database.prepare(`
        INSERT INTO workflow_request_nonces (nonce_hash, expires_at) VALUES (?, ?)
        ON CONFLICT (nonce_hash) DO NOTHING
      `).run(nonceHash, expiresAt).changes === 1;
    },

    createOAuthState(sessionOrRecord, state) {
      const record = typeof sessionOrRecord === 'object'
        ? sessionOrRecord
        : { sessionId: sessionOrRecord, state, expiresAt: Date.now() + 10 * 60 * 1000 };
      database.prepare('INSERT INTO oauth_states (state, session_id, expires_at) VALUES (?, ?, ?)').run(
        record.state,
        record.sessionId,
        record.expiresAt ?? Date.now() + 10 * 60 * 1000
      );
      return { state: record.state, sessionId: record.sessionId, expiresAt: record.expiresAt };
    },

    consumeOAuthState(state, now = Date.now()) {
      cleanupExpiredStates.run(now);
      const row = database.prepare('SELECT session_id FROM oauth_states WHERE state = ?').get(state);
      if (!row) return null;
      database.prepare('DELETE FROM oauth_states WHERE state = ?').run(state);
      return { sessionId: row.session_id };
    },

    createUploadAgentPairingCode(input) {
      database.prepare(`
        INSERT INTO upload_agent_pairing_codes (code_hash, owner_meta_user_id, expires_at, created_at)
        VALUES (?, ?, ?, ?)
      `).run(input.codeHash, input.ownerMetaUserId, input.expiresAt, input.createdAt ?? Date.now());
      return {
        codeHash: input.codeHash,
        ownerMetaUserId: input.ownerMetaUserId,
        expiresAt: input.expiresAt,
        createdAt: input.createdAt ?? Date.now()
      };
    },

    consumeUploadAgentPairingCode(codeHash, now = Date.now()) {
      const row = database.prepare(`
        DELETE FROM upload_agent_pairing_codes
        WHERE code_hash = ? AND expires_at > ?
        RETURNING owner_meta_user_id
      `).get(codeHash, now);
      return row ? { ownerMetaUserId: row.owner_meta_user_id } : null;
    },

    saveUploadAgentDevice(input) {
      const createdAt = input.createdAt ?? Date.now();
      const row = database.prepare(`
        INSERT INTO upload_agent_devices (
          id, owner_meta_user_id, token_hash, device_json, revoked_at, created_at, updated_at
        ) VALUES (?, ?, ?, ?, NULL, ?, ?)
        RETURNING id, owner_meta_user_id, token_hash, device_json, revoked_at, created_at, updated_at
      `).get(
        input.id,
        input.ownerMetaUserId,
        input.tokenHash,
        JSON.stringify(input.device),
        createdAt,
        createdAt
      );
      return mapUploadAgentDevice(row);
    },

    getUploadAgentDevice(ownerMetaUserId, id) {
      const row = database.prepare(`
        SELECT id, owner_meta_user_id, token_hash, device_json, revoked_at, created_at, updated_at
        FROM upload_agent_devices
        WHERE owner_meta_user_id = ? AND id = ?
      `).get(ownerMetaUserId, id);
      return row ? mapUploadAgentDevice(row) : null;
    },

    revokeUploadAgentDevice(ownerMetaUserId, id, now = Date.now()) {
      return database.prepare(`
        UPDATE upload_agent_devices
        SET revoked_at = ?, updated_at = ?
        WHERE owner_meta_user_id = ? AND id = ? AND revoked_at IS NULL
      `).run(now, now, ownerMetaUserId, id).changes > 0;
    },

    createTelegramUploadJob(input) {
      const now = input.createdAt ?? Date.now();
      const row = database.prepare(`
        INSERT INTO telegram_upload_jobs (
          id, owner_meta_user_id, media_id, network_path, intent_code, status,
          lease_token, lease_expires_at, error_message, uploaded_bytes, total_bytes,
          expires_at, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, 'queued', NULL, NULL, NULL, 0, 0, ?, ?, ?)
        RETURNING *
      `).get(
        input.id,
        input.ownerMetaUserId,
        input.mediaId,
        input.networkPath,
        input.intentCode,
        input.expiresAt,
        now,
        now
      );
      return mapTelegramUploadJob(row);
    },

    getTelegramUploadJobByMedia(ownerMetaUserId, mediaId) {
      const row = database.prepare(`
        SELECT * FROM telegram_upload_jobs
        WHERE owner_meta_user_id = ? AND media_id = ?
      `).get(ownerMetaUserId, mediaId);
      return row ? mapTelegramUploadJob(row) : null;
    },

    claimNextTelegramUploadJob(input) {
      const now = input.now ?? Date.now();
      database.exec('BEGIN IMMEDIATE');
      try {
        const candidate = database.prepare(`
          SELECT id FROM telegram_upload_jobs
          WHERE expires_at > ?
            AND (status = 'queued' OR (status = 'uploading' AND lease_expires_at <= ?))
          ORDER BY created_at, id
          LIMIT 1
        `).get(now, now);
        if (!candidate) {
          database.exec('COMMIT');
          return null;
        }
        const row = database.prepare(`
          UPDATE telegram_upload_jobs
          SET status = 'uploading', lease_token = ?, lease_expires_at = ?,
              error_message = NULL, uploaded_bytes = 0, total_bytes = 0, updated_at = ?
          WHERE id = ?
          RETURNING *
        `).get(input.leaseToken, input.leaseExpiresAt, now, candidate.id);
        database.exec('COMMIT');
        return mapTelegramUploadJob(row);
      } catch (error) {
        database.exec('ROLLBACK');
        throw error;
      }
    },

    updateTelegramUploadJobProgress(input) {
      const now = input.now ?? Date.now();
      const row = database.prepare(`
        UPDATE telegram_upload_jobs
        SET uploaded_bytes = ?, total_bytes = ?, lease_expires_at = ?, updated_at = ?
        WHERE id = ? AND status = 'uploading' AND lease_token = ?
        RETURNING *
      `).get(
        input.uploadedBytes,
        input.totalBytes,
        input.leaseExpiresAt,
        now,
        input.id,
        input.leaseToken
      );
      return row ? mapTelegramUploadJob(row) : null;
    },

    finishTelegramUploadJob(input) {
      const now = input.now ?? Date.now();
      const status = input.status === 'completed' ? 'completed' : 'failed';
      const row = database.prepare(`
        UPDATE telegram_upload_jobs
        SET status = ?, error_message = ?,
            uploaded_bytes = CASE WHEN ? = 'completed' AND total_bytes > 0 THEN total_bytes ELSE uploaded_bytes END,
            lease_token = NULL, lease_expires_at = NULL, updated_at = ?
        WHERE id = ? AND status = 'uploading' AND lease_token = ?
        RETURNING *
      `).get(status, input.errorMessage ?? null, status, now, input.id, input.leaseToken);
      return row ? mapTelegramUploadJob(row) : null;
    },

    upsertConnection(metaUserIdOrConnection, connection) {
      const record = connection
        ? { ...connection, metaUserId: metaUserIdOrConnection }
        : metaUserIdOrConnection;
      const now = record.now ?? Date.now();
      database.prepare(`
        INSERT INTO connections (meta_user_id, meta_user_name, access_token_ciphertext, updated_at)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(meta_user_id) DO UPDATE SET
          meta_user_name = excluded.meta_user_name,
          access_token_ciphertext = excluded.access_token_ciphertext,
          updated_at = excluded.updated_at
      `).run(record.metaUserId, record.metaUserName ?? '', record.accessTokenCiphertext, now);
      return this.getConnection(record.metaUserId);
    },

    getConnection(metaUserId) {
      const row = database.prepare(`
        SELECT meta_user_id, meta_user_name, access_token_ciphertext, updated_at
        FROM connections WHERE meta_user_id = ?
      `).get(metaUserId);
      return row ? mapConnection(row) : null;
    },

    saveMedia(media) {
      const id = media.id ?? randomUUID();
      const createdAt = media.createdAt ?? Date.now();
      const sizeBytes = media.sizeBytes ?? media.content?.byteLength ?? 0;
      database.prepare(`
        INSERT INTO media (
          id, owner_meta_user_id, name, mime_type, content, blob_url, blob_download_url, blob_pathname, size_bytes, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id,
        media.ownerMetaUserId,
        media.name,
        media.mimeType,
        media.content ?? null,
        media.blobUrl ?? null,
        media.blobDownloadUrl ?? null,
        media.blobPathname ?? null,
        sizeBytes,
        createdAt
      );
      return this.getMedia(media.ownerMetaUserId, id);
    },

    updateMediaLocation(ownerMetaUserId, id, expectedUrl, blobUrl, blobPathname) {
      const row = database.prepare(`
        UPDATE media SET blob_url = ?, blob_pathname = ?, blob_download_url = NULL
        WHERE owner_meta_user_id = ? AND id = ? AND blob_url = ? RETURNING *
      `).get(blobUrl, blobPathname, ownerMetaUserId, id, expectedUrl);
      return row ? mapMedia(row) : null;
    },

    getMedia(ownerMetaUserId, id) {
      if (!ownerMetaUserId || !id) {
        throw new TypeError('getMedia requires ownerMetaUserId and id');
      }
      const row = database.prepare(`
        SELECT id, owner_meta_user_id, name, mime_type, content, blob_url, blob_download_url, blob_pathname, size_bytes, created_at
        FROM media WHERE id = ? AND owner_meta_user_id = ?
      `).get(id, ownerMetaUserId);
      return row ? mapMedia(row) : null;
    },

    getMetaVideoId(ownerMetaUserId, mediaId, adAccountId) {
      return database.prepare(`
        SELECT meta_video_id FROM meta_video_assets
        WHERE owner_meta_user_id = ? AND media_id = ? AND ad_account_id = ?
      `).get(ownerMetaUserId, mediaId, adAccountId)?.meta_video_id ?? null;
    },

    saveMetaVideoId(ownerMetaUserId, mediaId, adAccountId, metaVideoId, now = Date.now()) {
      database.prepare(`
        INSERT INTO meta_video_assets (
          owner_meta_user_id, media_id, ad_account_id, meta_video_id, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(owner_meta_user_id, media_id, ad_account_id) DO UPDATE SET
          meta_video_id = excluded.meta_video_id,
          updated_at = excluded.updated_at
      `).run(ownerMetaUserId, mediaId, adAccountId, metaVideoId, now, now);
      return metaVideoId;
    },

    deleteMetaVideoId(ownerMetaUserId, mediaId, adAccountId, metaVideoId) {
      return database.prepare(`
        DELETE FROM meta_video_assets
        WHERE owner_meta_user_id = ? AND media_id = ? AND ad_account_id = ? AND meta_video_id = ?
      `).run(ownerMetaUserId, mediaId, adAccountId, metaVideoId).changes > 0;
    },

    registeredR2Keys(bucketName, keys) {
      if (keys.length === 0) return [];
      const urls = keys.map((key) => `r2://${bucketName}/${key}`);
      return database.prepare(`
        SELECT blob_pathname FROM media WHERE blob_url IN (${urls.map(() => '?').join(',')})
      `).all(...urls).map((row) => row.blob_pathname);
    },

    deleteMedia(ownerMetaUserId, id, blobUrl) {
      if (!ownerMetaUserId || !id || !blobUrl) throw new TypeError('deleteMedia requires owner, id and blobUrl');
      return database.prepare('DELETE FROM media WHERE owner_meta_user_id = ? AND id = ? AND blob_url = ?')
        .run(ownerMetaUserId, id, blobUrl).changes > 0;
    },

    listAudienceTemplates(ownerMetaUserId) {
      return database.prepare(`
        SELECT id, name, content_json, created_at, updated_at
        FROM audience_templates
        WHERE owner_meta_user_id = ?
        ORDER BY updated_at DESC, name_key, id
      `).all(ownerMetaUserId).map(mapAudienceTemplate);
    },

    createAudienceTemplate(ownerMetaUserId, input) {
      const template = validateAudienceTemplate(input);
      const id = input.id ?? createAudienceTemplateId();
      assertAudienceTemplateId(id);
      const now = input.now ?? Date.now();
      database.prepare(`
        INSERT INTO audience_templates (id, owner_meta_user_id, name, name_key, content_json, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
        id,
        ownerMetaUserId,
        template.name,
        normalizeAudienceTemplateName(template.name),
        JSON.stringify(template.content),
        now,
        now
      );
      return getAudienceTemplate(database, ownerMetaUserId, id);
    },

    updateAudienceTemplate(ownerMetaUserId, id, input) {
      if (!isAudienceTemplateId(id)) return null;
      const template = validateAudienceTemplate(input);
      const result = database.prepare(`
        UPDATE audience_templates
        SET name = ?, name_key = ?, content_json = ?, updated_at = ?
        WHERE id = ? AND owner_meta_user_id = ?
      `).run(
        template.name,
        normalizeAudienceTemplateName(template.name),
        JSON.stringify(template.content),
        input.now ?? Date.now(),
        id,
        ownerMetaUserId
      );
      return result.changes > 0 ? getAudienceTemplate(database, ownerMetaUserId, id) : null;
    },

    duplicateAudienceTemplate(ownerMetaUserId, id, name) {
      if (!isAudienceTemplateId(id)) return null;
      const source = getAudienceTemplate(database, ownerMetaUserId, id);
      if (!source) return null;
      return this.createAudienceTemplate(ownerMetaUserId, { name, content: source.content });
    },

    deleteAudienceTemplate(ownerMetaUserId, id) {
      if (!isAudienceTemplateId(id)) return false;
      return database.prepare('DELETE FROM audience_templates WHERE id = ? AND owner_meta_user_id = ?')
        .run(id, ownerMetaUserId).changes > 0;
    },

    claimLegacyTemplateLibraries(ownerMetaUserId) {
      database.exec('BEGIN IMMEDIATE');
      try {
        database.prepare('UPDATE audience_templates SET owner_meta_user_id = ? WHERE owner_meta_user_id IS NULL')
          .run(ownerMetaUserId);
        database.prepare('UPDATE conversation_templates SET owner_meta_user_id = ? WHERE owner_meta_user_id = ?')
          .run(ownerMetaUserId, SHARED_CONVERSATION_OWNER_ID);
        database.exec('COMMIT');
      } catch (error) {
        database.exec('ROLLBACK');
        throw error;
      }
    },

    listConversationTemplates(ownerMetaUserId, pageId) {
      const rows = pageId === undefined
        ? database.prepare(`
            SELECT id, owner_meta_user_id, page_id, name, template_json, is_default, created_at, updated_at
            FROM conversation_templates WHERE owner_meta_user_id = ?
            ORDER BY is_default DESC, updated_at DESC, name COLLATE NOCASE
          `).all(ownerMetaUserId)
        : database.prepare(`
            SELECT id, owner_meta_user_id, page_id, name, template_json, is_default, created_at, updated_at
            FROM conversation_templates WHERE owner_meta_user_id = ? AND page_id = ?
            ORDER BY is_default DESC, updated_at DESC, name COLLATE NOCASE
          `).all(ownerMetaUserId, pageId);
      return rows.map(mapConversationTemplate);
    },

    getConversationTemplate(ownerMetaUserId, id) {
      return getTemplate(ownerMetaUserId, id);
    },

    createConversationTemplate(ownerOrTemplate, input) {
      const template = input ? { ...input, ownerMetaUserId: ownerOrTemplate } : ownerOrTemplate;
      return createTemplate(template.ownerMetaUserId, template);
    },

    updateConversationTemplate(ownerOrTemplate, id, input) {
      const args = normalizeTemplateArguments(ownerOrTemplate, id, input);
      const template = args.input;
      const result = database.prepare(`
        UPDATE conversation_templates
        SET name = ?, template_json = ?, updated_at = ?
        WHERE id = ? AND owner_meta_user_id = ?
      `).run(template.name, JSON.stringify(template.template), Date.now(), args.id, args.ownerMetaUserId);
      return result.changes > 0 ? getTemplate(args.ownerMetaUserId, args.id) : null;
    },

    duplicateConversationTemplate(ownerOrTemplate, id, input) {
      const args = normalizeTemplateArguments(ownerOrTemplate, id, input);
      const source = getTemplate(args.ownerMetaUserId, args.id);
      if (!source) return null;
      const name = args.input.name;
      return createTemplate(args.ownerMetaUserId, {
        pageId: source.pageId,
        name,
        template: { ...source.template, sourceTemplateId: null, templateName: name }
      });
    },

    setDefaultConversationTemplate(ownerOrTemplate, id, input) {
      const args = normalizeTemplateArguments(ownerOrTemplate, id, input);
      const template = args.input ?? { pageId: undefined };
      const target = getTemplate(args.ownerMetaUserId, args.id);
      if (!target || (template.pageId && target.pageId !== template.pageId)) return null;

      const now = template.now ?? Date.now();
      database.exec('BEGIN IMMEDIATE');
      try {
        database.prepare(`
          UPDATE conversation_templates SET is_default = 0, updated_at = ?
          WHERE owner_meta_user_id = ? AND page_id = ? AND is_default = 1
        `).run(now, args.ownerMetaUserId, target.pageId);
        database.prepare(`
          UPDATE conversation_templates SET is_default = 1, updated_at = ?
          WHERE id = ? AND owner_meta_user_id = ? AND page_id = ?
        `).run(now, args.id, args.ownerMetaUserId, target.pageId);
        database.exec('COMMIT');
      } catch (error) {
        database.exec('ROLLBACK');
        throw error;
      }
      return getTemplate(args.ownerMetaUserId, args.id);
    },

    deleteConversationTemplate(ownerOrTemplate, id) {
      const args = normalizeTemplateArguments(ownerOrTemplate, id);
      const row = database.prepare(`
        SELECT page_id, is_default FROM conversation_templates WHERE id = ? AND owner_meta_user_id = ?
      `).get(args.id, args.ownerMetaUserId);
      if (!row) return false;

      database.exec('BEGIN IMMEDIATE');
      try {
        const deleted = database.prepare(`
          DELETE FROM conversation_templates WHERE id = ? AND owner_meta_user_id = ?
        `).run(args.id, args.ownerMetaUserId).changes > 0;
        if (deleted && Boolean(row.is_default)) {
          const nextTemplate = database.prepare(`
            SELECT id FROM conversation_templates
            WHERE owner_meta_user_id = ? AND page_id = ?
            ORDER BY updated_at DESC, created_at DESC, id DESC
            LIMIT 1
          `).get(args.ownerMetaUserId, row.page_id);
          if (nextTemplate) {
            database.prepare(`
              UPDATE conversation_templates SET is_default = 1, updated_at = ?
              WHERE id = ? AND owner_meta_user_id = ?
            `).run(Date.now(), nextTemplate.id, args.ownerMetaUserId);
          }
        }
        database.exec('COMMIT');
        return deleted;
      } catch (error) {
        database.exec('ROLLBACK');
        throw error;
      }
    },

    importConversationTemplate(ownerMetaUserId, input) {
      const id = input.id ?? randomUUID();
      const now = input.updatedAt ?? Date.now();
      const result = database.prepare(`
        INSERT INTO conversation_templates (
          id, owner_meta_user_id, page_id, name, template_json, is_default, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          page_id = excluded.page_id,
          name = excluded.name,
          template_json = excluded.template_json,
          is_default = excluded.is_default,
          created_at = excluded.created_at,
          updated_at = excluded.updated_at
        WHERE conversation_templates.owner_meta_user_id = excluded.owner_meta_user_id
      `).run(
        id,
        ownerMetaUserId,
        input.pageId,
        input.name,
        JSON.stringify(input.template),
        input.isDefault ? 1 : 0,
        input.createdAt ?? now,
        now
      );
      if (result.changes === 0) {
        throw new Error('Conversation template ID has an owner conflict.');
      }
      return getTemplate(ownerMetaUserId, id);
    },

    importConversationTemplates(ownerMetaUserId, templates) {
      const pageIds = new Set(templates.map((template) => template.pageId));
      const defaultTemplates = templates.filter((template) => template.isDefault);
      if (defaultTemplates.length !== pageIds.size
        || new Set(defaultTemplates.map((template) => template.pageId)).size !== pageIds.size) {
        throw new Error('Conversation template import requires exactly one default template per Page.');
      }
      database.exec('BEGIN IMMEDIATE');
      try {
        for (const template of templates) {
          const existing = database.prepare(`
            SELECT owner_meta_user_id FROM conversation_templates WHERE id = ?
          `).get(template.id);
          if (existing && existing.owner_meta_user_id !== ownerMetaUserId) {
            throw new Error('Conversation template ID has an owner conflict.');
          }
        }

        for (const template of templates) {
          this.importConversationTemplate(ownerMetaUserId, { ...template, isDefault: false });
        }

        for (const defaultTemplate of defaultTemplates) {
          database.prepare(`
            UPDATE conversation_templates SET is_default = 0, updated_at = ?
            WHERE owner_meta_user_id = ? AND page_id = ? AND is_default = 1
          `).run(defaultTemplate.updatedAt, ownerMetaUserId, defaultTemplate.pageId);
          const selected = database.prepare(`
            UPDATE conversation_templates SET is_default = 1, updated_at = ?
            WHERE id = ? AND owner_meta_user_id = ? AND page_id = ?
          `).run(
            defaultTemplate.updatedAt,
            defaultTemplate.id,
            ownerMetaUserId,
            defaultTemplate.pageId
          );
          if (selected.changes !== 1) {
            throw new Error('Default conversation template could not be selected.');
          }
        }
        database.exec('COMMIT');
      } catch (error) {
        database.exec('ROLLBACK');
        throw error;
      }
      return getTemplate(ownerMetaUserId, defaultTemplates[0].id);
    },

    listSeedingTemplates(ownerMetaUserId) {
      return database.prepare(`
        SELECT id, owner_meta_user_id, name, items_json, created_at, updated_at
        FROM seeding_templates
        WHERE owner_meta_user_id = ?
        ORDER BY updated_at DESC, created_at DESC, id DESC
      `).all(ownerMetaUserId).map(mapSeedingTemplate);
    },

    getSeedingTemplate(ownerMetaUserId, id) {
      const row = database.prepare(`
        SELECT id, owner_meta_user_id, name, items_json, created_at, updated_at
        FROM seeding_templates
        WHERE owner_meta_user_id = ? AND id = ?
      `).get(ownerMetaUserId, id);
      return row ? mapSeedingTemplate(row) : null;
    },

    createSeedingTemplate(input) {
      const id = input.id ?? randomUUID();
      const now = input.now ?? Date.now();
      database.prepare(`
        INSERT INTO seeding_templates (id, owner_meta_user_id, name, items_json, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(id, input.ownerMetaUserId, input.name, JSON.stringify(input.items), now, now);
      return this.getSeedingTemplate(input.ownerMetaUserId, id);
    },

    updateSeedingTemplate(input) {
      const result = database.prepare(`
        UPDATE seeding_templates
        SET name = ?, items_json = ?, updated_at = ?
        WHERE owner_meta_user_id = ? AND id = ?
      `).run(input.name, JSON.stringify(input.items), input.now ?? Date.now(), input.ownerMetaUserId, input.id);
      return result.changes > 0 ? this.getSeedingTemplate(input.ownerMetaUserId, input.id) : null;
    },

    duplicateSeedingTemplate(input) {
      const source = this.getSeedingTemplate(input.ownerMetaUserId, input.id);
      if (!source) return null;
      return this.createSeedingTemplate({
        id: input.newId ?? randomUUID(),
        ownerMetaUserId: input.ownerMetaUserId,
        name: input.name,
        items: copySeedingItems(source.items),
        now: input.now
      });
    },

    deleteSeedingTemplate(ownerMetaUserId, id) {
      return database.prepare(`
        DELETE FROM seeding_templates WHERE owner_meta_user_id = ? AND id = ?
      `).run(ownerMetaUserId, id).changes > 0;
    },

    listCampaignPresets(ownerMetaUserId) {
      return database.prepare(`
        SELECT id, owner_meta_user_id, name, content_json, created_at, updated_at
        FROM campaign_presets
        WHERE owner_meta_user_id = ?
        ORDER BY updated_at DESC, created_at DESC, id DESC
      `).all(ownerMetaUserId).map(mapCampaignPreset);
    },

    getCampaignPreset(ownerMetaUserId, id) {
      const row = database.prepare(`
        SELECT id, owner_meta_user_id, name, content_json, created_at, updated_at
        FROM campaign_presets
        WHERE owner_meta_user_id = ? AND id = ?
      `).get(ownerMetaUserId, id);
      return row ? mapCampaignPreset(row) : null;
    },

    createCampaignPreset(input) {
      const id = input.id ?? randomUUID();
      const now = input.now ?? Date.now();
      database.prepare(`
        INSERT INTO campaign_presets (id, owner_meta_user_id, name, content_json, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(id, input.ownerMetaUserId, input.name, JSON.stringify(input.content), now, now);
      return this.getCampaignPreset(input.ownerMetaUserId, id);
    },

    updateCampaignPreset(input) {
      const result = database.prepare(`
        UPDATE campaign_presets
        SET name = ?, content_json = ?, updated_at = ?
        WHERE owner_meta_user_id = ? AND id = ?
      `).run(input.name, JSON.stringify(input.content), input.now ?? Date.now(), input.ownerMetaUserId, input.id);
      return result.changes > 0 ? this.getCampaignPreset(input.ownerMetaUserId, input.id) : null;
    },

    deleteCampaignPreset(ownerMetaUserId, id) {
      return database.prepare(`
        DELETE FROM campaign_presets WHERE owner_meta_user_id = ? AND id = ?
      `).run(ownerMetaUserId, id).changes > 0;
    },

    insertSeedingJobs(ownerMetaUserId, jobs) {
      if (jobs.length === 0) return 0;
      const runIds = [...new Set(jobs.map(({ runId }) => runId))];
      const insert = database.prepare(`
        INSERT INTO seeding_jobs (
          id, run_id, owner_meta_user_id, campaign_client_id, page_id, post_id, item_id,
          position, sequence, message, image_media_id, status, meta_comment_id, error_json,
          attempt_count, available_at, started_at, completed_at, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT DO NOTHING
      `);
      let inserted = 0;
      database.exec('BEGIN IMMEDIATE');
      try {
        const ownedRunCount = database.prepare(`
          SELECT COUNT(*) AS count
          FROM runs
          WHERE owner_meta_user_id = ? AND id IN (${runIds.map(() => '?').join(', ')})
        `).get(ownerMetaUserId, ...runIds).count;
        if (Number(ownedRunCount) !== runIds.length) {
          database.exec('COMMIT');
          return 0;
        }
        const selections = new Map();
        for (const job of jobs) {
          const key = `${job.runId}\u0000${job.postId}`;
          const selectedCampaignClientId = selections.get(key);
          if (selectedCampaignClientId && selectedCampaignClientId !== job.campaignClientId) {
            throw seedingPostConflictError(job.runId, job.postId);
          }
          selections.set(key, job.campaignClientId);
        }
        const findConflict = database.prepare(`
          SELECT 1
          FROM seeding_jobs
          WHERE owner_meta_user_id = ? AND run_id = ? AND post_id = ? AND campaign_client_id <> ?
          LIMIT 1
        `);
        for (const [key, campaignClientId] of selections) {
          const [runId, postId] = key.split('\u0000');
          if (findConflict.get(ownerMetaUserId, runId, postId, campaignClientId)) {
            throw seedingPostConflictError(runId, postId);
          }
        }
        for (const job of jobs) {
          const createdAt = job.createdAt ?? Date.now();
          inserted += Number(insert.run(
            job.id,
            job.runId,
            ownerMetaUserId,
            job.campaignClientId,
            job.pageId,
            job.postId,
            job.itemId,
            job.position,
            job.sequence,
            job.message,
            job.imageMediaId ?? null,
            job.status ?? 'pending',
            job.metaCommentId ?? null,
            job.error ? JSON.stringify(job.error) : null,
            job.attemptCount ?? 0,
            job.availableAt ?? createdAt,
            job.startedAt ?? null,
            job.completedAt ?? null,
            createdAt,
            job.updatedAt ?? createdAt
          ).changes);
        }
        database.exec('COMMIT');
        return inserted;
      } catch (error) {
        database.exec('ROLLBACK');
        throw error;
      }
    },

    listSeedingJobs(ownerMetaUserId, runId) {
      return database.prepare(`
        SELECT * FROM seeding_jobs
        WHERE owner_meta_user_id = ? AND run_id = ?
        ORDER BY sequence, position, id
      `).all(ownerMetaUserId, runId).map(mapSeedingJob);
    },

    claimNextSeedingJob({ ownerMetaUserId, runId, now, staleBefore }) {
      database.exec('BEGIN IMMEDIATE');
      try {
        database.prepare(`
          UPDATE seeding_jobs
          SET status = 'needs_review', updated_at = ?
          WHERE owner_meta_user_id = ? AND run_id = ?
            AND status = 'posting' AND started_at < ?
        `).run(now, ownerMetaUserId, runId, staleBefore);

        const ownedRun = database.prepare(`
          SELECT id FROM runs WHERE owner_meta_user_id = ? AND id = ?
        `).get(ownerMetaUserId, runId);
        const posting = ownedRun && database.prepare(`
          SELECT id FROM seeding_jobs
          WHERE owner_meta_user_id = ? AND run_id = ? AND status = 'posting'
          LIMIT 1
        `).get(ownerMetaUserId, runId);
        if (!ownedRun || posting) {
          database.exec('COMMIT');
          return null;
        }

        const candidate = database.prepare(`
          SELECT candidate_job.id
          FROM seeding_jobs AS candidate_job
          WHERE candidate_job.owner_meta_user_id = ?
            AND candidate_job.run_id = ?
            AND candidate_job.status = 'pending'
            AND candidate_job.available_at <= ?
            AND NOT EXISTS (
              SELECT 1
              FROM seeding_jobs AS prior
              WHERE prior.owner_meta_user_id = candidate_job.owner_meta_user_id
                AND prior.run_id = candidate_job.run_id
                AND prior.campaign_client_id = candidate_job.campaign_client_id
                AND prior.post_id = candidate_job.post_id
                AND prior.position < candidate_job.position
                AND prior.status IN ('pending', 'posting', 'needs_review')
            )
          ORDER BY candidate_job.sequence, candidate_job.position, candidate_job.id
          LIMIT 1
        `).get(ownerMetaUserId, runId, now);
        if (!candidate) {
          database.exec('COMMIT');
          return null;
        }

        const row = database.prepare(`
          UPDATE seeding_jobs
          SET status = 'posting', attempt_count = attempt_count + 1, started_at = ?, updated_at = ?
          WHERE owner_meta_user_id = ? AND run_id = ? AND id = ? AND status = 'pending'
          RETURNING *
        `).get(now, now, ownerMetaUserId, runId, candidate.id);
        database.exec('COMMIT');
        return row ? mapSeedingJob(row) : null;
      } catch (error) {
        database.exec('ROLLBACK');
        throw error;
      }
    },

    finishSeedingJob(input) {
      if (!['created', 'failed', 'needs_review'].includes(input.status)) {
        throw new TypeError('finishSeedingJob requires a terminal seeding status');
      }
      database.exec('BEGIN IMMEDIATE');
      try {
        const row = database.prepare(`
          UPDATE seeding_jobs
          SET status = ?, meta_comment_id = ?, error_json = ?, completed_at = ?, updated_at = ?
          WHERE owner_meta_user_id = ? AND run_id = ? AND id = ? AND status = 'posting'
          RETURNING *
        `).get(
          input.status,
          input.metaCommentId ?? null,
          input.error ? JSON.stringify(input.error) : null,
          input.now,
          input.now,
          input.ownerMetaUserId,
          input.runId,
          input.jobId
        );
        if (row && input.status === 'created') {
          database.prepare(`
            UPDATE seeding_jobs
            SET available_at = MAX(available_at, ?), updated_at = ?
            WHERE owner_meta_user_id = ? AND run_id = ? AND status = 'pending'
          `).run(input.nextAvailableAt, input.now, input.ownerMetaUserId, input.runId);
        }
        database.exec('COMMIT');
        return row ? mapSeedingJob(row) : null;
      } catch (error) {
        database.exec('ROLLBACK');
        throw error;
      }
    },

    deferSeedingJob(input) {
      const row = database.prepare(`
        UPDATE seeding_jobs
        SET status = 'pending', started_at = NULL, completed_at = NULL,
            available_at = ?, updated_at = ?
        WHERE owner_meta_user_id = ? AND run_id = ? AND id = ? AND status = 'posting'
        RETURNING *
      `).get(input.availableAt, input.now, input.ownerMetaUserId, input.runId, input.jobId);
      return row ? mapSeedingJob(row) : null;
    },

    retrySeedingJob(input) {
      const row = database.prepare(`
        UPDATE seeding_jobs
        SET status = 'pending', started_at = NULL, completed_at = NULL, updated_at = ?
        WHERE owner_meta_user_id = ? AND run_id = ? AND id = ?
          AND status IN ('failed', 'needs_review')
        RETURNING *
      `).get(input.now, input.ownerMetaUserId, input.runId, input.jobId);
      return row ? mapSeedingJob(row) : null;
    },

    confirmSeedingJob(input) {
      const row = database.prepare(`
        UPDATE seeding_jobs
        SET status = 'created', meta_comment_id = ?, error_json = ?, completed_at = ?, updated_at = ?
        WHERE owner_meta_user_id = ? AND run_id = ? AND id = ? AND status = 'needs_review'
        RETURNING *
      `).get(
        input.metaCommentId ?? null,
        JSON.stringify({ manualConfirmation: true }),
        input.now,
        input.now,
        input.ownerMetaUserId,
        input.runId,
        input.jobId
      );
      return row ? mapSeedingJob(row) : null;
    },

    cancelSeedingJobs(ownerMetaUserId, runId, now = Date.now()) {
      return database.prepare(`
        UPDATE seeding_jobs SET status = 'cancelled', updated_at = ?
        WHERE owner_meta_user_id = ? AND run_id = ? AND status = 'pending'
      `).run(now, ownerMetaUserId, runId).changes;
    },

    resumeSeedingJobs(ownerMetaUserId, runId, now = Date.now()) {
      return database.prepare(`
        UPDATE seeding_jobs SET status = 'pending', available_at = ?, updated_at = ?
        WHERE owner_meta_user_id = ? AND run_id = ? AND status = 'cancelled'
      `).run(now, now, ownerMetaUserId, runId).changes;
    },

    createRun(run) {
      const id = run.id ?? randomUUID();
      database.prepare(`
        INSERT INTO runs (
          id, owner_meta_user_id, status, ad_account_id, snapshot_json, execution_json, completed_at, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id,
        run.ownerMetaUserId,
        run.status ?? 'creating',
        run.adAccountId ?? null,
        run.snapshot ? JSON.stringify(run.snapshot) : null,
        run.execution ? JSON.stringify(run.execution) : null,
        run.completedAt ?? null,
        run.createdAt ?? Date.now()
      );
      return { id };
    },

    updateRunStatus(runId, status, completedAt = Date.now()) {
      database.prepare('UPDATE runs SET status = ?, completed_at = ? WHERE id = ?').run(status, completedAt, runId);
    },

    claimWorkflowLease(runId, token, now, ttlMs) {
      return database.prepare(`
        UPDATE runs
        SET workflow_token = ?, workflow_lease_expires_at = ?
        WHERE id = ? AND (
          workflow_token IS NULL OR workflow_token = ? OR workflow_lease_expires_at <= ?
        )
      `).run(token, now + ttlMs, runId, token, now).changes === 1;
    },

    renewWorkflowLease(runId, token, now, ttlMs) {
      return database.prepare(`
        UPDATE runs SET workflow_lease_expires_at = ?
        WHERE id = ? AND workflow_token = ? AND workflow_lease_expires_at > ?
      `).run(now + ttlMs, runId, token, now).changes === 1;
    },

    isWorkflowLeaseCurrent(runId, token, now) {
      return Boolean(database.prepare(`
        SELECT 1 FROM runs
        WHERE id = ? AND workflow_token = ? AND workflow_lease_expires_at > ?
      `).get(runId, token, now));
    },

    releaseWorkflowLease(runId, token) {
      return database.prepare(`
        UPDATE runs SET workflow_token = NULL, workflow_lease_expires_at = NULL
        WHERE id = ? AND workflow_token = ?
      `).run(runId, token).changes === 1;
    },

    updateNodeResult(runId, node) {
      database.prepare(`
        INSERT INTO node_results (
          run_id, client_id, parent_client_id, type, status, name, remote_id, creative_id, creative_artifact_key,
          post_id, permalink_url, error_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(run_id, client_id) DO UPDATE SET
          parent_client_id = excluded.parent_client_id,
          type = excluded.type,
          status = excluded.status,
          name = excluded.name,
          remote_id = excluded.remote_id,
          creative_id = excluded.creative_id,
          creative_artifact_key = excluded.creative_artifact_key,
          post_id = excluded.post_id,
          permalink_url = excluded.permalink_url,
          error_json = excluded.error_json
      `).run(
        runId,
        node.clientId,
        node.parentClientId ?? null,
        node.type,
        node.status,
        node.name ?? null,
        node.remoteId ?? null,
        node.creativeId ?? null,
        node.creativeArtifactKey ?? null,
        node.postId ?? null,
        node.permalinkUrl ?? null,
        node.error ? JSON.stringify(node.error) : null
      );
    },

    getRun(runId) {
      const run = database.prepare(`
        SELECT id, owner_meta_user_id, status, ad_account_id, snapshot_json, execution_json,
          workflow_token, workflow_lease_expires_at, created_at, completed_at
        FROM runs WHERE id = ?
      `).get(runId);
      if (!run) return null;
      const nodes = database.prepare(`
        SELECT client_id, parent_client_id, type, status, name, remote_id, creative_id, creative_artifact_key,
          post_id, permalink_url, error_json
        FROM node_results WHERE run_id = ? ORDER BY rowid
      `).all(runId).map(mapNodeResult);
      return mapRunDetail(run, nodes);
    },

    listRuns(ownerMetaUserId, options = {}) {
      const { from = 0, to = Number.MAX_SAFE_INTEGER, limit = 20, offset = 0 } = options;
      const rows = database.prepare(`
        SELECT
          runs.id,
          runs.status,
          runs.ad_account_id,
          runs.snapshot_json,
          runs.created_at,
          runs.completed_at,
          runs.workflow_lease_expires_at,
          COUNT(node_results.client_id) AS total_count,
          SUM(CASE WHEN node_results.status = 'created' THEN 1 ELSE 0 END) AS created_count,
          SUM(CASE WHEN node_results.status = 'failed' THEN 1 ELSE 0 END) AS failed_count,
          SUM(CASE WHEN node_results.status = 'skipped' THEN 1 ELSE 0 END) AS skipped_count,
          SUM(CASE WHEN node_results.type = 'campaign' THEN 1 ELSE 0 END) AS campaign_count,
          SUM(CASE WHEN node_results.type = 'adSet' THEN 1 ELSE 0 END) AS adset_count,
          SUM(CASE WHEN node_results.type = 'ad' THEN 1 ELSE 0 END) AS ad_count
        FROM runs
        LEFT JOIN node_results ON node_results.run_id = runs.id
        WHERE runs.owner_meta_user_id = ? AND runs.created_at >= ? AND runs.created_at < ?
        GROUP BY runs.id
        ORDER BY runs.created_at DESC, runs.id DESC
        LIMIT ? OFFSET ?
      `).all(ownerMetaUserId, from, to, limit + 1, offset);
      const hasMore = rows.length > limit;
      const selectedRows = rows.slice(0, limit);
      const nodesByRun = new Map();
      if (selectedRows.length > 0) {
        const placeholders = selectedRows.map(() => '?').join(', ');
        const nodeRows = database.prepare(`
          SELECT run_id, client_id, parent_client_id, type, status, name, remote_id, creative_id,
            creative_artifact_key, post_id, permalink_url, error_json
          FROM node_results WHERE run_id IN (${placeholders}) ORDER BY rowid
        `).all(...selectedRows.map((row) => row.id));
        for (const nodeRow of nodeRows) {
          const nodes = nodesByRun.get(nodeRow.run_id) ?? [];
          nodes.push(mapNodeResult(nodeRow));
          nodesByRun.set(nodeRow.run_id, nodes);
        }
      }
      return {
        items: selectedRows.map((row) => mapRunSummary(row, nodesByRun.get(row.id) ?? [])),
        nextOffset: hasMore ? offset + limit : null
      };
    },

    close() {
      database.close();
    }
  };
}

export const createDatabase = createSqliteDatabase;

function seedSharedConversationLibrary(database) {
  const seed = createSharedConversationSeed();
  database.exec('BEGIN IMMEDIATE');
  try {
    const migration = database.prepare(`
      INSERT OR IGNORE INTO app_migrations (key, applied_at) VALUES (?, ?)
    `).run(SHARED_CONVERSATION_SEED_MIGRATION, seed.createdAt);
    if (migration.changes > 0) {
      database.prepare(`
        INSERT INTO conversation_templates (
          id, owner_meta_user_id, page_id, name, template_json, is_default, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, 1, ?, ?)
      `).run(
        seed.id,
        seed.ownerMetaUserId,
        seed.pageId,
        seed.name,
        JSON.stringify(seed.template),
        seed.createdAt,
        seed.updatedAt
      );
    }
    database.exec('COMMIT');
  } catch (error) {
    database.exec('ROLLBACK');
    throw error;
  }
}

function migrateSqliteSchema(database) {
  const sessionColumns = database.prepare('PRAGMA table_info(sessions)').all();
  if (!sessionColumns.some((column) => column.name === 'updated_at')) {
    database.exec('ALTER TABLE sessions ADD COLUMN updated_at INTEGER');
    database.exec('UPDATE sessions SET updated_at = created_at WHERE updated_at IS NULL');
  }

  const nodeResultColumns = database.prepare('PRAGMA table_info(node_results)').all();
  for (const [name, type] of [
    ['post_id', 'TEXT'],
    ['name', 'TEXT'],
    ['creative_id', 'TEXT'],
    ['creative_artifact_key', 'TEXT'],
    ['permalink_url', 'TEXT']
  ]) {
    if (!nodeResultColumns.some((column) => column.name === name)) {
      database.exec(`ALTER TABLE node_results ADD COLUMN ${name} ${type}`);
    }
  }

  const runColumns = database.prepare('PRAGMA table_info(runs)').all();
  for (const [name, type] of [
    ['ad_account_id', 'TEXT'],
    ['snapshot_json', 'TEXT'],
    ['execution_json', 'TEXT'],
    ['workflow_token', 'TEXT'],
    ['workflow_lease_expires_at', 'INTEGER'],
    ['completed_at', 'INTEGER']
  ]) {
    if (!runColumns.some((column) => column.name === name)) {
      database.exec(`ALTER TABLE runs ADD COLUMN ${name} ${type}`);
    }
  }
  database.exec('CREATE INDEX IF NOT EXISTS runs_owner_created_idx ON runs(owner_meta_user_id, created_at DESC)');

  migrateSqliteAudienceTemplateNames(database);

  const mediaColumns = database.prepare('PRAGMA table_info(media)').all();
  for (const [name, type] of [
    ['blob_url', 'TEXT'],
    ['blob_download_url', 'TEXT'],
    ['blob_pathname', 'TEXT'],
    ['size_bytes', 'INTEGER']
  ]) {
    if (!mediaColumns.some((column) => column.name === name)) {
      database.exec(`ALTER TABLE media ADD COLUMN ${name} ${type}`);
    }
  }

  const telegramUploadJobColumns = database.prepare('PRAGMA table_info(telegram_upload_jobs)').all();
  for (const [name, type] of [
    ['uploaded_bytes', 'INTEGER NOT NULL DEFAULT 0'],
    ['total_bytes', 'INTEGER NOT NULL DEFAULT 0']
  ]) {
    if (!telegramUploadJobColumns.some((column) => column.name === name)) {
      database.exec(`ALTER TABLE telegram_upload_jobs ADD COLUMN ${name} ${type}`);
    }
  }

  if (mediaColumns.find((column) => column.name === 'content')?.notnull) {
    database.exec('BEGIN IMMEDIATE');
    try {
      database.exec(`
        ALTER TABLE media RENAME TO media_legacy;
        CREATE TABLE media (
          id TEXT PRIMARY KEY,
          owner_meta_user_id TEXT NOT NULL,
          name TEXT NOT NULL,
          mime_type TEXT NOT NULL,
          content BLOB,
          blob_url TEXT,
          blob_download_url TEXT,
          blob_pathname TEXT,
          size_bytes INTEGER NOT NULL,
          created_at INTEGER NOT NULL
        );
        INSERT INTO media (
          id, owner_meta_user_id, name, mime_type, content, blob_url, blob_download_url, blob_pathname, size_bytes, created_at
        ) SELECT
          id, owner_meta_user_id, name, mime_type, content, blob_url, blob_download_url, blob_pathname,
          COALESCE(size_bytes, length(content)), created_at
        FROM media_legacy;
        DROP TABLE media_legacy;
      `);
      database.exec('COMMIT');
    } catch (error) {
      database.exec('ROLLBACK');
      throw error;
    }
  }

  database.exec(`
    CREATE TABLE IF NOT EXISTS seeding_templates (
      id TEXT PRIMARY KEY,
      owner_meta_user_id TEXT NOT NULL,
      name TEXT NOT NULL,
      items_json TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
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
      error_json TEXT,
      attempt_count INTEGER NOT NULL DEFAULT 0,
      available_at INTEGER NOT NULL,
      started_at INTEGER,
      completed_at INTEGER,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      UNIQUE (run_id, campaign_client_id, post_id, item_id)
    );
    CREATE INDEX IF NOT EXISTS seeding_templates_owner_updated_idx
      ON seeding_templates (owner_meta_user_id, updated_at DESC);
    CREATE INDEX IF NOT EXISTS seeding_jobs_owner_run_status_idx
      ON seeding_jobs (owner_meta_user_id, run_id, status);
  `);
}

function migrateSqliteAudienceTemplateNames(database) {
  const columns = database.prepare('PRAGMA table_info(audience_templates)').all();
  if (!columns.some((column) => column.name === 'owner_meta_user_id')) {
    database.exec('ALTER TABLE audience_templates ADD COLUMN owner_meta_user_id TEXT');
  }
  if (!columns.some((column) => column.name === 'name_key')) {
    database.exec('ALTER TABLE audience_templates ADD COLUMN name_key TEXT');
  }

  database.exec('DROP INDEX IF EXISTS audience_templates_name_nocase');
  database.exec('DROP INDEX IF EXISTS audience_templates_name_key_idx');
  const rows = database.prepare(`
    SELECT id, name FROM audience_templates ORDER BY created_at, id
  `).all();
  const usedKeys = new Set();
  const update = database.prepare('UPDATE audience_templates SET name = ?, name_key = ? WHERE id = ?');

  database.exec('BEGIN IMMEDIATE');
  try {
    for (const row of rows) {
      const unique = uniqueAudienceTemplateName(row.name, row.id, usedKeys);
      update.run(unique.name, unique.key, row.id);
    }
    database.exec('COMMIT');
  } catch (error) {
    database.exec('ROLLBACK');
    throw error;
  }

  database.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS audience_templates_owner_name_key_idx
    ON audience_templates (owner_meta_user_id, name_key)
  `);
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

function mapSession(row) {
  const session = { id: row.id, metaUserId: row.meta_user_id };
  if ('meta_user_name' in row) session.metaUserName = row.meta_user_name;
  if ('created_at' in row) session.createdAt = row.created_at;
  if ('updated_at' in row) session.updatedAt = row.updated_at;
  return session;
}

function mapConnection(row) {
  return {
    metaUserId: row.meta_user_id,
    metaUserName: row.meta_user_name,
    accessTokenCiphertext: row.access_token_ciphertext
  };
}

function mapUploadAgentDevice(row) {
  return {
    id: row.id,
    ownerMetaUserId: row.owner_meta_user_id,
    tokenHash: row.token_hash,
    device: typeof row.device_json === 'string' ? JSON.parse(row.device_json) : row.device_json,
    revokedAt: row.revoked_at === null ? null : Number(row.revoked_at),
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at)
  };
}

function mapTelegramUploadJob(row) {
  return {
    id: row.id,
    ownerMetaUserId: row.owner_meta_user_id,
    mediaId: row.media_id,
    networkPath: row.network_path,
    intentCode: row.intent_code,
    status: row.status,
    leaseToken: row.lease_token,
    leaseExpiresAt: row.lease_expires_at === null ? null : Number(row.lease_expires_at),
    errorMessage: row.error_message,
    uploadedBytes: Number(row.uploaded_bytes ?? 0),
    totalBytes: Number(row.total_bytes ?? 0),
    expiresAt: Number(row.expires_at),
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at)
  };
}

function mapMedia(row) {
  return {
    id: row.id,
    ownerMetaUserId: row.owner_meta_user_id,
    name: row.name,
    mimeType: row.mime_type,
    content: row.content,
    blobUrl: row.blob_url,
    blobDownloadUrl: row.blob_download_url,
    blobPathname: row.blob_pathname,
    sizeBytes: row.size_bytes,
    createdAt: row.created_at
  };
}

function mapConversationTemplate(row) {
  return {
    id: row.id,
    ownerMetaUserId: row.owner_meta_user_id,
    pageId: row.page_id,
    name: row.name,
    template: JSON.parse(row.template_json),
    isDefault: Boolean(row.is_default),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function getAudienceTemplate(database, ownerMetaUserId, id) {
  const row = database.prepare(`
    SELECT id, name, content_json, created_at, updated_at
    FROM audience_templates WHERE owner_meta_user_id = ? AND id = ?
  `).get(ownerMetaUserId, id);
  return row ? mapAudienceTemplate(row) : null;
}

function mapAudienceTemplate(row) {
  return {
    id: row.id,
    name: row.name,
    content: JSON.parse(row.content_json),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function assertAudienceTemplateId(id) {
  if (!isAudienceTemplateId(id)) {
    throw new TypeError(`Audience template ID must start with ${AUDIENCE_TEMPLATE_ID_PREFIX}`);
  }
}

function isAudienceTemplateId(id) {
  return typeof id === 'string' && id.startsWith(AUDIENCE_TEMPLATE_ID_PREFIX) && id.length > AUDIENCE_TEMPLATE_ID_PREFIX.length;
}

function mapSeedingTemplate(row) {
  return {
    id: row.id,
    ownerMetaUserId: row.owner_meta_user_id,
    name: row.name,
    items: JSON.parse(row.items_json),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function mapCampaignPreset(row) {
  return {
    id: row.id,
    ownerMetaUserId: row.owner_meta_user_id,
    name: row.name,
    content: JSON.parse(row.content_json),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function mapSeedingJob(row) {
  return {
    id: row.id,
    runId: row.run_id,
    ownerMetaUserId: row.owner_meta_user_id,
    campaignClientId: row.campaign_client_id,
    pageId: row.page_id,
    postId: row.post_id,
    itemId: row.item_id,
    position: row.position,
    sequence: row.sequence,
    message: row.message,
    imageMediaId: row.image_media_id,
    status: row.status,
    metaCommentId: row.meta_comment_id,
    error: row.error_json ? JSON.parse(row.error_json) : null,
    attemptCount: row.attempt_count,
    availableAt: row.available_at,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function copySeedingItems(items) {
  return items.map((item) => ({
    id: item.id,
    message: item.message,
    imageMediaId: item.imageMediaId ?? null
  }));
}

function seedingPostConflictError(runId, postId) {
  const error = new Error(`Post ${postId} already has a different Campaign selection in run ${runId}`);
  error.code = 'SEEDING_POST_CONFLICT';
  return error;
}

function mapNodeResult(row) {
  const node = {
    clientId: row.client_id,
    parentClientId: row.parent_client_id,
    type: row.type,
    name: row.name,
    status: row.status,
    remoteId: row.remote_id,
    postId: row.post_id,
    permalinkUrl: row.permalink_url,
    error: row.error_json ? JSON.parse(row.error_json) : null
  };
  if (row.creative_id) node.creativeId = row.creative_id;
  if (row.creative_artifact_key) node.creativeArtifactKey = row.creative_artifact_key;
  return node;
}

function mapRunDetail(row, nodes) {
  const snapshot = row.snapshot_json ? JSON.parse(row.snapshot_json) : null;
  const run = {
    id: row.id,
    ownerMetaUserId: row.owner_meta_user_id,
    status: row.status,
    adAccountId: row.ad_account_id,
    snapshot,
    createdAt: row.created_at,
    completedAt: row.completed_at,
    legacy: !snapshot,
    nodes
  };
  if (row.workflow_token) {
    run.workflowToken = row.workflow_token;
    run.workflowLeaseExpiresAt = row.workflow_lease_expires_at;
  }
  if (row.execution_json) run.execution = JSON.parse(row.execution_json);
  return run;
}

function mapRunSummary(row, nodes = []) {
  const snapshot = row.snapshot_json ? JSON.parse(row.snapshot_json) : null;
  return {
    id: row.id,
    status: row.status,
    adAccountId: row.ad_account_id,
    createdAt: row.created_at,
    completedAt: row.completed_at,
    workflowLeaseExpiresAt: row.workflow_lease_expires_at ?? null,
    legacy: !row.snapshot_json,
    campaigns: buildCampaignSummaries(snapshot, nodes),
    counts: {
      total: Number(row.total_count),
      created: Number(row.created_count),
      failed: Number(row.failed_count),
      skipped: Number(row.skipped_count),
      campaigns: Number(row.campaign_count),
      adSets: Number(row.adset_count),
      ads: Number(row.ad_count)
    }
  };
}

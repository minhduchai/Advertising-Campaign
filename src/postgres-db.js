import { randomUUID } from 'node:crypto';
import { createSqlTransport } from './postgres-transport.js';
import { buildCampaignSummaries } from './run-history-summary.js';
import {
  AUDIENCE_TEMPLATE_ID_PREFIX,
  createAudienceTemplateId,
  normalizeAudienceTemplateName,
  validateAudienceTemplate
} from './audience-template.js';
import { SHARED_CONVERSATION_OWNER_ID } from './shared-conversation-library.js';

export function createPostgresDatabase(sql) {
  async function getTemplate(ownerMetaUserId, id) {
    return mapOptionalConversationTemplate((await sql`
      SELECT id, owner_meta_user_id, page_id, name, template_json, is_default, created_at, updated_at
      FROM conversation_templates
      WHERE owner_meta_user_id = ${ownerMetaUserId} AND id = ${id}
    `)[0]);
  }

  function normalizeTemplateArguments(ownerOrTemplate, id, input) {
    if (typeof ownerOrTemplate === 'object') {
      return { ownerMetaUserId: ownerOrTemplate.ownerMetaUserId, id: ownerOrTemplate.id, input: ownerOrTemplate };
    }
    return { ownerMetaUserId: ownerOrTemplate, id, input };
  }

  return {
    async createSession(options = {}) {
      const id = options.id ?? randomUUID();
      const now = options.now ?? Date.now();
      return mapSession((await sql`
        INSERT INTO sessions (id, created_at, updated_at)
        VALUES (${id}, ${now}, ${now})
        RETURNING id, meta_user_id, meta_user_name, created_at, updated_at
      `)[0]);
    },

    async getSession(id) {
      return mapOptionalSession((await sql`
        SELECT id, meta_user_id, meta_user_name, created_at, updated_at
        FROM sessions WHERE id = ${id}
      `)[0]);
    },

    async attachMetaUser(sessionId, metaUser) {
      const user = typeof metaUser === 'string' ? { id: metaUser, name: null } : metaUser;
      return mapSession((await sql`
        UPDATE sessions
        SET meta_user_id = ${user.id}, meta_user_name = COALESCE(${user.name ?? null}, meta_user_name), updated_at = ${Date.now()}
        WHERE id = ${sessionId}
        RETURNING id, meta_user_id, meta_user_name, created_at, updated_at
      `)[0]);
    },

    async disconnectMetaUser(sessionId, metaUserId) {
      const queries = [
        sql`
          UPDATE sessions
          SET meta_user_id = NULL, meta_user_name = NULL, updated_at = ${Date.now()}
          WHERE id = ${sessionId} AND (meta_user_id = ${metaUserId} OR meta_user_id IS NULL)
          RETURNING id, meta_user_id, meta_user_name, created_at, updated_at
        `
      ];
      if (metaUserId) queries.push(sql`DELETE FROM connections WHERE meta_user_id = ${metaUserId}`);
      const [sessions] = await sql.transaction(queries);
      return mapOptionalSession(sessions[0]);
    },

    async claimWorkflowNonce(nonceHash, expiresAt, now = Date.now()) {
      const [, rows] = await sql.transaction([
        sql`DELETE FROM workflow_request_nonces WHERE expires_at < ${now}`,
        sql`INSERT INTO workflow_request_nonces (nonce_hash, expires_at) VALUES (${nonceHash}, ${expiresAt})
          ON CONFLICT (nonce_hash) DO NOTHING RETURNING nonce_hash`
      ]);
      return rows.length === 1;
    },

    async createOAuthState(sessionOrRecord, state) {
      const record = typeof sessionOrRecord === 'object'
        ? sessionOrRecord
        : { sessionId: sessionOrRecord, state, expiresAt: Date.now() + 10 * 60 * 1000 };
      const expiresAt = record.expiresAt ?? Date.now() + 10 * 60 * 1000;
      return mapOAuthState((await sql`
        INSERT INTO oauth_states (state, session_id, expires_at)
        VALUES (${record.state}, ${record.sessionId}, ${expiresAt})
        RETURNING state, session_id, expires_at
      `)[0]);
    },

    async consumeOAuthState(state, now = Date.now()) {
      const row = (await sql`
        DELETE FROM oauth_states
        WHERE state = ${state} AND expires_at > ${now}
        RETURNING session_id
      `)[0];
      return row ? { sessionId: row.session_id } : null;
    },

    async createUploadAgentPairingCode(input) {
      const createdAt = input.createdAt ?? Date.now();
      const row = (await sql`
        INSERT INTO upload_agent_pairing_codes (code_hash, owner_meta_user_id, expires_at, created_at)
        VALUES (${input.codeHash}, ${input.ownerMetaUserId}, ${input.expiresAt}, ${createdAt})
        RETURNING code_hash, owner_meta_user_id, expires_at, created_at
      `)[0];
      return {
        codeHash: row.code_hash,
        ownerMetaUserId: row.owner_meta_user_id,
        expiresAt: Number(row.expires_at),
        createdAt: Number(row.created_at)
      };
    },

    async consumeUploadAgentPairingCode(codeHash, now = Date.now()) {
      const row = (await sql`
        DELETE FROM upload_agent_pairing_codes
        WHERE code_hash = ${codeHash} AND expires_at > ${now}
        RETURNING owner_meta_user_id
      `)[0];
      return row ? { ownerMetaUserId: row.owner_meta_user_id } : null;
    },

    async saveUploadAgentDevice(input) {
      const createdAt = input.createdAt ?? Date.now();
      return mapUploadAgentDevice((await sql`
        INSERT INTO upload_agent_devices (
          id, owner_meta_user_id, token_hash, device_json, revoked_at, created_at, updated_at
        ) VALUES (
          ${input.id}, ${input.ownerMetaUserId}, ${input.tokenHash}, ${JSON.stringify(input.device)},
          NULL, ${createdAt}, ${createdAt}
        )
        RETURNING id, owner_meta_user_id, token_hash, device_json, revoked_at, created_at, updated_at
      `)[0]);
    },

    async getUploadAgentDevice(ownerMetaUserId, id) {
      const row = (await sql`
        SELECT id, owner_meta_user_id, token_hash, device_json, revoked_at, created_at, updated_at
        FROM upload_agent_devices
        WHERE owner_meta_user_id = ${ownerMetaUserId} AND id = ${id}
      `)[0];
      return row ? mapUploadAgentDevice(row) : null;
    },

    async revokeUploadAgentDevice(ownerMetaUserId, id, now = Date.now()) {
      const row = (await sql`
        UPDATE upload_agent_devices
        SET revoked_at = ${now}, updated_at = ${now}
        WHERE owner_meta_user_id = ${ownerMetaUserId} AND id = ${id} AND revoked_at IS NULL
        RETURNING id
      `)[0];
      return Boolean(row);
    },

    async createTelegramUploadJob(input) {
      const now = input.createdAt ?? Date.now();
      return mapTelegramUploadJob((await sql`
        INSERT INTO telegram_upload_jobs (
          id, owner_meta_user_id, media_id, network_path, intent_code, status,
          lease_token, lease_expires_at, error_message, uploaded_bytes, total_bytes,
          expires_at, created_at, updated_at
        ) VALUES (
          ${input.id}, ${input.ownerMetaUserId}, ${input.mediaId}, ${input.networkPath},
          ${input.intentCode}, 'queued', NULL, NULL, NULL, 0, 0, ${input.expiresAt}, ${now}, ${now}
        )
        RETURNING *
      `)[0]);
    },

    async getTelegramUploadJobByMedia(ownerMetaUserId, mediaId) {
      const row = (await sql`
        SELECT * FROM telegram_upload_jobs
        WHERE owner_meta_user_id = ${ownerMetaUserId} AND media_id = ${mediaId}
      `)[0];
      return row ? mapTelegramUploadJob(row) : null;
    },

    async claimNextTelegramUploadJob(input) {
      const now = input.now ?? Date.now();
      const row = (await sql`
        WITH candidate AS (
          SELECT id FROM telegram_upload_jobs
          WHERE expires_at > ${now}
            AND (status = 'queued' OR (status = 'uploading' AND lease_expires_at <= ${now}))
          ORDER BY created_at, id
          FOR UPDATE SKIP LOCKED
          LIMIT 1
        )
        UPDATE telegram_upload_jobs AS job
        SET status = 'uploading', lease_token = ${input.leaseToken},
            lease_expires_at = ${input.leaseExpiresAt}, error_message = NULL,
            uploaded_bytes = 0, total_bytes = 0, updated_at = ${now}
        FROM candidate
        WHERE job.id = candidate.id
        RETURNING job.*
      `)[0];
      return row ? mapTelegramUploadJob(row) : null;
    },

    async updateTelegramUploadJobProgress(input) {
      const now = input.now ?? Date.now();
      const row = (await sql`
        UPDATE telegram_upload_jobs
        SET uploaded_bytes = ${input.uploadedBytes}, total_bytes = ${input.totalBytes},
            lease_expires_at = ${input.leaseExpiresAt}, updated_at = ${now}
        WHERE id = ${input.id} AND status = 'uploading' AND lease_token = ${input.leaseToken}
        RETURNING *
      `)[0];
      return row ? mapTelegramUploadJob(row) : null;
    },

    async finishTelegramUploadJob(input) {
      const now = input.now ?? Date.now();
      const status = input.status === 'completed' ? 'completed' : 'failed';
      const row = (await sql`
        UPDATE telegram_upload_jobs
        SET status = ${status}, error_message = ${input.errorMessage ?? null},
            uploaded_bytes = CASE WHEN ${status} = 'completed' AND total_bytes > 0 THEN total_bytes ELSE uploaded_bytes END,
            lease_token = NULL, lease_expires_at = NULL, updated_at = ${now}
        WHERE id = ${input.id} AND status = 'uploading' AND lease_token = ${input.leaseToken}
        RETURNING *
      `)[0];
      return row ? mapTelegramUploadJob(row) : null;
    },

    async upsertConnection(metaUserIdOrConnection, connection) {
      const record = connection
        ? { ...connection, metaUserId: metaUserIdOrConnection }
        : metaUserIdOrConnection;
      return mapConnection((await sql`
        INSERT INTO connections (meta_user_id, meta_user_name, access_token_ciphertext, updated_at)
        VALUES (${record.metaUserId}, ${record.metaUserName ?? ''}, ${record.accessTokenCiphertext}, ${record.now ?? Date.now()})
        ON CONFLICT (meta_user_id) DO UPDATE SET
          meta_user_name = EXCLUDED.meta_user_name,
          access_token_ciphertext = EXCLUDED.access_token_ciphertext,
          updated_at = EXCLUDED.updated_at
        RETURNING meta_user_id, meta_user_name, access_token_ciphertext
      `)[0]);
    },

    async getConnection(metaUserId) {
      return mapOptionalConnection((await sql`
        SELECT meta_user_id, meta_user_name, access_token_ciphertext
        FROM connections WHERE meta_user_id = ${metaUserId}
      `)[0]);
    },

    async saveMedia(media) {
      const id = media.id ?? randomUUID();
      const sizeBytes = media.sizeBytes ?? media.content?.byteLength ?? 0;
      return mapMedia((await sql`
        INSERT INTO media (
          id, owner_meta_user_id, name, mime_type, content, blob_url, blob_download_url, blob_pathname, size_bytes, created_at
        ) VALUES (
          ${id}, ${media.ownerMetaUserId}, ${media.name}, ${media.mimeType}, ${media.content ?? null},
          ${media.blobUrl ?? null}, ${media.blobDownloadUrl ?? null}, ${media.blobPathname ?? null},
          ${sizeBytes}, ${media.createdAt ?? Date.now()}
        )
        RETURNING id, owner_meta_user_id, name, mime_type, content, blob_url, blob_download_url, blob_pathname, size_bytes, created_at
      `)[0]);
    },

    async updateMediaLocation(ownerMetaUserId, id, expectedUrl, blobUrl, blobPathname) {
      return mapOptionalMedia((await sql`
        UPDATE media SET blob_url = ${blobUrl}, blob_pathname = ${blobPathname}, blob_download_url = NULL
        WHERE owner_meta_user_id = ${ownerMetaUserId} AND id = ${id} AND blob_url = ${expectedUrl}
        RETURNING *
      `)[0]);
    },

    async getMedia(ownerMetaUserId, id) {
      if (!ownerMetaUserId || !id) {
        throw new TypeError('getMedia requires ownerMetaUserId and id');
      }
      const row = (await sql`
        SELECT id, owner_meta_user_id, name, mime_type, content, blob_url, blob_download_url, blob_pathname, size_bytes, created_at
        FROM media WHERE owner_meta_user_id = ${ownerMetaUserId} AND id = ${id}
      `)[0];
      return mapOptionalMedia(row);
    },

    async getMetaVideoId(ownerMetaUserId, mediaId, adAccountId) {
      const row = (await sql`
        SELECT meta_video_id FROM meta_video_assets
        WHERE owner_meta_user_id = ${ownerMetaUserId}
          AND media_id = ${mediaId}
          AND ad_account_id = ${adAccountId}
      `)[0];
      return row?.meta_video_id ?? null;
    },

    async saveMetaVideoId(ownerMetaUserId, mediaId, adAccountId, metaVideoId, now = Date.now()) {
      await sql`
        INSERT INTO meta_video_assets (
          owner_meta_user_id, media_id, ad_account_id, meta_video_id, created_at, updated_at
        ) VALUES (
          ${ownerMetaUserId}, ${mediaId}, ${adAccountId}, ${metaVideoId}, ${now}, ${now}
        )
        ON CONFLICT (owner_meta_user_id, media_id, ad_account_id) DO UPDATE SET
          meta_video_id = EXCLUDED.meta_video_id,
          updated_at = EXCLUDED.updated_at
      `;
      return metaVideoId;
    },

    async deleteMetaVideoId(ownerMetaUserId, mediaId, adAccountId, metaVideoId) {
      const rows = await sql`
        DELETE FROM meta_video_assets
        WHERE owner_meta_user_id = ${ownerMetaUserId}
          AND media_id = ${mediaId}
          AND ad_account_id = ${adAccountId}
          AND meta_video_id = ${metaVideoId}
        RETURNING meta_video_id
      `;
      return rows.length > 0;
    },

    async registeredR2Keys(bucketName, keys) {
      if (keys.length === 0) return [];
      const urls = keys.map((key) => `r2://${bucketName}/${key}`);
      const rows = await sql`SELECT blob_pathname FROM media WHERE blob_url = ANY(${urls}::text[])`;
      return rows.map((row) => row.blob_pathname);
    },

    async deleteMedia(ownerMetaUserId, id, blobUrl) {
      if (!ownerMetaUserId || !id || !blobUrl) throw new TypeError('deleteMedia requires owner, id and blobUrl');
      const rows = await sql`
        DELETE FROM media WHERE owner_meta_user_id = ${ownerMetaUserId} AND id = ${id} AND blob_url = ${blobUrl}
        RETURNING id
      `;
      return rows.length > 0;
    },

    async listAudienceTemplates(ownerMetaUserId) {
      const rows = await sql`
        SELECT id, name, content_json, created_at, updated_at
        FROM audience_templates
        WHERE owner_meta_user_id = ${ownerMetaUserId}
        ORDER BY updated_at DESC, LOWER(name), id
      `;
      return rows.map(mapAudienceTemplate);
    },

    async createAudienceTemplate(ownerMetaUserId, input) {
      const template = validateAudienceTemplate(input);
      const id = input.id ?? createAudienceTemplateId();
      assertAudienceTemplateId(id);
      const now = input.now ?? Date.now();
      return mapAudienceTemplate((await sql`
        INSERT INTO audience_templates (id, owner_meta_user_id, name, name_key, content_json, created_at, updated_at)
        VALUES (
          ${id}, ${ownerMetaUserId}, ${template.name}, ${normalizeAudienceTemplateName(template.name)},
          ${JSON.stringify(template.content)}, ${now}, ${now}
        )
        RETURNING id, name, content_json, created_at, updated_at
      `)[0]);
    },

    async updateAudienceTemplate(ownerMetaUserId, id, input) {
      if (!isAudienceTemplateId(id)) return null;
      const template = validateAudienceTemplate(input);
      return mapOptionalAudienceTemplate((await sql`
        UPDATE audience_templates
        SET name = ${template.name}, name_key = ${normalizeAudienceTemplateName(template.name)},
            content_json = ${JSON.stringify(template.content)}, updated_at = ${input.now ?? Date.now()}
        WHERE id = ${id} AND owner_meta_user_id = ${ownerMetaUserId}
        RETURNING id, name, content_json, created_at, updated_at
      `)[0]);
    },

    async duplicateAudienceTemplate(ownerMetaUserId, id, name) {
      if (!isAudienceTemplateId(id)) return null;
      const duplicate = validateAudienceTemplate({ name, content: {} });
      const nameKey = normalizeAudienceTemplateName(duplicate.name);
      const newId = createAudienceTemplateId();
      const now = Date.now();
      return mapOptionalAudienceTemplate((await sql`
        WITH source AS (
          SELECT content_json FROM audience_templates WHERE id = ${id} AND owner_meta_user_id = ${ownerMetaUserId}
        )
        INSERT INTO audience_templates (id, owner_meta_user_id, name, name_key, content_json, created_at, updated_at)
        SELECT ${newId}, ${ownerMetaUserId}, ${duplicate.name}, ${nameKey}, source.content_json, ${now}, ${now}
        FROM source
        RETURNING id, name, content_json, created_at, updated_at
      `)[0]);
    },

    async deleteAudienceTemplate(ownerMetaUserId, id) {
      if (!isAudienceTemplateId(id)) return false;
      const rows = await sql`
        DELETE FROM audience_templates WHERE id = ${id} AND owner_meta_user_id = ${ownerMetaUserId}
        RETURNING id
      `;
      return rows.length > 0;
    },

    async claimLegacyTemplateLibraries(ownerMetaUserId) {
      await sql.transaction([
        sql`UPDATE audience_templates SET owner_meta_user_id = ${ownerMetaUserId} WHERE owner_meta_user_id IS NULL`,
        sql`UPDATE conversation_templates SET owner_meta_user_id = ${ownerMetaUserId} WHERE owner_meta_user_id = ${SHARED_CONVERSATION_OWNER_ID}`
      ]);
    },

    async listConversationTemplates(ownerMetaUserId, pageId) {
      const rows = pageId === undefined
        ? await sql`
            SELECT id, owner_meta_user_id, page_id, name, template_json, is_default, created_at, updated_at
            FROM conversation_templates WHERE owner_meta_user_id = ${ownerMetaUserId}
            ORDER BY is_default DESC, updated_at DESC, name
          `
        : await sql`
            SELECT id, owner_meta_user_id, page_id, name, template_json, is_default, created_at, updated_at
            FROM conversation_templates WHERE owner_meta_user_id = ${ownerMetaUserId} AND page_id = ${pageId}
            ORDER BY is_default DESC, updated_at DESC, name
          `;
      return rows.map(mapConversationTemplate);
    },

    async getConversationTemplate(ownerMetaUserId, id) {
      return getTemplate(ownerMetaUserId, id);
    },

    async createConversationTemplate(ownerOrTemplate, input) {
      const template = input ? { ...input, ownerMetaUserId: ownerOrTemplate } : ownerOrTemplate;
      const id = template.id ?? randomUUID();
      const now = template.now ?? Date.now();
      return mapConversationTemplate((await sql`
        INSERT INTO conversation_templates (
          id, owner_meta_user_id, page_id, name, template_json, is_default, created_at, updated_at
        ) VALUES (
          ${id}, ${template.ownerMetaUserId}, ${template.pageId}, ${template.name}, ${JSON.stringify(template.template)},
          FALSE, ${now}, ${now}
        )
        RETURNING id, owner_meta_user_id, page_id, name, template_json, is_default, created_at, updated_at
      `)[0]);
    },

    async updateConversationTemplate(ownerOrTemplate, id, input) {
      const args = normalizeTemplateArguments(ownerOrTemplate, id, input);
      return mapOptionalConversationTemplate((await sql`
        UPDATE conversation_templates
        SET name = ${args.input.name}, template_json = ${JSON.stringify(args.input.template)}, updated_at = ${Date.now()}
        WHERE owner_meta_user_id = ${args.ownerMetaUserId} AND id = ${args.id}
        RETURNING id, owner_meta_user_id, page_id, name, template_json, is_default, created_at, updated_at
      `)[0]);
    },

    async duplicateConversationTemplate(ownerOrTemplate, id, input) {
      const args = normalizeTemplateArguments(ownerOrTemplate, id, input);
      const source = await getTemplate(args.ownerMetaUserId, args.id);
      if (!source) return null;
      return this.createConversationTemplate(args.ownerMetaUserId, {
        pageId: source.pageId,
        name: args.input.name,
        template: { ...source.template, sourceTemplateId: null, templateName: args.input.name }
      });
    },

    async setDefaultConversationTemplate(ownerOrTemplate, id, input) {
      const args = normalizeTemplateArguments(ownerOrTemplate, id, input);
      const now = args.input?.now ?? Date.now();
      const results = await sql.transaction([
        sql`
          WITH target AS (
            SELECT id, owner_meta_user_id, page_id
            FROM conversation_templates
            WHERE owner_meta_user_id = ${args.ownerMetaUserId}
              AND id = ${args.id}
              AND (${args.input?.pageId ?? null} IS NULL OR page_id = ${args.input?.pageId ?? null})
            FOR UPDATE
          )
          UPDATE conversation_templates AS existing
          SET is_default = FALSE, updated_at = ${now}
          FROM target
          WHERE existing.owner_meta_user_id = target.owner_meta_user_id
            AND existing.page_id = target.page_id
            AND existing.id <> target.id
            AND existing.is_default = TRUE
        `,
        sql`
          UPDATE conversation_templates AS selected
          SET is_default = TRUE, updated_at = ${now}
          WHERE selected.owner_meta_user_id = ${args.ownerMetaUserId}
            AND selected.id = ${args.id}
            AND (${args.input?.pageId ?? null} IS NULL OR selected.page_id = ${args.input?.pageId ?? null})
          RETURNING id, owner_meta_user_id, page_id, name, template_json, is_default, created_at, updated_at
        `
      ]);
      return mapOptionalConversationTemplate(results[1][0]);
    },

    async deleteConversationTemplate(ownerOrTemplate, id) {
      const args = normalizeTemplateArguments(ownerOrTemplate, id);
      const rows = await sql`
        WITH deleted AS (
          DELETE FROM conversation_templates
          WHERE owner_meta_user_id = ${args.ownerMetaUserId} AND id = ${args.id}
          RETURNING id, owner_meta_user_id, page_id, is_default
        ), candidate AS (
          SELECT conversation_templates.id
          FROM conversation_templates
          JOIN deleted
            ON conversation_templates.owner_meta_user_id = deleted.owner_meta_user_id
           AND conversation_templates.page_id = deleted.page_id
          WHERE deleted.is_default = TRUE
            AND conversation_templates.id <> deleted.id
          ORDER BY updated_at DESC, created_at DESC, id DESC
          LIMIT 1
        ), promoted AS (
          UPDATE conversation_templates
          SET is_default = TRUE, updated_at = ${Date.now()}
          FROM candidate
          WHERE conversation_templates.id = candidate.id
          RETURNING conversation_templates.id
        )
        SELECT ${args.id} AS id FROM deleted
      `;
      return rows.length > 0;
    },

    async importConversationTemplate(ownerMetaUserId, input) {
      const id = input.id ?? randomUUID();
      const now = input.updatedAt ?? Date.now();
      const row = (await sql`
        INSERT INTO conversation_templates (
          id, owner_meta_user_id, page_id, name, template_json, is_default, created_at, updated_at
        ) VALUES (
          ${id}, ${ownerMetaUserId}, ${input.pageId}, ${input.name}, ${JSON.stringify(input.template)},
          ${Boolean(input.isDefault)}, ${input.createdAt ?? now}, ${now}
        )
        ON CONFLICT (id) DO UPDATE SET
          page_id = EXCLUDED.page_id,
          name = EXCLUDED.name,
          template_json = EXCLUDED.template_json,
          is_default = EXCLUDED.is_default,
          created_at = EXCLUDED.created_at,
          updated_at = EXCLUDED.updated_at
        WHERE conversation_templates.owner_meta_user_id = EXCLUDED.owner_meta_user_id
        RETURNING id, owner_meta_user_id, page_id, name, template_json, is_default, created_at, updated_at
      `)[0];
      if (!row) {
        throw new Error('Conversation template ID has an owner conflict.');
      }
      return mapConversationTemplate(row);
    },

    async importConversationTemplates(ownerMetaUserId, templates) {
      const pageIds = new Set(templates.map((template) => template.pageId));
      const defaultTemplates = templates.filter((template) => template.isDefault);
      if (defaultTemplates.length !== pageIds.size
        || new Set(defaultTemplates.map((template) => template.pageId)).size !== pageIds.size) {
        throw new Error('Conversation template import requires exactly one default template per Page.');
      }
      const queries = [
        sql`
          WITH conflicts AS (
            SELECT 1 FROM conversation_templates
            WHERE id = ANY(${templates.map((template) => template.id)}::text[])
              AND owner_meta_user_id <> ${ownerMetaUserId}
          )
          SELECT 1 / (1 - LEAST((SELECT COUNT(*) FROM conflicts), 1)) AS import_guard
        `,
        ...templates.map((template) => sql`
          INSERT INTO conversation_templates (
            id, owner_meta_user_id, page_id, name, template_json, is_default, created_at, updated_at
          ) VALUES (
            ${template.id}, ${ownerMetaUserId}, ${template.pageId}, ${template.name}, ${JSON.stringify(template.template)},
            FALSE, ${template.createdAt}, ${template.updatedAt}
          )
          ON CONFLICT (id) DO UPDATE SET
            page_id = EXCLUDED.page_id,
            name = EXCLUDED.name,
            template_json = EXCLUDED.template_json,
            is_default = EXCLUDED.is_default,
            created_at = EXCLUDED.created_at,
            updated_at = EXCLUDED.updated_at
          WHERE conversation_templates.owner_meta_user_id = EXCLUDED.owner_meta_user_id
          RETURNING id
        `),
        ...defaultTemplates.map((defaultTemplate) => sql`
          WITH target AS (
            SELECT id, owner_meta_user_id, page_id
            FROM conversation_templates
            WHERE owner_meta_user_id = ${ownerMetaUserId}
              AND id = ${defaultTemplate.id}
              AND page_id = ${defaultTemplate.pageId}
            FOR UPDATE
          ), cleared AS (
            UPDATE conversation_templates AS existing
            SET is_default = FALSE, updated_at = ${defaultTemplate.updatedAt}
            FROM target
            WHERE existing.owner_meta_user_id = target.owner_meta_user_id
              AND existing.page_id = target.page_id
              AND existing.id <> target.id
              AND existing.is_default = TRUE
          ), selected AS (
            UPDATE conversation_templates AS chosen
            SET is_default = TRUE, updated_at = ${defaultTemplate.updatedAt}
            FROM target
            WHERE chosen.id = target.id
              AND chosen.owner_meta_user_id = target.owner_meta_user_id
              AND chosen.page_id = target.page_id
            RETURNING chosen.id, chosen.owner_meta_user_id, chosen.page_id, chosen.name,
              chosen.template_json, chosen.is_default, chosen.created_at, chosen.updated_at
          )
          SELECT selected.*, 1 / LEAST((SELECT COUNT(*) FROM selected), 1) AS import_guard
          FROM (SELECT 1) AS required
          LEFT JOIN selected ON TRUE
        `)
      ];
      const results = await sql.transaction(queries);
      const selectedDefaults = results.slice(-defaultTemplates.length).map((result) => result[0]);
      if (selectedDefaults.some((selected) => !selected)) {
        throw new Error('Default conversation template could not be selected.');
      }
      return mapConversationTemplate(selectedDefaults[0]);
    },

    async listSeedingTemplates(ownerMetaUserId) {
      return (await sql`
        SELECT id, owner_meta_user_id, name, items_json, created_at, updated_at
        FROM seeding_templates
        WHERE owner_meta_user_id = ${ownerMetaUserId}
        ORDER BY updated_at DESC, created_at DESC, id DESC
      `).map(mapSeedingTemplate);
    },

    async getSeedingTemplate(ownerMetaUserId, id) {
      return mapOptionalSeedingTemplate((await sql`
        SELECT id, owner_meta_user_id, name, items_json, created_at, updated_at
        FROM seeding_templates
        WHERE owner_meta_user_id = ${ownerMetaUserId} AND id = ${id}
      `)[0]);
    },

    async createSeedingTemplate(input) {
      const id = input.id ?? randomUUID();
      const now = input.now ?? Date.now();
      return mapSeedingTemplate((await sql`
        INSERT INTO seeding_templates (id, owner_meta_user_id, name, items_json, created_at, updated_at)
        VALUES (${id}, ${input.ownerMetaUserId}, ${input.name}, ${JSON.stringify(input.items)}, ${now}, ${now})
        RETURNING id, owner_meta_user_id, name, items_json, created_at, updated_at
      `)[0]);
    },

    async updateSeedingTemplate(input) {
      return mapOptionalSeedingTemplate((await sql`
        UPDATE seeding_templates
        SET name = ${input.name}, items_json = ${JSON.stringify(input.items)}, updated_at = ${input.now ?? Date.now()}
        WHERE owner_meta_user_id = ${input.ownerMetaUserId} AND id = ${input.id}
        RETURNING id, owner_meta_user_id, name, items_json, created_at, updated_at
      `)[0]);
    },

    async duplicateSeedingTemplate(input) {
      const newId = input.newId ?? randomUUID();
      const now = input.now ?? Date.now();
      return mapOptionalSeedingTemplate((await sql`
        WITH source AS (
          SELECT items_json
          FROM seeding_templates
          WHERE owner_meta_user_id = ${input.ownerMetaUserId} AND id = ${input.id}
        ), copied AS (
          SELECT COALESCE((
            SELECT jsonb_agg(
              jsonb_build_object(
                'id', item ->> 'id',
                'message', item ->> 'message',
                'imageMediaId', item -> 'imageMediaId'
              ) ORDER BY item_order
            )
            FROM jsonb_array_elements(source.items_json) WITH ORDINALITY AS entries(item, item_order)
          ), '[]'::jsonb) AS items_json
          FROM source
        )
        INSERT INTO seeding_templates (id, owner_meta_user_id, name, items_json, created_at, updated_at)
        SELECT ${newId}, ${input.ownerMetaUserId}, ${input.name}, copied.items_json, ${now}, ${now}
        FROM copied
        RETURNING id, owner_meta_user_id, name, items_json, created_at, updated_at
      `)[0]);
    },

    async deleteSeedingTemplate(ownerMetaUserId, id) {
      return (await sql`
        DELETE FROM seeding_templates
        WHERE owner_meta_user_id = ${ownerMetaUserId} AND id = ${id}
        RETURNING id
      `).length > 0;
    },

    async listCampaignPresets(ownerMetaUserId) {
      return (await sql`
        SELECT id, owner_meta_user_id, name, content_json, created_at, updated_at
        FROM campaign_presets
        WHERE owner_meta_user_id = ${ownerMetaUserId}
        ORDER BY updated_at DESC, created_at DESC, id DESC
      `).map(mapCampaignPreset);
    },

    async getCampaignPreset(ownerMetaUserId, id) {
      return mapOptionalCampaignPreset((await sql`
        SELECT id, owner_meta_user_id, name, content_json, created_at, updated_at
        FROM campaign_presets
        WHERE owner_meta_user_id = ${ownerMetaUserId} AND id = ${id}
      `)[0]);
    },

    async createCampaignPreset(input) {
      const id = input.id ?? randomUUID();
      const now = input.now ?? Date.now();
      return mapCampaignPreset((await sql`
        INSERT INTO campaign_presets (id, owner_meta_user_id, name, content_json, created_at, updated_at)
        VALUES (${id}, ${input.ownerMetaUserId}, ${input.name}, ${JSON.stringify(input.content)}, ${now}, ${now})
        RETURNING id, owner_meta_user_id, name, content_json, created_at, updated_at
      `)[0]);
    },

    async updateCampaignPreset(input) {
      return mapOptionalCampaignPreset((await sql`
        UPDATE campaign_presets
        SET name = ${input.name}, content_json = ${JSON.stringify(input.content)}, updated_at = ${input.now ?? Date.now()}
        WHERE owner_meta_user_id = ${input.ownerMetaUserId} AND id = ${input.id}
        RETURNING id, owner_meta_user_id, name, content_json, created_at, updated_at
      `)[0]);
    },

    async deleteCampaignPreset(ownerMetaUserId, id) {
      return (await sql`
        DELETE FROM campaign_presets
        WHERE owner_meta_user_id = ${ownerMetaUserId} AND id = ${id}
        RETURNING id
      `).length > 0;
    },

    async insertSeedingJobs(ownerMetaUserId, jobs) {
      if (jobs.length === 0) return 0;
      const runIds = [...new Set(jobs.map((job) => job.runId))];
      const records = jobs.map((job) => {
        const createdAt = job.createdAt ?? Date.now();
        return {
          id: job.id,
          run_id: job.runId,
          owner_meta_user_id: ownerMetaUserId,
          campaign_client_id: job.campaignClientId,
          page_id: job.pageId,
          post_id: job.postId,
          item_id: job.itemId,
          position: job.position,
          sequence: job.sequence,
          message: job.message,
          image_media_id: job.imageMediaId ?? null,
          status: job.status ?? 'pending',
          meta_comment_id: job.metaCommentId ?? null,
          error_json: job.error ?? null,
          attempt_count: job.attemptCount ?? 0,
          available_at: job.availableAt ?? createdAt,
          started_at: job.startedAt ?? null,
          completed_at: job.completedAt ?? null,
          created_at: createdAt,
          updated_at: job.updatedAt ?? createdAt
        };
      });
      const results = await sql.transaction([
        sql`
          SELECT runs.id
          FROM runs
          JOIN jsonb_array_elements_text(${JSON.stringify(runIds)}::jsonb) AS requested(run_id)
            ON requested.run_id = runs.id
          WHERE runs.owner_meta_user_id = ${ownerMetaUserId}
          ORDER BY runs.id
          FOR UPDATE
        `,
        sql`
        WITH input_jobs AS (
          SELECT *
          FROM jsonb_to_recordset(${JSON.stringify(records)}::jsonb) AS job(
            id TEXT, run_id TEXT, owner_meta_user_id TEXT, campaign_client_id TEXT, page_id TEXT,
            post_id TEXT, item_id TEXT, position INTEGER, sequence INTEGER, message TEXT,
            image_media_id TEXT, status TEXT, meta_comment_id TEXT, error_json JSONB,
            attempt_count INTEGER, available_at BIGINT, started_at BIGINT, completed_at BIGINT,
            created_at BIGINT, updated_at BIGINT
          )
        ), authorized AS (
          SELECT NOT EXISTS (
            SELECT 1
            FROM (SELECT DISTINCT run_id FROM input_jobs) AS requested_run
            WHERE NOT EXISTS (
              SELECT 1
              FROM runs
              WHERE runs.id = requested_run.run_id
                AND runs.owner_meta_user_id = ${ownerMetaUserId}
            )
          ) AS allowed
        ), batch_conflicts AS (
          SELECT run_id, post_id
          FROM input_jobs
          GROUP BY run_id, post_id
          HAVING COUNT(DISTINCT campaign_client_id) > 1
        ), existing_conflicts AS (
          SELECT 1
          FROM input_jobs
          JOIN seeding_jobs AS existing
            ON existing.owner_meta_user_id = input_jobs.owner_meta_user_id
            AND existing.run_id = input_jobs.run_id
            AND existing.post_id = input_jobs.post_id
            AND existing.campaign_client_id <> input_jobs.campaign_client_id
          LIMIT 1
        ), guard AS (
          SELECT
            authorized.allowed,
            authorized.allowed AND (
              EXISTS (SELECT 1 FROM batch_conflicts)
              OR EXISTS (SELECT 1 FROM existing_conflicts)
            ) AS conflict
          FROM authorized
        ), inserted AS (
          INSERT INTO seeding_jobs (
            id, run_id, owner_meta_user_id, campaign_client_id, page_id, post_id, item_id,
            position, sequence, message, image_media_id, status, meta_comment_id, error_json,
            attempt_count, available_at, started_at, completed_at, created_at, updated_at
          )
          SELECT
            job.id, job.run_id, job.owner_meta_user_id, job.campaign_client_id, job.page_id,
            job.post_id, job.item_id, job.position, job.sequence, job.message, job.image_media_id,
            job.status, job.meta_comment_id, job.error_json, job.attempt_count, job.available_at,
            job.started_at, job.completed_at, job.created_at, job.updated_at
          FROM input_jobs AS job
          CROSS JOIN guard
          WHERE guard.allowed AND NOT guard.conflict
          ON CONFLICT DO NOTHING
          RETURNING id
        )
        SELECT COUNT(*) AS count, (SELECT conflict FROM guard) AS conflict FROM inserted
        `
      ]);
      const result = results[1]?.[0];
      if (result?.conflict) throw seedingPostConflictError();
      return Number(result?.count ?? 0);
    },

    async listSeedingJobs(ownerMetaUserId, runId) {
      return (await sql`
        SELECT * FROM seeding_jobs
        WHERE owner_meta_user_id = ${ownerMetaUserId} AND run_id = ${runId}
        ORDER BY sequence, position, id
      `).map(mapSeedingJob);
    },

    async claimNextSeedingJob({ ownerMetaUserId, runId, now, staleBefore }) {
      const results = await sql.transaction([
        sql`
          SELECT id FROM runs
          WHERE owner_meta_user_id = ${ownerMetaUserId} AND id = ${runId}
          FOR UPDATE
        `,
        sql`
          UPDATE seeding_jobs
          SET status = 'needs_review', updated_at = ${now}
          WHERE owner_meta_user_id = ${ownerMetaUserId} AND run_id = ${runId}
            AND status = 'posting' AND started_at < ${staleBefore}
        `,
        sql`
          WITH candidate AS (
            SELECT candidate_job.*
            FROM seeding_jobs AS candidate_job
            WHERE candidate_job.owner_meta_user_id = ${ownerMetaUserId}
              AND candidate_job.run_id = ${runId}
              AND candidate_job.status = 'pending'
              AND candidate_job.available_at <= ${now}
              AND EXISTS (
                SELECT 1 FROM runs
                WHERE runs.owner_meta_user_id = ${ownerMetaUserId} AND runs.id = ${runId}
              )
              AND NOT EXISTS (
                SELECT 1 FROM seeding_jobs AS posting
                WHERE posting.owner_meta_user_id = candidate_job.owner_meta_user_id
                  AND posting.run_id = candidate_job.run_id
                  AND posting.status = 'posting'
              )
              AND NOT EXISTS (
                SELECT 1 FROM seeding_jobs AS prior
                WHERE prior.owner_meta_user_id = candidate_job.owner_meta_user_id
                  AND prior.run_id = candidate_job.run_id
                  AND prior.campaign_client_id = candidate_job.campaign_client_id
                  AND prior.post_id = candidate_job.post_id
                  AND prior.position < candidate_job.position
                  AND prior.status IN ('pending', 'posting', 'needs_review')
            )
            ORDER BY candidate_job.sequence, candidate_job.position, candidate_job.id
            LIMIT 1
            FOR UPDATE SKIP LOCKED
          ), claimed AS (
            UPDATE seeding_jobs AS target
            SET status = 'posting',
                attempt_count = candidate_job.attempt_count + 1,
                started_at = ${now},
                updated_at = ${now}
            FROM candidate AS candidate_job
            WHERE target.id = candidate_job.id
              AND target.owner_meta_user_id = ${ownerMetaUserId}
              AND target.run_id = ${runId}
              AND target.status = 'pending'
            RETURNING target.*
          )
          SELECT * FROM claimed
        `
      ]);
      return mapOptionalSeedingJob(results[2][0]);
    },

    async finishSeedingJob(input) {
      if (!['created', 'failed', 'needs_review'].includes(input.status)) {
        throw new TypeError('finishSeedingJob requires a terminal seeding status');
      }
      return mapOptionalSeedingJob((await sql`
        WITH finished AS (
          UPDATE seeding_jobs
          SET status = ${input.status},
              meta_comment_id = ${input.metaCommentId ?? null},
              error_json = ${input.error ? JSON.stringify(input.error) : null},
              completed_at = ${input.now},
              updated_at = ${input.now}
          WHERE owner_meta_user_id = ${input.ownerMetaUserId}
            AND run_id = ${input.runId}
            AND id = ${input.jobId}
            AND status = 'posting'
          RETURNING *
        ), delayed AS (
          UPDATE seeding_jobs
          SET available_at = GREATEST(available_at, ${input.nextAvailableAt}), updated_at = ${input.now}
          WHERE owner_meta_user_id = ${input.ownerMetaUserId}
            AND run_id = ${input.runId}
            AND status = 'pending'
            AND ${input.status} = 'created'
            AND EXISTS (SELECT 1 FROM finished)
        )
        SELECT * FROM finished
      `)[0]);
    },

    async deferSeedingJob(input) {
      return mapOptionalSeedingJob((await sql`
        UPDATE seeding_jobs
        SET status = 'pending', started_at = NULL, completed_at = NULL,
            available_at = ${input.availableAt}, updated_at = ${input.now}
        WHERE owner_meta_user_id = ${input.ownerMetaUserId}
          AND run_id = ${input.runId}
          AND id = ${input.jobId}
          AND status = 'posting'
        RETURNING *
      `)[0]);
    },

    async retrySeedingJob(input) {
      return mapOptionalSeedingJob((await sql`
        UPDATE seeding_jobs
        SET status = 'pending', started_at = NULL, completed_at = NULL, updated_at = ${input.now}
        WHERE owner_meta_user_id = ${input.ownerMetaUserId}
          AND run_id = ${input.runId}
          AND id = ${input.jobId}
          AND status IN ('failed', 'needs_review')
        RETURNING *
      `)[0]);
    },

    async confirmSeedingJob(input) {
      return mapOptionalSeedingJob((await sql`
        UPDATE seeding_jobs
        SET status = 'created',
            meta_comment_id = ${input.metaCommentId ?? null},
            error_json = ${JSON.stringify({ manualConfirmation: true })},
            completed_at = ${input.now},
            updated_at = ${input.now}
        WHERE owner_meta_user_id = ${input.ownerMetaUserId}
          AND run_id = ${input.runId}
          AND id = ${input.jobId}
          AND status = 'needs_review'
        RETURNING *
      `)[0]);
    },

    async cancelSeedingJobs(ownerMetaUserId, runId, now = Date.now()) {
      const rows = await sql`
        WITH changed AS (
          UPDATE seeding_jobs SET status = 'cancelled', updated_at = ${now}
          WHERE owner_meta_user_id = ${ownerMetaUserId} AND run_id = ${runId} AND status = 'pending'
          RETURNING id
        )
        SELECT COUNT(*) AS count FROM changed
      `;
      return Number(rows[0]?.count ?? 0);
    },

    async resumeSeedingJobs(ownerMetaUserId, runId, now = Date.now()) {
      const rows = await sql`
        WITH changed AS (
          UPDATE seeding_jobs SET status = 'pending', available_at = ${now}, updated_at = ${now}
          WHERE owner_meta_user_id = ${ownerMetaUserId} AND run_id = ${runId} AND status = 'cancelled'
          RETURNING id
        )
        SELECT COUNT(*) AS count FROM changed
      `;
      return Number(rows[0]?.count ?? 0);
    },

    async createRun(run) {
      const id = run.id ?? randomUUID();
      const row = (await sql`
        INSERT INTO runs (
          id, owner_meta_user_id, status, ad_account_id, snapshot_json, execution_json, completed_at, created_at
        ) VALUES (
          ${id}, ${run.ownerMetaUserId}, ${run.status ?? 'creating'}, ${run.adAccountId ?? null},
          ${run.snapshot ? JSON.stringify(run.snapshot) : null}, ${run.execution ? JSON.stringify(run.execution) : null},
          ${run.completedAt ?? null}, ${run.createdAt ?? Date.now()}
        )
        RETURNING id
      `)[0];
      return { id: row.id };
    },

    async updateRunStatus(id, status, completedAt = Date.now()) {
      await sql`UPDATE runs SET status = ${status}, completed_at = ${completedAt} WHERE id = ${id}`;
    },

    async claimWorkflowLease(runId, token, now, ttlMs) {
      const rows = await sql`
        UPDATE runs
        SET workflow_token = ${token}, workflow_lease_expires_at = ${now + ttlMs}
        WHERE id = ${runId} AND (
          workflow_token IS NULL OR workflow_token = ${token} OR workflow_lease_expires_at <= ${now}
        )
        RETURNING id
      `;
      return rows.length === 1;
    },

    async renewWorkflowLease(runId, token, now, ttlMs) {
      const rows = await sql`
        UPDATE runs SET workflow_lease_expires_at = ${now + ttlMs}
        WHERE id = ${runId} AND workflow_token = ${token} AND workflow_lease_expires_at > ${now}
        RETURNING id
      `;
      return rows.length === 1;
    },

    async isWorkflowLeaseCurrent(runId, token, now) {
      const rows = await sql`
        SELECT id FROM runs
        WHERE id = ${runId} AND workflow_token = ${token} AND workflow_lease_expires_at > ${now}
        LIMIT 1
      `;
      return rows.length === 1;
    },

    async releaseWorkflowLease(runId, token) {
      const rows = await sql`
        UPDATE runs SET workflow_token = NULL, workflow_lease_expires_at = NULL
        WHERE id = ${runId} AND workflow_token = ${token}
        RETURNING id
      `;
      return rows.length === 1;
    },

    async updateNodeResult(runId, node) {
      await sql`
        INSERT INTO node_results (
          run_id, client_id, parent_client_id, type, status, name, remote_id, creative_id, creative_artifact_key,
          post_id, permalink_url, error_json
        )
        VALUES (
          ${runId}, ${node.clientId}, ${node.parentClientId ?? null}, ${node.type}, ${node.status},
          ${node.name ?? null}, ${node.remoteId ?? null}, ${node.creativeId ?? null},
          ${node.creativeArtifactKey ?? null}, ${node.postId ?? null}, ${node.permalinkUrl ?? null},
          ${node.error ? JSON.stringify(node.error) : null}
        )
        ON CONFLICT (run_id, client_id) DO UPDATE SET
          parent_client_id = EXCLUDED.parent_client_id,
          type = EXCLUDED.type,
          status = EXCLUDED.status,
          name = EXCLUDED.name,
          remote_id = EXCLUDED.remote_id,
          creative_id = EXCLUDED.creative_id,
          creative_artifact_key = EXCLUDED.creative_artifact_key,
          post_id = EXCLUDED.post_id,
          permalink_url = EXCLUDED.permalink_url,
          error_json = EXCLUDED.error_json
      `;
    },

    // execution_json is the full draft (large); read-only endpoints pass { execution: false }.
    async getRun(runId, { execution = true } = {}) {
      const [runs, nodes] = await Promise.all([sql`
        SELECT id, owner_meta_user_id, status, ad_account_id, snapshot_json,
          CASE WHEN ${execution} THEN execution_json END AS execution_json,
          workflow_token, workflow_lease_expires_at, created_at, completed_at
        FROM runs WHERE id = ${runId}
      `, sql`
        SELECT client_id, parent_client_id, type, status, name, remote_id, creative_id, creative_artifact_key,
          post_id, permalink_url, error_json
        FROM node_results WHERE run_id = ${runId}
        ORDER BY client_id
      `]);
      return runs[0] ? mapRunDetail(runs[0], nodes.map(mapNodeResult)) : null;
    },

    async listRuns(ownerMetaUserId, options = {}) {
      const { from = 0, to = Number.MAX_SAFE_INTEGER, limit = 20, offset = 0 } = options;
      const rows = await sql`
        SELECT
          runs.id,
          runs.status,
          runs.ad_account_id,
          runs.snapshot_json,
          runs.created_at,
          runs.completed_at,
          runs.workflow_lease_expires_at,
          COUNT(node_results.client_id) AS total_count,
          COUNT(*) FILTER (WHERE node_results.status = 'created') AS created_count,
          COUNT(*) FILTER (WHERE node_results.status = 'failed') AS failed_count,
          COUNT(*) FILTER (WHERE node_results.status = 'skipped') AS skipped_count,
          COUNT(*) FILTER (WHERE node_results.type = 'campaign') AS campaign_count,
          COUNT(*) FILTER (WHERE node_results.type = 'adSet') AS adset_count,
          COUNT(*) FILTER (WHERE node_results.type = 'ad') AS ad_count
        FROM runs
        LEFT JOIN node_results ON node_results.run_id = runs.id
        WHERE runs.owner_meta_user_id = ${ownerMetaUserId}
          AND runs.created_at >= ${from}
          AND runs.created_at < ${to}
        GROUP BY runs.id
        ORDER BY runs.created_at DESC, runs.id DESC
        LIMIT ${limit + 1} OFFSET ${offset}
      `;
      const hasMore = rows.length > limit;
      const selectedRows = rows.slice(0, limit);
      const runIds = selectedRows.map((row) => row.id);
      const nodeRows = runIds.length > 0 ? await sql`
        SELECT run_id, client_id, parent_client_id, type, status, name, remote_id, creative_id,
          creative_artifact_key, post_id, permalink_url, error_json
        FROM node_results WHERE run_id = ANY(${runIds}) ORDER BY run_id, client_id
      ` : [];
      const nodesByRun = new Map();
      for (const nodeRow of nodeRows) {
        const nodes = nodesByRun.get(nodeRow.run_id) ?? [];
        nodes.push(mapNodeResult(nodeRow));
        nodesByRun.set(nodeRow.run_id, nodes);
      }
      return {
        items: selectedRows.map((row) => mapRunSummary(row, nodesByRun.get(row.id) ?? [])),
        nextOffset: hasMore ? offset + limit : null
      };
    }
  };
}

export function createNeonDatabase(databaseUrl) {
  return createPostgresDatabase(createSqlTransport(databaseUrl));
}

function mapSession(row) {
  const session = { id: row.id, metaUserId: row.meta_user_id };
  if ('meta_user_name' in row) session.metaUserName = row.meta_user_name;
  if ('created_at' in row) session.createdAt = Number(row.created_at);
  if ('updated_at' in row) session.updatedAt = Number(row.updated_at);
  return session;
}

function mapOptionalSession(row) {
  return row ? mapSession(row) : null;
}

function mapOAuthState(row) {
  return { state: row.state, sessionId: row.session_id, expiresAt: Number(row.expires_at) };
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

function mapOptionalConnection(row) {
  return row ? mapConnection(row) : null;
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
    sizeBytes: Number(row.size_bytes),
    createdAt: Number(row.created_at)
  };
}

function mapOptionalMedia(row) {
  return row ? mapMedia(row) : null;
}

function mapAudienceTemplate(row) {
  return {
    id: row.id,
    name: row.name,
    content: parseJson(row.content_json),
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at)
  };
}

function mapOptionalAudienceTemplate(row) {
  return row ? mapAudienceTemplate(row) : null;
}

function assertAudienceTemplateId(id) {
  if (!isAudienceTemplateId(id)) {
    throw new TypeError(`Audience template ID must start with ${AUDIENCE_TEMPLATE_ID_PREFIX}`);
  }
}

function isAudienceTemplateId(id) {
  return typeof id === 'string' && id.startsWith(AUDIENCE_TEMPLATE_ID_PREFIX) && id.length > AUDIENCE_TEMPLATE_ID_PREFIX.length;
}

function mapConversationTemplate(row) {
  return {
    id: row.id,
    ownerMetaUserId: row.owner_meta_user_id,
    pageId: row.page_id,
    name: row.name,
    template: parseJson(row.template_json),
    isDefault: Boolean(row.is_default),
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at)
  };
}

function mapOptionalConversationTemplate(row) {
  return row ? mapConversationTemplate(row) : null;
}

function mapSeedingTemplate(row) {
  return {
    id: row.id,
    ownerMetaUserId: row.owner_meta_user_id,
    name: row.name,
    items: parseJson(row.items_json),
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at)
  };
}

function mapCampaignPreset(row) {
  return {
    id: row.id,
    ownerMetaUserId: row.owner_meta_user_id,
    name: row.name,
    content: parseJson(row.content_json),
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at)
  };
}

function mapOptionalCampaignPreset(row) {
  return row ? mapCampaignPreset(row) : null;
}

function mapOptionalSeedingTemplate(row) {
  return row ? mapSeedingTemplate(row) : null;
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
    position: Number(row.position),
    sequence: Number(row.sequence),
    message: row.message,
    imageMediaId: row.image_media_id,
    status: row.status,
    metaCommentId: row.meta_comment_id,
    error: row.error_json ? parseJson(row.error_json) : null,
    attemptCount: Number(row.attempt_count),
    availableAt: Number(row.available_at),
    startedAt: row.started_at === null ? null : Number(row.started_at),
    completedAt: row.completed_at === null ? null : Number(row.completed_at),
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at)
  };
}

function mapOptionalSeedingJob(row) {
  return row ? mapSeedingJob(row) : null;
}

function seedingPostConflictError() {
  const error = new Error('Post already has a different Campaign selection in this run');
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
    error: row.error_json ? parseJson(row.error_json) : null
  };
  if (row.creative_id) node.creativeId = row.creative_id;
  if (row.creative_artifact_key) node.creativeArtifactKey = row.creative_artifact_key;
  return node;
}

function mapRunDetail(row, nodes) {
  const snapshot = row.snapshot_json ? parseJson(row.snapshot_json) : null;
  const run = {
    id: row.id,
    ownerMetaUserId: row.owner_meta_user_id,
    status: row.status,
    adAccountId: row.ad_account_id,
    snapshot,
    createdAt: Number(row.created_at),
    completedAt: row.completed_at === null ? null : Number(row.completed_at),
    legacy: !snapshot,
    nodes
  };
  if (row.workflow_token) {
    run.workflowToken = row.workflow_token;
    run.workflowLeaseExpiresAt = Number(row.workflow_lease_expires_at);
  }
  if (row.execution_json) run.execution = parseJson(row.execution_json);
  return run;
}

function mapRunSummary(row, nodes = []) {
  const snapshot = row.snapshot_json ? parseJson(row.snapshot_json) : null;
  return {
    id: row.id,
    status: row.status,
    adAccountId: row.ad_account_id,
    createdAt: Number(row.created_at),
    completedAt: row.completed_at === null ? null : Number(row.completed_at),
    workflowLeaseExpiresAt: row.workflow_lease_expires_at == null ? null : Number(row.workflow_lease_expires_at),
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

function parseJson(value) {
  return typeof value === 'string' ? JSON.parse(value) : value;
}

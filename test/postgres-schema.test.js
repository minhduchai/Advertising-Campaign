import test from 'node:test';
import assert from 'node:assert/strict';
import { applyPostgresSchema } from '../src/postgres-schema.js';

test('Postgres schema records and seeds the shared conversation library migration once', async () => {
  const calls = [];
  const sql = async (strings, ...values) => {
    calls.push({ text: String.raw(strings, ...values.map(() => '?')), values });
    return [];
  };

  const tables = await applyPostgresSchema(sql);
  const schema = calls.map((call) => call.text).join('\n');

  assert.ok(tables.includes('app_migrations'));
  assert.match(schema, /CREATE TABLE IF NOT EXISTS app_migrations/);
  assert.match(schema, /INSERT INTO app_migrations/);
  assert.match(schema, /INSERT INTO conversation_templates/);
  assert.ok(calls.some((call) => call.values.includes('__shared_conversation_library__')));
});

test('Postgres schema creates owner-indexed seeding templates and jobs', async () => {
  const calls = [];
  const sql = async (strings, ...values) => {
    calls.push({ text: String.raw(strings, ...values.map(() => '?')), values });
    return [];
  };

  const tables = await applyPostgresSchema(sql);
  const schema = calls.map((call) => call.text).join('\n');

  assert.ok(tables.includes('seeding_templates'));
  assert.ok(tables.includes('seeding_jobs'));
  assert.match(schema, /CREATE TABLE IF NOT EXISTS seeding_templates/);
  assert.match(schema, /items_json JSONB NOT NULL/);
  assert.match(schema, /CREATE TABLE IF NOT EXISTS seeding_jobs/);
  assert.match(schema, /UNIQUE \(run_id, campaign_client_id, post_id, item_id\)/);
  assert.match(schema, /seeding_templates_owner_updated_idx/);
  assert.match(schema, /seeding_jobs_owner_run_status_idx/);
});

test('Postgres schema caches Meta video IDs per owner media and ad account', async () => {
  const calls = [];
  const sql = async (strings, ...values) => {
    calls.push({ text: String.raw(strings, ...values.map(() => '?')), values });
    return [];
  };

  const tables = await applyPostgresSchema(sql);
  const schema = calls.map((call) => call.text).join('\n');

  assert.ok(tables.includes('meta_video_assets'));
  assert.match(schema, /CREATE TABLE IF NOT EXISTS meta_video_assets/);
  assert.match(schema, /PRIMARY KEY \(owner_meta_user_id, media_id, ad_account_id\)/);
  assert.match(schema, /meta_video_assets_media_idx/);
});

test('Postgres schema creates owner-indexed Campaign presets', async () => {
  const calls = [];
  const sql = async (strings, ...values) => {
    calls.push({ text: String.raw(strings, ...values.map(() => '?')), values });
    return [];
  };

  const tables = await applyPostgresSchema(sql);
  const schema = calls.map((call) => call.text).join('\n');

  assert.ok(tables.includes('campaign_presets'));
  assert.match(schema, /CREATE TABLE IF NOT EXISTS campaign_presets/);
  assert.match(schema, /content_json JSONB NOT NULL/);
  assert.match(schema, /campaign_presets_owner_updated_idx/);
});

test('Postgres schema stores upload agent pairing codes and hashed device tokens', async () => {
  const calls = [];
  const sql = async (strings, ...values) => {
    calls.push({ text: String.raw(strings, ...values.map(() => '?')), values });
    return [];
  };

  const tables = await applyPostgresSchema(sql);
  const schema = calls.map((call) => call.text).join('\n');

  assert.ok(tables.includes('upload_agent_pairing_codes'));
  assert.ok(tables.includes('upload_agent_devices'));
  assert.match(schema, /CREATE TABLE IF NOT EXISTS upload_agent_pairing_codes/);
  assert.match(schema, /code_hash TEXT PRIMARY KEY/);
  assert.match(schema, /CREATE TABLE IF NOT EXISTS upload_agent_devices/);
  assert.match(schema, /token_hash TEXT NOT NULL UNIQUE/);
  assert.match(schema, /upload_agent_devices_owner_idx/);
  assert.doesNotMatch(schema, /token_plaintext/);
});

test('Postgres schema stores the authenticated Telegram path queue', async () => {
  const calls = [];
  const sql = async (strings, ...values) => {
    calls.push({ text: String.raw(strings, ...values.map(() => '?')), values });
    return [];
  };

  const tables = await applyPostgresSchema(sql);
  const schema = calls.map((call) => call.text).join('\n');

  assert.ok(tables.includes('telegram_upload_jobs'));
  assert.match(schema, /CREATE TABLE IF NOT EXISTS telegram_upload_jobs/);
  assert.match(schema, /network_path TEXT NOT NULL/);
  assert.match(schema, /intent_code TEXT NOT NULL/);
  assert.match(schema, /uploaded_bytes BIGINT NOT NULL DEFAULT 0/);
  assert.match(schema, /total_bytes BIGINT NOT NULL DEFAULT 0/);
  assert.match(schema, /ADD COLUMN IF NOT EXISTS uploaded_bytes/);
  assert.match(schema, /telegram_upload_jobs_queue_idx/);
  assert.match(schema, /telegram_upload_jobs_owner_media_idx/);
});

test('Postgres schema creates owner-scoped audience templates with case-insensitive unique names', async () => {
  const calls = [];
  const sql = async (strings, ...values) => {
    const text = String.raw(strings, ...values.map(() => '?'));
    calls.push({ text, values });
    if (/SELECT id, name/.test(text)) {
      return [
        { id: 'tool_audience_legacy', name: 'ĐỐI TƯỢNG NỮ', name_key: null },
        { id: 'tool_audience_duplicate', name: 'đối tượng nữ'.normalize('NFD'), name_key: null }
      ];
    }
    return [];
  };

  const tables = await applyPostgresSchema(sql);
  const schema = calls.map((call) => call.text).join('\n');

  assert.ok(tables.includes('audience_templates'));
  assert.match(schema, /CREATE TABLE IF NOT EXISTS audience_templates/);
  assert.match(schema, /content_json JSONB NOT NULL/);
  assert.match(schema, /name_key TEXT/);
  assert.match(schema, /ADD COLUMN IF NOT EXISTS name_key TEXT/);
  assert.match(schema, /ALTER COLUMN name_key SET NOT NULL/);
  assert.match(schema, /CREATE UNIQUE INDEX IF NOT EXISTS audience_templates_owner_name_key_idx/);
  assert.match(schema, /ON audience_templates \(owner_meta_user_id, name_key\)/);
  assert.match(schema, /DROP INDEX IF EXISTS audience_templates_name_lower_idx/);
  assert.ok(calls.some((call) => call.values.includes('đối tượng nữ')));
  assert.ok(calls.some((call) => call.values.includes('đối tượng nữ (2)')));
  const dropIndexCall = calls.findIndex(({ text }) => /DROP INDEX IF EXISTS audience_templates_name_lower_idx/.test(text));
  const firstBackfillCall = calls.findIndex(({ text }) => /UPDATE audience_templates SET name/.test(text));
  assert.ok(dropIndexCall >= 0 && dropIndexCall < firstBackfillCall);
  assert.match(schema, /owner_meta_user_id TEXT/);
});

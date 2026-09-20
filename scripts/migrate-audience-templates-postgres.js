import { neon } from '@neondatabase/serverless';
import { applyAudienceTemplateSchema } from '../src/postgres-schema.js';

const dryRun = process.argv.includes('--dry-run');

if (dryRun) {
  console.log('Dry run: would apply the idempotent audience_templates schema migration.');
} else {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is required to migrate Postgres audience_templates.');
  }

  const tableName = await applyAudienceTemplateSchema(neon(databaseUrl));
  console.log(`Migrated ${tableName}`);
}

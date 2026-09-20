import { neon } from '@neondatabase/serverless';
import { applyWorkflowNonceSchema } from '../src/postgres-schema.js';

const databaseUrl = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL_UNPOOLED or DATABASE_URL is required.');
if (new URL(databaseUrl).hostname.includes('-pooler')) throw new Error('Use a direct database URL for this migration.');
console.log(await applyWorkflowNonceSchema(neon(databaseUrl)));

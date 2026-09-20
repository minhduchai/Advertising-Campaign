import { createSqlTransport } from '../src/postgres-transport.js';
import { applyPostgresSchema } from '../src/postgres-schema.js';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error('DATABASE_URL is required to migrate Postgres.');
}

const sql = createSqlTransport(databaseUrl);
const tableNames = await applyPostgresSchema(sql);
for (const tableName of tableNames) {
  console.log(tableName);
}
await sql.end?.();

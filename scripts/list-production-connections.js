import { neon } from '@neondatabase/serverless';

const databaseUrl = process.env.DATABASE_URL?.trim();
if (!databaseUrl) {
  throw new Error('DATABASE_URL is required to list production connections.');
}

const connections = await neon(databaseUrl)`
  SELECT meta_user_id, updated_at
  FROM connections
  ORDER BY updated_at DESC, meta_user_id
`;
for (const connection of connections) {
  console.log(`${connection.meta_user_id}\t${connection.updated_at}`);
}

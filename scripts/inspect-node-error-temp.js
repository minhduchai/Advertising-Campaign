import { createSqlTransport } from '../src/postgres-transport.js';

const clientId = process.argv[2];
if (!clientId || !process.env.DATABASE_URL) process.exit(2);
const sql = createSqlTransport(process.env.DATABASE_URL);
try {
  const rows = await sql`
    SELECT n.run_id, n.client_id, n.type, n.name, n.status, n.remote_id, n.error_json,
           r.status AS run_status, r.created_at, r.owner_meta_user_id
    FROM node_results n JOIN runs r ON r.id = n.run_id
    WHERE n.client_id = ${clientId}
    ORDER BY r.created_at DESC
  `;
  console.log(JSON.stringify(rows, null, 2));
} finally {
  await sql.end?.();
}

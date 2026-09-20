import pg from 'pg';
import { neon } from '@neondatabase/serverless';

// Preserve Neon HTTP in production; opt in to TCP on the self-hosted server.
export function createSqlTransport(url, driver = process.env.DATABASE_DRIVER ?? 'neon') {
  if (driver === 'neon') return neon(url);
  if (driver !== 'pg') throw new Error('Unsupported DATABASE_DRIVER');
  return createPoolSql(new pg.Pool({ connectionString: url, max: 10,
    connectionTimeoutMillis: 10000, idleTimeoutMillis: 30000 }));
}

export function createPoolSql(pool) {
  const queries = new WeakMap();
  function sql(parts, ...values) {
    const text = parts.reduce((out, part, i) => out + (i ? `$${i}` : '') + part, '');
    let promise;
    const query = { then(resolve, reject) {
      promise ??= pool.query(text, values).then(result => result.rows);
      return promise.then(resolve, reject);
    } };
    queries.set(query, { text, values, started: () => Boolean(promise) });
    return query;
  }
  sql.transaction = async items => {
    const statements = items.map(item => {
      const statement = queries.get(item);
      if (!statement || statement.started()) throw new Error('Transaction requires unexecuted queries');
      return statement;
    });
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const results = [];
      for (const { text, values } of statements) results.push((await client.query(text, values)).rows);
      await client.query('COMMIT');
      return results;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally { client.release(); }
  };
  sql.end = () => pool.end();
  return sql;
}

import { createSqliteDatabase } from './db.js';
import { createNeonDatabase } from './postgres-db.js';

export function createDatabaseForConfig(config) {
  return config.databaseUrl
    ? createNeonDatabase(config.databaseUrl)
    : createSqliteDatabase(config.databasePath);
}

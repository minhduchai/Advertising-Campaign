import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from '../src/config.js';
import { createSqliteDatabase } from '../src/db.js';

const outputPath = 'data-migrations/conversation-templates.json';

export async function exportTemplates(sourceDatabase, ownerMetaUserId) {
  const owner = requiredOwner(ownerMetaUserId);
  const connection = await sourceDatabase.getConnection(owner);
  if (!connection) {
    throw new Error(`No local Meta connection exists for owner ${owner}.`);
  }

  const templates = await sourceDatabase.listConversationTemplates(owner);
  return {
    schemaVersion: 1,
    exportedAt: new Date().toISOString(),
    templates: templates.map((template) => ({
      id: template.id,
      pageId: template.pageId,
      name: template.name,
      template: jsonClone(template.template),
      isDefault: Boolean(template.isDefault),
      createdAt: template.createdAt,
      updatedAt: template.updatedAt
    }))
  };
}

async function main(argumentsList) {
  const owner = parseOwnerArgument(argumentsList);
  const config = loadConfig();
  if (!config.databasePath) {
    throw new Error('Template export requires a local SQLite database, not DATABASE_URL.');
  }

  const exported = await exportTemplates(createSqliteDatabase(config.databasePath), owner);
  const destination = resolve(outputPath);
  await mkdir(dirname(destination), { recursive: true });
  await writeFile(destination, `${JSON.stringify(exported, null, 2)}\n`, 'utf8');
  console.log(`${outputPath} ${exported.templates.length}`);
}

function parseOwnerArgument(argumentsList) {
  if (argumentsList.length !== 2 || argumentsList[0] !== '--owner') {
    throw new Error('Usage: node scripts/export-conversation-templates.js --owner <meta-user-id>');
  }
  return requiredOwner(argumentsList[1]);
}

function requiredOwner(value) {
  const owner = typeof value === 'string' ? value.trim() : '';
  if (!owner) {
    throw new Error('A non-empty owner Meta user ID is required.');
  }
  return owner;
}

function jsonClone(value) {
  const serialized = JSON.stringify(value);
  if (!serialized) {
    throw new Error('Conversation template JSON must be serializable.');
  }
  return JSON.parse(serialized);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}

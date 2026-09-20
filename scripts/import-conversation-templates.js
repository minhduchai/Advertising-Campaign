import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createNeonDatabase } from '../src/postgres-db.js';

export async function importTemplates(destinationDatabase, ownerMetaUserId, exported) {
  const owner = requiredOwner(ownerMetaUserId);
  const templates = validateExport(exported);
  await destinationDatabase.importConversationTemplates(owner, templates);
  return templates.length;
}

async function main(argumentsList) {
  const { file, owner } = parseArguments(argumentsList);
  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is required to import conversation templates.');
  }

  const contents = await readFile(resolve(file), 'utf8');
  const imported = await importTemplates(createNeonDatabase(databaseUrl), owner, JSON.parse(contents));
  console.log(`Imported ${imported} conversation templates.`);
}

function parseArguments(argumentsList) {
  if (argumentsList.length !== 4) {
    throw new Error('Usage: node scripts/import-conversation-templates.js --file <path> --owner <meta-user-id>');
  }
  const values = new Map();
  for (let index = 0; index < argumentsList.length; index += 2) {
    const key = argumentsList[index];
    const value = argumentsList[index + 1];
    if ((key !== '--file' && key !== '--owner') || values.has(key) || !value) {
      throw new Error('Usage: node scripts/import-conversation-templates.js --file <path> --owner <meta-user-id>');
    }
    values.set(key, value);
  }
  return { file: values.get('--file'), owner: requiredOwner(values.get('--owner')) };
}

function requiredOwner(value) {
  const owner = typeof value === 'string' ? value.trim() : '';
  if (!owner) {
    throw new Error('A non-empty owner Meta user ID is required.');
  }
  return owner;
}

function validateExport(exported) {
  if (!exported || typeof exported !== 'object' || exported.schemaVersion !== 1 || !Array.isArray(exported.templates)) {
    throw new Error('Migration file must use schemaVersion 1 with a templates array.');
  }

  const templates = exported.templates.map(validateTemplate);
  if (new Set(templates.map((template) => template.id)).size !== templates.length) {
    throw new Error('Migration file must not contain duplicate template IDs.');
  }
  const pageIds = new Set(templates.map((template) => template.pageId));
  const defaultTemplates = templates.filter((template) => template.isDefault);
  if (defaultTemplates.length !== pageIds.size
    || new Set(defaultTemplates.map((template) => template.pageId)).size !== pageIds.size) {
    throw new Error('Migration file must contain exactly one default template per Page.');
  }
  return templates;
}

function validateTemplate(template) {
  if (!template || typeof template !== 'object'
    || !nonEmptyString(template.id)
    || !nonEmptyString(template.pageId)
    || !nonEmptyString(template.name)
    || !template.template
    || typeof template.template !== 'object'
    || Array.isArray(template.template)
    || typeof template.isDefault !== 'boolean'
    || !Number.isFinite(template.createdAt)
    || !Number.isFinite(template.updatedAt)) {
    throw new Error('Migration file contains malformed template JSON.');
  }
  return {
    id: template.id,
    pageId: template.pageId,
    name: template.name,
    template: template.template,
    isDefault: template.isDefault,
    createdAt: template.createdAt,
    updatedAt: template.updatedAt
  };
}

function nonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}

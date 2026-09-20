import test from 'node:test';
import assert from 'node:assert/strict';
import { createSqliteDatabase } from '../src/db.js';
import { exportTemplates } from '../scripts/export-conversation-templates.js';
import { importTemplates } from '../scripts/import-conversation-templates.js';

function createDestinationDatabase() {
  const templates = new Map();
  const batchCalls = [];

  return {
    batchCalls,
    async importConversationTemplates(ownerMetaUserId, inputs) {
      batchCalls.push({ ownerMetaUserId, inputs });
      const defaultTemplates = inputs.filter((template) => template.isDefault);
      for (const input of inputs) {
        templates.set(input.id, { ...input, ownerMetaUserId });
      }
      for (const defaultTemplate of defaultTemplates) {
        for (const template of templates.values()) {
          if (template.ownerMetaUserId === ownerMetaUserId && template.pageId === defaultTemplate.pageId) {
            template.isDefault = template.id === defaultTemplate.id;
          }
        }
      }
    },
    async listConversationTemplates(ownerMetaUserId) {
      return [...templates.values()].filter((template) => template.ownerMetaUserId === ownerMetaUserId);
    }
  };
}

test('export removes the old app-scoped owner and import assigns the new owner', async () => {
  const sourceDatabase = createSqliteDatabase(':memory:');
  sourceDatabase.upsertConnection({
    metaUserId: 'old-meta-user',
    metaUserName: 'Old Meta User',
    accessTokenCiphertext: 'encrypted-token',
    now: 1
  });
  sourceDatabase.createConversationTemplate({
    id: 'stable-template-id',
    ownerMetaUserId: 'old-meta-user',
    pageId: 'page-id',
    name: 'Template name',
    template: { message: { text: 'Hello' } },
    now: 10
  });
  sourceDatabase.createConversationTemplate({
    id: 'secondary-template-id',
    ownerMetaUserId: 'old-meta-user',
    pageId: 'page-id',
    name: 'Secondary template',
    template: { message: { text: 'Secondary' } },
    now: 20
  });
  sourceDatabase.setDefaultConversationTemplate({
    id: 'stable-template-id',
    ownerMetaUserId: 'old-meta-user',
    pageId: 'page-id'
  });

  const exported = await exportTemplates(sourceDatabase, 'old-meta-user');
  assert.equal(exported.schemaVersion, 1);
  assert.equal(exported.templates.length, 2);
  assert.equal('ownerMetaUserId' in exported.templates[0], false);
  assert.equal(JSON.stringify(exported).includes('encrypted-token'), false);

  const destinationDatabase = createDestinationDatabase();
  await importTemplates(destinationDatabase, 'new-meta-user', exported);
  await importTemplates(destinationDatabase, 'new-meta-user', exported);
  const imported = await destinationDatabase.listConversationTemplates('new-meta-user');

  assert.equal(imported.length, exported.templates.length);
  assert.equal(imported.every((template) => template.ownerMetaUserId === 'new-meta-user'), true);
  assert.equal(imported.filter((template) => template.isDefault).length, 1);
  assert.equal(destinationDatabase.batchCalls.length, 2);
  assert.equal(destinationDatabase.batchCalls.every((call) => call.inputs.length === exported.templates.length), true);
});

test('import rejects unsafe migration documents before writing templates', async () => {
  const destinationDatabase = createDestinationDatabase();
  const template = {
    id: 'template-1',
    pageId: 'page-1',
    name: 'Template',
    template: { message: { text: 'Hello' } },
    isDefault: true,
    createdAt: 1,
    updatedAt: 2
  };

  await assert.rejects(importTemplates(destinationDatabase, '', { schemaVersion: 1, templates: [template] }), /owner/i);
  await assert.rejects(importTemplates(destinationDatabase, 'new-meta-user', { schemaVersion: 2, templates: [template] }), /schemaVersion/i);
  await assert.rejects(importTemplates(destinationDatabase, 'new-meta-user', {
    schemaVersion: 1,
    templates: [template, { ...template, id: 'template-2', isDefault: true }]
  }), /default/i);
  await assert.rejects(importTemplates(destinationDatabase, 'new-meta-user', {
    schemaVersion: 1,
    templates: [{ ...template, isDefault: false }]
  }), /default/i);
  await assert.rejects(importTemplates(destinationDatabase, 'new-meta-user', {
    schemaVersion: 1,
    templates: [template, { ...template }]
  }), /duplicate/i);
  await assert.rejects(importTemplates(destinationDatabase, 'new-meta-user', {
    schemaVersion: 1,
    templates: [{ ...template, template: '{not JSON}' }]
  }), /template/i);
  assert.equal((await destinationDatabase.listConversationTemplates('new-meta-user')).length, 0);
});

test('import accepts one default template for every exported Page', async () => {
  const destinationDatabase = createDestinationDatabase();
  const templates = ['page-1', 'page-2'].map((pageId, index) => ({
    id: `template-${index + 1}`,
    pageId,
    name: `Template ${index + 1}`,
    template: { message: { text: `Hello ${index + 1}` } },
    isDefault: true,
    createdAt: index + 1,
    updatedAt: index + 1
  }));

  const importedCount = await importTemplates(destinationDatabase, 'new-meta-user', {
    schemaVersion: 1,
    templates
  });

  assert.equal(importedCount, 2);
  assert.equal((await destinationDatabase.listConversationTemplates('new-meta-user'))
    .filter((template) => template.isDefault).length, 2);
});

test('SQLite batch import selects one default template per Page', () => {
  const database = createSqliteDatabase(':memory:');
  const templates = ['page-1', 'page-2'].map((pageId, index) => ({
    id: `template-${index + 1}`,
    pageId,
    name: `Template ${index + 1}`,
    template: { message: { text: `Hello ${index + 1}` } },
    isDefault: true,
    createdAt: index + 1,
    updatedAt: index + 1
  }));

  database.importConversationTemplates('owner-1', templates);

  assert.equal(database.listConversationTemplates('owner-1')
    .filter((template) => template.isDefault).length, 2);
});

test('SQLite batch import rejects a cross-owner template ID without changing either owner', () => {
  const database = createSqliteDatabase(':memory:');
  database.createConversationTemplate({
    id: 'stable-template-id',
    ownerMetaUserId: 'old-meta-user',
    pageId: 'page-id',
    name: 'Old template',
    template: { message: { text: 'Old' } },
    now: 1
  });

  assert.throws(() => database.importConversationTemplates('new-meta-user', [{
    id: 'stable-template-id',
    pageId: 'page-id',
    name: 'Migrated template',
    template: { message: { text: 'New' } },
    isDefault: true,
    createdAt: 10,
    updatedAt: 20
  }]), /owner/i);

  assert.deepEqual(database.getConversationTemplate('old-meta-user', 'stable-template-id'), {
    id: 'stable-template-id',
    ownerMetaUserId: 'old-meta-user',
    pageId: 'page-id',
    name: 'Old template',
    template: { message: { text: 'Old' } },
    isDefault: false,
    createdAt: 1,
    updatedAt: 1
  });
  assert.equal(database.getConversationTemplate('new-meta-user', 'stable-template-id'), null);
});

test('SQLite batch import rolls back all templates when one ID belongs to another owner', () => {
  const database = createSqliteDatabase(':memory:');
  database.createConversationTemplate({
    id: 'foreign-template-id',
    ownerMetaUserId: 'old-meta-user',
    pageId: 'page-id',
    name: 'Foreign template',
    template: { message: { text: 'Old' } },
    now: 1
  });

  assert.throws(() => database.importConversationTemplates('new-meta-user', [
    {
      id: 'safe-template-id',
      pageId: 'page-id',
      name: 'Safe template',
      template: { message: { text: 'Safe' } },
      isDefault: false,
      createdAt: 10,
      updatedAt: 20
    },
    {
      id: 'foreign-template-id',
      pageId: 'page-id',
      name: 'Conflicting template',
      template: { message: { text: 'Conflict' } },
      isDefault: true,
      createdAt: 10,
      updatedAt: 20
    }
  ]), /owner/i);

  assert.equal(database.getConversationTemplate('new-meta-user', 'safe-template-id'), null);
  assert.equal(database.getConversationTemplate('old-meta-user', 'foreign-template-id').name, 'Foreign template');
});

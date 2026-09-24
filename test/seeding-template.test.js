import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeSeedingTemplateInput,
  validateSeedingConfig
} from '../src/seeding-template.js';

test('normalizes one to ten seeding comments without Blob URLs', () => {
  const result = normalizeSeedingTemplateInput({
    name: 'Triệt nách nữ',
    items: [{
      id: 'item-1',
      message: 'Đăng ký tại https://lgclinic.vn',
      imageMediaId: 'media-1',
      imagePreviewUrl: 'blob:https://app/private-preview',
      blobUrl: 'r2://bucket/image.jpg',
      token: 'private-token'
    }]
  });

  assert.deepEqual(result.errors, []);
  assert.equal(result.name, 'Triệt nách nữ');
  assert.deepEqual(result.items, [{
    id: 'item-1',
    message: 'Đăng ký tại https://lgclinic.vn',
    imageMediaId: 'media-1'
  }]);
});

test('generates an item ID when the supplied ID is blank', () => {
  const result = normalizeSeedingTemplateInput({
    name: 'Triệt nách nữ',
    items: [{ id: ' ', message: 'Đăng ký ngay', imageMediaId: null }]
  });

  assert.deepEqual(result.errors, []);
  assert.notEqual(result.items[0].id, '');
});

test('reports invalid template names and item content with precise paths', () => {
  const result = normalizeSeedingTemplateInput({
    name: ' ',
    items: [{ id: 'item-1', message: '' }, { id: 'item-1', message: 'Có ảnh', imageMediaId: 'media-1' }]
  });

  assert.ok(result.errors.some((entry) => entry.path === 'name'));
  assert.ok(result.errors.some((entry) => entry.path === 'items.0'));
  assert.ok(result.errors.some((entry) => entry.path === 'items.1.id'));
});

test('requires complete selected seeding content regardless of the legacy enabled flag', () => {
  const disabledIssues = validateSeedingConfig({
    enabled: false,
    templateId: null,
    templateName: '',
    items: []
  }, 'campaigns.0.seeding');
  const enabledIssues = validateSeedingConfig({
    enabled: true,
    templateId: null,
    templateName: '',
    items: [{ id: 'item-1', message: '', imageMediaId: null }]
  }, 'campaigns.0.seeding');

  assert.ok(disabledIssues.some((entry) => entry.path === 'campaigns.0.seeding.templateId'));
  assert.ok(disabledIssues.some((entry) => entry.path === 'campaigns.0.seeding.templateName'));
  assert.ok(disabledIssues.some((entry) => entry.path === 'campaigns.0.seeding.items'));
  assert.ok(enabledIssues.some((entry) => entry.path === 'campaigns.0.seeding.templateId'));
  assert.ok(enabledIssues.some((entry) => entry.path === 'campaigns.0.seeding.templateName'));
  assert.ok(enabledIssues.some((entry) => entry.path === 'campaigns.0.seeding.items.0'));
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeCampaignPresetInput } from '../src/campaign-preset.js';

const audienceContent = {
  sourceAdAccountId: 'act_1',
  ageMin: 22,
  ageMax: 45,
  genders: [2],
  locales: [],
  includedRegions: [{ key: '3847', name: 'Ho Chi Minh City', type: 'region', countryCode: 'VN' }],
  excludedRegions: [],
  includedCities: [],
  excludedCities: [],
  includedCustomLocations: [],
  excludedCustomLocations: [],
  includedCustomAudienceIds: [],
  excludedCustomAudienceIds: [],
  detailedTargeting: [],
  advantageAudienceEnabled: false
};

const validInput = {
  name: '  Triệt bikini nữ  ',
  content: {
    campaignName: '  Campaign nữ  ',
    adSetName: '  No Target Nữ 22–45  ',
    audienceTemplateId: ' tool_audience_1 ',
    audienceTemplateName: ' Nữ làm đẹp 22–45 ',
    audienceContent,
    seedingTemplateId: ' seed-1 ',
    seedingTemplateName: ' Seeding nữ ',
    conversationTemplateId: ' conversation-1 ',
    conversationTemplateName: ' Tư vấn nữ '
  }
};

test('normalizes every required Campaign preset field', () => {
  assert.deepEqual(normalizeCampaignPresetInput(validInput), {
    name: 'Triệt bikini nữ',
    content: {
      campaignName: 'Campaign nữ',
      adSetName: 'No Target Nữ 22–45',
      audienceTemplateId: 'tool_audience_1',
      audienceTemplateName: 'Nữ làm đẹp 22–45',
      audienceContent,
      seedingTemplateId: 'seed-1',
      seedingTemplateName: 'Seeding nữ',
      conversationTemplateId: 'conversation-1',
      conversationTemplateName: 'Tư vấn nữ'
    },
    errors: []
  });
});

test('requires all names and linked template identifiers', () => {
  const normalized = normalizeCampaignPresetInput(null);
  assert.deepEqual(normalized.errors.map(({ path }) => path), [
    'name',
    'content.campaignName',
    'content.adSetName',
    'content.audienceTemplateName',
    'content.audienceContent',
    'content.seedingTemplateId',
    'content.seedingTemplateName',
    'content.conversationTemplateId',
    'content.conversationTemplateName'
  ]);
});

test('rejects invalid Campaign preset audience snapshots', () => {
  const normalized = normalizeCampaignPresetInput({
    ...validInput,
    content: {
      ...validInput.content,
      audienceContent: { ...audienceContent, ageMin: 70 }
    }
  });
  assert.ok(normalized.errors.some(({ path }) => path === 'content.audienceContent'));
});

test('rejects overlong names and template identifiers', () => {
  const normalized = normalizeCampaignPresetInput({
    ...validInput,
    name: 'x'.repeat(121),
    content: { ...validInput.content, seedingTemplateId: 's'.repeat(257) }
  });
  assert.ok(normalized.errors.some(({ path }) => path === 'name'));
  assert.ok(normalized.errors.some(({ path }) => path === 'content.seedingTemplateId'));
});

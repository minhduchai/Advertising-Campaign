import { validateAudienceTemplate } from './audience-template.js';

const MAX_NAME_LENGTH = 120;
const MAX_ID_LENGTH = 256;

export function normalizeCampaignPresetInput(input) {
  const source = input?.content && typeof input.content === 'object' ? input.content : {};
  const audienceTemplateName = text(source.audienceTemplateName);
  const normalized = {
    name: text(input?.name),
    content: {
      campaignName: text(source.campaignName),
      adSetName: text(source.adSetName),
      audienceTemplateId: optionalIdentifier(source.audienceTemplateId),
      audienceTemplateName,
      audienceContent: null,
      seedingTemplateId: identifier(source.seedingTemplateId),
      seedingTemplateName: text(source.seedingTemplateName),
      conversationTemplateId: identifier(source.conversationTemplateId),
      conversationTemplateName: text(source.conversationTemplateName)
    },
    errors: []
  };

  validateText(normalized.errors, 'name', normalized.name, 'Nhập tên cấu hình');
  validateText(normalized.errors, 'content.campaignName', normalized.content.campaignName, 'Nhập tên chiến dịch');
  validateText(normalized.errors, 'content.adSetName', normalized.content.adSetName, 'Nhập tên nhóm quảng cáo');
  validateOptionalIdentifier(normalized.errors, 'content.audienceTemplateId', normalized.content.audienceTemplateId);
  validateText(normalized.errors, 'content.audienceTemplateName', audienceTemplateName, 'Thiếu tên thiết lập đối tượng');
  normalizeAudienceContent(normalized, source.audienceContent, audienceTemplateName);
  validateIdentifier(normalized.errors, 'content.seedingTemplateId', normalized.content.seedingTemplateId, 'Chọn mẫu seeding');
  validateText(normalized.errors, 'content.seedingTemplateName', normalized.content.seedingTemplateName, 'Thiếu tên mẫu seeding');
  validateIdentifier(normalized.errors, 'content.conversationTemplateId', normalized.content.conversationTemplateId, 'Chọn mẫu cuộc trò chuyện');
  validateText(normalized.errors, 'content.conversationTemplateName', normalized.content.conversationTemplateName, 'Thiếu tên mẫu cuộc trò chuyện');
  return normalized;
}

function text(value) {
  return String(value ?? '').trim();
}

function identifier(value) {
  return text(value);
}

function optionalIdentifier(value) {
  return identifier(value) || null;
}

function normalizeAudienceContent(normalized, content, name) {
  if (!content || typeof content !== 'object' || Array.isArray(content)) {
    normalized.errors.push({
      path: 'content.audienceContent',
      message: 'Thiếu Thiết lập đối tượng'
    });
    return;
  }
  try {
    normalized.content.audienceContent = validateAudienceTemplate({
      name: name || 'Thiết lập đối tượng',
      content
    }).content;
  } catch (error) {
    normalized.errors.push({
      path: 'content.audienceContent',
      message: error.message
    });
  }
}

function validateText(errors, path, value, emptyMessage) {
  if (!value) {
    errors.push({ path, message: emptyMessage });
  } else if (value.length > MAX_NAME_LENGTH) {
    errors.push({ path, message: 'Nội dung tối đa 120 ký tự' });
  }
}

function validateIdentifier(errors, path, value, emptyMessage) {
  if (!value) {
    errors.push({ path, message: emptyMessage });
  } else if (value.length > MAX_ID_LENGTH) {
    errors.push({ path, message: 'ID mẫu tối đa 256 ký tự' });
  }
}

function validateOptionalIdentifier(errors, path, value) {
  if (value && value.length > MAX_ID_LENGTH) {
    errors.push({ path, message: 'ID mẫu tối đa 256 ký tự' });
  }
}

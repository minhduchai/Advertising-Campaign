export const MAX_SEEDING_MESSAGE_LENGTH = 8_000;
export const MAX_SEEDING_IMAGE_BYTES = 200 * 1024 * 1024;
export const SEEDING_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'video/mp4', 'video/quicktime']);

const MAX_SEEDING_TEMPLATE_NAME_LENGTH = 120;

export function normalizeSeedingTemplateInput(input) {
  const name = String(input?.name ?? '').trim();
  const sourceItems = Array.isArray(input?.items) ? input.items : [];
  const errors = [];

  if (!name) {
    errors.push(issue('name', 'Nhập tên mẫu seeding'));
  } else if (name.length > MAX_SEEDING_TEMPLATE_NAME_LENGTH) {
    errors.push(issue('name', 'Tên mẫu seeding tối đa 120 ký tự'));
  }
  if (sourceItems.length === 0) {
    errors.push(issue('items', 'Thêm ít nhất 1 bình luận seeding'));
  }

  const itemIds = new Set();
  const items = sourceItems.map((item, index) => {
    const path = `items.${index}`;
    const suppliedId = String(item?.id ?? '').trim();
    const id = suppliedId || globalThis.crypto.randomUUID();
    const message = String(item?.message ?? '');
    const imageMediaId = String(item?.imageMediaId ?? '').trim() || null;

    if (itemIds.has(id)) {
      errors.push(issue(`${path}.id`, 'ID bình luận seeding không được trùng'));
    }
    itemIds.add(id);
    if (message.length > MAX_SEEDING_MESSAGE_LENGTH) {
      errors.push(issue(`${path}.message`, 'Nội dung bình luận seeding tối đa 8000 ký tự'));
    }
    if (!message.trim() && !imageMediaId) {
      errors.push(issue(path, 'Mỗi bình luận seeding cần có nội dung hoặc media'));
    }

    return { id, message, imageMediaId };
  });

  return { name, items, errors };
}

export function validateSeedingConfig(seeding, path) {
  if (!seeding) return [];
  const issues = [];
  if (!String(seeding.templateId ?? '').trim()) {
    issues.push(issue(`${path}.templateId`, 'Chọn mẫu seeding'));
  }
  const templateName = String(seeding.templateName ?? '').trim();
  if (!templateName) {
    issues.push(issue(`${path}.templateName`, 'Tên mẫu seeding không được để trống'));
  } else if (templateName.length > MAX_SEEDING_TEMPLATE_NAME_LENGTH) {
    issues.push(issue(`${path}.templateName`, 'Tên mẫu seeding tối đa 120 ký tự'));
  }

  const items = Array.isArray(seeding.items) ? seeding.items : [];
  if (items.length === 0) {
    issues.push(issue(`${path}.items`, 'Thêm ít nhất 1 bình luận seeding'));
    return issues;
  }

  const itemIds = new Set();
  items.forEach((item, index) => {
    const itemPath = `${path}.items.${index}`;
    const id = String(item?.id ?? '').trim();
    const message = String(item?.message ?? '');
    const imageMediaId = String(item?.imageMediaId ?? '').trim();

    if (!id) {
      issues.push(issue(`${itemPath}.id`, 'ID bình luận seeding không được để trống'));
    } else if (itemIds.has(id)) {
      issues.push(issue(`${itemPath}.id`, 'ID bình luận seeding không được trùng'));
    }
    itemIds.add(id);
    if (message.length > MAX_SEEDING_MESSAGE_LENGTH) {
      issues.push(issue(`${itemPath}.message`, 'Nội dung bình luận seeding tối đa 8000 ký tự'));
    }
    if (!message.trim() && !imageMediaId) {
      issues.push(issue(itemPath, 'Mỗi bình luận seeding cần có nội dung hoặc media'));
    }
  });

  return issues;
}

function issue(path, message) {
  return { path, message };
}

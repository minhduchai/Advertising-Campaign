function defaultRandomId() {
  return globalThis.crypto.randomUUID();
}

const MESSAGE_TEXT_LIMIT = 640;
const BUTTON_TITLE_LIMIT = 20;
const BUTTON_LIMIT = 3;
const QUICK_REPLY_LIMIT = 5;
const DEFAULT_TEMPLATE_NAME = 'Dịch vụ triệt nách nữ';
const DEFAULT_GREETING = 'Xin chào {{user_full_name}}, LG Clinic đang có chương trình ưu đãi dịch vụ triệt nách nữ 10 buổi chỉ 400K (giá gốc: 3.5TR), Mình để lại thông tin để em tư vấn cho mình nhé <3';
const DEFAULT_BUTTON_URL = 'https://uudai.lgclinic.vn/dangkylieutrinh/?utm_source=FB-Đức&utm_medium=messenger&utm_campaign=Triệt Nách Nữ 400k';

export function createDefaultConversation(randomId = defaultRandomId) {
  return createBlankConversation(randomId, false);
}

export function createEmptyConversation(randomId = defaultRandomId) {
  return createBlankConversation(randomId, true);
}

function createBlankConversation(randomId, dirty) {
  return {
    sourceTemplateId: null,
    templateName: '',
    greeting: '',
    quickReplies: [],
    showBusinessPhoneNumber: false,
    businessPhoneNumber: '',
    imageMediaId: null,
    imagePreviewUrl: '',
    imageName: '',
    imageSize: 0,
    customerActions: [],
    dirty
  };
}

export function createFemaleUnderarmConversation(randomId = defaultRandomId) {
  const buttonId = randomId();
  return {
    sourceTemplateId: null,
    templateName: DEFAULT_TEMPLATE_NAME,
    greeting: DEFAULT_GREETING,
    quickReplies: [],
    showBusinessPhoneNumber: false,
    businessPhoneNumber: '',
    imageMediaId: null,
    imagePreviewUrl: '',
    imageName: '',
    imageSize: 0,
    customerActions: [{
      id: buttonId,
      label: 'Đăng Ký Ngay',
      type: 'OPEN_URL',
      value: DEFAULT_BUTTON_URL
    }],
    dirty: false
  };
}

export function cloneConversation(conversation) {
  return structuredClone(conversation);
}

export function applyConversationTemplate(ad, template) {
  ad.conversation = {
    ...cloneConversation(template.template),
    greeting: normalizeMetaConversationVariables(template.template?.greeting),
    sourceTemplateId: template.id,
    templateName: template.name,
    dirty: false
  };
  return ad.conversation;
}

export function isConversationModified(conversation, template) {
  if (!conversation || !template?.template) {
    return true;
  }
  return JSON.stringify(conversationContent(conversation))
    !== JSON.stringify(conversationContent(template.template));
}

export function conversationContent(conversation, templateName = conversation?.templateName ?? '') {
  return {
    sourceTemplateId: null,
    templateName,
    greeting: normalizeMetaConversationVariables(conversation?.greeting),
    quickReplies: cloneConversation(conversation?.quickReplies ?? []),
    showBusinessPhoneNumber: Boolean(conversation?.showBusinessPhoneNumber),
    businessPhoneNumber: conversation?.businessPhoneNumber ?? '',
    imageMediaId: conversation?.imageMediaId ?? null,
    imagePreviewUrl: conversation?.imagePreviewUrl ?? '',
    imageName: conversation?.imageName ?? '',
    imageSize: Number(conversation?.imageSize) || 0,
    customerActions: cloneConversation(conversation?.customerActions ?? [])
  };
}

export function conversationToMessageDocument(conversation) {
  const greeting = normalizeMetaConversationVariables(conversation?.greeting).trim();
  const quickReplies = (conversation?.quickReplies ?? []).map((reply) => ({
    content_type: 'text',
    title: String(reply?.title ?? '').trim(),
    payload: String(reply?.payload ?? '').trim()
  }));
  const buttons = (conversation?.customerActions ?? []).map((action) => {
    if (action?.type === 'OPEN_URL') {
      return {
        type: 'web_url',
        title: String(action?.label ?? '').trim(),
        url: normalizeWebUrlForOutput(action?.value)
      };
    }
    return {
      title: String(action?.label ?? '').trim(),
      type: 'postback',
      payload: String(action?.value ?? '').trim()
    };
  });

  const imageUrl = String(conversation?.imageUrl || conversation?.imagePreviewUrl || '').trim();
  const message = conversation?.imageMediaId && imageUrl
    ? {
        attachment: {
          type: 'template',
          payload: {
            template_type: 'generic',
            elements: [{
              title: greeting,
              image_url: imageUrl,
              ...(buttons.length > 0 ? { buttons } : {})
            }]
          }
        }
      }
    : buttons.length > 0
    ? {
        attachment: {
          type: 'template',
          payload: {
            template_type: 'button',
            text: greeting,
            buttons
          }
        }
      }
    : { text: greeting };
  if (quickReplies.length > 0) {
    message.quick_replies = quickReplies;
  }
  return { message };
}

export function formatConversationMessageJson(conversation) {
  return JSON.stringify(conversationToMessageDocument(conversation), null, 2);
}

export function parseConversationMessageJson(source, currentConversation, randomId = defaultRandomId) {
  let document;
  try {
    document = JSON.parse(String(source ?? ''));
  } catch (error) {
    throw conversationMessageError('json', formatJsonSyntaxError(error, source));
  }
  const conversation = messageDocumentToConversation(document, currentConversation, randomId);
  return {
    conversation,
    formattedJson: formatConversationMessageJson(conversation)
  };
}

export function messageDocumentToConversation(document, currentConversation, randomId = defaultRandomId) {
  assertPlainObject(document, 'root');
  assertAllowedKeys(document, new Set(['message']), 'root');
  const message = document.message;
  assertPlainObject(message, 'message');
  assertAllowedKeys(message, new Set(['attachment', 'text', 'quick_replies']), 'message');

  let greeting;
  let customerActions = [];
  if (message.attachment != null) {
    if (message.text != null) {
      throw conversationMessageError('message.text', 'Không dùng message.text cùng button template');
    }
    const attachment = message.attachment;
    assertPlainObject(attachment, 'message.attachment');
    assertAllowedKeys(attachment, new Set(['type', 'payload']), 'message.attachment');
    if (attachment.type !== 'template') {
      throw conversationMessageError('message.attachment.type', 'Giá trị bắt buộc là "template"');
    }
    const payload = attachment.payload;
    assertPlainObject(payload, 'message.attachment.payload');
    assertAllowedKeys(payload, new Set(['template_type', 'text', 'buttons']), 'message.attachment.payload');
    if (payload.template_type !== 'button') {
      throw conversationMessageError('message.attachment.payload.template_type', 'Chỉ hỗ trợ "button"');
    }
    greeting = requiredLimitedText(payload.text, 'message.attachment.payload.text', MESSAGE_TEXT_LIMIT);
    if (!Array.isArray(payload.buttons) || payload.buttons.length < 1 || payload.buttons.length > BUTTON_LIMIT) {
      throw conversationMessageError('message.attachment.payload.buttons', 'Thêm từ 1 đến 3 nút');
    }
    customerActions = payload.buttons.map((button, index) => parseButton(
      button,
      currentConversation?.customerActions?.[index],
      randomId,
      `message.attachment.payload.buttons.${index}`
    ));
  } else {
    greeting = requiredLimitedText(message.text, 'message.text', MESSAGE_TEXT_LIMIT);
  }

  const quickReplies = parseQuickReplies(
    message.quick_replies ?? [],
    currentConversation?.quickReplies ?? [],
    randomId
  );

  return {
    ...cloneConversation(currentConversation ?? {}),
    sourceTemplateId: currentConversation?.sourceTemplateId ?? null,
    templateName: currentConversation?.templateName ?? 'Mẫu Cuộc trò chuyện',
    greeting: normalizeMetaConversationVariables(greeting),
    quickReplies,
    showBusinessPhoneNumber: Boolean(currentConversation?.showBusinessPhoneNumber),
    businessPhoneNumber: currentConversation?.businessPhoneNumber ?? '',
    imageMediaId: currentConversation?.imageMediaId ?? null,
    imagePreviewUrl: currentConversation?.imagePreviewUrl ?? '',
    imageName: currentConversation?.imageName ?? '',
    imageSize: Number(currentConversation?.imageSize) || 0,
    customerActions,
    dirty: true
  };
}

export function normalizeMetaConversationVariables(value) {
  return String(value ?? '')
    .replaceAll('{{full_name}}', '{{user_full_name}}')
    .replaceAll('{fullname}', '{{user_full_name}}');
}

function parseButton(button, currentButton, randomId, path) {
  assertPlainObject(button, path);
  const title = requiredLimitedText(button.title, `${path}.title`, BUTTON_TITLE_LIMIT);
  const id = currentButton?.id ?? randomId();
  if (button.type === 'web_url') {
    assertAllowedKeys(button, new Set(['type', 'title', 'url']), path);
    return {
      id,
      label: title,
      type: 'OPEN_URL',
      value: normalizeHttpsUrl(button.url, `${path}.url`)
    };
  }
  if (button.type === 'postback') {
    assertAllowedKeys(button, new Set(['type', 'title', 'payload']), path);
    return {
      id,
      label: title,
      type: 'QUICK_REPLY',
      value: requiredLimitedText(button.payload, `${path}.payload`, 1000)
    };
  }
  throw conversationMessageError(`${path}.type`, 'Chỉ hỗ trợ "web_url" hoặc "postback"');
}

function parseQuickReplies(quickReplies, currentReplies, randomId) {
  if (!Array.isArray(quickReplies) || quickReplies.length > QUICK_REPLY_LIMIT) {
    throw conversationMessageError('message.quick_replies', 'Thêm tối đa 5 câu trả lời nhanh');
  }
  return quickReplies.map((reply, index) => {
    const path = `message.quick_replies.${index}`;
    assertPlainObject(reply, path);
    assertAllowedKeys(reply, new Set(['content_type', 'title', 'payload']), path);
    if (reply.content_type !== 'text') {
      throw conversationMessageError(`${path}.content_type`, 'Giá trị bắt buộc là "text"');
    }
    const id = currentReplies[index]?.id ?? randomId();
    return {
      id,
      title: requiredLimitedText(reply.title, `${path}.title`, BUTTON_TITLE_LIMIT),
      payload: requiredLimitedText(reply.payload, `${path}.payload`, 1000)
    };
  });
}

function normalizeWebUrlForOutput(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return '';
  const candidate = /^[a-z][a-z\d+.-]*:/i.test(raw) ? raw : `https://${raw}`;
  try {
    return new URL(candidate).toString();
  } catch {
    return candidate;
  }
}

function normalizeHttpsUrl(value, path) {
  const raw = String(value ?? '').trim();
  if (!raw) throw conversationMessageError(path, 'Nhập URL trang web');
  const candidate = /^[a-z][a-z\d+.-]*:/i.test(raw) ? raw : `https://${raw}`;
  let url;
  try {
    url = new URL(candidate);
  } catch {
    throw conversationMessageError(path, 'URL trang web không hợp lệ');
  }
  if (url.protocol !== 'https:') {
    throw conversationMessageError(path, 'URL phải dùng https://');
  }
  return url.toString();
}

function requiredLimitedText(value, path, maxLength) {
  const text = String(value ?? '').trim();
  if (!text) throw conversationMessageError(path, 'Nội dung không được để trống');
  if (text.length > maxLength) {
    throw conversationMessageError(path, `Nội dung tối đa ${maxLength} ký tự`);
  }
  return text;
}

function assertPlainObject(value, path) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw conversationMessageError(path, 'Giá trị phải là object JSON');
  }
}

function assertAllowedKeys(value, allowedKeys, path) {
  const unsupportedKey = Object.keys(value).find((key) => !allowedKeys.has(key));
  if (unsupportedKey) {
    throw conversationMessageError(`${path}.${unsupportedKey}`, 'Trường JSON chưa được hỗ trợ');
  }
}

function formatJsonSyntaxError(error, source) {
  const message = String(error?.message ?? 'JSON không hợp lệ');
  const position = Number(message.match(/position\s+(\d+)/i)?.[1]);
  if (!Number.isFinite(position)) return `JSON không hợp lệ: ${message}`;
  const prefix = String(source ?? '').slice(0, position);
  const line = prefix.split('\n').length;
  const column = position - prefix.lastIndexOf('\n');
  return `JSON không hợp lệ tại dòng ${line}, cột ${column}`;
}

function conversationMessageError(path, message) {
  const error = new Error(message);
  error.path = path;
  return error;
}

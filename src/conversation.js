import {
  conversationToMessageDocument,
  createDefaultConversation,
  createFemaleUnderarmConversation
} from '../public/conversation.js';

export { createDefaultConversation, createFemaleUnderarmConversation };
export { normalizeMetaConversationVariables } from '../public/conversation.js';
export { conversationToMessageDocument } from '../public/conversation.js';

export function validateConversation(conversation, path = 'conversation') {
  const issues = [];
  if (!conversation || typeof conversation !== 'object' || Array.isArray(conversation)) {
    return [issue(path, 'Thiết lập Cuộc trò chuyện không hợp lệ')];
  }

  validateRequiredText(conversation.templateName, `${path}.templateName`, 'Nhập tên mẫu Cuộc trò chuyện', 120, issues);
  validateRequiredText(
    conversation.greeting,
    `${path}.greeting`,
    'Nhập lời chào Cuộc trò chuyện',
    conversation.imageMediaId ? 80 : 640,
    issues
  );
  if (!Array.isArray(conversation.quickReplies) || conversation.quickReplies.length > 0) {
    issues.push(issue(`${path}.quickReplies`, 'Mẫu dùng chung không hỗ trợ câu trả lời nhanh'));
  }
  if (conversation.showBusinessPhoneNumber !== false) {
    issues.push(issue(`${path}.showBusinessPhoneNumber`, 'Mẫu dùng chung không hỗ trợ số điện thoại'));
  }

  validateCustomerActions(conversation.customerActions, path, issues);
  return issues;
}

export function buildPageWelcomeMessage(conversation, mediaKind) {
  const issues = validateConversation(conversation);
  if (issues.length > 0) {
    const error = new Error(issues.map((entry) => entry.message).join(' · '));
    error.issues = issues;
    throw error;
  }
  if (!['image', 'video'].includes(mediaKind)) {
    throw new Error('Loại media Cuộc trò chuyện không hợp lệ');
  }

  const message = conversationToMessageDocument(conversation).message;
  const customerActionType = 'buttons';

  return JSON.stringify({
    type: 'VISUAL_EDITOR',
    version: 2,
    landing_screen_type: 'welcome_message',
    media_type: 'text',
    text_format: {
      customer_action_type: customerActionType,
      message
    },
    image_format: {
      customer_action_type: customerActionType,
      message
    },
    video_format: {
      customer_action_type: customerActionType,
      message
    },
    user_edit: true,
    surface: 'visual_editor_new',
    phone_number: null,
    template_version: 2,
    is_call_prompt_enabled: false
  });
}

function validateCustomerActions(customerActions, path, issues) {
  if (!Array.isArray(customerActions)) {
    issues.push(issue(`${path}.customerActions`, 'Danh sách hành động khách hàng không hợp lệ'));
    return;
  }
  if (customerActions.length > 3) {
    issues.push(issue(`${path}.customerActions`, 'Thêm tối đa 3 nút mở trang web'));
  }
  customerActions.forEach((action, index) => {
    const actionPath = `${path}.customerActions.${index}`;
    validateRequiredText(action?.label, `${actionPath}.label`, 'Nhập nhãn hành động', 20, issues);
    if (action?.type !== 'OPEN_URL') {
      issues.push(issue(`${actionPath}.type`, 'Chỉ hỗ trợ nút mở trang web'));
      return;
    }
    if (!isHttpsUrl(action.value)) {
      issues.push(issue(`${actionPath}.value`, 'URL hành động phải là địa chỉ https:// tuyệt đối'));
    }
  });
}

function validateRequiredText(value, path, missingMessage, maxLength, issues) {
  const text = String(value ?? '').trim();
  if (!text) {
    issues.push(issue(path, missingMessage));
  } else if (text.length > maxLength) {
    issues.push(issue(path, `Nội dung tối đa ${maxLength} ký tự`));
  }
}

function isHttpsUrl(value) {
  try {
    const raw = String(value ?? '').trim();
    const candidate = /^[a-z][a-z\d+.-]*:/i.test(raw) ? raw : `https://${raw}`;
    return new URL(candidate).protocol === 'https:';
  } catch {
    return false;
  }
}

function issue(path, message) {
  return { path, message };
}

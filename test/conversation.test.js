import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildPageWelcomeMessage,
  conversationToMessageDocument,
  createDefaultConversation,
  createFemaleUnderarmConversation,
  normalizeMetaConversationVariables,
  validateConversation
} from '../src/conversation.js';

function idSequence(...ids) {
  let index = 0;
  return () => ids[index++];
}

function validConversation(overrides = {}) {
  return {
    sourceTemplateId: null,
    templateName: 'Mẫu tư vấn',
    greeting: 'Chào bạn, chúng tôi có thể giúp gì?',
    quickReplies: [],
    showBusinessPhoneNumber: false,
    businessPhoneNumber: '',
    customerActions: [{
      id: 'a1',
      label: 'Đăng ký ngay',
      type: 'OPEN_URL',
      value: 'https://example.test/dang-ky'
    }],
    ...overrides
  };
}

test('creates a blank default conversation for a new Ad', () => {
  const conversation = createDefaultConversation(idSequence('button-1'));

  assert.equal(conversation.sourceTemplateId, null);
  assert.equal(conversation.templateName, '');
  assert.equal(conversation.greeting, '');
  assert.deepEqual(conversation.quickReplies, []);
  assert.equal(conversation.showBusinessPhoneNumber, false);
  assert.deepEqual(conversation.customerActions, []);
  assert.equal(conversation.dirty, false);
});

test('creates the shared female underarm treatment conversation', () => {
  const conversation = createFemaleUnderarmConversation(idSequence('button-1'));

  assert.equal(conversation.sourceTemplateId, null);
  assert.equal(conversation.templateName, 'Dịch vụ triệt nách nữ');
  assert.equal(conversation.greeting, 'Xin chào {{user_full_name}}, LG Clinic đang có chương trình ưu đãi dịch vụ triệt nách nữ 10 buổi chỉ 400K (giá gốc: 3.5TR), Mình để lại thông tin để em tư vấn cho mình nhé <3');
  assert.deepEqual(conversation.quickReplies, []);
  assert.equal(conversation.showBusinessPhoneNumber, false);
  assert.deepEqual(conversation.customerActions, [{
    id: 'button-1',
    label: 'Đăng Ký Ngay',
    type: 'OPEN_URL',
    value: 'https://uudai.lgclinic.vn/dangkylieutrinh/?utm_source=FB-Đức&utm_medium=messenger&utm_campaign=Triệt Nách Nữ 400k'
  }]);
});

test('builds a Visual Editor welcome-message with one button-template JSON', () => {
  const serialized = buildPageWelcomeMessage(validConversation(), 'image');
  const value = JSON.parse(serialized);

  assert.equal(value.type, 'VISUAL_EDITOR');
  assert.equal(value.version, 2);
  assert.equal(value.landing_screen_type, 'welcome_message');
  assert.equal(value.media_type, 'text');
  assert.deepEqual(value.image_format.message, {
    attachment: {
      type: 'template',
      payload: {
        template_type: 'button',
        text: 'Chào bạn, chúng tôi có thể giúp gì?',
        buttons: [{
          type: 'web_url',
          title: 'Đăng ký ngay',
          url: 'https://example.test/dang-ky'
        }]
      }
    }
  });
  assert.equal(value.surface, 'visual_editor_new');
  assert.equal(value.phone_number, null);
  assert.equal(value.is_call_prompt_enabled, false);
});

test('allows zero to three HTTPS web buttons', () => {
  const issues = validateConversation(validConversation({
    customerActions: [
      { id: 'a1', label: '', type: 'OPEN_URL', value: 'http://example.test' },
      { id: 'a2', label: 'Không hợp lệ', type: 'QUICK_REPLY', value: 'x' },
      { id: 'a3', label: 'Nút 3', type: 'OPEN_URL', value: 'https://example.test/3' },
      { id: 'a4', label: 'Nút 4', type: 'OPEN_URL', value: 'https://example.test/4' }
    ]
  }), 'conversation');

  assert.ok(issues.some((issue) => issue.path === 'conversation.customerActions'));
  assert.ok(issues.some((issue) => issue.path === 'conversation.customerActions.0.label'));
  assert.ok(issues.some((issue) => issue.path === 'conversation.customerActions.0.value'));
  assert.ok(issues.some((issue) => issue.path === 'conversation.customerActions.1.type'));
});

test('accepts a conversation without web buttons', () => {
  const issues = validateConversation(validConversation({ customerActions: [] }), 'conversation');
  assert.deepEqual(issues.filter((issue) => issue.path === 'conversation.customerActions'), []);
});

test('normalizes legacy fullname variables to user_full_name', () => {
  assert.equal(
    normalizeMetaConversationVariables('Xin chào {fullname} / {{full_name}}'),
    'Xin chào {{user_full_name}} / {{user_full_name}}'
  );
});

test('builds a generic template with an image and optional web buttons', () => {
  const conversation = validConversation({
    greeting: 'Ưu đãi dành riêng cho bạn',
    imageMediaId: 'media-1',
    imageUrl: 'https://cdn.example.test/conversation.jpg',
    customerActions: []
  });

  assert.deepEqual(conversationToMessageDocument(conversation), {
    message: {
      attachment: {
        type: 'template',
        payload: {
          template_type: 'generic',
          elements: [{
            title: 'Ưu đãi dành riêng cho bạn',
            image_url: 'https://cdn.example.test/conversation.jpg'
          }]
        }
      }
    }
  });
});

test('limits image conversation greetings to 80 characters', () => {
  const issues = validateConversation(validConversation({
    greeting: 'a'.repeat(81),
    imageMediaId: 'media-1'
  }), 'conversation');

  assert.ok(issues.some((issue) => issue.path === 'conversation.greeting'));
});

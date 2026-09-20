import {
  conversationContent,
  createFemaleUnderarmConversation
} from '../public/conversation.js';

export const SHARED_CONVERSATION_OWNER_ID = '__shared_conversation_library__';
export const SHARED_CONVERSATION_PAGE_ID = '__shared__';
export const SHARED_CONVERSATION_SEED_ID = 'shared-conversation-female-underarm';
export const SHARED_CONVERSATION_SEED_MIGRATION = '2026-08-13-shared-conversation-library-seed';

export function createSharedConversationSeed(now = Date.now()) {
  const conversation = createFemaleUnderarmConversation(() => 'shared-register-button');
  return {
    id: SHARED_CONVERSATION_SEED_ID,
    ownerMetaUserId: SHARED_CONVERSATION_OWNER_ID,
    pageId: SHARED_CONVERSATION_PAGE_ID,
    name: conversation.templateName,
    template: conversationContent(conversation, conversation.templateName),
    isDefault: true,
    createdAt: now,
    updatedAt: now
  };
}

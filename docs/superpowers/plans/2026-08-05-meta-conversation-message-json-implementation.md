# Meta Conversation Message JSON Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a safe two-way **Biểu mẫu / JSON nâng cao** editor for Messenger conversation messages and embed its canonical message in Meta's existing Visual Editor wrapper.

**Architecture:** Keep the normalized conversation snapshot as the only publishable data. Add pure message-document adapters in `public/conversation.js`, reuse them from server validation/serialization, and keep raw JSON drafts only in per-Ad UI state until the user applies them successfully.

**Tech Stack:** Node.js ES modules, browser-native JavaScript, server-rendered HTML strings, CSS, Meta Marketing API Visual Editor `page_welcome_message`.

## Global Constraints

- JSON editing boundary is `{ message }`, never the complete Visual Editor wrapper.
- Supported attachment template is `template_type: "button"` with one to three `web_url` or `postback` buttons.
- Preserve `{{full_name}}` literally.
- Prefix missing URL schemes with `https://`; reject explicit non-HTTPS URLs.
- Keep quick replies at zero to five and preserve business-phone settings outside JSON.
- Invalid or unapplied JSON never mutates the conversation, persists as a template, or reaches Meta.
- Campaigns, Ad Sets, and Ads remain `PAUSED`.
- The user explicitly requested no automated test execution for this delivery; perform syntax and local browser checks only.
- The repository has no `.git` directory; do not create commits.

---

### Task 1: Canonical Message Adapters

**Files:**
- Modify: `public/conversation.js`
- Modify: `src/conversation.js`

**Interfaces:**
- Produces: `conversationToMessageDocument(conversation): { message: object }`
- Produces: `formatConversationMessageJson(conversation): string`
- Produces: `messageDocumentToConversation(document, currentConversation, randomId?): object`
- Produces: `parseConversationMessageJson(source, currentConversation, randomId?): { conversation, formattedJson }`
- Consumes later: renderer and event handlers use the public adapters; server publisher uses the canonical message object.

- [ ] **Step 1: Add browser-safe normalization helpers**

Implement pure helpers that trim strings, preserve list IDs by index, generate IDs for new items, and normalize a missing URL scheme:

```js
function normalizeWebUrl(value) {
  const raw = String(value ?? '').trim();
  const candidate = /^[a-z][a-z\d+.-]*:/i.test(raw) ? raw : `https://${raw}`;
  const url = new URL(candidate);
  if (url.protocol !== 'https:') throw messageIssue('message.attachment.payload.buttons.url', 'URL phải dùng https://');
  return url.toString();
}
```

- [ ] **Step 2: Serialize form state to `{ message }`**

Map `greeting` to `payload.text`, `OPEN_URL` to `web_url`, `QUICK_REPLY` to `postback`, and optional quick replies to `message.quick_replies`. When there are no customer actions, emit a backward-compatible plain `message.text` document.

```js
export function conversationToMessageDocument(conversation) {
  const quickReplies = mapQuickReplies(conversation.quickReplies);
  const buttons = mapButtons(conversation.customerActions);
  const message = buttons.length
    ? { attachment: { type: 'template', payload: { template_type: 'button', text: greeting, buttons } } }
    : { text: greeting };
  if (quickReplies.length) message.quick_replies = quickReplies;
  return { message };
}
```

- [ ] **Step 3: Parse JSON into a new conversation**

Require a root `message` object, accept either the button-template shape or the plain-text compatibility shape, validate exact supported button fields, and return a new snapshot that preserves `sourceTemplateId`, `templateName`, phone fields, and prior list IDs where possible.

- [ ] **Step 4: Strengthen server validation and wrapper serialization**

Change server limits to text `640`, button title `20`, buttons `3`, quick replies `0–5`, and quick-reply title `20`. Build the canonical message through `conversationToMessageDocument()` and insert the same message into `text_format`, `image_format`, and `video_format`; retain phone and Visual Editor metadata.

---

### Task 2: JSON Editor UI

**Files:**
- Modify: `public/state.js`
- Modify: `public/workspace.js`
- Modify: `public/app.css`

**Interfaces:**
- Consumes: `formatConversationMessageJson(conversation)` from Task 1.
- Produces UI state: `state.ui.conversationJsonEditors[adClientId] = { tab, draft, dirty, error }`.
- Produces controls: `set-conversation-tab`, `apply-conversation-json`, `reset-conversation-json`, and `data-role="conversation-json"`.

- [ ] **Step 1: Add isolated per-Ad editor state**

Initialize `conversationJsonEditors: {}` under `state.ui`. Each entry defaults to `{ tab: 'form', draft: '', dirty: false, error: null }`; raw JSON never belongs in `state.draft`.

- [ ] **Step 2: Render Form and JSON tabs**

Keep the existing builder under **Biểu mẫu**. Add **JSON nâng cao** with a monospace textarea, status/error region, **Áp dụng JSON**, and **Khôi phục từ biểu mẫu**. The displayed source is the dirty draft or freshly formatted conversation JSON.

- [ ] **Step 3: Mark template actions unsafe while JSON is unapplied**

Disable save/update controls when the selected Ad has `dirty === true` or `error`, and show `JSON chưa được áp dụng` beside the tab.

- [ ] **Step 4: Style the editor without changing workspace layout**

Add compact tab buttons, a minimum `360px` JSON textarea, clear invalid/valid states, responsive action wrapping, and preserve existing desktop/mobile panels.

---

### Task 3: Two-Way Interaction and Publish Gate

**Files:**
- Modify: `public/app.js`

**Interfaces:**
- Consumes: `formatConversationMessageJson()` and `parseConversationMessageJson()` from Task 1.
- Consumes: controls emitted by Task 2.
- Produces: no-rerender JSON typing, atomic Apply/Reset, and client validation issues that block save/publish.

- [ ] **Step 1: Handle JSON typing without rerender**

In the workspace `input` listener, update only the matching editor entry's `draft`, `dirty`, and `error`; return before `render()` or server validation so focus and scroll remain stable.

- [ ] **Step 2: Add tab, Apply, and Reset actions**

`set-conversation-tab` switches views. `apply-conversation-json` parses into a temporary result, replaces `ad.conversation` only on success, clears dirty/error state, renders, then validates. `reset-conversation-json` discards the raw draft and regenerates from the current form snapshot.

- [ ] **Step 3: Keep form changes synchronized**

After `updateConversationControl()`, regenerate the editor JSON only when no unapplied draft exists. Template selection/new/default application must reset the matching JSON editor to the normalized snapshot.

- [ ] **Step 4: Block unsafe template and publish actions**

Before save/update, return with a toast if the selected editor is dirty or invalid. Extend `validateCurrentDraft()` with one path-based client issue per unapplied/invalid JSON editor so the top publish button stays disabled before `/api/runs` can be called.

- [ ] **Step 5: Preserve the completed account-resource race guard**

Retain `createAccountResourceRequestGate`, account-change invalidation, requested-account capture, and stale success/error/finally checks already present in `public/app.js` and `public/state.js`.

---

### Task 4: Documentation and Local Handoff

**Files:**
- Modify: `README.md`

**Interfaces:**
- Documents: message-only JSON boundary, automatic HTTPS normalization, supported limits, local template behavior, and unchanged `PAUSED` safety.

- [ ] **Step 1: Update usage documentation**

Add a short section showing **Biểu mẫu / JSON nâng cao**, explain that the app wraps the message into `page_welcome_message`, and state that arbitrary full-wrapper JSON is intentionally rejected.

- [ ] **Step 2: Perform non-test syntax checks**

Run `node --check` on modified JavaScript files only. Do not run `npm test` or `node --test` because the user explicitly reserved behavioral testing for themselves.

- [ ] **Step 3: Refresh the existing local app**

Keep `http://localhost:3001/` running, reload the selected browser tab, verify the two tabs and JSON editor render, and never click the publish button.

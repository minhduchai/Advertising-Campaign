# Meta Conversation Message JSON — Design

## Status

Approved in conversation on 2026-08-05.

## Goal

Add an advanced JSON view to each Ad's **Cuộc trò chuyện** editor while retaining the existing friendly form. The form and JSON must convert in both directions, saved Page-scoped templates must continue to work, and the publisher must still create every Campaign, Ad Set, and Ad in `PAUSED` state.

The advanced editor owns only the Messenger `message` document shown to the user. The application remains responsible for wrapping that message in the existing Meta Ads `page_welcome_message` Visual Editor envelope.

## Approved UX

The **Cuộc trò chuyện** section has two tabs:

1. **Biểu mẫu** — the existing visual fields and preview.
2. **JSON nâng cao** — a formatted JSON textarea, validation result, **Áp dụng JSON**, and **Khôi phục từ biểu mẫu** actions.

Form changes regenerate the normalized JSON whenever there is no unapplied JSON draft. Editing the textarea keeps an isolated draft and does not mutate the Ad. **Áp dụng JSON** parses and validates the entire draft; only a fully valid document updates the form and conversation snapshot. Invalid JSON remains in the textarea with an actionable error and the prior conversation remains unchanged.

The JSON tab edits this boundary:

```json
{
  "message": {
    "attachment": {
      "type": "template",
      "payload": {
        "template_type": "button",
        "text": "Xin chào {{full_name}}, chúng tôi có thể giúp gì?",
        "buttons": [
          {
            "title": "Đăng Ký Ngay",
            "type": "web_url",
            "url": "https://example.com/dang-ky"
          }
        ]
      }
    }
  }
}
```

The application never exposes the full Visual Editor wrapper for manual editing.

## Supported Message Schema

The primary supported shape is a Messenger button template:

- Root must be an object containing exactly one required `message` object.
- `message.attachment.type` must be `template`.
- `message.attachment.payload.template_type` must be `button`.
- `payload.text` maps to the form greeting.
- `payload.buttons` accepts one to three supported buttons.
- `message.quick_replies` is optional and maps to the existing quick-reply form.

Supported buttons:

- `web_url`: `{ "type": "web_url", "title": "...", "url": "..." }`
- `postback`: `{ "type": "postback", "title": "...", "payload": "..." }`

For backward compatibility, a conversation with no customer-action buttons serializes as a plain text message with optional `quick_replies`. Applying JSON that uses the button-template shape still requires one to three buttons.

Unknown attachment templates, button types, executable fields, or arbitrary Visual Editor wrapper fields are rejected rather than silently discarded.

## Normalization Rules

- Preserve `{{full_name}}` and other text literally; the local preview does not substitute recipient data.
- If a `web_url` value has no URI scheme, prefix `https://` before validation.
- Explicit `http://` and all non-HTTPS schemes are rejected.
- Normalize surrounding whitespace from button titles, URLs, payloads, and message text.
- Preserve existing local IDs for list items by position where possible; generate stable local IDs for newly introduced JSON items.
- Pretty-print accepted JSON with two-space indentation.

App limits remain intentionally conservative:

- Message text: 1–640 characters.
- Button title: 1–20 characters.
- Buttons: 1–3 in a button template.
- Quick replies: 0–5.
- Quick-reply title: 1–20 characters.

An older local template that exceeds these limits is never truncated silently. The editor shows the exact validation issue and requires correction before that template can be saved again or published.

Business-phone fields remain form-only and stay in the Visual Editor wrapper. Applying message JSON must not clear them.

## Internal Data Model

The normalized conversation snapshot remains the source of truth for publishing and saved templates:

```js
{
  sourceTemplateId,
  templateName,
  greeting,
  quickReplies,
  showBusinessPhoneNumber,
  businessPhoneNumber,
  customerActions,
  dirty
}
```

Two pure adapters isolate the JSON boundary:

- `conversationToMessageDocument(conversation)` returns the normalized `{ message }` document.
- `messageDocumentToConversation(document, currentConversation, createId)` validates and returns a new conversation without mutating the current snapshot.

The UI stores only transient editor state per selected Ad: active tab, raw JSON draft, dirty state, and parse/validation error. Raw invalid JSON is never persisted as a template and never reaches the server.

## Data Flow

### Form to JSON

1. User changes a form field.
2. Existing conversation state updates.
3. The adapter regenerates normalized `{ message }` JSON unless an unapplied JSON draft exists.
4. Preview and validation continue to use the normalized conversation snapshot.

### JSON to Form

1. User edits the isolated JSON draft.
2. User clicks **Áp dụng JSON**.
3. Parser reports syntax errors with line and column when available.
4. Schema validator reports a precise field path for semantic errors.
5. On success, the adapter creates a new conversation snapshot, preserves form-only phone settings and template identity, marks the conversation dirty, then refreshes form, JSON, and preview.

### Saved Templates

Page-scoped template CRUD remains unchanged. Templates store normalized conversation snapshots. Selecting a template regenerates the JSON view; saving or updating a template is blocked while the JSON draft is invalid or unapplied.

### Meta Publish

The server never trusts browser-generated wrapper JSON. It validates the normalized conversation again, builds the canonical `{ message }` document, then embeds its `message` value into the existing `VISUAL_EDITOR` version 2 `page_welcome_message` envelope for text, image, and video formats.

The creative publishing workflow remains unchanged. Campaigns, Ad Sets, and Ads continue to be created in `PAUSED`; Ad Creatives do not expose a delivery-status field.

## Error Handling

- Syntax error: show `JSON không hợp lệ` plus line/column when derivable.
- Schema error: show the exact path, for example `message.attachment.payload.buttons.0.url`.
- Invalid Apply: preserve both the raw draft and the previous valid conversation.
- Unapplied draft: visibly mark the JSON tab and block template save/update and publish validation.
- Server validation: reject unsupported or out-of-limit conversation data before creating a run or making any Meta write.
- Meta error: retain current code, subcode, message, and trace handling.

## Testing

Add focused tests for:

1. Form conversation → exact button-template `{ message }` JSON.
2. User sample JSON → normalized conversation, including automatic `https://` prefix.
3. Round trip preserves text, supported buttons, quick replies, phone settings, and template identity.
4. Invalid JSON and invalid schema do not mutate the prior conversation.
5. Limits for text, button title/count, quick replies, and HTTPS URLs.
6. Saved Page template round trip regenerates the same semantic JSON.
7. Image and video creatives contain the canonical message inside `page_welcome_message`.
8. Unapplied/invalid JSON blocks save and publish before Meta writes.
9. JSON typing does not rerender the editor or reset its scroll/focus.
10. Full regression confirms every Campaign, Ad Set, and Ad remains `PAUSED`.

## Non-Goals

- Editing the complete `page_welcome_message` Visual Editor envelope.
- Arbitrary Messenger templates such as generic carousels, receipts, media templates, or nested unsupported attachments.
- Synchronizing local templates with Ads Manager's native saved-message library.
- Expanding `{{full_name}}` locally or fetching recipient information.
- Activating campaigns, ad sets, or ads.

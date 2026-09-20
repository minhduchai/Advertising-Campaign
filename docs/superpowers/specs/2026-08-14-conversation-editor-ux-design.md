# Conversation Editor UX Design

## Goal

Make the existing Messenger conversation editor easier to scan and edit without changing its data model, actions, validation, or publishing behavior.

## Approved Structure

- **Channel header:** A compact Messenger identity row with channel title, short helper copy, and the existing `PAUSED-safe` badge.
- **Template library:** A collapsible shared-template panel. Its summary shows the current template state and a clear "Mở thư viện" affordance. The library opens when there is no selected template or the current Campaign copy differs from the selected template; otherwise it stays compact.
- **Composer:** A two-column desktop layout. The left column contains template name, greeting, web-button cards, and the collapsed JSON preview. The right column contains the existing Messenger preview.
- **Web buttons:** Each button is a bordered card with a compact header and two fields (label and URL) arranged side by side on wide screens.
- **Preview:** A contained Messenger-like card with a stable header, message bubble, action buttons, and composer footer.
- **Responsive behavior:** Below 900px, composer columns stack in source order so editing remains usable on narrower screens.

## Boundaries

- Preserve all existing `data-*` attributes and action names.
- Preserve the existing `conversation` object shape and all CRUD behavior.
- Use existing color, spacing, radius, and typography variables from `public/app.css`.
- Add no new dependency and no backend change.

## Verification

- Add renderer assertions for the new semantic classes, collapsed JSON details, library auto-open state, and preview placement.
- Run targeted workspace tests, build, and the full suite.
- Reload localhost and inspect an Ad editor with both empty and populated conversation actions.


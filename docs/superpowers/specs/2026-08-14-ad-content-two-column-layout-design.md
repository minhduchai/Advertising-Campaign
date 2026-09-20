# Ad Content Two-Column Layout Design

## Goal

Rearrange the existing "Nội dung quảng cáo" editor so text inputs appear on the left and the media upload/preview appears on the right, matching the approved sketch.

## Approved Layout

- Keep the existing section heading, shared-creative notice, controls, and behavior.
- Use a two-column grid with a `40% / 60%` proportion.
- Left column: "Văn bản chính" textarea, followed by the "Tiêu đề" input.
- Right column: the existing image/video upload and preview component.
- Stretch the media area to the height of the two-field left column where practical.
- Do not add a mobile or single-column variant for this block. It remains two columns at all viewport widths.

## Implementation Boundaries

- Reorder only the markup inside `.creative-layout` in `public/workspace.js`.
- Add narrowly scoped `.creative-layout` rules in `public/app.css`.
- Preserve upload actions, preview behavior, field bindings, validation, and publishing behavior.
- Do not modify backend publication or media handling.

## Verification

- Add a rendering test that proves the text field stack appears before the upload control in the HTML.
- Add a CSS assertion for the approved `40% / 60%` grid.
- Run the targeted workspace test, the build, and the full test suite.
- Reload `http://localhost:3001/` and visually confirm the left/right layout.


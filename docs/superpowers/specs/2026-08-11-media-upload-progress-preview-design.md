# Media Upload Progress and Preview Design

## Goal

Make image and video uploads visibly trustworthy inside the Ad editor. The user must see real upload progress, know when the upload succeeds, and be able to inspect the uploaded creative without leaving the app.

## Scope

- Show real upload percentage for local uploads and Vercel Blob uploads.
- Show an image thumbnail for JPEG, PNG, and WebP files.
- Show a playable preview for MP4 files.
- Show the file name, formatted file size, and a clear success state.
- Keep the previous creative intact when a replacement upload fails.
- Preserve the existing 200 MB limit and accepted media types.

## Non-Goals

- Persisting browser object URLs across a page refresh.
- Generating server-side video posters or transcoded video variants.
- Adding pause, resume, or upload cancellation controls.
- Publishing anything to Meta during upload verification.

## Existing Behavior

The browser creates an object URL before upload, but only assigns it to the Ad after the request succeeds. The editor always renders the preview with an `img` element, so MP4 previews do not work. Upload APIs do not currently expose progress to the editor.

## User Experience

### Empty State

The media panel shows the existing upload prompt and accepted file guidance.

### Uploading State

Immediately after file selection:

- The selected image or video preview appears.
- A progress overlay shows a bar and a numeric value from `0%` to `100%`.
- The file name and formatted size are visible.
- The file input is disabled so a second upload cannot overlap the first.
- Progress updates do not rerender the entire editor or change its scroll position.

### Success State

- Images render through an `img` element with descriptive alternative text.
- Videos render through `video controls muted playsinline preload="metadata"` so the user can inspect playback.
- A success badge displays `Đã tải lên` with the file name and size.
- A separate `Thay file` control remains available and does not cover video controls.

### Failure State

- The newly created object URL is revoked.
- The previous media ID, preview, kind, name, and size remain unchanged.
- The upload control becomes available again.
- The existing toast system displays the server or network error.

## State Model

Stable Ad data gains:

- `mediaFileName`: the successfully uploaded source file name.
- `mediaFileSize`: the successfully uploaded source file size in bytes.

Transient UI data gains a `mediaUploads` map keyed by Ad client ID. Each entry contains:

- `status`: `uploading`.
- `progress`: a normalized integer from 0 through 100.
- `previewUrl`: the temporary browser object URL.
- `kind`: `image` or `video` inferred from the selected file MIME type.
- `fileName` and `fileSize`.

Transient upload state is removed after success or failure. A successful upload transfers its preview and metadata to the Ad. Draft publication continues to use only `mediaId` and `mediaKind`.

## Upload Data Flow

1. The editor validates that a file and Ad exist.
2. It creates an object URL and records transient upload state at `0%`.
3. `api.uploadMedia` receives an `onProgress` callback.
4. In production, `src/client/blob-upload-entry.js` forwards the callback to Vercel Blob's `onUploadProgress` option.
5. In local mode, an `XMLHttpRequest` upload listener reports `loaded / total` while preserving multipart form boundaries.
6. Progress updates mutate only the matching progress DOM nodes.
7. On success, the editor detaches a shared creative, replaces stable media fields, clears transient state, and validates the draft.
8. On failure, the editor clears transient state, revokes only the failed preview URL, and preserves the previous creative.

## Rendering Structure

The media panel becomes a container instead of one full-area file label. It contains:

- A visually hidden file input.
- An empty-state label when no preview exists.
- An `img` or `video` preview selected from the media kind.
- A progress overlay while uploading.
- A success footer and a dedicated replacement label after success.

Separating the replacement control from the preview prevents the invisible file input from blocking video playback controls.

## Accessibility

- Upload progress uses `role="progressbar"` with `aria-valuemin`, `aria-valuemax`, and `aria-valuenow`.
- Upload status text uses a polite live region.
- File inputs remain reachable through their associated labels.
- Video controls remain keyboard and pointer accessible.
- Success is communicated with text and an icon, not color alone.

## Error and Concurrency Rules

- Only one upload may run per Ad at a time.
- Progress values are clamped and rounded to integers.
- A stale callback may update only its own Ad upload entry.
- Media fields change only after server metadata registration succeeds.
- Replacing media revokes the previous browser object URL only after the replacement succeeds.

## Testing

- Client API tests verify local XHR progress and Vercel Blob callback forwarding.
- State/render tests verify default media metadata and image/video markup.
- Interaction tests verify progress wiring, success assignment, failure rollback, and shared-creative detachment timing.
- Build and syntax checks cover generated Blob client output.
- Browser smoke testing verifies the percentage, successful image preview, playable video markup, and unchanged editor scroll without creating Meta objects.

## Acceptance Criteria

1. Selecting an accepted file immediately shows its preview and `0%` or the first measured progress value.
2. Upload percentage increases from real transport events and reaches `100%` on success.
3. A successful image displays a thumbnail.
4. A successful MP4 displays a playable video preview.
5. Success displays the file name, file size, and `Đã tải lên`.
6. Failed replacement uploads leave the previous media unchanged.
7. Video controls are clickable and are not covered by the file input.
8. Uploading does not scroll the Ad editor to the top.

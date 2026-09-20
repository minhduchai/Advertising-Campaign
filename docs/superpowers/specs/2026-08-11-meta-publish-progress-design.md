# Meta Publish Progress Design

## Goal

Show real, object-level progress inside the Meta creation log as Campaigns, Ad Sets, and Ads are created. The user must know how much work is complete, which object is currently being processed, and whether the run finished successfully without relying on a simulated timer.

## Approved Experience

- Open the existing `Nhật ký tạo quảng cáo Meta` dialog immediately after the user clicks the Meta creation button and client validation succeeds.
- Display progress only inside this dialog, not inside the publish button.
- Show a numeric percentage, a progress bar, `Đã xử lý X/Y đối tượng`, and the name/type of the object currently being created.
- Pre-populate every Campaign, Ad Set, and Ad as `Chờ xử lý` in draft hierarchy order.
- Update each row live through `Chờ xử lý` → `Đang tạo` → `Thành công`, `Thất bại`, or `Đã bỏ qua`.
- Keep the publish button disabled while the run is active so one click cannot create duplicate Meta objects.
- Leave all created Meta objects in the existing `PAUSED` state.

## Progress Semantics

The progress unit is one Meta object represented by a draft node:

- One Campaign counts as one unit.
- One Ad Set counts as one unit.
- One Ad counts as one unit.

`total` is calculated from the validated draft before publication. A node is complete only when its status is `created`, `failed`, or `skipped`. `pending` and `creating` nodes do not count as complete.

The displayed percentage is:

`completed === total ? 100 : floor(completed terminal nodes / total nodes * 100)`

This prevents `100%` from appearing while any object is still active. It also makes the percentage deterministic and truthful at the resolution the Meta publishing flow exposes. A failed parent and all children subsequently marked `skipped` still advance the run to 100%, because every planned object has reached a terminal outcome.

## Architecture

Use a streamed NDJSON response from the existing `POST /api/runs` request. The request remains open while the current publisher executes, so it is safe for the deployed Vercel runtime and does not depend on an in-process background task surviving after an HTTP response ends.

The browser opts into streaming with `Accept: application/x-ndjson`. Requests without that header retain the existing final JSON response for backward compatibility.

The stream emits one JSON object per line:

1. `run_started` with the persisted run ID and total node count.
2. `node_updated` whenever the publisher reports `creating`, `created`, `failed`, or `skipped`.
3. `run_completed` with the final run status and final node collection.
4. `run_failed` only for an unexpected run-level failure after streaming has started.

Headers disable caching and proxy buffering where supported. The server flushes the initial stream event before starting Meta publication.

## Server Responsibilities

### Run Creation

The existing authorization, draft validation, media ownership, Page access, and publication-context checks continue before Meta objects are created. Conventional JSON error responses remain available until streaming begins.

After those checks:

- Create the run with status `creating`.
- Start the NDJSON response and emit `run_started`.
- Persist every publisher node update before emitting the corresponding `node_updated` event.
- Update the run to `completed` or `completed_with_errors` after all nodes reach terminal states.
- Emit `run_completed` and end the response.
- If an unexpected error escapes the publisher, mark the run `failed`, emit a normalized `run_failed` event, and end the response without creating a second run.

### Run Recovery Endpoint

Add owner-scoped `GET /api/runs/:runId` using the existing database `getRun` capability.

- Return `404` when the run does not exist or belongs to another Meta user, so the endpoint does not reveal another user's run IDs.
- Return the run status and persisted node results for the connected owner.
- Never expose access tokens, Page tokens, media bytes, or draft content.

This endpoint is a recovery path for interrupted progress display, not a trigger for publishing.

## Client State

Add transient publication progress state containing:

- `runId`: persisted server run ID once received.
- `status`: `preparing`, `creating`, `completed`, `completed_with_errors`, or `failed`.
- `total`: total draft nodes.
- `completed`: terminal node count.
- `percent`: normalized integer from 0 through 100.
- `currentClientId`: the node currently in `creating` state, when present.
- `nodes`: one merged entry per draft node, initially `pending`.

This state is not stored in the editable draft and does not affect draft validation or Meta payloads.

## Client Data Flow

1. Validate the current draft.
2. Build ordered `pending` result rows from the Campaign hierarchy and set progress to `0%`.
3. Open the result dialog and render `Đang kiểm tra dữ liệu và quyền truy cập` while waiting for the first server event.
4. Call the streaming publish API with an event callback.
5. Merge each `node_updated` event by node type and local client ID rather than appending duplicate rows.
6. Recalculate terminal count and percentage after every update.
7. Update only the progress elements and affected result content without scrolling the editor or dialog back to the top.
8. On `run_completed`, force the verified terminal result to `100%`, display the existing completion message, and re-enable publishing.

The stream parser must support JSON lines split across arbitrary network chunks and multiple lines delivered in one chunk. A malformed event ends progress tracking with a clear error and never retries the publish request.

## Connection Recovery

If the stream disconnects after `run_started` supplied a run ID:

- Keep the dialog open and show `Đang khôi phục trạng thái`.
- Poll `GET /api/runs/:runId` at a short fixed interval.
- Merge persisted node states with the same progress calculation.
- Stop polling when the run is terminal.
- After a bounded series of consecutive failures, show that tracking was interrupted and instruct the user not to click publish again until the run status is checked.

If the request fails before a run ID is received, display the normalized request error and re-enable the publish button. The client must never automatically resend `POST /api/runs`, because doing so could duplicate Meta objects.

## Result Dialog

Add a compact progress block below the dialog title and above the result rows:

- Large percentage text.
- Horizontal progress bar using the existing blue accent.
- `Đã xử lý X/Y đối tượng` summary.
- Current activity text such as `Đang tạo Nhóm quảng cáo: Nhóm remarketing`.

Result rows gain a `pending` visual state labeled `Chờ xử lý`. Existing colors and labels remain for `creating`, `created`, `failed`, and `skipped`. The dialog body remains scrollable while its title and progress summary stay visible.

When complete:

- `completed` shows a success summary.
- `completed_with_errors` shows a warning summary while preserving individual Meta errors.
- `failed` shows a run-level error without hiding any node results already received.

## Accessibility

- Use `role="progressbar"` with `aria-valuemin`, `aria-valuemax`, and live `aria-valuenow`.
- Announce major state changes through a polite live region without announcing every percentage point.
- Communicate status through text and icons in addition to color.
- Keep the dialog close control keyboard accessible. Closing the dialog hides it but does not cancel or duplicate an active run.

## Error and Concurrency Rules

- Only one publication run may be active in the current browser state.
- Duplicate node events replace the previous state for that node and never increase the total.
- Terminal node states are idempotent; repeated recovery responses cannot push progress above 100%.
- A `creating` event may change the current activity label but not the completed count.
- Server persistence happens before stream emission so recovery never goes backward after a confirmed event.
- Closing or reopening the result dialog does not reset active progress.
- No automatic cancellation is introduced because Meta objects already created cannot be rolled back safely as one transaction.

## Testing

- Publisher integration tests verify the stream event order and terminal updates for success, parent failure, skipped children, and mixed Ad failures.
- Request-handler tests verify NDJSON headers/events, legacy JSON compatibility, run-level error emission, and owner-scoped run recovery.
- Client API tests verify chunk-split NDJSON parsing, multiple events per chunk, JSON validation errors, malformed stream handling, and recovery requests.
- State tests verify total calculation, node merging, terminal counting, idempotency, and the 100% result for mixed outcomes.
- Workspace render tests verify pending rows, progress accessibility attributes, current-object text, and completed/error summaries.
- Interaction tests verify immediate dialog opening, disabled duplicate submission, live updates without scroll resets, recovery polling, and publish-button restoration.
- Final verification uses mocked Meta calls; it must not create real Campaigns, Ad Sets, Ads, posts, or media.

## Acceptance Criteria

1. Clicking the Meta creation button opens the log immediately at `0%` after client validation succeeds.
2. The log displays the exact total number of Campaign, Ad Set, and Ad objects in the submitted draft.
3. Rows update live as the server starts and finishes each object.
4. Percentage advances only when objects reach `created`, `failed`, or `skipped`.
5. A fully processed run reaches `100%` even when some objects fail or are skipped.
6. The user can identify the object currently being created.
7. The publish button cannot start a second run while the first run is active.
8. A dropped stream with a known run ID recovers from persisted results without resending the publish request.
9. Existing Meta errors, local IDs, remote IDs, and post IDs remain visible in the result rows.
10. Progress updates do not move the Campaign, Ad Set, or Ad editor scroll position.

## Non-Goals

- Estimating progress inside one individual Meta API request.
- Displaying elapsed time or an estimated completion time.
- Cancelling or rolling back a partially completed Meta run.
- Resuming an unknown run after a full page refresh when the browser did not retain its run ID.
- Adding a historical run-management screen.
- Changing campaign structure, creative-sharing behavior, budgets, targeting, or Meta publication status.

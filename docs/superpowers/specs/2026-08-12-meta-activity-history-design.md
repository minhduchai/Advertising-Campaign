# Meta Activity History Design

## Goal

Add a read-only, owner-scoped history of Meta publication runs. Reports persist indefinitely, support date-range filtering, preserve the submitted Campaign → Ad Set → Ad configuration, and show each Ad name, Meta IDs, Post ID, and Reel permalink when Meta exposes one.

## Approved Experience

- Add `Lịch sử hoạt động` to the top bar.
- Open a separate history drawer instead of mixing old reports with the live publication log.
- Filter by inclusive `Từ ngày` and `Đến ngày`, with an action to clear the filter.
- List newest runs first with date/time, ad account, run status, object totals, and success/failure totals.
- Expand one run into Campaign → Ad Set → Ad details.
- Show Ad name, Meta ID, Post ID, and `Mở bài Reel` in a new tab when a permalink exists.
- Retain reports indefinitely and load them incrementally.
- Keep legacy runs visible with `Dữ liệu cũ chưa đầy đủ`; never invent missing names or Reel links.

## Data Model

`runs` stores `ad_account_id`, an immutable JSON snapshot, `created_at`, and `completed_at`. `node_results` stores the node name and permalink in addition to existing status, Meta ID, Post ID, and error data. Existing rows remain valid because every new column is nullable.

The snapshot contains only report data from the submitted draft and selected media/Page metadata. It never stores access tokens, Page access tokens, Blob URLs, or media bytes.

## Reel Permalink

After an Ad is created, the publisher asks Meta for its creative story identity and then requests the story `permalink_url`. This is best-effort reporting: failure to resolve a permalink does not change a successfully created Ad into a failed Ad. Linked Ads that share a creative may share the same Post ID and permalink.

## API

- `GET /api/runs?from=<epoch>&to=<epoch>&limit=<n>&offset=<n>` lists owner-scoped run summaries.
- `GET /api/runs/:runId` returns the owner-scoped report detail.
- `POST /api/runs` keeps its current publication behavior.

Date bounds are validated server-side. `to` is exclusive internally so an inclusive end-date filter includes the whole selected local day. Lists are newest-first and return `nextOffset` only when more data exists.

## Error and Security Rules

- A disconnected session cannot list history.
- Missing and foreign run IDs both return `404`.
- A permalink lookup error is omitted from the report and does not fail publication.
- Legacy rows return a `legacy: true` marker and their available node data.
- Every response excludes encrypted tokens, media storage locations, and private media content.

## Testing

- Database contracts cover snapshots, node names/permalinks, owner-scoped date filtering, pagination, and legacy rows.
- Publisher tests cover successful permalink capture, shared creative links, and non-fatal permalink lookup errors.
- Route tests cover authentication, date validation, listing, detail, and owner isolation.
- Client tests cover API encoding, history rendering, filters, pagination, legacy labels, and safe external Reel links.
- Production verification must not create real Meta objects.


# Shared Ad Creative Duplication Design

## Goal

Let users duplicate an Ad Set or Ad from its three-dot menu while intentionally reusing the same Meta ad creative. Duplicated Ads can therefore point to one effective Facebook post and share reactions, comments, and social proof across different Ad Sets.

## Approved Interaction Model

- Add `Thêm nhóm quảng cáo tương tự` to every Ad Set three-dot menu.
- Add `Thêm quảng cáo tương tự` to every Ad three-dot menu.
- Duplicating an Ad Set deep-copies the complete Ad Set and every Ad inside it.
- Duplicating an Ad copies it into the same parent Ad Set.
- Every copied Campaign descendant receives a new local `clientId` and a copy-style name.
- Copied Ads initially reuse the same creative group as their source Ads.
- Editing creative-defining content on one copied Ad automatically detaches only that Ad and gives it a private creative group.
- Editing targeting, budget, schedule, bid, age, gender, audience, or location does not detach the shared creative.
- Selecting either duplicate action closes the menu, expands the parent Campaign, selects the new copy, focuses its tree row, and runs the existing draft validation.

## Menu Structure

The Campaign menu remains unchanged. Ad Set and Ad menus become:

| Node | Actions |
| --- | --- |
| Campaign | `Thêm chiến dịch mới`, `Xóa chiến dịch` |
| Ad Set | `Thêm nhóm quảng cáo mới`, `Thêm nhóm quảng cáo tương tự`, `Xóa nhóm quảng cáo` |
| Ad | `Thêm quảng cáo mới`, `Thêm quảng cáo tương tự`, `Xóa quảng cáo` |

Duplicate actions target the row on which the menu was opened rather than the current editor selection. Their payload therefore carries the source node's `clientId`.

## Duplication Semantics

### Ad Set Duplication

`duplicateAdSet(state, sourceAdSetId, randomId)` finds the source and parent Campaign, deep-copies all editable Ad Set fields, and deep-copies every child Ad.

- The copied Ad Set receives a new `clientId`.
- Every copied Ad receives a new `clientId`.
- Each copied Ad preserves its source Ad's `creativeGroupId`.
- Media IDs and conversation snapshots are reused by value; nested arrays and objects are deep-copied so later edits do not mutate the source.
- The copy is inserted immediately after the source Ad Set.
- The copy name uses ` - Bản sao`, then ` - Bản sao 2`, and so on when needed among siblings.

If the source Ad Set contains multiple Ads, each copied Ad shares only with its corresponding source creative group. Unrelated source Ads are never merged into one group.

### Ad Duplication

`duplicateAd(state, sourceAdId, randomId)` deep-copies the source Ad into the same Ad Set.

- The copy receives a new `clientId`.
- The copy preserves the source `creativeGroupId`.
- The copy is inserted immediately after the source Ad.
- The same copy-name convention is applied among sibling Ads.

## Creative Group State

Every Ad owns a `creativeGroupId` string.

- A newly created Ad receives a new group ID, so normal `Thêm quảng cáo mới` behavior remains independent.
- A duplicated Ad preserves its source group ID.
- Existing drafts without a group ID are normalized to a new private group before editing or publishing.
- A creative group is an identity value, not a pointer to a source Ad. Deleting the original Ad therefore does not break any remaining copies.

The Ad editor shows `Đang dùng chung bài quảng cáo với N quảng cáo` when more than one current Ad has the same group ID and compatible creative content. No badge is shown for a private group.

## Automatic Detachment

The following changes assign a new `creativeGroupId` to the edited Ad before applying the change:

- Primary text.
- Headline.
- Image or video media ID.
- Publication mode.
- Any conversation-template field, quick reply, customer action, greeting, JSON snapshot, or saved-template application.

Changing an Ad Set's Facebook Page assigns new private group IDs to every Ad inside that edited Ad Set. Other Ad Set changes do not affect creative sharing.

Changing only an Ad's internal name does not detach it because the name is not part of the Facebook post shown to users.

The client performs detachment for immediate and understandable UI behavior. The server also computes a defensive creative signature from Page ID, publication mode, media, primary text, headline, and conversation data. Ads are reused only when both `creativeGroupId` and the signature match, preventing stale or externally edited drafts from sharing the wrong creative.

## Publisher Flow

Each publish run owns an in-memory creative artifact cache. The cache key combines:

1. Ad account.
2. `creativeGroupId`.
3. Defensive creative signature.

The first Ad in a key uploads the media, creates the Meta creative, creates the source Meta Ad, and stores its remote Ad ID. Later Ads with the same key are created through Meta's `/{source_ad_id}/copies` edge into their target Ad Sets with `status_option=PAUSED`. This makes the similarity action explicit at Meta level instead of assuming that separate Ad creation calls will preserve one effective post.

Normal `ThÃªm quáº£ng cÃ¡o má»›i` Ads retain private creative groups and are always created independently. If a similarity copy fails, publishing reports that Ad as failed and does not fall back to a fresh Ad creation that would silently create another post ID. The copy flow still supports different targeting, budgets, schedules, and placements because the copied Ad is attached to its target Ad Set.

If shared creative creation fails, every linked Ad receives the same normalized failure without repeatedly creating the same creative. If one Meta Ad creation fails after the shared creative exists, later linked Ads still reuse that creative and can succeed independently.

For `PUBLIC_TEST`, the shared artifact also owns the public `postId`. Cleanup is deferred until all linked Ads have been attempted: keep the post if at least one linked Ad succeeds, and delete it only when none succeed. Default dark-post publishing reuses the creative without publishing the post on the Page timeline.

## Compatibility and Validation

- A creative is never reused across different Facebook Pages because Page ID participates in the signature.
- Different content, media, conversation settings, or publication modes cannot share one creative even if malformed client state contains the same group ID.
- Draft validation continues to require valid media, Page, conversation, targeting, and budget fields for every copied node.
- Existing drafts remain publishable because missing group IDs fall back to private groups.
- The API accepts and preserves `creativeGroupId` as non-secret draft metadata; it is never sent directly to Meta.

## Accessibility and Feedback

- Duplicate menu items remain ordinary keyboard-focusable buttons within the existing action group.
- `Escape`, outside click, and action completion retain the current menu-close behavior.
- The shared-post badge is text, not color-only status.
- Duplicate actions use the same focus restoration pattern as normal add actions.
- Names identify copies without requiring the user to inspect hidden IDs.

## Testing

- State tests prove Ad duplication creates a new local ID, deep-copies nested data, preserves the creative group, inserts after the source, selects the copy, and expands the parent Campaign.
- State tests prove Ad Set duplication deep-copies all child Ads with new IDs while preserving each source Ad's creative group.
- State tests prove source deletion does not invalidate copies.
- State tests prove creative edits and Page changes detach the affected Ads, while names, targeting, and budgets do not.
- Workspace render tests cover both new menu labels, source-node payloads, copy naming, and the shared-post badge/count.
- Client interaction tests cover action routing, menu closure, focus restoration, default application behavior, and validation.
- Publisher tests prove four linked Ads create one media upload and one creative but four Meta Ad objects.
- Publisher tests prove mismatched signatures never reuse a creative, one Ad failure does not block later linked Ads, and shared creative failures are not retried per Ad.
- Public Test tests cover shared post reuse and deferred cleanup.
- Final verification runs focused tests, the full project test command, client build, production deployment, health check, and a browser smoke test without publishing real Meta objects.

## Out of Scope

- Duplicating an entire Campaign.
- Duplicating nodes into another Campaign or ad account.
- Manually merging unrelated existing Ads into one creative group.
- Synchronizing creative edits across all linked Ads.
- Fetching or displaying the Facebook permalink for the effective post.
- Dynamic creative, catalog, or placement-specific asset variants.

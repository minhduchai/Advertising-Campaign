# Campaign Tree Menus, Collapse, and Region-Only Targeting Design

## Goal

Make the campaign hierarchy compact enough for many campaigns, turn every decorative three-dot mark into a real action menu, and remove nationwide targeting so every Ad Set explicitly targets Vietnamese provinces/cities.

## Approved Interaction Model

- Move add and delete actions for Campaigns, Ad Sets, and Ads into the three-dot menu on each tree row.
- Keep the single `+` button in the tree header as the global shortcut for adding a Campaign.
- Remove the exposed `+ Thêm nhóm quảng cáo`, `+ Thêm quảng cáo`, and editor-footer add/delete buttons.
- Clicking a Campaign row both selects that Campaign and toggles all descendants between expanded and collapsed.
- Clicking an Ad Set or Ad row only selects it.
- Creating a Campaign collapses all older Campaigns, expands the new Campaign, and selects it.
- Only Campaigns are collapsible; Ad Sets do not have an independent collapse state.
- Remove the `Toàn Việt Nam` option. Every Ad Set uses province/city targeting and must include at least one valid Vietnamese Meta region before publishing.
- Province/city exclusions remain available, but an exclusion never removes the requirement for at least one included region.

## Tree Structure

Each tree node becomes a semantic row rather than one large button. The row contains:

1. A primary node button for selection and Campaign collapse.
2. A separate three-dot menu button with an accessible label such as `Tùy chọn Chiến dịch tháng 8`.
3. A compact menu rendered next to the row when open.

The menu actions depend on node type:

| Node | Add action | Delete action |
| --- | --- | --- |
| Campaign | Thêm chiến dịch mới | Xóa chiến dịch |
| Ad Set | Thêm nhóm quảng cáo mới | Xóa nhóm quảng cáo |
| Ad | Thêm quảng cáo mới | Xóa quảng cáo |

Add actions create a sibling at the same hierarchy level. Ad Set siblings use the same parent Campaign; Ad siblings use the same parent Ad Set. Delete actions keep the existing confirmation guard and explicitly warn when children will also be deleted.

Only one node menu can be open. Clicking outside, pressing `Escape`, selecting a menu item, or selecting another node closes it. Clicking the three-dot button must not select or collapse the underlying Campaign.

## Collapse State

Campaign collapse state lives in `state.ui.collapsedCampaignIds` as an array of Campaign client IDs. State helpers own all mutations so render code only reads state.

- `toggleCampaignCollapsed(state, campaignId)` toggles one valid Campaign.
- `addCampaign` records all existing Campaign IDs as collapsed before appending the new expanded Campaign.
- Adding or selecting a child ensures its parent Campaign is expanded.
- Removing a Campaign also removes its ID from collapse state.
- A collapsed Campaign row exposes `aria-expanded="false"` and omits its child subtree from rendered HTML.
- An expanded Campaign row exposes `aria-expanded="true"` and renders its Ad Sets and Ads.

Campaign selection still opens the Campaign editor. The same click also changes expansion state, matching the approved whole-row interaction.

## Region-Only Targeting

New Ad Sets default to `locationMode: 'REGIONS'`. The location editor no longer renders mode cards or dispatches a `set-location-mode` action. It always shows:

- Province/city search.
- Search results from Meta restricted to Vietnamese `region` results.
- Included provinces/cities.
- Excluded provinces/cities.

Draft validation accepts only `REGIONS` and requires `includedRegions.length >= 1`. Publisher targeting always sends `geo_locations.regions` and optionally `excluded_geo_locations.regions`; it no longer falls back to `countries: ['VN']`.

Existing in-memory `COUNTRY` values are treated as invalid rather than silently targeting nationwide. The validation message tells the user to choose at least one Vietnamese province/city.

## Visual Treatment

The existing compact Meta-inspired design remains. Changes are intentionally restrained:

- Replace the decorative `•••` span with a real square icon button.
- Use a small white menu with border, subtle shadow, and clear hover/focus states.
- Display delete actions in red and add actions in the normal text color.
- Show a compact disclosure indicator on Campaign rows.
- Preserve current node colors, typography, density, responsive drawers, and keyboard focus treatment.

## Error Handling and Accessibility

- Ignore menu actions whose parent node no longer exists.
- Keep destructive confirmation before every delete.
- Menu buttons expose `aria-haspopup="menu"` and `aria-expanded`.
- Menus use `role="menu"`; actions use `role="menuitem"`.
- `Escape` closes the node menu before handling workspace drawers.
- Region validation blocks the PAUSED publish button until at least one included province/city is selected.

## Testing

- State tests cover default region mode, Campaign toggle behavior, automatic collapse when adding a Campaign, parent expansion when adding/selecting descendants, and collapse cleanup after deletion.
- Workspace render tests cover accessible three-dot menus for all node types, sibling action payloads, removal of exposed add/delete buttons, collapsed child omission, and Campaign `aria-expanded` values.
- Client interaction tests cover menu open/close behavior, whole-row Campaign toggle behavior, and menu clicks not toggling the Campaign.
- Draft tests reject `COUNTRY`, require one included Vietnamese region, and verify generated Meta targeting contains regions rather than countries.
- CSS assertions cover menu positioning, focus treatment, and destructive styling.
- Final verification runs focused tests, the client build, production deployment, health check, and a browser smoke test without creating Meta Campaign, Ad Set, or Ad objects.

## Out of Scope

- Drag-and-drop hierarchy reordering.
- Duplicating Campaigns, Ad Sets, or Ads.
- Independent Ad Set collapse state.
- Bulk selection or bulk deletion.
- Nationwide targeting or automatic selection of all Vietnamese provinces/cities.

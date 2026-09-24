# Website events tracking

Added the compact “Sự kiện trên trang web” checkbox under “Theo dõi” in the ad editor. It defaults to off. Enabling it reveals a Meta Pixel input with account-specific suggestions from `/adspixels?fields=id,name`; discovery failures leave manual ID entry available without blocking audience resource loading. The option belongs to each ad, persists with drafts, and is copied when duplicating ads. It does not split a shared creative.

When enabled, a positive numeric Pixel ID is required before publishing. IDs remain strings. Ad creation includes `tracking_specs: [{"action.type":["offsite_conversion"],"fb_pixel":["<selected ID>"]}]`. Disabled and legacy drafts omit this parameter. Both initial publication and retries use the existing `buildAdParams` path. This configures ad measurement using an existing Pixel; it does not install website event collection.

Validation: all 793 tests pass. Three new regression tests cover enabled/disabled payloads, invalid and long IDs, progress validation, draft restoration, copying without creative changes, rendered controls, and account-specific Pixel lookup. An existing API response assertion was updated for the added Pixel resource fields.

Browser QA used the actual app with synthetic local API responses: checked the option, entered a Pixel ID, reloaded and observed the checked state and retained ID, inspected layout, and unchecked it. No real ads were created. Live Meta acceptance and actual website event delivery have not been exercised.

Primary references: [Meta Ad schema](https://github.com/facebook/facebook-python-business-sdk/blob/main/facebook_business/adobjects/ad.py) and [ConversionActionQuery schema](https://github.com/facebook/facebook-python-business-sdk/blob/main/facebook_business/adobjects/conversionactionquery.py). Meta developer documentation could not be fetched during this session.

Production deployment: application server at https://advertisingserver.tailac4f15.ts.net. Verified all five changed public assets match local bytes and /api/health returns ok:true.

## Fixed Pixel follow-up
User requested the screenshot configuration be fixed for every ad: Pixel 657921569053875, website events always enabled. Shared public/website-tracking.js now defines the ID. New ads and restored local drafts adopt it; UI displays checked disabled checkbox and readonly Pixel; server ad creation and retry payloads always use this ID even for legacy or conflicting draft fields. Updated tests verify these cases; all 793 pass. This supersedes the optional selection behavior above.

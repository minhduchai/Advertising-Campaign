# Saved audience age and location fidelity — 2026-09-11

User reference: LG Clinic 25, `Đức_Notaget_Nữ_Thủ Đức`. The supplied Ads Manager screenshot shows Advantage+ enabled, a minimum-age control of 18, a suggested age range of 18–45, female gender, and two included locations with an 8 km radius each (Đặng Văn Bi, Thủ Đức and a coordinate pin displayed approximately as 10.85, 106.76).

## Changes

- Read `age_range` in saved targeting, keeping Advantage+ minimum-age controls separate from age suggestions. Preserve the enabled state instead of rendering/sending Advantage+ off unconditionally.
- Preserve fractional radii and kilometer/mile units through normalization, application, tool-template copies, validation, and the outgoing targeting payload. Maps convert miles to meters for the actual circle.
- Use `address_string` for unnamed address pins; preserve both pins. Reject missing coordinates before numeric conversion. A city with no radius stays city-only rather than acquiring an invented 8 km radius.
- Refresh linked Meta audience snapshots when the matching ad account's resources load, leaving manual/tool audiences and other accounts alone. This corrects old local drafts after refresh.
- Read-only saved audiences show the location count and existing maps without an extra add-pin map. Age 13 is not clamped to 18, and age 65 is labeled 65+.
- Advantage+ export uses `age_min` for the control and `age_range` for suggestions. Manual targeting continues to use `age_min`/`age_max` with Advantage+ off. No ads were published.

## Verification

`npm test`: 790 passed, 0 failed.

Added `test/saved-audience-roundtrip.test.js` covering the API → application → display → validation → targeting payload path, including the screenshot's two-pin setup, fractional miles, city-only targeting, stale saved snapshots, and malformed inputs.

The screenshot-based API fixture is synthetic: the precise coordinates are test values, not claimed to be the exact original Saved Audience response. In the actual local app, a stale 18–65 draft with no pins refreshed to 18–45, female, two 8 km pins, and Advantage+ controls; F5 preserved this display. No JavaScript errors were observed. Browser network access to the production origin and remote map tiles timed out during this session, so direct authenticated verification of the exact production Saved Audience remains unconfirmed. Public production HTTP verification is separate.

## Primary references

- [Meta SDK Targeting fields](https://github.com/facebook/facebook-python-business-sdk/blob/main/facebook_business/adobjects/targeting.py): `age_min`, `age_max`, `age_range`, and `targeting_automation`.
- [Meta SDK TargetingAutomation](https://github.com/facebook/facebook-python-business-sdk/blob/main/facebook_business/adobjects/targetingautomation.py): `advantage_audience`.
- [Meta SDK custom locations](https://github.com/facebook/facebook-python-business-sdk/blob/main/facebook_business/adobjects/targetinggeolocationcustomlocation.py): `address_string`, floating-point radius, coordinates, and `distance_unit`.

## Follow-up: second location missing

After the user's deployment, they confirmed only one of the two locations appeared. Code inspection identified that `geo_locations.places` was entirely ignored. The importer now merges these radius locations into the display model with an explicit `type: place`, a separate `place:<key>` identity, and `metaPlaceKey`. The original Meta key is preserved when serializing to `geo_locations.places`; coordinate pins remain under `custom_locations`. Include/exclude, template copies, and validation preserve both kinds. Places without optional preview coordinates remain visible and exportable. Two targets at identical coordinates are not collapsed across types.

Two additional regression tests cover mixed place/pin targeting and places lacking map coordinates. The exact account response still could not be read directly in this session; `places` omission is a confirmed code bug matching the reported missing-place behavior, not a claim to have inspected that private response.

Primary schema: [Meta SDK TargetingGeoLocationPlace](https://github.com/facebook/facebook-python-business-sdk/blob/main/facebook_business/adobjects/targetinggeolocationplace.py).

## Production deployment

Deployed successfully to https://advertisingserver.tailac4f15.ts.net. Public verification returned HTTP 200 for /api/health and confirmed the deployed bytes of all six changed browser JavaScript assets match the local files. Full test suite: 790 passed. Exact authenticated Saved Audience verification remains pending as described above.

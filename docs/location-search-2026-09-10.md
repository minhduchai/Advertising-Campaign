# Location search and maps — 2026-09-10

Deployed to https://advertisingserver.tailac4f15.ts.net.

## User behavior

- Typing suggests Meta provinces/cities. Enter or **Tìm kiếm** additionally searches Vietnamese addresses and streets through Photon/OpenStreetMap. Results identify addresses as radius pins and retain OSM attribution; this is not a promise of the same address catalog as Ads Manager.
- Address results become coordinate pins (default 1 km), while Meta provinces/cities preserve their native targeting types. Include/exclude and radius remain editable. No Meta access token is passed to the geocoder.
- A picker map is available before a pin exists and remains available under **Thêm ghim bao gồm/loại trừ trên bản đồ** after the first pin. **Thả ghim** / **Đặt lại ghim** explicitly arms a map click, avoiding accidental changes while panning. Coordinates and radius persist with the draft. Moving a pin updates its coordinate identity so adding the previous address does not replace the moved pin.
- Locally served Leaflet replaces repeatedly recreated remote iframes. Existing maps survive form rerenders; true geographic circles replace fixed decorative overlays. Visible maps load lazily, resize correctly, and show retry/external-map actions if tiles fail or time out.
- Search feedback updates without replacing the form, so typing focus and maps remain intact. Stale queries/account/selection responses are ignored; completed results use the current account resource object if account loading finishes during a search. Empty coordinates cannot silently become zero.

## Verification

`npm test`: 783 passed, 0 failed. Includes geocoder filtering/ranking, authentication and partial provider errors, explicit search opt-in, invalid coordinates, map lifecycle/radius/cleanup/late loads/retry/picker events, and search rendering.

Local browser with test Meta resources and live address lookup: **Đặng Văn Bi, Hồ Chí Minh** returned the street at approximately `10.842861,106.763027`; selecting it displayed a map, changing radius to 3 km updated its circle, F5 retained the pin/radius, and explicitly choosing another map point updated coordinates. No console errors were recorded. No ads were published.

Public production health and new JavaScript/CSS assets returned 200; served app, workspace, map helper and Leaflet assets matched local files. The public alias points to the deployment above.

Authenticated production browser verification also returned **Đặng Văn Bi, Hồ Chí Minh** and displayed its selected 1 km pin with loaded map tiles and no console errors. The temporary verification draft was removed afterward; no ads were published. Following the final review fixes, all 783 tests passed again and the production health and seven served JavaScript/CSS files were rechecked successfully.

## Provider operation

`PHOTON_GEOCODER_URL` can switch to a private/managed compatible Photon instance. The default public endpoint permits moderate use without an availability guarantee; address searches therefore require explicit action, use an 8-second timeout and bounded server/client caches, and expose partial-source warnings. See [Photon project documentation](https://github.com/komoot/photon#demo-server).

Tiles use normal browser caching and visible OSM attribution; no bulk/offline downloads or cache bypass is requested. See [OSM tile usage policy](https://operations.osmfoundation.org/policies/tiles/).

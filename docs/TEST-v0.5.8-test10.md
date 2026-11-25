# 0.5.8 test 10 — direct OpenAI preview transport

November 25, 2026. Local unsigned build. Runtime: `release/0.5.8/test10/runtime/manifest.json`. No new permissions, host scope, external service or public release.

## Failure identified

The maintainer's test 9 diagnostic reports image **156/478**, message **282**, `referenceKind: url`, three attempts, and `IMAGE_NETWORK_ERROR` at the request stage with zero received bytes. The last saved partial file contains messages 279–281 and ends with the user's question about Kitsune. Its header reports **281 of 670 complete messages**; the earlier run's 672-message count must not be substituted for this run.

The next answer was located in the authorized in-app browser. It contains a six-image reference gallery. All six displayed preview URLs are on `images.openai.com/static-rsc-4/`. Bounded HTTP GETs for these exact URLs, without cookies or authorization, returned **200 image/jpeg** with **no Access-Control-Allow-Origin header**, and no redirects. The first file is 209,548 bytes; the six files total 824,723 bytes. All six decode as JPEG with Pillow.

In Firefox Manifest V3, content-script fetches remain subject to page CORS even when the extension has host permission. Extension background pages can use the granted host permission. See [Mozilla's content-script documentation](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/Content_scripts#xhr_and_fetch) and [host permissions](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/manifest.json/host_permissions). Test 9's direct exporter used page fetch for these URLs; its existing background preview reader was used only by rendered-page collection. Repeating the page request could not overcome this restriction.

## Change

- Direct HTML/PDF export now uses the existing background reader for exact `images.openai.com/static-rsc-*/` and `/thumbnails/` URLs. It preserves the established owner/frame checks, permission check, download bounds, byte validation, timeout and cancellation. No conversation token or cookies are sent to the image host. Redirects remain rejected.
- For a saved image result containing both an original URL and an explicit supported OpenAI preview, use that same result's preview. This applies to normal galleries and exact `AsyncImage` query matches. Do not invent URLs, use source-page URLs as images, or match ambiguous results. These are previews; original-file equivalence is not claimed.
- Validate the bounded background reply before embedding. Preserve error categories and fixed request-stage/byte diagnostics; add the fixed `extension` transport marker. Show the existing image-access action during a partial-save decision if permission is missing.
- Keep image order, role switches, completed messages and multipart behavior. No technical image captions are added.

## Validation

**291 automated tests pass** (`release/0.5.8/test10-unit-tests.log`). New regressions cover the direct preview bridge, gallery source selection, ambiguous query rejection, excluded images, hostile/non-preview URLs, cancellation, timeouts, invalid replies, missing permission, diagnostic redaction and a synthetic 670-message/478-image run with the direct preview at image 156 in message 282. That run completes without downloading the prepared prefix again.

The maintainer's current 29 partial HTML files were checked locally: their declared message ranges are contiguous and agree with the article counts, totaling **281 messages and 155 embedded images**. This verifies the saved prefix counts, not the missing remainder or every image's identity against the original chat.

The six real preview downloads were replayed through the production normalizer, content-to-background handler, image loader and HTML renderer. The stored real HTTP headers were used to model the page CORS refusal (Node itself does not enforce browser CORS). Test 9 fails with the reported category and request stage; the working implementation embeds all six JPEGs. Extracted output bytes have the same SHA-256 values and order as the downloaded files. The JavaScript decode API and extension permission API are simulated in this replay; Pillow separately verifies the actual files. Reports and the resulting gallery HTML are under `release/0.5.8/kitsune-evidence/`.

This is a targeted verification of the identified transport defect and the real gallery's bytes, **not a complete export of the real chat or a Firefox UI test**. The exact backend response was unavailable; the replay constructs a minimal gallery from the six observed URLs. Other third-party images without a saved supported preview can still fail under their host's access rules. A full real-chat result must still be checked after installing this build. The earlier DOM traversal cannot establish that result.

## Run locally

`npm test`

`node --test tests/api-preview-transport.test.cjs`

The local real-file replay can run without further network access using `node release/0.5.8/verify-kitsune-transport.cjs --offline` when its evidence directory is present. Evidence files are local and excluded from source packages. The unsigned build is packaged with `scripts/package.ps1 -OutputDirectory release/0.5.8/test10`.

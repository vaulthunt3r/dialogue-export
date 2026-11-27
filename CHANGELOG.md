# Changelog

## 0.5.9 — 2026-11-27

Runtime frozen at test 6. All 318 automated tests pass. All 46 runtime files in the Mozilla-signed XPI match the submission, allowing equivalent manifest formatting and five added signature files only. The submitted source reproduces the runtime ZIP byte for byte. See the [release notes](docs/RELEASE-v0.5.9.md) and [submission record](docs/AMO_SUBMISSION-v0.5.9.md).

- Preserve semantic status icons in rendered answers and the content clipping/height of thin padded separators. Direct layouts include local check, warning and copy vectors; other icons use the existing verified page fallback instead of disappearing. Verified against the supplied export and a browser reproduction; see [test 6](docs/TEST-v0.5.9-test6.md).
- Support the observed nested `{@body const name = expression}` data binding and `preserveWhitespace` text attribute. The reported prompt card now renders its complete text and paragraphs without a mounted page answer. Bindings use the existing bounded expression interpreter with local scope; arbitrary JavaScript statements and active copy handlers remain excluded. Reproduced and checked against the supplied Markdown and the live rendered answer; see [test 5](docs/TEST-v0.5.9-test5.md).
- Resolve static `AsyncImage` queries from saved DIL component results using exact compiler query/resolution-ID pairs, including DIL content references. Do not execute the saved program or infer bindings from result order or `safe_urls`. Allow an exactly identified rendered answer alongside generated-image records from other user turns; retain the same-turn duplication guard. See [test 4 and verification limits](docs/TEST-v0.5.9-test4.md).
- Expand unresolved `AsyncImage` diagnostics with bounded image-reference shapes, query-match flags and the secondary rendered/generated-image planning failure. No query text, URLs, IDs or arbitrary metadata fields are included. The initial diagnostic build is recorded in [test 3](docs/TEST-v0.5.9-test3.md).
- Render observed `grid-item` and `title` layouts, text sizes, borders and tabular numbers. Handle numeric `toLocaleString()` through a bounded internal `Intl.NumberFormat` adapter, without evaluating conversation JavaScript or allowing arbitrary method calls. The supplied 36-message conversation now passes direct HTML/PDF/JSON preparation with no mounted answers. See [test 2](docs/TEST-v0.5.9-test2.md).
- Add an offline Markdown corpus audit for repeated text/component checks across supplied files. Report failures per message and format; explicitly separate this coverage from live exports, source metadata and image downloads.
- Accept the observed single-source citation syntax `<Cite ref="..."/>` alongside `refs`. The old renderer treated this ordinary citation as unsupported content and required its answer to be loaded on the page. Direct HTML/PDF and JSON's rendered HTML now use the saved reference without that page dependency. Missing citation metadata retains the existing explicit unavailable-link label. See [test 1 and reproduction evidence](docs/TEST-v0.5.9-test1.md).
- Preserve structural diagnostics for unsupported static content: element, failure stage, known attribute types and message position, together with the rendered-page matching reason. Do not include conversation text, attribute values, URLs or source IDs. Missing-page errors identify the message number without asserting that its content is a card or diagram.

## 0.5.8 — 2026-11-25

Release code is frozen at test 11. All 295 automated tests pass. The maintainer reported that the affected image-heavy conversation saved all images across 66 HTML parts. This is a user-confirmed result, not an independent audit of every output file. See [release notes](docs/RELEASE-v0.5.8.md) and [Mozilla submission notes](docs/AMO_SUBMISSION-v0.5.8.md). The Mozilla-signed XPI matches all 46 submitted runtime files, allowing manifest formatting and added signature metadata only.

- Check permission for explicit supported OpenAI previews before direct HTML/PDF image downloads or staging, rather than after an expensive prepared prefix. Missing access reports a permission-stage diagnostic with zero attempts. Keep Allow image access available in reopened export menus after the transient error expires. Preserve the existing explicit permission click and manual export restart. See `docs/TEST-v0.5.8-test11.md`.

- Route direct OpenAI preview downloads through the existing bounded extension background reader. MV3 page fetches were subject to CORS and repeatedly failed for preview responses without Access-Control-Allow-Origin. The gallery immediately after the reported partial-export boundary exposes six such previews; all six real files returned HTTP 200 and passed targeted production-code replay with unchanged bytes. Prefer an explicitly saved supported preview from the same image result over its third-party original. Keep existing host scope, cancellation, credential omission and redirect rejection. The earlier targeted transport investigation and its limits are recorded in `docs/TEST-v0.5.8-test10.md`.

- Retry a failed direct image at most three times for network/timeouts and selected temporary HTTP errors, with short cancellable delays. Refresh its ChatGPT download reference on each attempt; refreshable download links also retry HTTP 401/403. Keep completed images and staged parts instead of restarting the prefix. Isolate reference timeouts from the export's cancellation controller. Persistent failures retain the existing Save collected / Discard choice.
- Distinguish unsupported URLs and invalid embedded data from network failures. Image diagnostics add the request stage, bounded received-byte count, attempts, source-reference category and message position. Add Copy diagnostic to the in-page image report. The original test 9 synthetic regression uses the earlier reported 672-message/478-image counts and failure at image 156; the later diagnostic and partial file enabled the targeted test 10 investigation above.

- Render supported standalone and nested SVG diagrams directly from saved text: preserve passive shapes, labels, repeated elements, local gradients/references and presentation styles; normalize percentage dimensions using the viewBox and embed through the existing image pipeline. Literal SVG examples remain code. Active/external SVG content is rejected and image switches still apply.
- Resolve `AsyncImage` from exact nested `image_group` results as well as existing image-reference formats. Preserve explicit label/URL markers without guessing destinations; reject malformed or active links. These cases are based on observed content shapes; the exact failing backend response was not available for an end-to-end replay.
- Do not reject an exactly matched rendered answer merely because an unrelated API-supplied text bubble has no source ID. Ambiguous, foreign, duplicated, reordered and changed messages still fail verification. Explain rendered-message failures with fixed reason codes and bounded message positions in Last export diagnostic.

- Offer Save collected / Discard after Stop or an image-embedding failure in direct HTML/PDF. Retain the verified complete-message prefix, including staged parts and the current completed buffer; exclude the unfinished message. Require an explicit choice, with no five-second dismissal while waiting. Label partial filenames, every HTML/PDF part and completion notices. During HTML downloads, finish the current file before offering Save remaining / Discard; completed files remain.
- Preserve fixed image failure codes, image index/count, request phase and HTTP status for diagnosis. Keep diagnostics accessible after saving a partial export. Navigation, source closure and discard clean up temporary data; storage failures do not produce an unverified partial result. PDF previews preserve the partial warning even without a document title.
- Support `image_group` references, including nested `images[].image_result` search results. Preserve image order in direct HTML/PDF, honor role-specific image switches, and use explicit placeholders in text-only exports. Match the exact saved marker; do not infer image URLs from queries, source-page URLs or `safe_urls`. Missing enabled images still stop export. Extend structural diagnostics with fixed nested-image field names.
- Dismiss completed in-page statuses after five seconds for both success and error, including stopped exports. Keep the last error and structural diagnostics available in the reopened export menu until the next export or page reload.
- Preserve ordinary answer and Working / Thinking text when a citation has no saved reference metadata; mark its missing destination with `Source link unavailable`. Unknown rich content still stops with a bounded diagnostic containing only fixed type categories, field presence and counts. This fixes a reproduced failure case; the cause in the reported image-bearing conversation has not yet been confirmed.
- Render supported static cards from saved conversation data, including arrays, repeated rows, scoped property access, arithmetic, template strings, conditional expressions, spacing, colors and comparison bars. Preserve literal code. Use a bounded parser without JavaScript evaluation or active event handlers.
- Read available saved Thinking summaries and Working updates directly and attach them to their response. Exclude hidden records, raw tool output, analysis-channel text and service recaps. Include activity in memory limits and preserve it through numbered HTML/PDF parts.
- Add direct normalized single-chat JSON with text, Markdown and rendered HTML. All five formats avoid automatic page scans for saved ChatGPT conversations; unavailable or unsupported direct data stops with an explanation instead of starting scrolling.
- Resolve component citations/entities from saved references and image components from explicit URLs or exact saved image-query matches. Mark missing citation links; do not guess images. An unsupported card can still use an already loaded page node with exact-ID, role and order checks before and after media loading. Missing or ambiguous nodes stop export.
- Keep checking when messages are still loading, automatically reconnect after transient failures, and restore missing content scripts from the extension controls. Add `scripting` for this local restoration; existing host scope is unchanged. Guard content initialization so a running export is not replaced. Restore a usable launcher after back/forward navigation or a removed dock.
- Remove empty ChatGPT table-edge overlays whose measured inline heights became blank blocks without the page stylesheet. Normalize first/last child margins in table cells so paragraph wrappers do not inflate row heights. Retain real table notes, media and chart bars.
- Recognize ChatGPT card/layout component source even with bare tags or reordered attributes. Keep generated tool-image records alongside directly rendered cards without the previous DOM-grouping dependency.
- Preserve supported rendered text cards and bar comparisons: spacing, colors, typography, flex layout, empty colored tracks/fills, percentage widths and explicit small dimensions. Keep chart colors in HTML printing and the PDF preview. Page stylesheets, resource URLs, positioning and clipping are not copied.
- Leave the launcher accessible after status dismissal. Cancel old timers when a new export starts or status is dismissed; retain the original deadline across restored pages.
- No additional host permissions or external services. The new `scripting` permission restores the extension's own bundled content scripts on existing supported sites. The signed 0.5.8 package preserves the submitted runtime, and the release includes the exact AMO source plus a source archive with final documentation.

## 0.5.7 — 2026-11-22

- Remove generated image source/size/quality captions and their settings control from all new HTML/PDF exports, including multipart and page collection. Previously saved `includeImageDetails` preferences are ignored; original conversation captions remain content.
- Detect ChatGPT visual-component source such as `AsyncImage`, `Entity`, and layout containers in HTML/PDF direct exports and collect the rendered page instead. Literal code examples remain code. Image queries are never treated as downloadable image URLs.
- Preserve portable thumbnail-and-text card rows in page-based HTML/PDF exports, including typography, badges, links, thumbnail proportions and passive entity labels. Keep responsive layout without importing page stylesheets, fixed positioning or CSS resource URLs.
- Avoid scrolling for rendered cards when all mounted messages match the current API branch by ordered message IDs and roles. Recheck after image loading; missing, duplicated, reordered or changed messages cannot pass as a complete verified export.
- Embed supported OpenAI CDN previews through a bounded background download when canvas access is blocked. Add the narrow `images.openai.com` host permission; omit cookies, tokens and referrers and preserve downloaded preview bytes without re-encoding. Stop with an explanation if this preview download fails.
- Preserve original-to-clone image pairing when cards contain hidden icons; remove hidden elements only after media matching.
- Check image-host permission explicitly and offer an Allow image access action only when missing. Distinguish missing permission, HTTP refusal, network failure, size/format problems and decoding failures with privacy-safe codes instead of blaming all failures on site access.
- Validation: 219 automated tests pass; isolated Firefox 160.0.1 checks cover rendered cards, offline embedded previews, image permissions, HTML/print layout and verified collection without scrolling. The maintainer confirmed the affected HTML export looks correct with test 4 on November 22. This is not a pixel-exact copy of every ChatGPT component. Page collection may scroll and retains its existing media/memory limits; the fast direct path remains unchanged for supported ordinary Markdown.

## 0.5.6 — 2026-11-17

- Add direct saved-ChatGPT export for TXT/Markdown/HTML/PDF with conversation and current-branch validation, no scrolling when supported, and explicit page fallback for unsupported variants.
- Preserve Markdown code fences, indentation, and code/table/list structure in HTML/PDF using a pinned local markdown-it parser. Ship the upstream distribution and readable source map unchanged for reproducible review.
- Download supported image references sequentially. Add separate user-image/AI-image switches and optional source, resolution, format and quality labels. Original Download-file equivalence is not claimed.
- Split large direct ChatGPT HTML/PDF exports into numbered parts staged in local IndexedDB. Download HTML parts sequentially; navigate and print PDF parts separately. Preserve message ranges and clean up temporary content on completion, cancellation, failure or expiry on later access.
- Add a compact monochrome dialogue launcher and ASCII menu in the free right gutter. Keep Export accessible while settings scroll, retain persistent progress/results, and offer site-specific permission guidance when Firefox only permits access after a toolbar click.
- Add opt-in generic completion/error notifications, off by default, using optional notification permission. No new required permissions or host scope.
- Add text-only ChatGPT history ZIP export in a separate local tab: explicit list loading, optional archived chats, search, 20-chat pagination, cross-page selection, all-found selection, TXT/MD/HTML/normalized JSON, bounded sequential reads and numbered ZIP parts with indexes and reports.
- Skip individual unsupported chats with fixed reasons/codes, and save the prepared ZIP remainder after a terminal read failure when downloads are available. Distinguish ready, saved, failed and unattempted counts. Show failed-chat details in the UI, preserve all rows in JSON, and never treat unconfirmed downloads as saved or retry them silently.
- Known archive limits: no images/PDF/activity/alternate branches, no automatic resume, and unverified project coverage. A real 42-chat run saved 36 and rejected six (four RICH_REFERENCE, one MESSAGE_TYPE, one RESPONSE_UNFINISHED); all selected chats were processed and no prepared chats were lost. These parser cases await further examples and fixes.
- Validation: 202 automated tests; isolated Firefox checks of direct export, images/printing, multipart output and ZIP archives; independent ZIP CRC/content/index verification; user-confirmed fast long-text exports and a three-part image-bearing HTML/PDF export. These do not guarantee completeness or a fixed browser-memory footprint for all chats. See docs/RELEASE-v0.5.6.md and versioned test notes.

## 0.5.5 — 2026-10-24

- Preserve loaded images, standalone generated-image replies, static SVG diagrams and readable canvas snapshots in HTML/PDF. Normalize fixed-height galleries so images do not overlap the next message.
- Preserve loaded modern ChatGPT code blocks with language labels, indentation, blank lines and supported syntax colors; mark unavailable virtualized lines.
- Accept additional existing message identifiers, improve ordering across virtualized windows, and remove fixed 300-batch/1200-step collection ceilings. Ambiguous identity and stalled scrolling remain explicit errors.
- Wait for content images before capture, while consistently excluding decorative icons and activity media absent from the output. Fix blocked Google faviconV2 requests interrupting text exports. The user confirmed successful export of a very long text conversation with the tested runtime on October 24.
- Bound collected media and serialized content, limit pending source decodes, avoid unused output copies, release caches and scratch canvases, and offer Stop during collection. These safeguards do not guarantee a fixed total Firefox memory footprint.
- Release completed/failed download Blob URLs and consume background print payloads once. Reloading a prepared PDF tab requires a new export.
- Capture structural image diagnostics at failure time before scroll restoration. Reports exclude text, URLs, IDs, cookies and pixels; opt-in diagnostic scripts remain local.
- Known limitation: a previously incomplete, image-heavy long conversation has not been revalidated after an OOM report. Check important exports against the source. Automatic multipart output is not included. Successful long-text testing does not establish completeness for all heavy chats or interface variants.
- Validation: automated regressions, isolated Firefox HTML/PDF media checks and user-confirmed long-text export. No additional permissions, remote code, telemetry or conversation uploads. See docs/TEST-v0.5.5.md for evidence and limits.
- Distribute the Mozilla-returned signed XPI, runtime ZIP, complete development source ZIP, release kit and SHA-256 checksums. The signed package matches the submitted runtime apart from manifest formatting and added signature metadata.
- Document a wishlist for ZIP archives with separately stored original images where available, automatic numbered parts and further image-heavy collection work. These are not implemented in 0.5.5.

## 0.5.4 — 2026-10-11

- Add opt-in export of available ChatGPT Working / Thinking sections in all formats (issue #4). HTML uses collapsible details; PDF prints expanded details; TXT/Markdown use headings; JSON includes activity fields. Expand sections before exporting. Collapsed sections get an explicit unavailable-content notice; vanished content is not recovered. Ambiguous associations stop export rather than attaching activity to a nearby answer.

- Compact print mode removes message boxes from layout, retaining author labels and spacing. In the reproduced Firefox case, this reduces 5 pages to 4 and lets the first answer begin on page 1 instead of leaving a large gap. Extracted PDF text matches after whitespace normalization.

- Add optional **Compact PDF pagination** for PDF exports and printing exported HTML (issue #5). It defaults off and is remembered across popup sessions.
- When enabled, allow message articles to span printed pages; keep headings with following content and prefer keeping code blocks, images and table rows together. On-screen HTML is unchanged. Oversized blocks may still split according to the browser's print engine.
- Show the active pagination mode in the PDF toolbar. Both new options default off and are remembered.
- Validation: 62 automated tests; local Edge and Firefox pagination checks; user-confirmed compact PDF output. A supplied real-chat HTML export confirms correct activity association, ordering and no duplicates for an expanded section. Other collapsed sections contain missing-content notices; this does not establish coverage of every ChatGPT layout.

## 0.5.3 — 2026-10-01

- Exclude hidden/inert ChatGPT message trees and message previews outside the main conversation area without excluding offscreen messages needed for full exports.
- Stop collection when visible message ownership conflicts with the current conversation URL, rather than saving a potentially mixed conversation.
- Abort when the page URL changes during collection, before handing the file to Firefox.
- Add regressions for retained hidden chats, foreign conversation IDs, legacy fallback, selection, and navigation during export. All 54 automated tests pass. The affected user confirmed correct conversation content with 0.5.3 and subsequently reported successful HTML/PDF checks. VPN/DNS causality has not been established.
- Important: 0.5.2 can include messages from another ChatGPT conversation under the correct title and source URL. Review important previous exports before sharing and re-export affected files with 0.5.3. Other versions have not been assessed for this defect.

## 0.5.2 — 2026-09-29

- Detect user bubbles and assistant message containers in the ChatGPT interface reported in issue #2, while retaining the existing ChatGPT and Gemini selectors.
- Determine modern message authors from their markers rather than viewport position.
- Use opaque message/search keys for modern message identity and merge visible batches in DOM order, including earlier disjoint batches. Do not interpret ID suffixes as message positions.
- Read optional assistant timestamps using the new explicit message ID; ambiguous or unavailable metadata remains missing.
- Add regression coverage for detection, mixed markup, selection, content preservation, remounts, missing keys, and overlapping/disjoint virtualized windows.
- Test build 2: include programmatically scrollable hidden-overflow containers and small scroll ranges; verify that candidate containers actually move. Normalize negative scroll coordinates and temporarily disable smooth scrolling and snapping, restoring the original offset and styles in a finally block.
- Stop with a specific error when scrolling cannot begin or stalls before the end, rather than waiting through the entire scan loop.
- Verification: 50 automated tests and 3 real-layout headless Edge scenarios pass. The reporter confirmed successful export of 301 messages using build 2 on the affected interface; a quick review found the file intact from beginning to end, without checking every message individually.
- Thanks to hexgf for the diagnostics, quick replies, and testing both builds.
- Includes `Dialogue-Export-v0.5.2-signed.xpi`, a runtime ZIP, a development source ZIP, and SHA-256 checksums. The Mozilla-returned XPI has identical runtime files apart from normalized manifest line endings and added signing metadata.

## 0.5.1 — 2026-09-10

### Distribution

- Added the Mozilla-signed `Dialogue-Export-v0.5.1-signed.xpi` for permanent Firefox installation.

### New

- Added optional **Include message timestamps**, requested in issue #1, for ChatGPT exports.
- Added local date/time beneath each author in TXT, Markdown, HTML, and PDF. JSON stores UTC `createdAt` values.
- Remembered the timestamp preference, off by default. Explained why the option is disabled for Gemini.
- Reported timestamp availability in completed export status and in documents with missing dates. Missing times remain absent or `null` in JSON.

### Reliability and privacy

- Matched ChatGPT creation times to exact message IDs and roles, including regenerated-answer variants.
- Preserved already discovered times when virtualised nodes lose metadata, only for the same message ID.
- Kept loading/scrolling algorithms unchanged. Added no permissions, page script injection, network requests, or remote code.
- Added automated tests for dates, all formats, missing metadata, selection, hostile page getters, and virtualised conversation windows.


## 0.5.0 — 2026-09-10

### Interface and usability

- Added an explicit Export button after format selection, with short format descriptions.
- Remembered format, scope, link/title options, and optional date suffix.
- Added safe filename preview, including Windows reserved names.
- Added bounded connection attempts, an in-popup Retry action, and actionable empty/unsupported-page states.
- Restored active export status when reopening the popup: stage, elapsed time, and collected count.
- Replaced misleading total-message estimates with collected counts and phase indicators. Toolbar stages are LOAD, READ, and SAVE.
- Blocked duplicate exports and selection changes during an export.
- Added live selected count, Clear, Escape, and pressed-state labels to page selection controls.
- Updated open controls when the page theme changes; fixed transparent-background detection and selection outlines.
- Added keyboard focus indicators and reduced-motion styles.
- Passed the requested PDF filename to the print page and corrected loading/error text.

### Distribution

- Added a Mozilla-signed XPI for permanent installation.
- Refreshed the README with interface and local-processing presentation images.

### Scope and verification

- Retained v0.4.2 scrolling/loading routines, extractor, and document renderers.
- Added 16 automated UI/message-flow tests with synthetic conversations.
- Automated checks use synthetic conversations. Real Firefox download/print dialogs and live website behavior still require manual testing.

## 0.4.2 — 2026-08-29

### Important fix

- Fixed incomplete exports of long ChatGPT conversations. Earlier releases could save only the messages currently loaded on the page.
- Added automatic loading and collection of earlier conversation sections before the final file is created.
- Export continues after the popup is closed.

### New

- Added support for ordinary Google Gemini conversations.
- Added **All messages** and **Selected** export modes.
- Added message-selection controls directly on the conversation page.
- Added a progress timeline and Firefox toolbar badge.
- Added automatic light and dark themes based on the open conversation page.

### Improved

- Preserved link destinations in every format when **Keep links** is enabled.
- Markdown writes links as `[label](URL)`.
- TXT writes links as `label (URL)`.
- Removed redundant “Your prompt” and “Gemini response” labels from Gemini exports.
- Removed ChatGPT and Google Gemini branding suffixes from filenames and document titles.
- Improved PDF export instructions and background downloads.
- Updated the interface to a neutral style matching ChatGPT.

### Privacy

- All conversation processing remains local in Firefox.
- No analytics, telemetry, advertising, remote scripts, or conversation uploads were added.

## 0.2.0 — 2026-08-18

- Renamed the project to Dialogue Export.
- Added TXT, Markdown, HTML, JSON, and PDF export.
- Added a stable Firefox extension ID and Mozilla data-collection declaration.
- Added privacy, security, licensing, and Mozilla submission documentation.
- Published the first Mozilla-signed version.

### Known issue

- Long ChatGPT conversations could be exported incompletely because only the currently loaded part of the conversation was collected. This is fixed in v0.4.2.

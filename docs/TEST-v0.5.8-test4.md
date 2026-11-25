# 0.5.8 test 4 — static cards and saved activity without scrolling

November 25, 2026. Local unsigned build, including the earlier table-spacing, connection-recovery and five-second success-status fixes. No public release or signed XPI is created.

## Install

Load `release/0.5.8/test4/runtime/manifest.json` through `about:debugging#/runtime/this-firefox`, replacing the previous temporary build. Reload ChatGPT after switching builds. Select **All** and export the affected chat with the usual options; Working / Thinking can remain enabled. Permissions and host scope are unchanged from test 3.

## What changed

- Saved ChatGPT conversations use direct data for TXT, Markdown, JSON, HTML and PDF. They no longer start automatic page scrolling when the direct reader encounters an unsupported case or a request fails. A failure does not save a partial conversation.
- Supported cards are built from their stored source, even when no card is mounted. The static interpreter supports card/box/row/column/grid, text, caption, badge, divider and spacer components; literal arrays and objects, scoped field/index access, arithmetic, template strings, conditional expressions, `each` and simple `if` blocks. Event handlers and copy-button icons are inactive. Arbitrary JavaScript, function calls, general Svelte/JSX programs and interactive applications are not executed.
- Explicit image URLs and exact saved image-reference matches use the existing bounded download/embed pipeline. No image search is run and similar queries are not guessed. Missing citation links are labelled; their internal reference IDs are not presented as links.
- Saved `thoughts` summaries/content and visible assistant commentary/preambles become Working / Thinking sections attached to the same response branch. Hidden entries, raw tool output, analysis-channel text and service recap records are excluded. The option no longer forces a page scan. This does not reconstruct tool-event labels or activity that is absent from the saved data.
- Single-chat JSON contains normalized text, Markdown and HTML, with optional activity/timestamps. Image binaries and session credentials are not included. Original component source remains in its Markdown field; its HTML field uses the static renderer.
- If a card cannot be reconstructed directly, an already loaded page node can still supply its visual content after exact-ID/role/order checks. Missing or ambiguous content stops the export without scanning. Temporary chats and Gemini keep their existing page collection; selected-message export reads selected page nodes.

## Validation

- All **249 automated tests pass** (`release/0.5.8/test4-unit-tests-final.log`).
- Automated tests cover direct collection in all five formats with forty saved messages and only the final message mounted, including an unmounted card and two activity records. They verify zero scroll writes, exact message order, timestamps, activity ownership, hidden/off-branch exclusion, JSON structure, unsupported-image refusal and disabled-image behavior.
- Static-renderer tests exercise the supplied card's loop/expression structure, proportional bars, passive controls, Markdown tables and code, exact citations/images, prototype/function/event/placeholder injection attempts, finite expansion/depth limits and recovery after rejection.
- Firefox 161.0, using a fresh test profile and local synthetic endpoints, exported forty messages in each of the five formats with **zero scroll writes and an unchanged scroll position**. HTML/PDF included an embedded image and both activity records. Offline HTML and the PDF preview retained the image. The rendered bar ratios measured 0.1, 0.3, 0.5 and 1.0, with 12px tracks/fills.
- The user's previously supplied Markdown was rendered locally through the new interpreter. Its tariff and USSD cards rendered without raw component source; the four PDF pages were rendered with Poppler and visually checked. This sample has no API reference metadata, so its missing citation destinations are labelled. It is a renderer check on the supplied file, not a fresh authenticated export of that chat.
- The separate mounted-card Firefox regression also passed: eight messages, zero scroll writes, two offline images with unchanged bytes, preserved chart proportions and a 16px gap after the table. No private browser profile or external conversation endpoint was used in these browser checks.

Run `npm test`. Browser checks: `node tests/static-components-firefox.cjs release/0.5.8/static-card-test4-final` and `node tests/rich-page-firefox.cjs release/0.5.8/mounted-card-test4-qa`. The former optionally accepts a local Markdown sample path as its third argument. Results are local under `release/0.5.8/`; supplied private samples are not included in the source/runtime package.

This builds the supported layouts independently of the live page stylesheet; it does not promise a pixel-identical copy of every ChatGPT component. Unsupported layouts and unmatched enabled images remain explicit errors. Response, per-message, image and static-rendering limits still apply.

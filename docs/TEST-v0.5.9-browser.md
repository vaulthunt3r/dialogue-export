# 0.5.9 test 2 — browser verification

November 27, 2026. Follow-up to [test 2](TEST-v0.5.9-test2.md), with the same packaged runtime and no further product changes.

## Environment

Used the authorized in-app browser. No personal or isolated Firefox profile was accessed. Local file/HTTP attempts initially timed out. A shell request to the loopback address failed with a socket-permission error inside the sandbox. The same local server, bound only to `127.0.0.1`, was then started outside the sandbox with approved escalation: HTTP 200 and successful browser loading followed. VPN settings were not changed. This establishes a working local preview route; it does not diagnose every earlier browser timeout.

## Checks completed

- Opened the complete supplied Hoco HTML in the browser: 36 messages, 17 tables, 119 static components. At the default 1280px viewport, no table/component extended beyond the viewport. All 16 comparison bars had the source percentages, within pixel rounding; measured heights were 12, 22 or 24px as specified. The four metric titles rendered at 24, 24, 24 and 20px. Inspected the formatted-number and power-comparison cards visually. No console errors were recorded.
- Compared all 18 assistant answers with the live Hoco chat using normalized text lengths and fingerprints, independently of the MD replay. Fifteen matched directly. Three differed only in citation labels: the page displayed E-Catalog UK, aks.ua and Yandex Market source pills, while the metadata-free replay displayed `Source link unavailable`. After excluding those labels, all 18 matched. Table counts matched for every answer. The three page-only 12px images were citation favicons, not missing content images.
- Ran the exact packaged normalization, media embedding and rendering scripts in an in-app browser fixture: Hoco, RetroArch and a mixed-content case, each in HTML and PDF-preparation mode. All six checks passed. The real conversations preserved 36 and 8 messages in order.
- The mixed case combined formatted cards, a static SVG diagram, literal code, a table, a PNG attachment and six actual JPEG files retained from the previous image investigation. Images were fetched from the local test server, embedded by production code and decoded by the real browser without replacing `Image.decode()`. All eight images had positive dimensions, used embedded data URLs and remained inside the document width. Their dimensions were 640×160, 340×160, 1200×842, 600×480, 683×1024, 600×828, 500×700 and 1024×1024. Inspected the rendered PNG/card area and first real JPEG visually. Literal `<title>` code remained code. No console errors were recorded.

## Evidence

Private local evidence is excluded from distributable archives:

- `release/0.5.9/browser-qa-report.json`: report downloaded from the completed browser fixture.
- `release/0.5.9/live-hoco-check.json`: live-answer comparison, including citation exclusions.
- `release/0.5.9/build-browser-qa.cjs` and `browser-qa/runner.js`: local reproduction using the packaged test 2 scripts, supplied Markdown and retained image files.

The existing 307-test automated-suite result remains applicable: product code did not change during this follow-up.

## Remaining coverage

These checks do not prove all-account exports. Only two complete source texts were available. The mixed case uses retained real image bytes with local transport; it does not verify current remote downloads, signed-link refresh or the Firefox background bridge. PDF mode here checks preparation and decoding, not printed page layout. The browser does not have the Firefox extension installed, and its normal chat actions offer no raw conversation export. Original source metadata and full API payloads for the remaining chats are still unavailable. No claim of a complete 39-chat pass is made.

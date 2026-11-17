# 0.5.6 test 9 — ChatGPT history archive

Unsigned local test build, November 17, 2026. No signing or publishing.

## User test

1. Load `release/0.5.6/test9/runtime/manifest.json` as the temporary extension and reload the source ChatGPT tab.
2. Open the export menu and click **Chat archive · ZIP**. It opens a separate local tab. No history request occurs until **Load list** is clicked.
3. Leave **Include archived chats** checked and load the list. Check whether a known ordinary chat, an archived chat and a project chat appear. The extension does not yet claim that all project chats are discoverable.
4. Select two or three chats first, choose **Markdown**, and click **Export selected**. Keep the source and archive tabs open; other tabs can be used normally.
5. Find `ChatGPT-archive-…-part-001.zip` and the final `…-report.json` in Downloads. Extract the ZIP, open `index.html`, and compare the first and last messages of each exported chat. Titles containing Cyrillic and code indentation should survive.
6. Repeat the same small selection with HTML. Check headings, code blocks, lists and tables. Images are deliberately excluded in this first archive build; PDF and activity sections are unavailable here.
7. Once these pass, use **Select all found**. Compare the found count against known chats and inspect the final report. “All found” refers to the returned list, not a verified full-account backup.
8. Optional: stop a running batch. Completed ZIP downloads should remain. The current unsaved buffer is discarded; **Save report again** records what was and was not saved. Restarting does not resume or skip prior downloads automatically.

For feedback, counts, status/error text and whether known project/archived chats appear are sufficient. Personal conversation files are not needed.

## Scope and limits

- ChatGPT only; active and optionally archived list endpoints are paginated independently. Duplicate IDs, changing totals, truncated pages or malformed IDs cause discovery to stop rather than silently offering a partial list as complete. This test build caps discovery at 10,000 chats.
- Each selected chat is fetched by ID and verified against the returned conversation identity. It uses the server's current response branch. Alternate branches, unavailable/temporary/deleted chats, Working / Thinking and image files are outside this first build.
- Formats: TXT, MD, HTML and normalized exported-message JSON. JSON does not contain the raw API account payload. HTML retains the shared Markdown renderer's code/table formatting; it contains no fetched images.
- ZIP uses standard STORE entries with UTF-8 names and CRC-32, without compression or a remote library. Parts are limited to 32 MiB including metadata; metadata headroom and a 250-chat part limit may produce smaller parts. No single chat is split across ZIP parts. An oversized single response/file is reported as failed.
- Each part contains local `index.html`, `manifest.json` and `chats/` files. The final JSON report maps chats to confirmed saved parts. A failed/unconfirmed download is not counted as saved. ZIP creation holds only one part at a time; this does not cap Firefox's total memory.
- Chat reads have 30-second deadlines. Requests are sequential, with pacing and at most two delayed retries for 429/503. Authentication failures, network failures and server errors stop the queue; missing/unsupported chats can be skipped with an explicit report.
- Keep both tabs open. Closing/reloading the source can interrupt collection; closing the archive discards its state. No durable resume or history export for Gemini. Current single-chat HTML/PDF images and multipart behavior remain separate.
- No new permissions. List metadata and ZIP buffers are local; credentials are neither returned in extension messages nor stored in files. Reports do include selected titles and IDs intentionally.

## Validation

- **183/183 unit tests pass** on the final source (`release/0.5.6/test9-unit-tests-final.log`). The complete suite includes opt-in requests, fixed read-only URLs, credential exclusion, wrong conversation IDs, malformed lists, cancellation, original-tab ownership, selected scope, active/archived discovery, multipart size bounds, failures, network stop, interrupted downloads, ZIP path validation, CRC-32 and the existing export regressions.
- Firefox 160.0, fresh temporary profile and synthetic localhost account only: discovered **105 chats over three list requests**, then exported four selected chats in each of MD/TXT/HTML/JSON. Each run saved **three**, reported the synthetic missing chat as **one failure**, and produced **two ZIP parts** using a reduced test budget. Production budget remains 32 MiB. There were no history requests before Load list and all 24 service requests were GETs. Evidence: `release/0.5.6/archive-test9-final/`.
- Python's independent `zipfile` reader verified **eight ZIP files**, **12 conversation files**, **four reports**, CRCs, UTF-8, relative index links, table/code markup and report-to-file mappings. Tokens and the synthetic hidden branch were absent. Reproduce: `python tests/verify-archive.py release/0.5.6/archive-test9-final`.
- Compact-menu Firefox regression: pinned Export, light/dark appearance, short viewport, selected PDF handoff and narrow-window fallback still pass. Evidence: `release/0.5.6/ui-test9/`.
- Personal browser profiles and real accounts were not accessed. The next required validation is the user test above, especially actual API compatibility, project coverage and real list completeness.

## Protocol investigation

The history endpoints are internal, not a supported public API contract. Active/archived list discovery follows the observed `offset`, `limit`, `order` and `is_archived` query shape, independently implemented and validated locally. Primary investigation references: [txcript's ChatGPT reader documentation](https://github.com/skillsynchq/txcript/blob/main/docs/formats/chatgpt.md) and [observed conversation-list response structure](https://gist.github.com/0xdevalias/4e54bb28a02db5357ea4fa3a872fc5fc/3bf1ea679a2117389d5874ecdf8d3f5928c0785f). No source from the proprietary AMO extension was copied.

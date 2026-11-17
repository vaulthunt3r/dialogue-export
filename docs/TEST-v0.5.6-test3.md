# 0.5.6 test 3 — image fallback diagnostics

Unsigned local diagnostic build, 2026-11-17. Not a release or a fix for the reported image export failure.

## Evidence

The user confirmed fast, complete TXT/Markdown/HTML/PDF exports of a real text conversation. A different chat containing fewer than ten images scrolled during HTML export and failed with the legacy page collector's image memory error. That establishes page collection and a budget failure, but the screenshot does not reveal the direct reader's fallback reason or which budget failed.

The direct reader deliberately falls back for unmatched tool-image references rather than silently omitting images. This is a plausible cause for the generated-image chat, not yet a confirmed diagnosis. Other fallback causes remain possible.

## Changes

- Keep the fallback reason visible after page collection fails.
- Identify the exceeded budget: retained image data, total pixels or asset count. Include attempted and retained amounts before cleanup.
- For unmatched tool images, retain at most 12 structural records from the validated active conversation branch. Records contain fixed categories and dimensions only, without message text, IDs, URLs, tokens, image contents or arbitrary metadata values. Reports stay in the tab and are shown only after collection finishes or fails; they are not uploaded.
- Existing resource limits, collection behavior and image processing remain unchanged.

## Local test

1. In Firefox `about:debugging#/runtime/this-firefox`, remove the previous temporary Dialogue Export entry and load `release/0.5.6/test3/runtime/manifest.json` as a temporary add-on.
2. Reload the affected ChatGPT tab. Use All → HTML with Include Working / Thinking disabled.
3. If export fails, retain the full error and the line below it. Expand **Image diagnostic** and **Direct export diagnostic**, if present, and copy their contents. A screenshot of the error and reason is also useful. No full conversation or browser access is needed.

Do not repeatedly retry an unchanged failure. This diagnostic build is intended to identify the reason before changing image handling.

## Validation

Regression tests cover privacy filtering and bounds of the structural report, the exact pixel-budget error before decoding, and preservation of the source reason and both diagnostics through the page-export error UI. Existing direct-reader, memory, image and UI tests are run with these changes. See `release/0.5.6/test3-unit-tests.log`.

The successful isolated Firefox HTML/PDF rendering checks from test 2 remain applicable to unchanged rendering code. Test 3 does not claim a new successful real image export or repeat those visual checks.

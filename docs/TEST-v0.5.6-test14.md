# 0.5.6 test 14 — keep prepared chats after an archive read failure

Unsigned local build, November 17, 2026. Not signed or published.

Load `release/0.5.6/test14/runtime/manifest.json`, refresh ChatGPT and open a new archive tab through `[ZIP]`. Load the list, select chats and export. Completed ZIP parts and the final JSON report save to Downloads automatically.

## What changed

- A terminal reading error now saves the prepared ZIP remainder before reporting failure. Individual content errors are recorded and skipped while reading continues.
- Progress distinguishes files ready in memory from confirmed downloads. Final counts include unattempted chats.
- Expand **Failed chats — show reasons** for titles, fixed explanations, codes and suggested next steps. The latest 20 failures are shown; the JSON report includes all chats. Titles are inserted as text, not HTML.
- Network failures, request timeouts, invalid responses and HTTP errors retain distinct safe codes. Reports never forward arbitrary exception text or credentials.
- Closing the source tab stops reading but still attempts to save prepared files. Explicit Stop cancels unsaved work. Download failures are not marked successful or retried implicitly; check Firefox Downloads for unconfirmed files.

The supplied earlier report contained 36 prepared-but-unsaved chats, one `RESPONSE_UNFINISHED`, two `RICH_REFERENCE` failures and three unattempted chats. It omitted the terminal error code, so its exact cause cannot be recovered. This build does not change rejection of unfinished messages or unsupported references and does not claim those content cases are fixed.

## Validation

- 24 archive/history/UI tests cover partial success, the 42-chat failure case, safe diagnostics, source-tab loss, cancellation, failed saving, size limits, multipart output, titles treated as text and failure display.
- Isolated Firefox 160.0 uses only a synthetic localhost account and a fresh profile. Of 42 chats, three reject on content and chat 40 returns HTTP 502: 36 chats save in one ZIP, four fail, two remain unattempted. The report saves automatically. Evidence: `release/0.5.6/archive-failure-test14-final/`.
- Python's independent ZIP reader verifies CRCs, all 36 chat entries, UTF-8, code fences, index links, manifest/report agreement and exclusion of failed chats, hidden branches and credentials. Screenshots of the expanded error panel are inspected.

The terminal HTTP 502 is a test fixture, not a diagnosis of the user's prior generic error. Archive scope remains text-only TXT/MD/HTML/normalized JSON and the server's current branch. No automatic resume, additional permissions or external uploads are introduced. The report's existing `notSaved` total includes unattempted rows; `notAttempted` explicitly identifies that subset.

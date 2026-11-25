# 0.5.8 test 9 — bounded image retries and clearer failures

November 25, 2026. Local unsigned build. Load `release/0.5.8/test9/runtime/manifest.json` as the temporary Firefox extension, then reload the source tab after saving any pending partial export. No new permissions, host scope or public release.

Follow-up: the maintainer's subsequent diagnostic and last partial file identified the Kitsune gallery boundary. The CORS transport investigation and fix are documented in [test 10](TEST-v0.5.8-test10.md); the limitations below describe what was established during test 9.

## Report and change

The screenshot reports `IMAGE_NETWORK_ERROR` at image **156 of 478**, with **282 complete messages out of 672** and **155 embedded images** after **10:04**. Test 8 offered Save collected / Discard. The expanded diagnostic was no longer available when requested. The image number identifies an export occurrence, not a visibly selected image or its filename.

Previously, a single failed request ended preparation. Test 9 makes at most **three attempts**, waiting 0.5 and 1.5 seconds before the next attempt. Network failures, timeouts and HTTP 408/429/500/502/503/504 are eligible. HTTP 401/403 on a download is retried only when a ChatGPT file reference can supply a fresh URL. Missing references, unsupported URLs, invalid image formats, size limits and decoding failures are not retried. Existing per-request 60-second deadlines remain.

Each retry resolves the same file reference again, including conversation/message scoping for sandbox files. Completed images and staged parts stay prepared; the successful prefix is not downloaded again. A reference timeout now aborts only that attempt, so later attempts can run. Stop interrupts requests and waits. If attempts are exhausted, Save collected / Discard still offers only complete messages. This is not a resume mechanism for a prior export or a reloaded tab.

`IMAGE_URL_UNSUPPORTED` and `IMAGE_DATA_INVALID` no longer appear as network failures. Reports distinguish request, headers, response body and reference metadata stages, and include attempt count, reference kind, bounded received bytes and message position. They contain no URLs, file/message IDs, credentials or conversation text. The page report now has Copy diagnostic, matching the popup control.

## Validation and limits

All **284 automated tests pass**. This includes the production direct-export flow: it waits through the retries, offers the partial choice after the final failure, and downloads nothing until Save is selected.

The new synthetic regression has exactly 672 messages and 478 tiny fixture images, with the 156th image in message 283. Before the change, a single injected network failure reproduced the reported error text and the 282-message/155-image partial prefix. After the change, a temporary failure completes all 672 messages and 478 images, in order and without duplicate or repeated-prefix downloads. A permanent failure stops after three attempts and retains precisely 282 complete messages and 155 images. Other cases cover cancelling during backoff, refreshing a rejected signed URL, missing-reference rejection, independent reference timeouts, broken response streams and diagnostic redaction. Browser image decoding is stubbed in jsdom.

The named real chat was opened in the authorized in-app browser. Six mounted images decoded successfully and used blob URLs; earlier content is virtualized. That browser has no installed Dialogue Export controls and exposes no page tool for running the extension. The ChatGPT connector's text projection omits generated assistant-image records and original image metadata. Therefore this inspection does **not** reproduce the failing download, identify image 156, prove the network cause or confirm a complete real-chat export. No further attempt to access the user's personal Firefox or launch the previously declined isolated Firefox check was made.

This build improves recovery from a temporary error and diagnosis of a persistent one. It does not establish that the particular reported image is now downloadable. The static-card/SVG changes and their limits from [test 8](TEST-v0.5.8-test8.md), and the partial-export behavior from [test 7](TEST-v0.5.8-test7.md), remain.

## Additional real-chat investigation — November 25

The authorized in-app browser was used to load the beginning of **Логотипы брендов** and traverse forward to the final Sweet Loot exchange. The reader recorded **654 distinct rendered message IDs: 329 user and 325 assistant**. Consecutive sampled windows overlapped, but this is not a completeness guarantee: messages and attachment controls can appear after the initial window read. This rendered projection does not match the reported direct-export total of 672 messages.

During this traversal, user attachment controls and generated-image elements appeared asynchronously. The observed image count increased even while staying at the final scroll position. Counting those DOM elements during a fast traversal therefore undercounts images and cannot identify the reported export occurrence 156. No filename or message was asserted to be that failing image. A real image had been downloaded through the in-app browser, but this does not exercise the extension's reference resolution or download request.

The app's chat-reading tool returned only five recent user messages with attachments and omitted generated assistant-image records, so it also cannot supply a complete replay fixture. No saved partial export for this chat was found in the checked download directory or the root of D:. No personal or isolated Firefox instance was used.

**Result: the real-chat end-to-end export is still unverified, and the specific network failure is unresolved.** The investigation did not run the extension or produce an export containing all 672 messages and 478 images. There are no new production changes or a new build from this investigation; test 9 remains the bounded-retry change described above. A successful DOM traversal, downloaded preview, or synthetic regression must not be reported as a successful real-chat export.

## Local reproduction commands

Run `npm test`; the final result is recorded in `release/0.5.8/test9-unit-tests-final.log`. Targeted checks are in `tests/api-image-retry.test.cjs` and `tests/api-html.test.cjs`. Package into a new directory with `scripts/package.ps1 -OutputDirectory release/0.5.8/test9`.

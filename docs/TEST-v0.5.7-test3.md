# 0.5.7 test 3 — actionable preview download failures

Unsigned local test build; test2 artifacts remain unchanged.

The user's test2 report shows a loaded 800×600 preview displayed at 136×102 and a failure during download. This proves neither a missing permission nor a server failure. The generic message in test2 incorrectly suggested checking permission for every failure.

All five public preview URLs in the supplied HTML returned JPEG bytes, and the production download bridge embedded all five successfully in a fresh Firefox 160.0.1 profile. That test used a synthetic local page, no personal browser, ChatGPT session, cookies or tokens. The user's browser-specific failure is not yet identified.

This build:

- Checks whether Firefox actually granted `images.openai.com` access before fetching. Missing access produces `IMAGE_PERMISSION_REQUIRED` and an **Allow image access** button.
- The button opens a local extension page. Its explicit button requests that one image host only, then tells the user to return and retry. It never starts or repeats an export automatically.
- Reports fixed codes for HTTP refusal (with numeric status), network errors, timeout, cancellation, size limits, unsupported image data, decoding failure, busy downloads and invalid extension replies. No raw exceptions, image URLs, chat text or headers enter diagnostics.
- Keeps the card/thumbnail fixes and verified no-scroll collection from test2.

## Retest

1. Temporarily load `release/0.5.7/test3/runtime/manifest.json` in `about:debugging`, then refresh ChatGPT.
2. Retry the same HTML export with AI images enabled.
3. If **Allow image access** appears, click it, allow the request on the local settings page, return to the chat and retry.
4. If another error remains, copy **Image diagnostic**. The new `download.code` (and `httpStatus`, if present) identifies the failing stage; no personal conversation data is needed.

This is an error-handling and permission-recovery build, not a claim that the user's unresolved failure has been reproduced or universally fixed.

Validation: the full 218-test suite passed, followed by 53 focused UI/media tests after the final button regression and message-channel failure handling were added. Firefox 160.0.1 checked no-CORS synthetic previews, eight messages with zero scroll writes, offline HTML/print output, five real supplied JPEG previews with granted permission, and explicit permission-required results when that host was not granted. The browser profiles were isolated.

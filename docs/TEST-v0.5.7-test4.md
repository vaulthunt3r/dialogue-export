# 0.5.7 test 4 — remove technical image captions

The source/size/quality captions and their settings checkbox have been removed. New HTML/PDF exports do not add them, even when an earlier installation saved `includeImageDetails: true`. This applies to direct export, multipart output and rendered-page collection. The user/AI image switches remain. Image bytes and resolution are unchanged by this removal, and captions originally present in the conversation remain content.

Load `release/0.5.7/test4/runtime/manifest.json` as a temporary add-on, refresh ChatGPT and export again. Existing saved HTML/PDF files are not rewritten.

The preview-download fixes, permission recovery action and privacy-safe failure diagnostics from test3 remain included. This is an unsigned local test build; no GitHub release was published.

Validation: 219 tests passed. An isolated Firefox 160.0.1 run verified eight messages without scrolling, unchanged embedded image bytes, aligned cards and offline HTML/print output with no added technical captions even when the legacy details option was supplied.

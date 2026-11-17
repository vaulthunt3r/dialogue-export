# 0.5.6 test 4 — direct generated-image export

Unsigned local test build, 2026-11-17. Not signed or published.

## Confirmed cause and scope

The user's test 3 screenshot confirmed `unmapped-tool-images` fallback followed by a page-collector image-data limit failure (17.9 / 16 Mi characters). The structural report counted 23 image parts, with its first 12 records including user uploads, visible finished `multimodal_text` tool outputs in `commentary` and `final`, and hidden tool records. This count does not establish 23 distinct visible images. Exact duplicates cannot be inferred from dimensions alone.

Previously, any tool-image pointer absent from ordinary assistant messages forced fallback, even if that tool record was hidden. The page collector then scrolled and attempted to retain image data, including PNG canvas captures.

Test 4 handles finished visible tool-image outputs through the direct reader. It preserves their active-branch position and available timestamps, presenting the image under ChatGPT. It does not export tool prompts, prose, attachments or arbitrary execution metadata. Hidden records and analysis records are omitted before rendering or downloading. Unknown image-bearing output types/channels and unfinished tool responses still produce an explicit fallback.

Exact repeated tool pointers within one response are retained once. When that response has a visible assistant message explicitly referencing the same image, that assistant reference takes precedence. User attachments and later responses are kept even when they reuse an image pointer; downloads still reuse the export-local cache. No comparison by image dimensions or global removal of user-visible repeated images is performed.

Image bytes remain unmodified by the direct reader. Existing output, download and pixel limits remain in force; a smaller serialized export is possible when the service supplies compressed images, but no measured size saving or guaranteed success for the affected real chat is claimed. Automatic multipart output is not implemented.

## User retest

1. Remove the previous temporary Dialogue Export entry in `about:debugging#/runtime/this-firefox`. Load `release/0.5.6/test4/runtime/manifest.json` as a temporary add-on.
2. Reload the affected saved ChatGPT conversation. Choose **All → HTML**, with **Include Working / Thinking** disabled.
3. Check that export uses the direct path without scrolling. In the saved HTML verify the beginning/end, user attachments and generated images at their correct positions, without hidden duplicate images.
4. If HTML succeeds, export the same chat to PDF. Check images in the print preview and saved PDF. If an export fails, retain the exact error and source reason; do not repeatedly retry unchanged settings.

The structural case is covered by automated tests and an isolated Firefox fixture. The actual affected account/chat has not yet been retested.

## Validation

November 17, 2026: **148/148 unit tests passed**; isolated Firefox integration passed. Both four-page PDFs have matching extracted text, all 65 code lines and the final message. All four rendered print pages were inspected.

- Unit checks include the supplied 12-record shape using synthetic pointers and images, hidden/off-branch exclusion, image-only tool output, timestamps/order, exact-reference deduplication scoped to a response, repeated user attachments and unchanged TXT/Markdown handling. Unsupported variants retain safe structural diagnostics.
- Isolated Firefox 160.0 uses a fresh profile and localhost fixtures only. TXT/Markdown retain 1200 messages; HTML/PDF retain those messages plus one visible generated-image output. A hidden tool image is never requested. Credentials remain confined to the synthetic origin and absent from output.
- A separate seven-message visual subset includes three embedded image occurrences, a 65-line code block and formatting fixtures. All images decode; subsequent messages do not overlap images; both exported HTML and the extension's print document produce PDFs. PDF rendering is inspected with Poppler.
- Local evidence: `release/0.5.6/test4-unit-tests.log` and `release/0.5.6/api-images-test4/`.

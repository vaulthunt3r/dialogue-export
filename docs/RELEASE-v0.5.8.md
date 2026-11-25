# Dialogue Export 0.5.8 — direct rich exports and reliable image handling

November 25, 2026. **[Install the Mozilla-signed XPI](https://github.com/vaulthunt3r/dialogue-export/releases/download/v0.5.8/Dialogue-Export-v0.5.8-signed.xpi)** — Firefox 142 or later. Reload ChatGPT after updating. The release uses the frozen test 11 code.

## Changes

- Read saved ChatGPT conversations directly in all five single-chat formats, including JSON. Saved chats no longer fall back to automatic page scrolling when direct content is unsupported; export stops with an explanation. Temporary chats, selected messages and Gemini retain their page readers.
- Reconstruct supported static cards, comparison layouts and SVG diagrams from saved data, even when the answer is not mounted on the page. Preserve ordinary code examples. Unsupported cards can use already loaded content only after checking message identity and order.
- Export supported image galleries and exact saved image references. OpenAI previews use bounded background downloads to avoid page CORS restrictions. Prefer an explicitly saved supported preview from the same image result; no image URLs are invented and no new searches are made.
- Check access to known OpenAI previews before downloading the image list. **Allow image access** remains available in reopened export menus. After granting access, start the export again.
- Retry temporary image failures up to three attempts and refresh available ChatGPT file download links. Completed images and staged parts are retained during retries.
- Offer **Save collected / Discard** after Stop or an image failure. Save only complete messages, mark partial files clearly and exclude the unfinished message. This does not resume across a page reload.
- Include available saved Thinking summaries and Working updates when enabled. Hidden records, raw tool output and analysis-channel text remain excluded.
- Preserve surrounding text when citation metadata is missing; mark the unavailable source link. Improve fixed-category diagnostics and keep them accessible after the five-second status notice disappears.
- Restore missing content scripts when export controls reconnect, using the new `scripting` permission on the existing supported sites. Improve launcher recovery and table spacing.

## How export works now

1. **Read the saved conversation.** For All messages in a saved ChatGPT chat, the content script uses the existing session to fetch the conversation data, checks its identity and follows the current response branch. It does not need every message to be mounted on the page. The internal service API is used locally; no separate OpenAI API key is required.
2. **Build an ordered document.** Normalize message roles, text, Markdown, links, timestamps and supported media references. When enabled, attach the available saved Thinking summaries and Working updates. Hidden records, raw tool output and analysis-channel text are excluded.
3. **Render supported content.** A local Markdown parser handles ordinary formatting. A restricted static parser reconstructs supported cards, repeated layouts and SVG diagrams without running message JavaScript. An unsupported card can use an already loaded page node only after exact message checks; otherwise export stops with an explanation. Saved chats never start an automatic scrolling scan as a fallback.
4. **Prepare images.** Apply the user/AI image switches, check existing permission for explicit supported OpenAI previews, resolve saved file references and download sequentially. OpenAI previews go through the bounded background reader. Temporary failures get up to three attempts, refreshing available download links; successful earlier images remain prepared. Validated bytes are embedded for offline HTML/PDF viewing.
5. **Stage and save.** Large direct HTML/PDF documents are split into numbered parts and temporarily staged in local IndexedDB. HTML parts download sequentially; PDF opens a print view with separately selectable parts. Stop or an image error offers saving the complete prepared prefix or discarding it. Partial output is clearly labelled, and the incomplete message is excluded. Temporary data is cleaned up after completion/discard under the documented lifecycle.

Selected messages, temporary chats and Gemini use the page reader. The separate multi-chat ZIP workflow requests selected conversations sequentially and remains text-only. There is no cloud conversion service, developer upload or automatic image search.

## What caused the failures

Virtualized chats do not keep the whole conversation in the visible page. Rich responses also contain internal component structures rather than ordinary Markdown. Relying on mounted content could miss earlier cards, while parsing component text as Markdown exposed tags or rejected supported layouts. Direct branch reading plus the local static renderer handles the supported cases without scanning the page.

The image-156 failure had two distinct causes. First, page fetches could not read OpenAI preview responses that lacked CORS permission; direct export now uses the existing extension background reader. Next, Firefox had not granted that reader image-host access. This used to be detected only after 155 previous downloads; explicit previews now trigger a permission check before image preparation. Retries address temporary transport errors, while persistent failures retain the explicit partial-save choice.

## Validation

All **295 automated tests pass**. Code and assets are unchanged from test 11; only release documentation, including privacy-policy wording, changed during signing preparation. All 46 runtime files in the signed XPI match the submission, allowing semantically identical manifest formatting and five added Mozilla signature files.

The maintainer reported that the affected real conversation saved **all images across 66 HTML parts**. This is a user-confirmed result; the final 66 files have not been independently counted or compared with the source conversation. Earlier diagnostics reported 478 images. A separate synthetic 670-message/478-image regression verifies that missing permission stops before any image requests and that granting access allows all messages and images to finish in order.

The six real preview files at the previously failing gallery boundary were also replayed through the production transport and renderer, preserving their bytes and order. That replay simulates CORS and permission APIs; it is not a complete real-chat or new Firefox permission-dialog test. Earlier isolated Firefox checks are documented in the individual test reports.

## Permissions and limits

The only added permission relative to 0.5.7 is **`scripting`**. Host scopes are unchanged: ChatGPT, Gemini and OpenAI's image host. Image downloads omit session credentials to other origins; no developer uploads, telemetry or remote executable code are introduced.

The internal ChatGPT data format can change. Unsupported interactive components can still stop export. Available image bytes may be previews rather than the original Download files. Preflight permission checks cover explicit supported preview URLs in the normalized image list, not remote file-pointer destinations. Third-party images without a saved supported preview can still fail under their host's access rules.

Large direct HTML/PDF exports use numbered parts to bound memory. PDF parts are printed separately. The multi-chat ZIP archive remains text-only. Gemini and selected-message export retain their existing page-based behavior.

## Release files

Download from the [0.5.8 release](https://github.com/vaulthunt3r/dialogue-export/releases/tag/v0.5.8):

- **`Dialogue-Export-v0.5.8-signed.xpi`** — Firefox installation.
- **`Dialogue-Export-v0.5.8-release-kit.zip`** — complete bundle with the signed XPI, runtime/source archives, documentation, checksums and the existing English 0.5.6 feature tour.
- **`Dialogue-Export-v0.5.8.zip`** — unsigned runtime for inspection or temporary loading.
- **`Dialogue-Export-v0.5.8-source.zip`** — development source, tests and final release documentation.
- **`Dialogue-Export-v0.5.8-AMO-source.zip`** — exact source archive supplied to Mozilla; its runtime is identical.
- **`SHA256SUMS.txt`** — component and release-kit hashes. The copy inside the kit covers its components.

Signed XPI: 325,510 bytes, SHA-256 `24031ddf0026bce232aa6c215ada3a2e2bbbf5cb10edaeac331b855cadb943c3`. The submitted runtime was rebuilt from its source with identical ZIP bytes. See the [Mozilla submission record](AMO_SUBMISSION-v0.5.8.md).

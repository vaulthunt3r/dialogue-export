# Dialogue Export 0.5.6 — faster exports and ChatGPT ZIP archives

November 17, 2026. Mozilla-signed Firefox release.

[Install the signed XPI](https://github.com/vaulthunt3r/dialogue-export/releases/download/v0.5.6/Dialogue-Export-v0.5.6-signed.xpi) · [All downloads](https://github.com/vaulthunt3r/dialogue-export/releases/tag/v0.5.6) · [60-second feature tour](https://github.com/user-attachments/assets/c4a84b92-d3b3-4237-879a-082efc998ac2)

## Changes

- Saved ChatGPT conversations can export directly to TXT, Markdown, HTML and PDF, avoiding page scrolling when supported. Conversation identity and the connected current branch are checked. Unsupported variants fall back to page collection with a visible explanation.
- Preserve Markdown code fences and indentation. Direct HTML/PDF uses a locally bundled Markdown parser for code blocks, tables, lists and headings.
- Include supported images from user messages and AI responses, with separate switches and optional source, dimensions and quality labels. Downloaded raster bytes are not re-encoded; equivalence to the service's original Download file is not guaranteed.
- Large direct ChatGPT HTML/PDF exports split into numbered parts. HTML parts download sequentially; PDF parts share a preview with navigation and are printed separately. Existing resource limits still apply.
- A compact monochrome dialogue icon opens the ASCII-style menu in the free right margin. Export stays accessible while settings scroll. Persistent status, elapsed time, Stop and optional generic notifications make completion easier to notice. Notifications are off by default and require optional permission. If the page icon only appears after a toolbar click, enable the site's persistent Firefox access or use **Show icon automatically** in the toolbar popup.
- **[ZIP]** opens ChatGPT history selection in a separate local tab. Load active and optionally archived chats, search, select entries across pages or select all found chats, then save TXT/MD/HTML/normalized JSON in bounded ZIP parts with indexes and reports.
- Failed chats are listed with explanations and codes while other chats continue. A terminal read error attempts to save the already prepared ZIP remainder and a report. Progress distinguishes ready files from confirmed downloads. Unconfirmed downloads are never labelled saved or silently retried.

## Known limitations

The history ZIP is **text-only**: it does not download images, include PDF, Working / Thinking sections or alternative response branches. JSON contains the exported current-branch message model, not the full raw account response. The list comes from ChatGPT; project-chat coverage is unverified. This release does not promise a complete account backup or automatic resume.

A real 42-chat Markdown archive run processed the entire selection: **36 saved, six rejected**. Four rejections were `RICH_REFERENCE` (unsupported rich markers/references), one was `MESSAGE_TYPE` (unsupported content type), and one was `RESPONSE_UNFINISHED` (a saved message was not marked finished). No unattempted chats or unsaved prepared files remained. These parser cases are documented, not fixed; further examples will be collected through issues. Try exporting an affected chat separately from its page. Reports contain titles/IDs, so share only the relevant codes unless comfortable disclosing more.

Very long or image-heavy exports remain bounded by response, per-image, per-message and output limits. The user confirmed one image-bearing chat exported into three HTML/PDF parts, but this does not establish coverage of every chat or cap total browser RAM. ZIP with separate original image files remains on the wishlist. Temporary chats, Gemini, Selected messages, activity sections and some unsupported cases still use page collection.

Explicit Stop or closing the archive tab cancels unsaved archive work; completed downloads remain. Source loss can stop reading, with prepared chats saved when downloading remains available. Check Firefox Downloads if a download could not be confirmed. PDF completion means layouts are ready, not that PDFs have already been saved.

## Validation

202 automated tests pass before release-only packaging changes; all 44 focused final archive/UI/HTML checks also pass. Isolated Firefox 160.0 checks already cover direct text export, HTML/PDF media and pagination, multipart output, archive formats and navigation. A 42-chat synthetic terminal-error fixture saved 36 chats in a ZIP after three content rejections and HTTP 502 at chat 40; Python independently verified CRCs, all entries, indexes, UTF-8 and code fences. The user's subsequent real run confirmed all 42 were processed and the 36 supported chats saved. No actual user conversation data is included in the packages.

The final runtime preserves test 14's export algorithms. Release changes remove test labels and retain the exact upstream Markdown library bytes and source map for reproducible review; executable parser code is unchanged. See [signing instructions](AMO_SUBMISSION-v0.5.6.md), [test 14 evidence](TEST-v0.5.6-test14.md), and earlier versioned test notes.

## Files

- `Dialogue-Export-v0.5.6-signed.xpi`: Mozilla-signed package for permanent installation in Firefox 142 or later.
- `Dialogue-Export-v0.5.6.zip`: unsigned runtime, byte-identical to the package submitted for signing; use for temporary installation or inspection.
- `Dialogue-Export-v0.5.6-source.zip`: development sources, tests, lockfile, release documentation and trailer sources; not an installation package.
- `Dialogue-Export-v0.5.6-AMO-source.zip`: exact source archive supplied for Mozilla review, preserved before publication documentation and video were added. Both source archives contain the same extension runtime.
- `Dialogue-Export-v0.5.6-release-kit.zip`: all release files, documentation, trailer and checksums in one download; extract it before selecting the signed XPI.
- `Dialogue-Export-0.5.6-trailer-EN.mp4`: one-minute English feature tour with fictional demonstration data and original music.
- `SHA256SUMS.txt`: package and document checksums.

The signed XPI was compared with the exact AMO submission: all 43 runtime files match, except byte formatting in manifest.json whose parsed contents match. Mozilla added five META-INF signature files. The submitted runtime ZIP SHA-256 is `14fa20d9a4d5d44b2b948144636c1278ef2349b6f8a607b472f5f2798f950d59`; the signed XPI SHA-256 is `39f6a0a0e4f19813b991f18842183c2a8d513b166757b4bda767c8bc34cfe5b8`.

## Acknowledgment

The direct-reading approach was inspired by [John2022's ChatGPT Conversation Export](https://github.com/John2022/chatgpt-conversation-export). The new reader complements Dialogue Export's existing page collector; it does not replace every collection path. Gemini retains page-based current-chat export and is not part of the direct ChatGPT or history ZIP features.

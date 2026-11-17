# 0.5.6 test 2 - direct ChatGPT HTML/PDF

Unsigned local test build. Not submitted for signing or published. Published version 0.5.5 and the archived test 1 packages are unchanged.

## User validation already received

The user reported a quick, complete Markdown export with more than 35,000 lines, then confirmed that TXT of the same conversation was also quick and complete. These are user-reported checks, not an independent line-by-line audit or timed benchmark. Direct HTML/PDF now needs live user testing.

## Install and test, in order

1. In `about:debugging#/runtime/this-firefox`, remove the previous temporary test add-on and load `release/0.5.6/test2/runtime/manifest.json`. The version remains 0.5.6; the **test2 folder** distinguishes this build. Reload the ChatGPT tab.
2. On the same saved long text conversation, select **All -> HTML**, with **Include Working / Thinking off**. The final detail should say **direct HTML export**. Check first/middle/last messages, role order, code indentation/language labels, headings, lists, tables and links.
3. Export that chat as **PDF**, with **Compact PDF pagination on**. The detail should say **direct PDF export**. Check both the prepared document and Firefox's Save as PDF preview. Downloading the conversation and laying out many printed pages are separate stages; print layout can take longer.
4. Use a smaller conversation containing a generated/uploaded image, a diagram, a table and a code block. Export HTML, then PDF. Check placement, image count and code. Open the saved HTML offline to verify embedded images. Mermaid/code-form SVG stays a code block; it is not automatically executed or drawn.
5. Only after that check, try a larger image conversation. Limits still apply: this is not a claim that the earlier OOM/incomplete-image case has been fixed. ZIP originals and automatic multipart export are not implemented.

When something fails, report format and the exact status/error. A synthetic conversation or minimal anonymized example is sufficient; no browser control or private chat dump is required.

## Behavior and limits

- ChatGPT All TXT/MD/HTML/PDF uses the direct reader when supported. JSON, Gemini, Selected, temporary chats and activity export retain the page collector. Unknown content variants and generated-image tool results that cannot be mapped to visible messages use page collection with an explicit status reason.
- HTML/PDF uses bundled markdown-it 15.0.3 with raw HTML disabled. Tables, nested lists, quotes, headings, inline code and fenced code render locally. Language labels are preserved; full original syntax-color reproduction, mathematical typesetting and Mermaid rendering are not implemented by this reader.
- Supported image references include image parts, image attachments, exact image galleries in content references and Markdown images. The reader recognizes file-service/sediment pointers and sandbox image paths. These depend on internal ChatGPT endpoints and need real-account validation for the various image types.
- Supported image bytes: PNG, JPEG, WebP, GIF and a conservative subset of basic static SVG. Raster bytes are embedded without re-encoding. The URL may still supply a preview, so this is not a guarantee of original download quality. Unsupported SVG active content/styles/external resources are rejected.
- Images are downloaded/decoded sequentially, repeated references reuse cached results, and all caches are export-local. A blocked, unavailable, invalid or oversized image stops direct export without saving a partial file. A failed embedded image decode also leaves the direct PDF print button disabled.
- Limits: 32 MiB conversation response, 16 Mi characters output, 8 MiB per downloaded image, 16 Mi pixels per image, 24 Mi pixels across distinct prepared image references, 128 image occurrences, 60 seconds per image/download-reference request. These are allocation safeguards, not a hard cap on Firefox's total memory.
- Authorization is sent only to same-origin ChatGPT endpoints. Other image hosts receive GET requests with cookies and referrer omitted, without the ChatGPT token. Redirects are not automatically followed. Browser CORS restrictions can prevent some external images from embedding. No new extension permissions or remote code.
- Credential-free export metadata and cancellation/identity checks from test 1 remain. An invalid current branch is never replaced by a chronological flattening of all branches.

## Verification

November 17, 2026: full suite **141/141 passed**, followed by **39/39 focused checks** including two added image cancellation/decode regressions. Production runtime did not change after the successful Firefox visual run.

- Unit suite: covers original direct-text behavior plus HTML structure, code whitespace, link controls, script/attribute escaping, image ownership and deduplication, download authentication boundaries, sandbox mapping, image limits, static SVG filtering, missing image failure, unsupported tool-image fallback and PDF decode failure.
- Isolated Firefox 160.0 MV3 test: 1200 synthetic messages in each of TXT, Markdown, HTML and PDF; first/middle/last and code checked. Uses only a loopback server and a fresh profile, never personal tabs/accounts. Production code is used with only the ChatGPT origin redirected to that fixture.
- A separate six-message subset is used for visual checks to avoid printing the entire synthetic stress conversation: PNG at 640 x 160, static SVG, nested list, table and a 65-line code block. All images decode, following messages do not overlap them, and exact code survives. Both ordinary HTML printing and the extension PDF page generate four-page PDFs with matching extracted text.
- PDFs rendered with bundled Poppler and inspected. Long code continues across pages; short code's language label stays with its body. The final message and every code line remain present.
- `npm install --ignore-scripts` reported no known vulnerabilities in the installed dependency set at build time. Vendored parser and bundled dependency licenses accompany the runtime. `scripts/vendor-markdown.cjs` reproduces the parser copy from the pinned lockfile.

Evidence files (local): `release/0.5.6/html-unit-tests.log` and `release/0.5.6/api-html-firefox/{result.json,export.html,print.html,export.pdf,print.pdf,page-*.png}`. This is not a benchmark of the user's live ChatGPT or proof of every image variant.

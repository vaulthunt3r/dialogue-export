# 0.5.5 — release verification

Prepared and returned from Mozilla signing on October 24, 2026. The release uses the runtime confirmed as test 8; its only code difference is removal of the popup's test label. The user reported that a very long text conversation exported correctly. The signed XPI contains the same 23 runtime files as the exact submission; the only differences are manifest formatting (parsed settings are identical) and added `META-INF/` signature metadata. Its SHA-256 is `c88285803926b0cc02f7df63832b5b89ac41cdacc4cbbeed17c4ce45d390de19`.

## Automated and browser evidence

Final release validation: `npm test` passed all 107 tests with no failures or skipped tests. Coverage includes modern/legacy message identification, hidden/foreign routes, virtualized ordering, a synthetic 1,211-message conversation requiring over 1,200 forward steps, slow-image waits, blocked decorative favicons, image-only replies, gallery flow, code blocks, timestamps, activity sections, UI state, resource limits, cancellation and diagnostic privacy.

Isolated Firefox 158.0.1 preserved an embedded 1448 x 1086 raster, static SVG and canvas in both HTML and PDF. The same fixture blocks a `t0.gstatic.com/faviconV2?...&size=32` request with a local content-security policy: export proceeds while the three content images remain embedded. PDFs were rendered with Poppler and visually checked. Separate code-block checks retained exact loaded text and indentation across a printed page boundary. These tests used temporary profiles and synthetic or user-supplied local fixtures, not control of the user's signed-in browser.

A real supplied export confirmed capture of a generated-image reply. Its fixed-height gallery was repaired and verified with unchanged image data and message text. A subsequent user test confirmed the long text-chat export after the favicon fix. This confirmation is not an exhaustive independent audit of every message or every ChatGPT interface variant.

## Known unresolved scope

A previous very long image-heavy chat exported only a small fraction while displaying success; later image-loading testing exhausted memory. The stage and memory profile of that OOM are unavailable. The same heavy conversation has not been revalidated with this release. Do not describe the long-text success as a fix for all image-heavy completeness failures.

Resource-limit errors stop the whole export before handoff and do not intentionally save truncated output. However, general collection coverage still depends on the site's loaded DOM and virtualizer. Check the beginning, middle and end of important files against the source. Automatic splitting into numbered parts is not implemented in 0.5.5. Peak browser memory and end-to-end speed improvements have not been measured.

## Resource handling

Budgets are fixed and conservative, not based on free system RAM: at most 128 captured media assets, 24 Mi pixels (25,165,824 pixels; about 96 MiB for one RGBA representation), and 16 Mi data-URL characters per collection. Serialized message fields and each rendered file are capped at 16 Mi characters. Background handoffs retain at most 32 Mi characters. These limits do not cap the website, Firefox, its DOM/serialization overhead or print engine.

At most two source decodes are pending at a time. HTML/PDF omit the unused Markdown image copy; selected export skips unselected captures. Collection maps and media caches clear on success, failure and cancellation. Scratch canvases release their backing buffers. The print page adopts parsed nodes and drops serialized HTML. Background print payloads are consumed once or expire after one minute; reloading a prepared tab requires a new export. Download Blob URLs release on terminal states, errors or a ten-minute fallback. Stop is available during collection before file handoff.

## Image, formatting and identity limits

HTML/PDF waits up to 60 seconds per mounted window for content images and delayed tiles. Waiting time does not consume scroll-progress deadlines. Lazy attributes restore on success/failure. Decorative icons and activity media excluded from the output are filtered consistently from waiting and capture. Recognized Google favicon endpoints are ignored for small icon requests even before dimensions are known; explicit content containers remain protected. Small dimensions or empty alt text alone never exclude an ordinary image. Failed unclassified content images stop with an error. TXT/Markdown/JSON do not add the source-image wait.

Raster capture preserves the page's loaded resolution, which may be a preview. Capture is limited to 16 million pixels and 12 million data-URL characters per image. Readable SVG uses a static allowlist; unsupported elements receive notices. Unreadable HTTP(S) images can remain labelled external references that expire or require login; inaccessible blob content receives a notice. Interactive apps, inaccessible frames and attachments outside recognized containers remain limitations. CodeMirror exports retain loaded lines; virtualized editor gaps are marked, not reconstructed.

Modern identifiers are used only when present. Missing or ambiguous modern identities stop export. The original third-party reporters did not supply their DOM/version, so their exact failures remain unverified.

## Opt-in diagnostics

Image failures capture bounded structural data at the failure point before scroll restoration can unmount the node. The error panel exposes Image diagnostic details. The local `scripts/image-failure-diagnostics.js` can copy that saved record, or sample failed images for up to 60 seconds. It retains at most six snapshots, scans at most 500 images, and keeps at most 16 candidates with ten ancestors each. Values are allowlisted; no message text, URLs, IDs, cookies or pixels are included. It makes no network requests and does not scroll or decode images.

`scripts/collection-diagnostics.js` is also opt-in and not injected by the extension. It retains at most 2,000 changed samples with at most 64 anonymous aliases each and 20,000 mappings; it stops after completion or one hour. It records counts, scroll geometry and progress, with explicit truncation flags. Neither script uploads reports. Private user reports and local test outputs stay outside the runtime/source packages.

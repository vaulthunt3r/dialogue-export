# Dialogue Export v0.5.5 — images, code blocks and long-conversation fixes

## What changed

HTML/PDF exports can now include loaded images, generated-image replies, static SVG diagrams and readable canvas snapshots. Image-only replies keep their own message identity and position. Generated-image galleries use normal document flow so large pictures do not cover the following message.

Modern ChatGPT code blocks retain their loaded lines, indentation, blank lines, language label and supported syntax colors. Compact printing allows long code blocks to continue across pages. Unloaded editor gaps are marked rather than reconstructed.

The collector accepts additional existing ChatGPT message identifiers, preserves ordering across virtualized windows and no longer stops at fixed 300-batch/1200-step ceilings. Ambiguous identities and stalled collection still stop with an error.

Content images are awaited before their window is captured. Decorative icons and activity media omitted from the output are excluded consistently from waiting, capture and resource accounting. In particular, a blocked Google `faviconV2` icon in a citation no longer prevents a text conversation from exporting. The runtime tested as **0.5.5 test 8** successfully exported the user's very long text conversation; the user confirmed the result on October 24, 2026.

## Memory handling and remaining limitations

**Large or image-heavy conversations are not yet reliably validated.** An earlier image-heavy export saved only part of a chat while reporting success, and later testing produced an out-of-memory failure. The same heavy chat has not been revalidated with this release. Verify the beginning, middle and end of important saved conversations, and do not rely on this release as the sole archive of a large image-rich chat.

The extension now limits collected media and serialized data, prepares at most two source-image decodes at once, avoids unused HTML/Markdown copies, releases export caches and scratch canvases, and offers **Stop** during collection. Exceeding a resource limit aborts the export explicitly; it does not intentionally save a truncated file. These safeguards are not a guarantee about total browser memory, and no measured peak-RAM reduction is claimed.

Images retain the resolution already loaded by the page, not necessarily the full-resolution original. Unreadable HTTP(S) images may remain labelled external references; unavailable blob content and unsupported diagram elements receive notices. Failed or timed-out content-image loading stops collection. Interactive applications, inaccessible frames and visual content outside recognized messages remain unsupported or incomplete.

**Automatic splitting into numbered parts is not included in 0.5.5.** It remains future work, together with further validation of very large image-heavy conversations. A prepared PDF tab can be printed normally, but reloading it requires a new export.

## Validation and privacy

The release keeps the tested runtime from test 8; only the popup's test label is removed. Automated coverage includes long virtualized collection, media, formatting, resource limits, cancellation, diagnostics, timestamps and existing UI behavior. Local Firefox checks preserve a raster, SVG and canvas in both HTML and PDF while a favicon request is blocked; the PDF was rendered and visually inspected. See [validation details](TEST-v0.5.5.md).

The successful long-text user test is distinct from the unresolved image-heavy case. The original third-party reports did not include their DOM or version, so their exact interface variants are not all verified.

No permissions were added. Processing remains local; there is no telemetry, remote code or conversation upload. Firefox may load the conversation page's existing lazy image URLs. Exported external image references may request their original host when opened. On failure, optional diagnostic details contain structural flags and dimensions, with no conversation text, URLs, IDs, cookies or pixels.

## Wishlist — not included in 0.5.5

- A ZIP export with the conversation and separate original image files, where the service exposes authorized access to the originals. A saved preview must never be labelled as an original.
- Automatic numbered parts for large exports, preserving message order and image associations with an index and explicit completeness checks.
- Further investigation of incomplete image-heavy collection and peak memory use.

See [the wishlist](WISHLIST.md). These items have no promised delivery date.

## Installation and release files

Download **Dialogue-Export-v0.5.5-signed.xpi**, the Mozilla-returned package for permanent installation in Firefox 142 or later. Open `about:addons`, choose the gear menu, select **Install Add-on From File**, and choose the XPI. Reload ChatGPT/Gemini after updating.

The signed XPI was compared with the exact AMO submission: all 23 runtime files are present, only manifest formatting differs, parsed manifest settings are identical, and the only added files are signature metadata under `META-INF/`.

- **Dialogue-Export-v0.5.5.zip** — runtime files for temporary installation: extract, open `about:debugging#/runtime/this-firefox`, choose **Load Temporary Add-on**, then select `manifest.json`.
- **Dialogue-Export-v0.5.5-source.zip** — complete development sources, tests and documentation; not an installation package.
- **Dialogue-Export-v0.5.5-release-kit.zip** — the signed XPI, runtime/source ZIPs, release notes, wishlist and component checksums together.
- **SHA256SUMS.txt** — SHA-256 checksums for the attached packages and documents. The kit contains its own component checksums.

The release kit is a distribution bundle for the extension; it is unrelated to the proposed conversation ZIP export above.

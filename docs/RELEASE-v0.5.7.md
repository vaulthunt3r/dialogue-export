# Dialogue Export 0.5.7 — ChatGPT cards and image previews

November 22, 2026. **[Install the Mozilla-signed XPI](https://github.com/vaulthunt3r/dialogue-export/releases/download/v0.5.7/Dialogue-Export-v0.5.7-signed.xpi)** — Firefox 142 or later. Reload ChatGPT after updating.

## Changes

- ChatGPT thumbnail cards export as rendered cards instead of internal `box`, `AsyncImage`, `Entity` and related markup. Preserve supported thumbnail/text rows, badges and links in HTML/PDF.
- Fix misplaced or missing thumbnails when cards contain hidden icons.
- Embed supported OpenAI image previews when browser origin restrictions prevent canvas capture. The extension requests `images.openai.com` access for these downloads; a missing permission has an explicit **Allow image access** action.
- Avoid scrolling when the complete rendered conversation matches the current API branch by message IDs, roles and order. Ordinary supported direct exports remain fast; other page-collected cases may still need scrolling.
- Distinguish permission, network, server, decoding and size-limit failures. Diagnostics contain fixed codes and optional HTTP status, without conversation text or image URLs.
- Remove generated source/size/quality captions and their setting. User/AI image switches remain, and existing details preferences no longer add technical text to exports.

## Why the export differed from ChatGPT

Some responses contain internal visual-component markup that ChatGPT turns into cards. Treating that source as ordinary Markdown exposed its tags and indentation in exported files. The page collector now preserves supported rendered card layouts instead.

Some preview hosts allow an image to be displayed but do not allow the page to read its pixels. Earlier exports therefore retained an external link or stopped. Supported OpenAI previews now use bounded background downloads without cookies, session tokens or referrers. Removing hidden elements before pairing original and cloned media could also shift thumbnails; that ordering is corrected.

## Validation

219 automated tests passed. Isolated Firefox 160.0.1 checks covered card/thumbnail alignment, a narrow viewport, offline embedded images, HTML/print output, image permissions and verified eight-message collection without scrolling. The maintainer confirmed the affected HTML export with test 4. All 45 final runtime files match that approved build exactly.

## Limits

This is not a pixel-exact archive of every interactive ChatGPT widget. Image bytes may be previews rather than the original files offered by ChatGPT's Download button. Large rich conversations that use page collection retain its existing media/memory limits; direct-export multipart support does not automatically extend to that fallback. ChatGPT history ZIP remains text-only, with the previously documented unsupported content cases. Gemini retains its existing page-based export.

## Release files

Download files from the [0.5.7 release](https://github.com/vaulthunt3r/dialogue-export/releases/tag/v0.5.7):

- **`Dialogue-Export-v0.5.7-signed.xpi`** — Firefox installation.
- **`Dialogue-Export-v0.5.7-release-kit.zip`** — complete bundle with signed XPI, runtime and source archives, documentation, checksums and the existing English 0.5.6 feature tour.
- **`Dialogue-Export-v0.5.7.zip`** — unsigned runtime for inspection or temporary loading.
- **`Dialogue-Export-v0.5.7-source.zip`** — development source, tests and final release documentation.
- **`Dialogue-Export-v0.5.7-AMO-source.zip`** — exact source archive provided for Mozilla review; the runtime is the same.
- **`SHA256SUMS.txt`** — component and release-kit checksums. The checksum file inside the kit covers its components.

All 45 runtime files in the signed XPI were compared with the submitted package. Only manifest whitespace and five added Mozilla signature files differ. Signed XPI SHA-256: `df3062c90e3e8da2437028a5366cbe4d071857d4ea941ce805d32fa24d02c9ef`. See the [AMO submission record](AMO_SUBMISSION-v0.5.7.md) for reproduction instructions.

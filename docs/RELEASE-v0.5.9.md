# Dialogue Export 0.5.9 — saved images and faithful card exports

November 27, 2026. **[Install the Mozilla-signed XPI](https://github.com/vaulthunt3r/dialogue-export/releases/download/v0.5.9/Dialogue-Export-v0.5.9-signed.xpi)** — Firefox 142 or later. Reload ChatGPT after updating. Runtime code and assets are frozen at test 6.

## Changes

- Resolve supported saved image queries through their exact DIL component result IDs, including DIL content references. This fixes an image reference that was present in saved data but previously unrecognized. No image search, URL guessing or execution of saved code is involved.
- Allow a verified rendered answer alongside generated-image records from different user turns. Keep the duplication guard when both belong to the same turn.
- Render nested immutable prompt bindings and preserve their whitespace and paragraph breaks. Supported prompt cards no longer require that answer to be mounted on the page. Copy controls remain passive in exported files.
- Support observed citation shorthand, grid items, titles, text sizes, borders, tabular numbers and bounded numeric formatting. Preserve ordinary code examples as literal code.
- Keep semantic status icons in rendered answers and thin padded dividers. Direct rendering provides local check, warning and copy icons; other names use the existing verified rendered-answer fallback. Content icons remain part of the layout when image downloads are disabled.
- Improve bounded structural diagnostics for unsupported components and unresolved image references. Add an offline Markdown corpus audit for development checks against supplied source files.

## Validation

All **318 automated tests pass** on the frozen runtime. Targeted browser checks cover exported card appearance, image decoding and HTML/PDF preparation. The latest comparison reproduces the missing icons and gray bars with test 5, then verifies four 18px icons and two 1px divider lines with test 6. Its reconstructed card uses the supplied export, observed source separator styling and equivalent generic vectors; it is not a fresh full Firefox export.

The maintainer confirmed successful export of the earlier image-bearing conversation after the prompt-binding fix, then accepted the final build for signing. This is user confirmation, not an independent audit of every exported image or file. The full test history and coverage limits are in [test 1](TEST-v0.5.9-test1.md), [test 2](TEST-v0.5.9-test2.md), [browser checks](TEST-v0.5.9-browser.md), [test 4](TEST-v0.5.9-test4.md), [test 5](TEST-v0.5.9-test5.md) and [test 6](TEST-v0.5.9-test6.md).

## Permissions and limits

No permissions, host scopes or runtime dependencies are added relative to 0.5.8. Parsing remains bounded and local. Conversation JavaScript, event handlers and remote executable code are not run. Private chat exports and diagnostic artifacts are excluded from distributable packages.

The internal ChatGPT format can still change. Unsupported components may require an already mounted answer whose identity can be verified; unavailable required content stops export. Saved chats never trigger an automatic scrolling fallback. Available image bytes can be previews. PDF verification covers preparation, not a new printed-page comparison, and the multi-chat ZIP workflow remains text-only.

## Release files

- **`Dialogue-Export-v0.5.9-signed.xpi`** — Firefox installation.
- **`Dialogue-Export-v0.5.9-release-kit.zip`** — complete bundle with the signed XPI, runtime/source archives, documentation, checksums and the existing English 0.5.6 feature tour.
- **`Dialogue-Export-v0.5.9.zip`** — unsigned runtime for inspection or temporary loading.
- **`Dialogue-Export-v0.5.9-source.zip`** — development source, tests and final release documentation.
- **`Dialogue-Export-v0.5.9-AMO-source.zip`** — exact source supplied to Mozilla; its runtime is identical.
- **`SHA256SUMS.txt`** — component and release-kit hashes. The copy inside the kit covers its components.

Download from the [0.5.9 release](https://github.com/vaulthunt3r/dialogue-export/releases/tag/v0.5.9). All 46 runtime files in the signed XPI match the submission, allowing equivalent manifest formatting and five added Mozilla signature files only. The submitted source reproduces the runtime ZIP byte for byte. Signed XPI: 331,715 bytes, SHA-256 `f58dc193f6ed2fdb3611bb5d26892f444733a4bc92481c6cf088c95ca1605877`. See the [Mozilla submission record](AMO_SUBMISSION-v0.5.9.md).

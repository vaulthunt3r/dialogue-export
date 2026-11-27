# 0.5.9 test 6 — status icons and thin separators

November 27, 2026. Follow-up to a successful export with damaged card styling.

## Evidence and cause

The supplied HTML contains 56 messages. Its diagnostic card has two dividers with background and 8px vertical padding, but no content clipping or content-box sizing. All four status icons are absent. The supplied Markdown explicitly includes two `check-circle` and two `alert-triangle` icons.

Read-only inspection of the live answer confirmed 18px inline SVG components and dividers with a 1px content height, `background-clip:content-box`, `box-sizing:content-box` and 8px vertical padding. The old exporter classified the small vectors as decorative UI and copied only part of the separator styling.

## Changes

- Preserve visible `data-d-component="icon"` vectors as sanitized embedded inline images, keeping their computed dimensions and colors. Exclude hidden elements and UI controls. Reuse the SVG sanitizer; external or unsupported visual resources cannot silently produce an incomplete icon.
- Treat these icons as part of the text layout, retaining them when answer image downloads are disabled without inserting image placeholders into extracted text. Ordinary media retains its existing capture and budget behavior.
- Preserve small empty component dividers' computed height, box sizing and background clipping. Text containers and comparison charts keep their existing rules.
- Direct rendering includes inert local equivalents of the observed check, warning and copy icons. Other icon names use the existing verified rendered-answer fallback instead of being silently discarded; an unavailable required answer can still stop export.

Only `content/components.js`, `content/extract.js` and `content/media.js` change in the runtime relative to test 5. Manifest and permissions are unchanged.

## Validation and limits

- All 318 automated tests pass. The exact status-card block from the supplied Markdown renders four icons and two separators; its normalized text matches the supplied HTML card.
- Regression coverage includes both image settings and HTML/PDF preparation, four inline icons, separator styling, SVG sanitization, hidden/control exclusion, following-image pairing and direct source rendering. The mixed search/generated-image integration still checks all 26 content images separately from the newly retained copy icon.
- Built-in browser comparison uses the supplied HTML's status card, reconstructed with the source-observed divider properties and equivalent generic vectors. The old runtime reproduces the missing icons and gray bars; the new runtime passes all four format/image-setting combinations. All icons decode and measure 18 × 18px. Both divider lines measure 1px inside a 17px padded box. No horizontal overflow or console errors were observed.
- This is a local rendering verification, not a fresh full Firefox export or a printed-PDF comparison. The full supplied Markdown still needs the existing rendered fallback for a separate SVG attribute; that already-successful export path is unchanged.
- The user reported that test 5 successfully exported the earlier image-bearing conversation. This is user confirmation, not an independent audit of all its output files.

Private exports, local replay pages and browser evidence remain in ignored `release/0.5.9/`, outside the source and runtime packages. Test 5 remains intact. No signing, publication or commit is performed.

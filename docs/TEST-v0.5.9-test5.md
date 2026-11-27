# 0.5.9 test 5 — local prompt bindings in saved layouts

November 27, 2026. Follow-up to the user's failed test 4 export.

## Exact reproduction

The new diagnostic was `unsupported-static-component`, component `box`, phase `parse`, at exported message 12. Rendered fallback reported nine mounted messages, no matching required answer, and a missing message at position 12. Weakening branch validation would not make that absent answer available.

The user then supplied the conversation's Markdown export. Its prompt card contains a nested `{@body const prompt = "..."}` followed by `<text size="sm" preserveWhitespace>{prompt}</text>` and a copy button. The old parser treated the body declaration as an ordinary interpolation and rejected it. Replaying the supplied file before the change reproduced `box / parse` in HTML, PDF preparation and JSON's rendered HTML.

## Change

- Parse only single immutable `const` declarations within layout child sequences. Initializers use the existing bounded static expression interpreter; the code does not compile or execute JavaScript.
- Resolve later references in a local sequence scope. Child layouts and loop iterations isolate bindings; names cannot leak into another layout/message. Reject duplicate bindings, forbidden names, uninitialized self-references, arbitrary statements, assignments, destructuring and function calls.
- Preserve whitespace with `white-space:pre-wrap` when the text attribute is enabled. The copied prompt's literal markup and Markdown punctuation stay escaped text. The copy button remains a passive label in the export.
- Keep image transport, permissions, scrolling behavior and rendered-branch checks unchanged. This answer can now use direct rendering, so its missing-page fallback is no longer needed.

## Verification

- **315 automated tests passed**, including the original 26-image mixed export with the new prompt card, HTML/PDF/JSON prompt rendering, literal text, scopes and rejected executable statements.
- All **47 messages present in the supplied Markdown** pass HTML/PDF/JSON preparation without mounted page content. The prompt has all **1048 characters and five paragraphs**; the table remains present. The Markdown does not contain the generated-image messages, which explains the difference from the original rich export's 68 records.
- In the authorized in-app browser, replayed the entire supplied text with the four actual retained search JPEGs and explicitly reconstructed image-reference metadata. Production rendering and real image decoding passed for HTML and PDF preparation: 47 messages, four embedded images, one table in the affected answer, correct prompt paragraphs, no image overflow and no console errors.
- Compared the affected exported answer with the live page: both have 2355 characters after whitespace normalization and the same FNV-1a text fingerprint `8cc5333b`. Both have four images, one table and the 1048-character prompt. Inspected the exported prompt and images visually.
- Package verification checks ZIP/XPI/source hashes, equality with tested workspace/browser scripts and unchanged manifest. Only `content/components.js` and `content/markdown.js` differ from test 4 at runtime. Private Markdown, reconstructed metadata, retained images and browser evidence are excluded from distributable archives.

This verifies the reported parser failure using the actual supplied source. It does not claim a full live Firefox export or live image-download verification: the browser replay reconstructs references and uses local image bytes. Generated outputs and user attachment bytes are absent from Markdown; their pipeline is covered by the mixed regression, not recovered from that file. No personal or isolated Firefox profile was accessed.

Load `release/0.5.9/test5/runtime/manifest.json`, reload the chat, and repeat the HTML export with images enabled.

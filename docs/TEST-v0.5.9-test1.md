# 0.5.9 test 1 — direct export of single-source citations

November 27, 2026. Local unsigned build. Runtime: `release/0.5.9/test1/runtime/manifest.json`. No signing, public release or permission-scope change.

## Reproduced cause and fix

The maintainer's eight-message MD export contains an ordinary inline citation written as `<Cite ref="..."/>` in message 2. The renderer accepted only the plural `refs` attribute. It therefore classified the singular form as unsupported and attempted to read that answer from the page. Only six of the eight messages were mounted, so export stopped until the maintainer manually opened the first answer.

The renderer now accepts the singular `ref` attribute when `refs` is absent. Both forms use the same exact saved-reference lookup, escaping, link switch and reference-count limit. An explicitly present malformed `refs` remains an error. No page loading or scrolling is needed for this citation form. This applies to HTML, PDF preparation and the rendered HTML in normalized JSON. Literal component examples remain code.

If the saved response has no citation destination, the text remains exportable with the existing `Source link unavailable` label. The extension does not guess a source URL. Other unsupported constructs still retain the existing verified-page fallback or explicit failure.

This build also includes the [structural diagnostics follow-up](TEST-v0.5.8-diagnostics.md): distinguish parsing, attributes, styles, SVG and references; preserve fixed element/type categories and the page-match reason; identify the message number. Conversation text, values, URLs and source IDs are excluded.

## Validation

- Exact supplied MD text, locally replayed through the production reader with zero mounted messages: before the fix, HTML/PDF fail with `CITATION_REFS_INVALID` in message 2 and request rendered-page content. After the fix, both process all eight messages in order, preserve all three tables and surrounding text, and make zero rendered-page requests and zero scroll calls.
- The supplied MD does not contain citation metadata. That replay therefore produces one unavailable-source label and cannot verify the original destination. Separate regression fixtures include saved source metadata and verify that the singular citation resolves to the exact source URL, excludes unrelated sources and preserves its list item.
- Production collection regression: an early answer with a singular citation exports all 40 messages through the API when only the last answer is mounted. Covered for HTML, PDF and JSON, with zero scrolling and only the session/conversation requests.
- Tests also cover plural compatibility, missing metadata, links disabled, malformed attributes and literal code. The full automated-suite result is recorded in the build's `verification.json`.

These are local reader/DOM checks, not a new live Firefox export. The real browser check still needs the test build. The supplied conversation, replay script, outputs and logs stay in the ignored local release directory and are excluded from the distributable source archive.

## Install and retry

In Firefox, open `about:debugging#/runtime/this-firefox`, choose **Load Temporary Add-on**, and select `release/0.5.9/test1/runtime/manifest.json`. Reload the conversation tab so it receives the updated content scripts. Start **All messages → HTML** while viewing the end of the chat; there is no need to open the first answer.

This is an unsigned temporary build, removed by Firefox when the browser restarts. The published signed version remains 0.5.8.

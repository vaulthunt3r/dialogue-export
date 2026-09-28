# ChatGPT interface compatibility — 0.5.2 test build

Issue: https://github.com/vaulthunt3r/dialogue-export/issues/2

The reporter's loaded conversation has neither `data-message-author-role` nor
`article[data-testid^="conversation-turn-"]`. PING succeeds with zero messages.
Their inspected user message has `data-user-message-bubble`; the assistant has
`data-chatgpt-selection-message-id`. Both have search metadata ancestors.

The change recognizes both message types and preserves DOM order. Nested old/new
markers are counted once. Modern cache keys use explicit message IDs or opaque
search/turn keys, qualified by author. A missing stable key stops export with an
explanation rather than silently overwriting other viewport messages.

The collector merges visible windows using shared message IDs. Disjoint windows
found while seeking the beginning are prepended; disjoint forward windows are
appended. Numeric suffixes of opaque keys are never used to sort messages.

## Automated validation

Run `npm install --ignore-scripts` and `npm test`.

44 tests pass, including 10 new tests covering the reported structure, both
authors, selection, links/code, mixed markers, remounted nodes, equal text,
missing stable keys, old ChatGPT/Gemini, exact-ID timestamps, and virtualized
windows with and without overlap. Existing popup, export and timestamp tests pass.

Fixtures reproduce reported attribute placement but use synthetic ID values.
The actual search-key formats, all message variants, and live scrolling behavior
have not been independently observed. User timestamps remain unavailable where
the page has no unambiguous explicit message ID. No timestamps are guessed from
search-key strings.

## Install the unsigned test build

Extract `Dialogue-Export-v0.5.2-test.zip`. In Firefox, open
`about:debugging#/runtime/this-firefox`, choose **Load Temporary Add-on**, and select
the extracted `manifest.json`. Reload the conversation after loading the build.
Temporary installations disappear after Firefox restarts. This is not a signed
XPI or a published stable release.

Check a short question/answer conversation first, then selection and a long
conversation starting in the middle or at the end. Verify authors, first/last
messages, order, duplicates, and links/code in the exported file. If timestamps
are enabled, unavailable times should be reported rather than invented.

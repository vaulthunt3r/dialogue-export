# ChatGPT interface compatibility — 0.5.2 verification

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

50 tests pass, including 16 new tests covering the reported structure, both
authors, selection, links/code, mixed markers, remounted nodes, equal text,
missing stable keys, old ChatGPT/Gemini, exact-ID timestamps, and virtualized
windows with and without overlap. Scroll cases include hidden overflow, ranges
below 100px, negative coordinates, blocked inner wrappers, and stalls. Tests also
verify restoration of the original scroll offset and inline style priorities.
Existing popup, export and timestamp tests pass.

An optional real-layout test is available as `node tests/scroll-browser.cjs`
(requires Playwright and installed Edge; optionally pass the Playwright module
path as the first argument). Three headless Edge scenarios pass: hidden overflow,
negative scroll coordinates, and a small hidden scroll range. Each loads three
virtualized batches and verifies all 12 messages in order. All page requests are
intercepted with a local fixture; no live ChatGPT traffic is used.

## Long-conversation follow-up

The reporter confirmed that build 1 detects and exports a two-message chat, but
reported that a longer chat stops at 10 collected messages without scrolling up.
Their exact scroll container styles and coordinate behavior are still unknown.

Build 2 fixes independently identified assumptions in the old scroll code:
`overflow: hidden` was excluded despite supporting programmatic scrolling,
scroll ranges below 100px were excluded, the first candidate was used without
testing movement, and nonnegative coordinates were assumed. It also bounds
no-progress failures and restores scroll position/styles on success or error.
The reporter subsequently confirmed that build 2 successfully exported a
301-message conversation on the affected interface. A quick review found the
export intact from beginning to end; they did not check every message individually.
See https://github.com/vaulthunt3r/dialogue-export/issues/2#issuecomment-5884361059.
The particular scroll-container configuration has not been independently observed.

Fixtures reproduce reported attribute placement but use synthetic ID values.
The actual search-key formats, all message variants, and live scrolling behavior
have not been independently observed. User timestamps remain unavailable where
the page has no unambiguous explicit message ID. No timestamps are guessed from
search-key strings.

## Packaging and signed release

The 0.5.2 signing package retains the runtime files tested in build 2. Only release
documentation and packaging support were updated after that test.
The Mozilla-returned XPI was compared with that package: 21 files match byte for
byte, and `manifest.json` differs only in line endings/outer whitespace. The only
additional entries are under `META-INF`, including Mozilla RSA and COSE signatures.
The supplied signed file is distributed unchanged under the descriptive release filename.
Run `powershell -ExecutionPolicy Bypass -File scripts/package.ps1` to generate
the unsigned XPI, runtime ZIP, complete source ZIP, and SHA-256 checksums under
`release/0.5.2/`. The script refuses to overwrite an existing output directory.
After signing, pass `-SignedXpi <returned-file> -OutputDirectory <new-directory>`
to build the public set with a signed XPI instead of an unsigned one. The supplied
signed file must be verified against the runtime package before this step.

Extract `Dialogue-Export-v0.5.2.zip`. In Firefox, open
`about:debugging#/runtime/this-firefox`, choose **Load Temporary Add-on**, and select
the extracted `manifest.json`. Reload the conversation after loading the build.
Temporary installations disappear after Firefox restarts. This is not a signed
XPI or a published stable release.

Check a short question/answer conversation first, then selection and a long
conversation starting in the middle or at the end. Verify authors, first/last
messages, order, duplicates, and links/code in the exported file. If timestamps
are enabled, unavailable times should be reported rather than invented.

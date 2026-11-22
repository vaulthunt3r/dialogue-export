# 0.5.7 test 1 — rendered ChatGPT cards

This is an unsigned local test build, not a published or Mozilla-signed release. The published 0.5.6 files are unchanged.

## Report and change

A November 22 screenshot showed ChatGPT thumbnail cards exported as literal `box`, `row`, `AsyncImage`, `Entity`, `badge`, `text` and `Link` source. Component indentation was also interpreted as Markdown code blocks. The direct reader now requests page collection for recognized visual-component markup outside literal code in HTML/PDF assistant replies.

Page extraction preserves a limited set of computed presentation properties for two-column thumbnail/text rows (48–240 CSS-pixel thumbnails), including typography, badges, links, list spacing and image proportions. It does not copy whole ChatGPT stylesheets or execute component source. Text remains selectable; interactive entity buttons become passive labels. Existing image embedding and image switches still apply.

## Local verification

- Regression tests cover visual-component fallback, fenced/inline/indented code, complete collection handoff, thumbnail card styles, disabled images, right-side thumbnails, and removal of fixed positioning, clipping and CSS resource URLs from captured card styles.
- `node tests/rich-cards-firefox.cjs release/0.5.7/rich-cards-qa` uses a synthetic local fixture and an isolated Firefox profile. It checks two embedded thumbnails, 136-pixel image columns, text alignment, badge sizing, full-width dividers, print-page layout and a 390-pixel mobile viewport without horizontal overflow.
- No personal profile, live chat, external image request or user conversation is used by that browser check.

## User check

1. In `about:debugging#/runtime/this-firefox`, load `release/0.5.7/test1/runtime/manifest.json` as a temporary add-on, or reload that temporary add-on if already selected.
2. Refresh the affected ChatGPT tab so its content scripts update.
3. Export the same conversation to HTML with assistant images enabled. Rich-component replies may trigger scrolling while the rendered page is collected; ordinary supported Markdown retains direct export.
4. Compare the cards' text, links, thumbnails and badges against the live answer. Optionally check PDF as well.

The exact live DOM behind the supplied screenshots has not been inspected. Arbitrary widgets, every layout variant and pixel-exact reproduction are not claimed. Large rich conversations fall back to the existing page collector and its existing image/memory limits; automatic direct-export multipart handling does not extend to that fallback. If differences remain, provide the resulting HTML and a non-sensitive rendered card DOM fragment, rather than account data or a full private conversation.

# 0.5.8 test 2 — remove blank space after rendered tables

November 25, 2026. Local unsigned test build, including the card and five-second success-status fixes from test 1.

## Install

Open `about:debugging#/runtime/this-firefox`, choose **Load Temporary Add-on**, and select `release/0.5.8/test2/runtime/manifest.json`. If a temporary Dialogue Export is already loaded, replace it with this build. Reload the ChatGPT tab, then export again. Existing saved files are not automatically rewritten.

## Cause and fix

ChatGPT's rendered table includes an empty `Edges-*` decoration with inline measured width/height. Its positioning comes from the website stylesheet, which is not included in exports. In the reported HTML, three decorations consequently occupied 260, 367 and 257 pixels of normal flow. The extractor now removes empty known edge decorations only when they are direct children of a recognized rendered table frame with a table viewport. Real notes, media and empty colored chart boxes are preserved.

Paragraphs inside table cells also inherited the exported document's default top/bottom margins, increasing row height. HTML and the PDF preview now remove those margins only at the first and last child of a cell, retaining separation between multiple paragraphs.

## Validation

- 225 automated tests pass. Coverage includes table decoration removal, preservation of real content and chart bars, card rendering and the existing status timer.
- Isolated Firefox 161.0 checked rendered-page collection, HTML and PDF-preview geometry, offline thumbnail images and proportional chart bars. The synthetic table-to-paragraph gap is 16px and the sample data row is 40.6px high.
- The user's existing HTML was checked locally, without publishing its contents. At the same viewport, the reported table-to-paragraph gap fell from **383px to 16px**, and the sample row height from **72.6px to 40.6px**. All message text and all bar widths remained unchanged. A separately saved corrected HTML copy, before/after screenshots and measurements are in `release/0.5.8/spacing-qa/`.
- The corrected document was printed with Firefox and its four PDF pages rendered with Poppler. The table-sized blank blocks are gone. Ordinary browser page breaks, including splits/moves of larger cards, remain outside this targeted fix.

Reproduce regressions with `npm test`, and the isolated browser fixture with `node tests/rich-page-firefox.cjs release/0.5.8/spacing-fixture-qa`. See [test 1](TEST-v0.5.8-test1.md) for the card/export limitations that still apply. No new permissions, network scope or public release were added.

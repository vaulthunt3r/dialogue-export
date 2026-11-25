# 0.5.8 test 1 — text cards, comparison bars and success dismissal

November 25, 2026. Local unsigned test build.

## Install for testing

In Firefox, open `about:debugging#/runtime/this-firefox`, choose **Load Temporary Add-on**, and select `release/0.5.8/test1/runtime/manifest.json`. Reload the ChatGPT tab before exporting. The ZIP contains the same runtime and can also be extracted for temporary loading. A temporary installation lasts until Firefox restarts.

## Fixes

- HTML/PDF recognizes `<card>`, bare layout components, reordered attributes and `Cite` source, and uses the rendered page. Fenced/inline/indented code remains code. TXT/Markdown behavior is unchanged.
- The supplied four-plan card retains its labels, prices, grey tracks and green fills at 10/30/50/100 percent. The extractor copies a limited inert style subset, resolving page CSS variables while preserving authored percentage widths. It retains flex spacing and explicit empty-box heights. Text containers are not fixed to the source height. No page stylesheets, positioning, clipping or CSS resource URLs are copied.
- Chart colors are requested explicitly for printing, including the extension's separate PDF preview.
- Successful in-page export status dismisses after five seconds. The launcher remains available and the last status remains accessible in the popup. Error status stays until dismissed. An old completion timer cannot remove a new export or its error. Manual dismissal and page restoration do not duplicate dismissal events.

## Validation

- 224 automated tests pass, covering direct-reader fallback, literal code, card geometry attributes with image switches off, inert styles, the five-second deadline, manual dismissal, restored pages and starting another export before the old deadline.
- An isolated Firefox 161.0 profile collected eight messages without scrolling through the direct-reader-to-rendered-page fallback. Existing thumbnail cards retained their alignment; two preview images remained embedded byte-for-byte and worked offline.
- The supplied card HTML was tested with a minimal reconstructed source stylesheet. HTML, the PDF preview and a 390px viewport retained all four bar proportions and 12px heights without horizontal page overflow. Firefox-generated PDFs and screenshots are under `release/0.5.8/card-qa/`; a one-page card PDF was also printed with backgrounds disabled and rendered with Poppler for visual inspection. Bars, labels and prices were visible.

Reproduce with `npm ci`, `npm test`, then `node tests/rich-page-firefox.cjs release/0.5.8/card-qa`. The browser script requires Firefox at its standard Windows installation path, launches its own temporary profile and uses only local fixture servers. It chooses a free debugging port.

## Limits

This validates the reported card structure in a local fixture, not the complete live conversation. It is not a pixel-exact archive of every interactive widget. Existing page-collection media/memory limits remain, and page collection may still scroll when complete ordered message identity cannot be verified. Previously exported files are unchanged; export again with this build. No new permissions or network scope were added. No signed XPI or public release has been created for 0.5.8.

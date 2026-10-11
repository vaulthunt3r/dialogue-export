# 0.5.4 test build — compact PDF pagination

## Test build 3

The supplied real-world nested-message HTML still left the first page mostly blank in Firefox 157.0.1 with build 2. Removing individual break constraints did not fix this fixture. Compact printing now removes message article boxes from layout (`display: contents`) while retaining author headings and spacing. Borders, backgrounds and padding around each message are intentionally absent in compact print output; screen HTML and the default mode are unchanged.

Local Firefox verification on the supplied HTML: 5 pages before, 4 after; the first answer starts on page 1. Extracted PDF text matches after whitespace normalization. Adding 50 paragraphs verifies that a long answer starts on page 1 and spans subsequent pages. User-provided content and generated diagnostic PDFs remain under ignored `release/` output or their original paths, not in source fixtures.

Load the ZIP from `release/0.5.4/test3`, reload ChatGPT and generate a new export. Keep the usual margins; confirm `Compact pagination: on`, then print. Old export tabs do not update automatically.

## Test build 2

Build 1 did not forward the pagination option to the separate PDF tab. Build 2 fixes that handoff and applies the option in the tab's own stylesheet. On the PDF tab, confirm **Compact pagination: on** before opening the print dialog. Close previously generated PDF tabs and create a fresh export after replacing the temporary extension and reloading ChatGPT.

Build 2 validation: 57 automated tests passed. Headless Edge checks of both HTML and the actual PDF-tab loader/styles produced 4 pages with the option off and 3 with it on. Firefox verification is still pending.

This unsigned test build implements issue #5 only. It does not add Working / Thinking exports from issue #4. Nothing has been published or submitted for signing.

## Temporary Firefox installation

Extract `Dialogue-Export-v0.5.4.zip` into a folder. Open `about:debugging#/runtime/this-firefox`, select **Load Temporary Add-on**, then select the extracted `manifest.json`. If Firefox reports a conflict with the installed Dialogue Export, disable that installed copy and retry. Reload the ChatGPT conversation after loading the test build. Temporary installations last until Firefox restarts; afterward verify that the signed version is enabled again.

## Compare output

1. Open one long conversation containing prose, a code block and a table.
2. Select PDF. Under **Export options**, leave **Compact PDF pagination** off and save a baseline PDF.
3. Enable that option and save another PDF. Use identical paper size, margins and scale for both.
4. Compare blank areas and page counts. Confirm the first and last messages, paragraph continuity, code and table rows are present and readable.
5. Repeat with HTML, opening each exported file in Firefox and using Print → Save to PDF. The screen layout should remain unchanged; the compact setting affects printing.
6. Reopen the popup and check that the setting is remembered. For TXT, Markdown and JSON, the control is hidden and the option has no effect.

The compact mode permits messages to split between pages. It prefers keeping code blocks, images and table rows intact, but blocks larger than a page remain subject to browser pagination. A lower page count is content-dependent, not guaranteed for every conversation.

Validation completed: 56 automated tests and a local Edge print test (4 pages normally, 3 compact; 60 paragraphs in both source DOMs). Firefox manual verification is pending.

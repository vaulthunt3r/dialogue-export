# Dialogue Export v0.5.4 — compact PDF and ChatGPT activity sections

## Compact PDF pagination (issue #5)

Enable **Export options → Compact PDF pagination** to let messages flow across printed pages. This removes message boxes in print while retaining author labels and spacing. It works for PDF exports and printing exported HTML; on-screen HTML is unchanged. The option defaults off and is remembered.

Firefox could move a nested message box to the next page, leaving a large blank area. Allowing breaks alone did not fix the reproduced case. Removing the article box from compact print layout did: the sample decreased from 5 pages to 4 with the first answer starting on page 1. Browser margins, paper size and content still affect pagination.

## Working / Thinking sections (issue #4)

Enable **Export options → Include Working / Thinking sections** in ChatGPT and expand the sections you want before exporting. Available progress text and tool summaries are included before their associated answer in TXT, Markdown, HTML, JSON and PDF. HTML uses collapsible sections; PDF receives them expanded. The option defaults off and is remembered; Gemini is unsupported.

Only content available in the page can be collected. Collapsed sections get an explicit missing-content notice. The extension does not automatically expand sections or recover vanished progress or private reasoning. If a section cannot be safely associated with one assistant message, export stops with an explanation; disable the option for an ordinary export on unsupported layouts.

## Validation and distribution

62 automated tests cover extraction, association, format rendering, options and existing behavior. Local Edge and Firefox pagination checks passed, and the user confirmed the compact PDF fix. A real-chat HTML export confirms correct ordering and no duplication for the expanded activity section; collapsed sections contain the expected notices. Other ChatGPT layouts may differ.

No additional permissions. Processing remains local. Thanks to **oshonsoft** for both feature requests and to the user who supplied diagnostics and tested the builds.

Download **Dialogue-Export-v0.5.4-signed.xpi** for permanent installation in Firefox. Open `about:addons`, choose the gear menu → **Install Add-on From File**, and select the XPI. Reload conversation tabs after updating.

The Mozilla-returned XPI matches all 22 runtime files from the tested submission, apart from manifest formatting and added signature metadata. The release also includes the runtime ZIP, development source ZIP and SHA-256 checksums. The source ZIP is for development, not installation.

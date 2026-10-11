# Mozilla Add-ons submission — 0.5.4

Upload `Dialogue-Export-v0.5.4.zip` as a new version of the existing add-on. The byte-identical `Dialogue-Export-v0.5.4-unsigned.xpi` is an alternative. The ID remains `dialogue-export@extension`; manifest.json is at the archive root. Do not upload the source ZIP as the add-on package.

The runtime uses readable JavaScript, HTML and CSS, with no compiler, bundler, minifier or runtime npm dependencies. Developer tests are excluded. For the source-code processing question, select **No**.

## Reviewer notes

Dialogue Export reads open ChatGPT and Gemini conversations and prepares local TXT, Markdown, HTML, JSON or PDF files. No permissions were added; there is no remote code, telemetry or conversation upload.

0.5.4 adds two options, both off by default: compact pagination for PDF/HTML printing, and available ChatGPT Working / Thinking activity sections for all formats. Expand activity sections before export. Collapsed sections get a notice; ambiguous association stops export. No automatic activity clicks, network retrieval or private-reasoning recovery is performed.

Validation: 62 automated tests, local Edge and Firefox pagination checks, user-confirmed compact PDF output and inspected real-chat HTML activity export.

## Release note

Adds optional compact PDF pagination to reduce large gaps between messages, and optional export of available ChatGPT Working / Thinking sections. Expand activity sections before export; collapsed or vanished content is not recovered.

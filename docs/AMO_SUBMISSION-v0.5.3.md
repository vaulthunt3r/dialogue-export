# Mozilla Add-ons submission — 0.5.3

Upload `Dialogue-Export-v0.5.3.zip` or the byte-identical `Dialogue-Export-v0.5.3-unsigned.xpi` as a new version of the existing add-on. The ID remains `dialogue-export@extension`; `manifest.json` is at the archive root. The source ZIP is not the installation package.

The package contains readable JavaScript, HTML and CSS without a compiler, bundler, minifier or runtime npm dependencies. Developer tests are excluded. For the source-code processing question, select **No**.

## Reviewer notes

Dialogue Export reads conversations on ChatGPT and Gemini and prepares local TXT, Markdown, HTML, JSON or PDF output. It has no remote code, telemetry or conversation uploads. No permissions were added.

0.5.3 addresses mixed ChatGPT exports: 0.5.2 could collect unrelated messages retained in the page alongside the current conversation. The fix excludes hidden/inert message trees and previews outside the main conversation area, checks explicit conversation ownership against the URL, and aborts when the page URL changes. Offscreen messages remain eligible for long-conversation exports.

Optional timestamps remain off by default and use explicit DOM metadata or bounded reads of matching React message data. No page functions/getters are intentionally invoked, and no network API is called. Gemini timestamps remain unsupported.

Validation: 54 automated tests passed. The affected user confirmed correct conversation content with 0.5.3 and reported successful HTML/PDF checks. Additional headless browser checks could not be rerun due to a local launch/approval failure.

## Release note

Fixes mixed ChatGPT exports that could contain messages from another conversation despite a correct title and source URL. Reload ChatGPT after updating and check important exports made with 0.5.2 before sharing them. Re-export affected files.

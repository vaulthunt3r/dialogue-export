# Dialogue Export v0.5.3 — fix mixed ChatGPT exports

## Important: check exports made with 0.5.2

Version 0.5.2 can include messages from another ChatGPT conversation in an export even when the title and source URL are correct. The issue affects the shared message collection used by all export formats; changing formats is not a workaround.

Update to 0.5.3 and reload your ChatGPT tabs. Check the contents of important previous exports, particularly before sharing them, and re-export affected conversations. If you already shared an affected file, check whether it included unintended conversation text and replace or remove that copy where possible.

The reported case involved messages from the user's other conversations. We have no evidence of access to other users' chats or of network transmission by the extension. A VPN/DNS cause has not been established. Other extension versions have not been assessed for this defect.

## Changes

### Why it happened

The collector queried message markers across the entire page. It did not exclude hidden message trees or validate conversation ownership. If ChatGPT retained another chat's message markup in the document, those messages could be collected too. Meanwhile, the export title and source URL were read from the current page, producing a correctly labelled file with mixed content. This mechanism was reproduced in a local fixture; the exact live DOM at the time of the report was not captured. VPN/DNS involvement has not been established.

- Exclude hidden/inert ChatGPT message trees and message previews outside the main conversation area, while retaining offscreen messages in long conversations.
- Stop export if visible message ownership conflicts with the current chat URL, avoiding partial filtering that could leave unrelated questions behind.
- Abort if the page URL changes during collection, before saving a file.
- No additional permissions or external requests.

## Validation

All 54 automated tests pass, including hidden retained chats, conflicting conversation IDs, navigation during collection, and existing virtualized scrolling scenarios. A synthetic local comparison reproduced mixing in 0.5.2 and excluded the unrelated message in 0.5.3 without network requests.

The affected user confirmed correct content and subsequently reported successful HTML/PDF checks. This confirms the reported case, not every ChatGPT interface. Markdown formatting is unchanged and can still lose some original structure.

The additional headless Edge check could not be rerun because process launch was blocked and automatic approval review failed with HTTP 403; this is not a passing browser test.

## Installation

Download **Dialogue-Export-v0.5.3-signed.xpi**. In Firefox, open `about:addons`, use the gear menu → **Install Add-on From File**, and select the XPI. Reload ChatGPT tabs after updating.

The Mozilla-returned package's runtime files match the tested submission; the manifest differs only in formatting and signing metadata was added. The runtime ZIP, development source ZIP and SHA-256 checksums are also included. The source ZIP is not the installation package.

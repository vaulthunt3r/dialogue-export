# Dialogue Export v0.5.2 — support for the new ChatGPT interface

Fixes “No messages found yet” on ChatGPT's newer interface, plus the scrolling
problem that could leave long conversations stuck on the initially visible messages.

- Recognizes both user questions and ChatGPT answers in the new layout.
- Preserves message identities and order while older messages load during scrolling.
- Supports hidden-overflow scroll containers and negative scroll offsets.
- Reports an error when scrolling cannot proceed and restores the original offset/styles.
- Retains support for the older ChatGPT interface and Google Gemini.
- Adds no permissions, telemetry, or external requests.

Thanks to **hexgf** for the detailed reports, quick replies, and testing. They
confirmed successful export of a 301-message chat; a quick review found it intact
from beginning to end, though every message was not individually checked.

Validation also includes 50 passing automated tests and three headless Edge
scrolling scenarios using local fixtures.

## Installation

Download **Dialogue-Export-v0.5.2-signed.xpi**, signed by Mozilla for permanent
installation in Firefox 142 or newer. Open `about:addons`, click the gear menu,
choose **Install Add-on From File**, and select the XPI. Reload ChatGPT after updating.

For temporary installation, extract `Dialogue-Export-v0.5.2.zip`, open
`about:debugging#/runtime/this-firefox`, choose **Load Temporary Add-on**, and select
`manifest.json`. Reload the ChatGPT tab after loading the extension.

`Dialogue-Export-v0.5.2-source.zip` contains the full development sources and tests.
`SHA256SUMS.txt` contains checksums for all three attached packages.

Optional timestamps can still be missing where the interface does not expose
unambiguous metadata. Complex interactive content may not export exactly; verify
the first and last messages in important conversations.

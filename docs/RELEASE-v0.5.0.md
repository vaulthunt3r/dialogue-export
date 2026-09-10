# Dialogue Export v0.5.0

A clearer interface for saving ChatGPT and Google Gemini conversations in Firefox.

## What changed

- Pick TXT, Markdown, HTML, JSON, or PDF, then press one clearly labelled Export button.
- Your last format and export options are remembered.
- Preview the filename and optionally add today's date.
- Selection controls appear in Selected mode, with a live count, Clear, and Escape to finish choosing.
- Reopen the popup to see the current stage, elapsed time, and collected-message count.
- Retry a failed connection from the popup without closing and reopening it.
- Improved light/dark themes, keyboard navigation, and suggested PDF filenames.

The loading and scrolling routines are the same as v0.4.2. Processing stays local, with no analytics or telemetry.

**Upgrading from v0.2.0?** That version could export only the loaded portion of a long ChatGPT conversation. The loading fix introduced in v0.4.2 is included here. Re-export important old conversations and check their first and last messages.

## Which file should I download?

- **Dialogue-Export-v0.5.0-signed.xpi** — recommended. Signed by Mozilla for permanent installation in Firefox 142 or later. Open `about:addons`, select the gear menu, choose **Install Add-on From File**, and select the XPI.
- **Dialogue-Export-v0.5.0.zip** — temporary installation and local testing. Extract it, open `about:debugging#/runtime/this-firefox`, choose **Load Temporary Add-on**, and select `manifest.json`.
- **Source code** — the repository snapshot for this release, including documentation and development tests.

For PDF, the extension prepares a print page. Choose **Save as PDF**, then select Firefox's PDF destination.

![Dialogue Export interface](screenshots/dialogue-export-interface.png)

# Dialogue Export v0.5.1 — message timestamps

You can now keep the original date and time of ChatGPT messages in your saved conversations. Thanks to the first community feature request in [issue #1](https://github.com/vaulthunt3r/dialogue-export/issues/1).

## How to use it

1. Open a ChatGPT conversation.
2. Open Dialogue Export and expand **Export options**.
3. Enable **Include message timestamps**, then export as usual.

The setting is off by default. Your choice is remembered.

TXT, Markdown, HTML, and PDF show dates in your local time zone. JSON stores UTC ISO dates for use in other tools. If ChatGPT does not provide a time, the message is still saved and the export explains how many dates were available. It never substitutes the date of export for the original message time.

This setting is currently available for ChatGPT only. Gemini exports continue to work as before. The conversation loading and scrolling algorithms are unchanged, and no new permissions or external requests were added.

## Installation

- **Dialogue-Export-v0.5.1-signed.xpi** — Mozilla-signed package for permanent installation in Firefox 142 or later. Open `about:addons`, click the gear menu, choose **Install Add-on From File**, and select the XPI.
- **Dialogue-Export-v0.5.1.zip** — temporary installation. Extract the ZIP, open `about:debugging#/runtime/this-firefox`, choose **Load Temporary Add-on**, and select `manifest.json`.
- **Source code** — the repository snapshot for this release.

If you are upgrading from v0.2.0, this release also includes the earlier long-conversation loading fixes, Gemini support, and the redesigned v0.5.0 interface. Check the first and last messages when re-exporting important older conversations.

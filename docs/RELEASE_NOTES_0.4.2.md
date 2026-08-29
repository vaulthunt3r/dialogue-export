# Dialogue Export 0.4.2

Dialogue Export 0.4.2 is an important update for anyone who saves long ChatGPT conversations.

## Important: long conversation export fixed

The previous public version could save only the section of a long ChatGPT conversation that was loaded on the page. The download still completed normally, so the missing messages were not always obvious.

Version 0.4.2 loads earlier conversation sections, remembers the messages it discovers, and collects the conversation from beginning to end before creating the file.

Users of v0.2.0 should update before exporting long conversations.

## Google Gemini support

Dialogue Export can now save ordinary conversations opened on `gemini.google.com`. ChatGPT and Gemini use the same simple export window and the same TXT, Markdown, HTML, JSON, and PDF formats.

## Other changes

- Added complete-conversation and selected-message modes.
- Export continues after the popup is closed.
- Added progress on the conversation page and Firefox toolbar icon.
- Added automatic light and dark themes.
- Added working link preservation to TXT and Markdown.
- Removed unnecessary Gemini interface labels from exported messages.
- Cleaned ChatGPT and Google Gemini suffixes from filenames.
- Refined PDF export and download handling.

## Privacy

Dialogue Export works locally inside Firefox. Conversations are not uploaded anywhere. The extension contains no analytics, telemetry, advertising, or remote scripts.

## Supported websites

- ChatGPT: `https://chatgpt.com/`
- Google Gemini: `https://gemini.google.com/`

## Supported formats

- TXT
- Markdown
- HTML
- JSON
- PDF

Dialogue Export is intended primarily for ordinary text conversations. Complex interactive content and some embedded media may not be reproduced exactly.

# Changelog

## 0.4.2 — 2026-08-29

### Important fix

- Fixed incomplete exports of long ChatGPT conversations. Earlier releases could save only the messages currently loaded on the page.
- Added automatic loading and collection of earlier conversation sections before the final file is created.
- Export continues after the popup is closed.

### New

- Added support for ordinary Google Gemini conversations.
- Added **All messages** and **Selected** export modes.
- Added message-selection controls directly on the conversation page.
- Added a progress timeline and Firefox toolbar badge.
- Added automatic light and dark themes based on the open conversation page.

### Improved

- Preserved link destinations in every format when **Keep links** is enabled.
- Markdown writes links as `[label](URL)`.
- TXT writes links as `label (URL)`.
- Removed redundant “Your prompt” and “Gemini response” labels from Gemini exports.
- Removed ChatGPT and Google Gemini branding suffixes from filenames and document titles.
- Improved PDF export instructions and background downloads.
- Updated the interface to a neutral style matching ChatGPT.

### Privacy

- All conversation processing remains local in Firefox.
- No analytics, telemetry, advertising, remote scripts, or conversation uploads were added.

## 0.2.0 — 2026-08-18

- Renamed the project to Dialogue Export.
- Added TXT, Markdown, HTML, JSON, and PDF export.
- Added a stable Firefox extension ID and Mozilla data-collection declaration.
- Added privacy, security, licensing, and Mozilla submission documentation.
- Published the first Mozilla-signed version.

### Known issue

- Long ChatGPT conversations could be exported incompletely because only the currently loaded part of the conversation was collected. This is fixed in v0.4.2.

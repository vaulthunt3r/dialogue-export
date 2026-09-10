# Changelog

## 0.5.0 — 2026-09-10

### Interface and usability

- Added an explicit Export button after format selection, with short format descriptions.
- Remembered format, scope, link/title options, and optional date suffix.
- Added safe filename preview, including Windows reserved names.
- Added bounded connection attempts, an in-popup Retry action, and actionable empty/unsupported-page states.
- Restored active export status when reopening the popup: stage, elapsed time, and collected count.
- Replaced misleading total-message estimates with collected counts and phase indicators. Toolbar stages are LOAD, READ, and SAVE.
- Blocked duplicate exports and selection changes during an export.
- Added live selected count, Clear, Escape, and pressed-state labels to page selection controls.
- Updated open controls when the page theme changes; fixed transparent-background detection and selection outlines.
- Added keyboard focus indicators and reduced-motion styles.
- Passed the requested PDF filename to the print page and corrected loading/error text.

### Distribution

- Added a Mozilla-signed XPI for permanent installation.
- Refreshed the README with interface and local-processing presentation images.

### Scope and verification

- Retained v0.4.2 scrolling/loading routines, extractor, and document renderers.
- Added 16 automated UI/message-flow tests with synthetic conversations.
- Automated checks use synthetic conversations. Real Firefox download/print dialogs and live website behavior still require manual testing.

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

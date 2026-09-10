# Changelog

## 0.5.1 — 2026-09-10

### Distribution

- Added the Mozilla-signed `Dialogue-Export-v0.5.1-signed.xpi` for permanent Firefox installation.

### New

- Added optional **Include message timestamps**, requested in issue #1, for ChatGPT exports.
- Added local date/time beneath each author in TXT, Markdown, HTML, and PDF. JSON stores UTC `createdAt` values.
- Remembered the timestamp preference, off by default. Explained why the option is disabled for Gemini.
- Reported timestamp availability in completed export status and in documents with missing dates. Missing times remain absent or `null` in JSON.

### Reliability and privacy

- Matched ChatGPT creation times to exact message IDs and roles, including regenerated-answer variants.
- Preserved already discovered times when virtualised nodes lose metadata, only for the same message ID.
- Kept loading/scrolling algorithms unchanged. Added no permissions, page script injection, network requests, or remote code.
- Added automated tests for dates, all formats, missing metadata, selection, hostile page getters, and virtualised conversation windows.


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

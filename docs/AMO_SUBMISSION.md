# Mozilla Add-ons submission notes

## Package

Upload the AMO-ready ZIP in which `manifest.json` is located at the archive root.

## Suggested listing

**Name:** Dialogue Export

**Summary:** Export complete chatgpt.com conversations to Markdown, PDF, HTML, TXT, or JSON directly in Firefox.

**Category:** Other or Tabs

**Data collection:** None

**License:** MIT

## Reviewer notes

Dialogue Export runs only on `https://chatgpt.com/*`. Open a conversation, select the toolbar icon, and choose an export format. The extension reads the open conversation only after a user-initiated export and processes all content locally. It contains no remote code, analytics, telemetry, advertising, or external network requests.

PDF export opens an internal extension page that invokes Firefox's print dialog after the user selects **Save as PDF**.

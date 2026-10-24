# Mozilla Add-ons submission — 0.5.5

Submission completed. The user returned Mozilla's signed XPI, and all runtime contents were compared with the exact uploaded package. Only manifest formatting (identical parsed settings) and `META-INF/` signature metadata differ. The instructions below record how this version was submitted; users should install the signed XPI from the release.

Upload **Dialogue-Export-v0.5.5-AMO.zip** as a new version of the existing add-on. The runtime ZIP and `Dialogue-Export-v0.5.5-unsigned.xpi` are byte-identical alternatives. The ID remains `dialogue-export@extension`, version 0.5.5, Firefox minimum 142.0. `manifest.json` is at the archive root. Do not upload the source ZIP or the complete release-kit ZIP as the installation package.

The runtime is readable JavaScript, HTML and CSS with no compiler, bundler, minification or runtime npm dependencies. For the source-code transformation/processing question, select **No**. Developer dependencies run tests only and are excluded from the installation package. The source ZIP is available if requested by the reviewer.

Mozilla's [packaging guide](https://extensionworkshop.com/documentation/publish/package-your-extension/) permits ZIP/XPI packages, and its [source-code guide](https://extensionworkshop.com/documentation/publish/source-code-submission/) explains when a separate source submission is required.

## Reviewer notes

Dialogue Export reads the open ChatGPT or Gemini conversation after an explicit export request and prepares local TXT, Markdown, HTML, JSON or PDF output. Permissions are unchanged: activeTab, downloads, storage, and the existing ChatGPT/Gemini hosts. No conversation upload, analytics, telemetry or remote code is present.

0.5.5 preserves loaded raster images, static SVG diagrams, readable canvas snapshots, standalone generated-image replies and modern ChatGPT code blocks. Images are captured locally from the existing DOM; there is no separate media-fetching service. Source images in mounted messages may temporarily change from lazy to eager loading while the extension waits, then restore their original attribute. Cross-origin content that cannot be embedded may remain an explicitly labelled external reference, which can make a request when the saved file is opened. SVG is reduced to a static allowlist and unsupported elements are noted.

The collector adds existing message-identity variants and improves ordering and scrolling for long conversations. Broken decorative website icons, including Google faviconV2, do not block text-only exports. Content-image failures remain explicit errors. Collection has resource budgets, at most two pending source decodes, cleanup on completion/error/cancellation and a Stop control before handoff. Structural failure diagnostics contain no text, URLs, IDs, cookies or image pixels.

Existing opt-in timestamps still use bounded reads of page-owned metadata through Firefox's wrappedJSObject, matching exact IDs and roles without intentionally calling page functions or getters. Existing Working / Thinking export includes only available user-visible activity; it does not recover hidden or vanished reasoning.

Validation includes automated regression tests, isolated local Firefox HTML/PDF checks and the user's successful export of a very long text chat on October 24, 2026. Large image-heavy conversations remain a documented limitation; automatic multipart output is not included. See RELEASE-v0.5.5.md and TEST-v0.5.5.md for scope and evidence.

## Suggested release note

Adds loaded images and static diagrams to HTML/PDF, preserves modern ChatGPT code blocks, fixes image-gallery overlap and blocked favicon interruptions, and improves long-conversation collection. Adds resource limits, cleanup and Stop during collection. Very large image-heavy chats still need further work; verify important exports. Automatic splitting into parts is not included.

## Reproducing the package

No compilation is required. With PowerShell 7, from the extracted source root run `./scripts/package.ps1 -OutputDirectory ./release/rebuilt-0.5.5`, using a directory that does not exist. The script copies the runtime files unchanged and creates deterministic ZIP entries. Tests require Node.js and the exact development dependencies in package.json: run `npm install`, then `npm test`. No npm dependency is needed to package or run the extension. Local Firefox visual-test helpers are optional and currently use the standard Windows Firefox executable path.

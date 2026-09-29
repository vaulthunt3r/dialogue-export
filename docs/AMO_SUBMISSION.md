# Mozilla Add-ons submission notes — 0.5.2

## Package

Upload `Dialogue-Export-v0.5.2-unsigned.xpi`. The equivalent `Dialogue-Export-v0.5.2.zip` has identical bytes and can also be used where ZIP upload is accepted. `manifest.json` is at the archive root. Submit it as a **new version of the existing Dialogue Export add-on**, keeping `dialogue-export@extension` as its ID. The separate `Dialogue-Export-v0.5.2-source.zip` includes documentation, tests and packaging support; it is not the installation package.

The extension contains ordinary, readable JavaScript, HTML and CSS. There is no compiler, bundler, minifier, template engine or runtime npm dependency. The developer tests are excluded from the uploaded package. For the source-code processing question, select **No**.

## Reviewer notes

Dialogue Export operates on `https://chatgpt.com/*` and `https://gemini.google.com/*`. Open a conversation, click the toolbar icon, choose a format, and press Export. Processing is local. The extension has no remote code, analytics, telemetry or conversation uploads.

Version 0.5.2 fixes message detection after a ChatGPT interface update. It supports new user/assistant markers, preserves identity and ordering across virtualized windows, and handles hidden-overflow scroll containers and negative offsets. Temporary scroll styles and the original offset are restored after collection or failure.

**Export options → Include message timestamps**, off by default, reads explicit DOM metadata or the message `create_time` property in ChatGPT's React component data. The new explicit assistant message ID is recognized. Firefox's `wrappedJSObject` is used on message DOM elements to read page-owned data. Only own data properties are inspected, with bounded traversal. No page functions/getters are intentionally invoked, no script is injected into the main world, and no network API is called. Exact message IDs and roles are checked to avoid attributing another reply's time to a message.

If no timestamp is available, the conversation still exports. The result reports timestamp availability. JSON uses `createdAt: null`; text formats omit the missing dates. Timestamps are currently disabled in the popup on Gemini.

No permissions were added in this version. PDF export prepares an internal extension page; **Save as PDF** opens Firefox's print dialog.

Validation: 50 automated tests and 3 headless Edge real-layout checks passed. The reporter confirmed that the same runtime successfully exported 301 messages on the affected Firefox interface. Their quick review found it intact from beginning to end; this was not an exhaustive per-message comparison.

## Manual checks

- Open a real ChatGPT conversation and enable message timestamps. Export MD and JSON and verify dates belong to the correct messages.
- Repeat for a long conversation and a regenerated answer.
- Disable timestamps and confirm the normal output.
- On Gemini, verify that timestamp controls explain the limitation and ordinary exports still work.
- Export PDF and verify the date line in print preview.

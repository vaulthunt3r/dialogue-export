# Timestamp implementation and verification — 0.5.1

## Behavior

The setting is opt-in and currently supported for ChatGPT. Timestamped snapshots add `messageId` (the page's exact message identifier, when available) and `createdAt` (UTC ISO 8601, or `null`). Normal exports keep the previous schema. JSON adds a `messageTimestamps` object with `available`, `total`, and the local `timeZone` used for human-readable output.

The reader tries explicit message metadata first. It then examines local React component data through Firefox's DOM `wrappedJSObject`. Message IDs must match exactly, and an explicit role must agree. `update_time`, neighbouring messages and the export date are never substituted for creation time. Access is bounded and guarded; own data descriptors avoid calling ordinary page-defined getters. Proxy traps can still run when inspecting a proxy, so the page remains an untrusted source and read errors are contained.

The cache retains a known date if metadata temporarily disappears, only when the exact message ID and role still match. A regenerated reply with a different ID does not inherit the previous reply's date. No collection loop was changed.

## Verification

34 automated tests passed using synthetic DOMs and mocked WebExtension APIs. Coverage includes seconds/milliseconds/offsets, invalid dates, exact ID/role matching, regenerated variants, inaccessible metadata, page getters, cyclic component references, selected exports, missing timestamps, all five output formats, popup state, and collection across virtualised message windows.

Mozilla web-ext 10.6.0 reports 0 errors, 0 warnings, 0 notices for the runtime package. This validates packaging and static rules, not live timestamp availability.

The browser preview in this environment was blocked by its local-URL policy. A real logged-in ChatGPT session and Firefox's native print/download dialogs have not been tested here. Verify actual dates in your own Firefox session. The user supplied the Mozilla-signed 0.5.1 XPI for publication on September 10, 2026; its runtime files match this source snapshot. Issue #1 has not been closed by this workflow.

## References

- Firefox page objects: https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/Sharing_objects_with_page_scripts
- Community request: https://github.com/vaulthunt3r/dialogue-export/issues/1

Internal ChatGPT data structures are not a public API and can change. Gemini's exact per-message timestamps are not implemented in this version.

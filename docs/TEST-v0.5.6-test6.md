# 0.5.6 test 6 — completion visibility

Unsigned local test build, November 17, 2026. No publication or signing yet.

The user confirmed that test 5 exported the affected image-bearing chat successfully in HTML and PDF, split into three parts. They were reading another tab and missed the transient completion message. No export or image-collection changes are made in test 6.

## Behavior

- Completed status remains in the conversation tab until dismissed or replaced by a later export (reloading/closing the tab still clears its in-memory status). Errors also remain visible. The toolbar result badge no longer clears after a short timer.
- **Notify when export finishes or stops** is off by default and remembered locally. Checking it requests the optional `notifications` permission from Firefox. Opening the popup never prompts. Denial leaves notifications off and export available; revoked permission is checked again before sending a notification.
- One notification follows the final export result, not each part. Multipart HTML says how many parts finished downloading. PDF says that the layout is ready and must still be saved from the print page. Single-file handoff says to check the save dialog/Downloads, without claiming the user saved the file.
- Alerts contain the extension name and generic status/part count only, with no conversation title, text, URLs, filenames or raw error details.
- Native alerts depend on Firefox/OS settings, including notification suppression. Notification failure does not fail the export. Persistent in-tab status works without permission.

## Local check

1. Load `release/0.5.6/test6/runtime/manifest.json` as the temporary add-on, then reload the conversation tab.
2. Enable **Notify when export finishes or stops** and grant the optional Firefox permission.
3. Export a small conversation and switch to another tab. Verify the native result alert. Return after more than 15 seconds: the in-tab result should remain until its × button is clicked.
4. Optionally disable notifications and repeat; export and the persistent in-tab result should still work. PDF alerts indicate preparation only; save PDF parts using the preview controls.

Existing image choices, numbered parts, limits and test 5 Firefox/PDF evidence remain documented in [test 5 notes](TEST-v0.5.6-test5.md). Native notification display on the user's desktop still needs their check; headless tests cannot establish OS toast visibility.

## Verification

November 17, 2026: **40/40 focused UI/background tests passed** (`tests/ui.test.cjs`, `tests/parts-background.test.cjs`). They cover persistent status beyond 15 seconds, dismissal, one final notification after all parts, failure without success notification, optional permission granting/denial/revocation, preference/job propagation, generic notification payloads and notification API failures. Existing multipart downloads, cancellation and PDF access/cleanup tests also pass. Evidence: `release/0.5.6/test6-notifications-tests.log`.

JavaScript syntax checks passed for the three changed scripts. The manifest declares notifications only as an optional permission. Test 5's 160-test suite and isolated Firefox multipart/image/PDF validation remain the previous baseline; the full suite and heavy browser fixture were not repeated for this status-only change.

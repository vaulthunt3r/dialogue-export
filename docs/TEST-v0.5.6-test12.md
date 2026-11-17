# 0.5.6 test 12 — ZIP in the format grid and site-access guidance

Unsigned local build, November 17, 2026. Not signed or published.

## Install and check

1. Load `release/0.5.6/test12/runtime/manifest.json` as the temporary extension and reload ChatGPT. Reopen any archive tab from the updated extension.
2. The one dialogue icon opens the menu. **ZIP ↗ / ALL CHATS** is the sixth format-grid control. It opens the archive chooser; it neither starts a single-chat export nor changes the selected TXT/MD/HTML/JSON/PDF format. The chooser still lets the user select individual chats or all found chats before exporting.
3. If the page icon only appears after a Firefox-toolbar click, check the extension's site access. In the toolbar popup, **Show icon automatically** appears only when persistent access to the current supported site is missing. Clicking it requests access only to `https://chatgpt.com/*` or `https://gemini.google.com/*`, whichever is open. Accept or decline in Firefox, then reload the chat to check. Declining preserves toolbar use.
4. Test 11's specific archive report codes remain. The six real archive parser rejections are still unresolved; retry one failed chat and inspect its new code/reason. This menu update does not claim to fix those failures.

## Cause and limits

The user clarified that the icon appears after clicking the main toolbar icon, then identified Firefox's site-access setting. This is distinct from test 11's independently reproduced image-wrapper geometry bug. A local fixture with already-granted site access did not reproduce the user's withheld-permission state. No personal profile or browser settings were inspected or changed.

Firefox allows users to grant/revoke host permissions. The UI now checks `permissions.contains` and requests the already-declared site origin only from a click handler. See [Mozilla host-permission documentation](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/manifest.json/host_permissions) and [Firefox's extension access controls](https://support.mozilla.org/en-US/kb/extensions-button). Persistent site access permits automatic script startup; normal free-space checks still prevent the panel from covering the chat.

## Verification

- **45/45** menu and placement tests passed (`release/0.5.6/test12-ui-tests.log`), including ZIP routing, keeping the prior format, accessibility on empty chats, no automatic permission request, current-site-only grant, refusal and already-granted/embedded cases.
- Isolated Firefox **160.0**, localhost fixtures and fresh profiles only (`release/0.5.6/ui-test12/`): compact layout, image gutter, light/dark themes, pinned Export, short viewport, owner binding and selected PDF passed. Compact HTML screenshot inspected; ZIP / ALL CHATS fits alongside the other formats.
- Isolated archive menu test (`release/0.5.6/archive-menu-test12/`): ZIP opens the archive chooser without history reads; narrow layout retains the single-launcher fallback.
- Permission outcomes are covered by mocked API tests. The browser prompt was not automatically accepted on the user's behalf.

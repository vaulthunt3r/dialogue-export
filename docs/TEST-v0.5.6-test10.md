# 0.5.6 test 10 — archive shortcut, pagination and status

Unsigned local build, November 17, 2026. Not signed or published.

## Changes and user check

1. Load `release/0.5.6/test10/runtime/manifest.json` as the temporary extension, then reload ChatGPT.
2. Two small monochrome buttons appear in the available right margin: the dialogue icon opens single-chat export, and the archive-box icon opens the ZIP interface directly. With a narrow margin the buttons stack; neither may overlap message text. If even a launcher cannot fit, the Firefox toolbar remains the fallback.
3. Load the archive list. There are now **20 chats per page**, with explicit displayed ranges and a hint about scrolling inside the list. For **42 chats**, expect **three pages (20, 20, 2)**. First/last-page navigation buttons are intentionally disabled at the boundaries; checked selections survive navigation and filtering. Select all found still selects the whole discovered list, not just the current page/filter.
4. Start a small export. The bottom status panel stays visible while scrolling. It shows LOAD / READ / SAVE, elapsed time, chat/download counts and Stop. The moving ASCII marker means activity, not a percentage or time estimate. Success, partial results and errors remain distinguishable after completion.

The archive still opens in its own extension tab in this build. This is an interface choice, not a Firefox/ZIP requirement; embedding selection controls in the conversation is possible separately. Test 9's text-only formats, scope and limits continue to apply.

## Verification

- **15/15 focused tests pass** (`release/0.5.6/test10-tests.log`): existing archive cases, top-level sender-bound shortcut security, no history reads on open, immediate list invalidation on reload, 42-chat pagination, preserved selection, activity stages, elapsed-time freeze and unavailable-state handling.
- **Firefox 160.0**, fresh isolated profiles and localhost fixtures only: page shortcut opens the archive without a menu or history read; narrow layout stacks both buttons outside the chat (`release/0.5.6/shortcut-test10/`).
- A second Firefox check discovers 42 synthetic chats, navigates three pages, selects across pages, shows fixed progress and Stop during collection, and confirms two chats saved with a persistent completed result (`release/0.5.6/archive-ui-test10/`). Running and completed screenshots inspected.
- Existing compact-menu Firefox regression passes: light/dark themes, unchanged chat geometry, pinned Export, short viewport, selected PDF, owner binding and narrow fallback (`release/0.5.6/ui-test10/`).
- Test 9's **183/183** full-suite run and independently verified ZIP artifacts remain baseline evidence. This build does not change rendering or ZIP byte encoding.

No personal browser/profile access. Real-account discovery completeness, especially project chats, remains a separate user check; the screenshot showing 42 results does not establish full-account coverage.

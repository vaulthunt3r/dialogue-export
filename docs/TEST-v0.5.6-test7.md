# 0.5.6 test 7 — compact monochrome menu

Unsigned local test build, November 17, 2026. No signing or publication.

## Behavior

- `[DE]` opens a 184–220 CSS-pixel menu in measured free space to the right of visible message bodies and the composer. The chat layout is not resized. Positioning responds to viewport changes, scrolling and host-app layout changes, and skips layout work in background tabs.
- Monospace text, square thin borders, `[x]` checkboxes, bracketed actions and inverse black/white format selection. Theme follows the conversation. No random or format-specific accent colors.
- Scope, format, filename and Export are always present. Options contains all existing preferences, including both image categories, captions, activity, timestamps, compact pagination and notifications. Long options scroll inside the available viewport height.
- `[-]`/Escape collapses the menu. Starting an accepted export or selecting messages also collapses it. Status uses the same right gutter with an ASCII activity indicator, stage labels, elapsed time, Stop, expandable details and persistent completion/error state. The activity indicator does not claim an exact percentage.
- If the margin is too narrow, only the launcher remains; it directs the user to the Firefox toolbar menu. If even the launcher would overlap content, the page widget is hidden. The toolbar menu retains all settings and includes Stop during cancellable export stages.
- Embedded controls use the same popup form/preferences. Firefox exposes fewer APIs to this embedded context, so a restricted background relay binds all commands to the containing tab; page-supplied target tab IDs are not accepted. First-time notification setup opens a local extension tab with a user-clicked Enable button. Existing permission can be reused directly. No new permissions or export-algorithm changes.

## Install and check

1. Replace the temporary extension using `release/0.5.6/test7/runtime/manifest.json`; reload ChatGPT/Gemini.
2. Open `[DE]` in the right margin. Check that the chat and composer stay in place. Switch formats, expand Options and verify remembered preferences.
3. Start a small export. The menu should collapse and status should remain at the right. Check `[Stop]` during a longer run and `[x]` after completion.
4. Narrow the browser window or increase zoom. The menu should collapse instead of covering chat text; the toolbar menu is the fallback.

The exact layout of the user's live ChatGPT/Gemini pages still needs user verification. Conservative measurement may leave only the toolbar available for unrecognized or full-width layouts.

## Verification

- **171/171 unit tests pass**, including popup state/preferences, embedded owner binding, allowlisted relay commands, size validation, notification setup and existing export/media/multipart regressions. Log: `release/0.5.6/test7-unit-tests.log`.
- **Firefox 160.0**, fresh isolated profile and synthetic localhost conversation only: real extension iframe loads, expands Options, follows light/dark themes, preserves measured chat width/position, binds to its original tab while another tab is active, selects messages and opens an actual PDF print page. The 220 px menu collapses automatically; narrowing from 1920×1080 to 1280×800 hides the full widget/status without overlapping chat.
- Screenshots and structured result: `release/0.5.6/ui-test7/`. Light compact, expanded options, dark compact, completed status and narrow layout inspected. No personal browser/profile access.
- The Firefox fixture also passes with parent-page `script-src 'none'; frame-src 'none'` and with a full-width outer form containing a centered rounded composer. Only the intended extension iframe is loaded; the conversation remains in place.
- Native OS notification appearance and website-specific layouts remain user checks. Test 5's three-part real image export and prior PDF/image-byte checks remain the export baseline.

Firefox's user-action requirement is why the first-time permission request uses an explicit button in a top-level extension page: [Mozilla user actions documentation](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/User_actions).

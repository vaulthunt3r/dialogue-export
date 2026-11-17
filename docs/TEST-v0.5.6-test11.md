# 0.5.6 test 11 — launcher placement, one menu and archive diagnostics

Unsigned local build, November 17, 2026. Not signed or published.

## Install and check

1. Replace the temporary extension with `release/0.5.6/test11/runtime/manifest.json`, then reload the ChatGPT page. Close any old archive tab and reopen it from the updated menu.
2. One small dialogue icon should appear in the available right gutter, including alongside an image-only response. It opens single-chat export directly. The top **Chat archive · ZIP ↗** button opens the existing archive tab. **Current chat → All messages** means the messages in the open chat.
3. Export remains pinned below the scrolling settings. A genuinely narrow gutter still uses the Firefox toolbar fallback; neither chat nor composer is resized.
4. The real archive report provided for test 10 contains **36 saved and 6 failed chats**. All failures were collapsed into the same unsupported-chat reason, so their precise causes cannot be recovered from that report. This build adds fixed `code` and `reason` categories. Repeat the archive export for **one failed chat** and inspect the new report; send only its code/reason if sharing diagnostics. The six failures are not claimed fixed.

ZIP archive scope is still text-only and current-branch-only. Its separate tab, 20-row pagination, fixed progress and download behavior remain. No new permissions or automatic history reads.

## What was reproduced and fixed

- The previous panel measured a full-width image wrapper as if its entire width contained chat content. This falsely hid the launcher despite a usable right gutter. Placement now measures visible text/media bounds and the composer.
- The panel previously called the export collector merely to position itself. Missing/ambiguous IDs could throw before initialization completed. Geometry now uses independent DOM measurement; export safety checks remain in the exporter.
- Archive normalization failures previously lost their specific category. New reports distinguish unsupported message/attachment/reference types, unfinished responses, missing/ambiguous IDs, incomplete branches, content limits and unavailable renderers. Only allowlisted categories are returned; arbitrary exception text is not exposed.

## Verification

- All three new placement regressions failed against the prior panel and pass with this change: full-width image wrappers, export-ID validation independence, and wide visible versus hidden media.
- Menu/placement/archive-UI unit run: **44/44 passed**. Subsequent focused run including archive diagnostic changes: **19/19 passed** (`release/0.5.6/test11-diagnostics-tests.log`). These runs overlap and are not additive.
- Isolated Firefox **160.0**, synthetic localhost fixtures only (`release/0.5.6/ui-test11/`): single visible launcher next to a full-width image turn lacking IDs; unchanged chat geometry, strict host CSP, light/dark layouts, pinned Export, short viewport, correct owner binding and selected PDF.
- Isolated Firefox archive check (`release/0.5.6/archive-ui-test11/`): the menu opens the archive without reading history, 42 synthetic chats span three pages, selection survives paging, and two selected chats save with persistent progress/completion. Screenshots of the image gutter and compact menu were inspected.
- No personal browser/profile access. The screenshot's exact live DOM was not inspected; confirmation on the user's page remains necessary.

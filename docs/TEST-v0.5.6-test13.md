# 0.5.6 test 13 — plain ZIP control

Unsigned local build, November 17, 2026. Not signed or published.

Load `release/0.5.6/test13/runtime/manifest.json` and refresh ChatGPT. ZIP now reads `[ZIP]`, without a subtitle, arrow or separate border, and matches the other format controls. Its tooltip and accessibility label still describe the all-chat archive. Clicking it opens the same archive chooser.

Two focused existing UI tests pass. Isolated Firefox 160.0 confirms ZIP/PDF control widths and heights match within one pixel, ZIP opens the archive without reading history, and narrow fallback remains available (`release/0.5.6/archive-menu-test13/`). Screenshot inspected. Test 12's permission guidance and test 11's archive error diagnostics remain; the six real parser failures are not claimed resolved.

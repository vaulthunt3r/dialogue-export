# 0.5.8 test 3 — direct export with rendered cards and connection recovery

November 25, 2026. Local unsigned test build; includes the previous card, table-spacing and five-second success-status fixes.

## Install

Load `release/0.5.8/test3/runtime/manifest.json` through `about:debugging#/runtime/this-firefox` as a temporary add-on, replacing the earlier temporary build. Reload the current chat once when switching these test builds. The manifest adds `scripting` for restoration of the extension's own scripts; host permissions remain limited to the existing ChatGPT/Gemini/OpenAI-image origins. No public release or signed XPI was created.

## Why scrolling could return

Direct reading was still present. Rich component markup deliberately fell back to rendered-page collection so that raw `<card>`, `<row>` and similar source would not leak into HTML/PDF. Avoiding scrolling in that fallback previously required every message to be mounted and verified. The old proof also used Markdown normalization, which could reject unrelated rich references.

Test 3 keeps ordinary messages from the validated direct response and substitutes only the rich answers matched to already-mounted page nodes. Matching uses exact message IDs, roles and current-branch order, including rendered-response IDs; it runs before and after image preparation. Timestamps and message order come from the direct response. Card component source and unsupported references inside that rendered card are not interpreted as ordinary Markdown.

This avoids a scan even when ordinary messages are outside the viewport. It does not invent content for an unloaded card. Missing/ambiguous cards, incompatible content types, unavailable API data, temporary chats, selected-message collection, single-chat JSON and Working/Thinking still use their existing page paths. Rendered cards combined with generated tool-image records also retain fallback because their grouping cannot yet be proved. Gemini remains page-based. Thus this is not a promise of zero scrolling for every export.

## Connection recovery

- An open menu waits for conversation messages instead of entering a permanent error when ChatGPT has not loaded yet. A temporary connection failure disables export until local status checks reconnect automatically. Neither recovery path starts or repeats an export.
- If the top-frame receiver is absent, the extension controls can ask the background to insert the manifest's bundled CSS/scripts into the supported target tab. Concurrent requests share one attempt; responding, busy and temporarily invalid receivers are not reinitialized. Content modules are guarded against duplicate initialization.
- Embedded controls are bound to their containing tab. Website callers and unsupported hosts cannot use the restoration request. Browser permission refusal is reported; it is not bypassed.
- The launcher recovers after an open menu enters back/forward cache, or after page rendering removes its dock. Granting persistent site access reconnects the controls immediately.

The user's intermittent error was reported without its exact message. These are reproduced code paths and targeted fixes, not proof that every possible connection error has the same cause.

## Validation

All 236 automated tests pass. Coverage checks a complete eight-message export with only three messages mounted, zero scroll writes, preserved API order/timestamps and a rendered answer with an otherwise unsupported reference. It also checks missing/duplicate/reordered/changing rich nodes, generated-image ambiguity, empty-page recovery, transient disconnects, missing receivers, concurrent restoration, permission refusal, active-export preservation and launcher restoration.

Run `npm test`. The browser fixture in `tests/rich-page-firefox.cjs` has been adapted for the mixed path, but its execution for test 3 was denied. No fresh Firefox end-to-end result is claimed for this build; test 1/test 2 browser results do not validate these new connection and collection changes.

# 0.5.6 test 1 — direct ChatGPT TXT/Markdown

Local unsigned test build. Not submitted for signing or published. The currently published release is 0.5.5.

## Install and check

1. Open `about:debugging#/runtime/this-firefox` in Firefox.
2. Use **Load Temporary Add-on** and select this build's `runtime/manifest.json`. If a temporary build is already loaded, remove that temporary build before selecting the new manifest. Keep the signed 0.5.5 download available for restoring the stable version if needed.
3. Reload the ChatGPT conversation tab so the new content scripts are loaded. Confirm version **0.5.6** in the extension popup.
4. Open an ordinary saved conversation; choose **All**, **Markdown**, and turn off **Include Working / Thinking**. Other normal options, including timestamps, can remain enabled.
5. Export. The completion detail should include **direct text export**. No scrolling should be needed. If the direct path is unavailable, the status explains page collection; do not count that run as a direct-export timing result.
6. Check the first, middle and final messages against the conversation. Check role order, repeated/regenerated replies, code fences, indentation, tables, links and citations. Repeat in TXT; TXT removes fenced-code delimiters while retaining the code contents.
7. Try a long text conversation, then one with edited/regenerated replies. Do not assume speed alone proves completeness. The visible reply branch must match the exported branch.

Report the format, displayed completion/fallback reason, approximate elapsed time and which part differed. A synthetic example is preferable to a private conversation export.

## Scope and limits

- Direct requests are made only to the current ChatGPT origin after export starts: session, then the saved conversation. Tokens remain in memory; no page-world injection, request interception, persistent response cache or third-party service is used. Firefox Manifest V3 content-script requests use page context ([Mozilla documentation](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/Content_scripts)).
- Temporary chats, Selected, Include Working / Thinking, Gemini and HTML/PDF/JSON retain the existing page reader. Their previous limitations still apply. An unsupported rich-content/attachment format also triggers page collection, rather than silently dropping that message.
- Image/file placeholders in text exports do not contain image bytes or promise original-quality media. Images, diagrams, autonomous HTML, PDF layout and ZIP originals remain separate work.
- The API is internal and can change. The user confirmed fast, complete Markdown (more than 35,000 lines) and TXT exports of the same real conversation with this test build. This is user-reported validation, not an independently counted message comparison or a timed benchmark. Other API response variants and Temporary Chat behavior still require user validation. HTML/PDF work continues in [test 2](TEST-v0.5.6-test2.md).
- Responses over 32 MiB and normalized text over 16 Mi characters stop without saving a partial export. These are allocation safeguards, not a guarantee about total Firefox memory.
- If the server cannot provide a connected current branch, the reader does not flatten other branches chronologically. Conflicting conversation IDs stop export. Available visible message IDs are checked against the returned branch.
- Existing pending issue #6 code-fence changes are included. The author’s exact live Gemini case has not yet been retested.

## Automated verification

November 17, 2026: **129/129 automated tests passed**. The isolated Firefox check passed in **Firefox 160.0**, exporting **1200 messages each in TXT and Markdown** with four authenticated local GET requests in total. These automated checks do not measure live-account timing or completeness; the separate user-reported Markdown result is recorded above.

`npm test` includes branch/identity validation, literal Markdown and code, citations and attachments, unknown-content fallback, cookie/Bearer request shape, output without tokens, cancellation, navigation, response limits, timeout and interrupted stream handling. A synthetic 1200-message runtime test checks first/middle/last messages and code without scrolling. This is not a benchmark of live ChatGPT.

`node tests/chatgpt-api-firefox.cjs release/0.5.6/api-firefox` installs a small MV3 fixture extension into a new headless Firefox profile, substitutes only the allowed origin with a loopback server, and runs the production reader against a synthetic 1200-message conversation. It verifies real content-script fetch, HttpOnly session cookies, Bearer authentication, streamed JSON, TXT/Markdown output and absence of tokens in the output. It does not open or inspect personal browser tabs.

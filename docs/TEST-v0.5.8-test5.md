# 0.5.8 test 5 — transient errors and rich-reference diagnostics

November 25, 2026. Local unsigned build based on test 4. No public release or signed XPI is created. Permissions and host scope are unchanged.

## Install and check

Load `release/0.5.8/test5/runtime/manifest.json` through `about:debugging#/runtime/this-firefox`, replacing the previous temporary build, then reload ChatGPT.

Retry the affected image-bearing conversation with the same options, including Working / Thinking. Success and error notices now disappear five seconds after completion. The last error remains accessible when opening the export menu. If export still fails, expand **Last export diagnostic**, click **Copy diagnostic**, and share that report. If clipboard access is unavailable, the button selects the report; press Ctrl+C. The report remains until the next export or page reload, so it need not be copied during the five-second notice.

## Changes and limits

- Both successful and failed in-page statuses use the same five-second deadline. This includes stopped/cancelled exports. A later running export is protected from the previous timer; returning to a restored page retains the original deadline.
- A reproduced failure in Working / Thinking occurs when text contains a citation marker but the saved response has no matching reference metadata. Such citations now become `[Source link unavailable]`; the surrounding text is retained. This also applies to ordinary answers and all five single-chat formats. Literal markers in code remain code. No destination is guessed.
- This is not proof that missing citation metadata caused the user's reported failure. Unknown rich markers and unsupported matching reference records still stop export. Their diagnostic distinguishes ordinary content from activity, marker categories, matching reference counts and the presence of known fields.
- Diagnostics contain fixed categories and counts only, with bounded reference samples. They exclude conversation text, marker payloads, unknown metadata names/values, URLs, IDs, credentials and image bytes. Copying is user initiated; no automatic upload is performed.
- Saved-chat exports retain the no-scrolling behavior from test 4. Image resolution and embedding are unchanged. This build does not claim that every image-bearing conversation is supported.

## Validation

All **254 automated tests pass**.

Automated coverage checks missing citations in ordinary answers and Working / Thinking across TXT, Markdown, HTML, PDF and JSON with forty messages and only the final message mounted; zero scroll writes; preserved text and literal code; diagnostic redaction and sample bounds; clipboard and selection fallback; diagnostics in the reopened popup/page menu; and success/error dismissal at the exact five-second boundary.

Run `npm test`. The complete result is recorded locally in `release/0.5.8/test5-unit-tests-final.log`. No fresh authenticated export of the reported chat or fresh Firefox browser run was performed for test 5. Test 4's isolated Firefox checks are documented in `TEST-v0.5.8-test4.md`; they do not validate this specific chat.

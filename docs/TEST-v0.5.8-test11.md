# 0.5.8 test 11 — check image access before downloading

November 25, 2026. Local unsigned build. Runtime: `release/0.5.8/test11/runtime/manifest.json`. No public release or permission-scope change.

Follow-up: the maintainer reported that the affected conversation saved all images in **66 HTML parts**. This confirms their observed outcome; the 66 final files were not independently audited. The release code is frozen at test 11 for [0.5.8 signing](AMO_SUBMISSION-v0.5.8.md).

## Report and correction

Test 10 reached image 156/478, message 282, then reported `IMAGE_PERMISSION_REQUIRED` with `transport: extension` and one attempt. This is the background reader's explicit permission refusal, not the earlier page CORS error. Test 10 checked permission only when it reached the first OpenAI preview, after downloading 155 earlier images. That late check wasted the preceding work.

Test 11 scans the normalized enabled image references before direct HTML/PDF embedding. If a supported explicit OpenAI preview is present, it checks the existing Firefox host permission before resolving file pointers, downloading images or staging parts. Denial reports `phase: permission`, zero attempts and the first preview's image/message position. There is no partial-save choice because no prefix has been prepared. A failed or unanswered check also stops without downloads; the check has a five-second deadline and supports cancellation.

Chats without such previews, disabled image roles and text-only formats do not request this check. Per-download checks remain in place for permission revocation. Preflight covers explicit preview URLs already present in the normalized media list; it does not inspect remote file-pointer targets or change rendered-page collection.

The **Allow image access** action remains available in the reopened toolbar and in-page menus after the transient status disappears. It opens the existing permission page. Access is requested only when the user clicks that page's enable button. Granting access does not resume an interrupted job automatically; return to the chat and start the export again.

## Validation

- Regression fixture: 670 messages, 478 images, first OpenAI preview at image 156 / message 282. With access denied, zero image requests, file-reference resolutions or staged parts. With access granted, the fixture completes with all 478 images and 670 messages in order.
- Production content flow: missing access reports an error at zero processed messages, exposes the repair action, preserves the diagnostic after status dismissal, and completes after access is granted and export is restarted.
- Background sender restrictions, cancellation, timeout, invalid replies, disabled images and text-only formats are covered. Toolbar and in-page menu tests verify persistent access to permission settings without automatically starting export.
- **295 automated tests pass**; output: `release/0.5.8/test11-unit-tests.log`. The offline six-file Kitsune transport replay also retains all image bytes and order.

Permission APIs and DOM are simulated in these tests. This is not a new Firefox permission-dialog test or a complete export of the maintainer's real chat. The previous test 10 transport evidence and its limits remain documented in [test 10](TEST-v0.5.8-test10.md).

## Install and retry

Load `release/0.5.8/test11/runtime/manifest.json` as the temporary extension, then reload the conversation. Start HTML export. If access is missing, select **Allow image access**, enable it on the opened page, return to the conversation and start export again. The existing test 10 permission button can also grant the same access; test 11 prevents discovering the missing permission late in a long run.

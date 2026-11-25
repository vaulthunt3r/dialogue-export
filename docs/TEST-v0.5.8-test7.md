# 0.5.8 test 7 — save collected content after Stop or an image error

November 25, 2026. Local unsigned build. Manifest, permissions and host scope are unchanged. No public release or signed XPI is created.

## Install and use

Replace the temporary extension using `release/0.5.8/test7/runtime/manifest.json` in `about:debugging#/runtime/this-firefox`, then reload ChatGPT.

For direct saved-chat HTML/PDF, **Stop** halts collection and offers **Save collected** or **Discard**. An image-embedding failure offers the same choice. The prompt shows the complete-message count, total when known, and included images. It remains until a choice is made and is also available in the reopened Firefox popup or page menu. No file is downloaded automatically from this prompt.

**Save collected** retains the verified prefix: already staged parts plus complete messages in the current buffer. The unfinished message is excluded as a whole, including images prepared within that message. Files receive `-partial` in their names and a visible warning describing the included message range; the warning also survives PDF preview/printing and disabling the document title. PDF parts still need to be printed separately.

**Discard** removes unsaved temporary data. Files already downloaded remain. If Stop is pressed during HTML file saving, the current download finishes first, then **Save remaining / Discard** appears before the next part. Final success/error notices still disappear after five seconds; pending choices do not.

When no complete message is available, saving is disabled. There is no resume after reload and no automatic skipping of a failed image. Navigation or closing/reloading the source page discards the pending export. Existing temporary-storage expiry remains one hour of inactivity. The ZIP archive workflow is unchanged. Page collectors, such as selected-message/Gemini exports, do not gain a partial-message checkpoint.

## Reported failure and diagnostics

The supplied screenshot shows test 6 stopping at image **156 of 478**, after **10:53**, with a generic embedding error. That run did not establish successful export of all 478 images. Test 6 deleted its unsaved temporary parts on that failure; test 7 cannot recover them retroactively.

The exact cause of that image failure remains unconfirmed. Test 7 preserves fixed failure codes, numeric HTTP status when available, the image index/count and whether failure occurred while obtaining a download reference or downloading/decoding the image. Diagnostics contain no source URLs, identifiers, session credentials or conversation text. They remain accessible under **Last export diagnostic** after saving a partial result. The new behavior protects completed work; it does not guarantee that image 156 itself will download.

## Validation

All **270 automated tests pass** (`release/0.5.8/test7-unit-tests-final.log`). Coverage includes interruption within a multi-image message, cancellation during an acknowledged stage write, preservation of staged parts and the complete tail without duplication, HTTP/reference failures and diagnostic redaction, storage-failure cleanup, exact partial metadata and filenames, explicit Save/Discard, zero-ready-message behavior, source closure/navigation, popup restoration, and stopping during file saving.

Firefox **161.0** checks used a fresh isolated profile and local synthetic endpoints. Four scenarios passed: Stop → save HTML; HTTP 503 → save HTML; HTTP 503 → discard; HTTP 503 → save PDF. Each retained prefix contained three of four messages, split across two parts. No download occurred before the choice. HTML image bytes matched the source fixtures, discard cleared staged data, and both PDF preview parts decoded their images and retained the partial warning. The complete-message prefix exported with zero scroll writes. Choice and PDF screenshots were inspected. Results: `release/0.5.8/partial-test7-final/result.json`. The final subsequent UI change adds the included-image count to the choice text; it does not change the recovery logic.

Run `npm test` and `node tests/partial-firefox.cjs <new-output-directory>`. Tests do not use the personal browser profile or the private 478-image chat.

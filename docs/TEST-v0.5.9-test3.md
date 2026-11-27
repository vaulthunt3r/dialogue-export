# 0.5.9 test 3 — unresolved AsyncImage investigation

November 27, 2026. Diagnostic build; the reported conversation export is not yet fixed or verified.

## Observed failure

The maintainer reported `AsyncImage`, `phase: reference`, `IMAGE_REFERENCE_NOT_FOUND`, with string `query` and `aspectRatio` attributes. The same build successfully exported a previously tested image-heavy conversation. The image-query resolver has the same acceptance rules as published 0.5.8; only diagnostic detail changed in 0.5.9.

The authorized in-app browser displayed an answer with four search illustrations. All four loaded and were downloaded through the browser asset capability: JPEG files with dimensions 819×460, 720×720, 681×383 and 1024×575. This verifies that those particular displayed resources are available. It does not reveal the saved query/reference association received by the extension and does not verify the whole conversation export. Private local evidence stays under the ignored release directory.

The connector returns only a partial text projection without source references. Browser DOM inspection exposes rendered image URLs, not the original reference records. The existing failure report therefore lacks the information necessary to reproduce the binding failure.

## Diagnostic changes

- On an unresolved or ambiguous `AsyncImage`, include bounded shapes of saved content references and known image metadata fields. Include exact and trimmed query-equality flags, reference type categories and URL-kind categories.
- Exclude all scalar source values, query strings, labels, addresses, source IDs, unknown key names and unrelated metadata. Limit array samples, depth and the total description budget.
- Retain the secondary failure when rendered-answer planning encounters generated image messages, instead of losing that explanation behind the first component failure.
- Keep existing matching, rejection, download, scrolling and permission behavior. Images are not silently dropped or replaced with new search results.

## Validation and next reproduction

The full suite result is recorded beside this build. New tests check mismatched queries, alternate metadata shapes, absence of private values and bounded diagnostic size. Existing reference-resolution and image-transport tests remain applicable.

Load `release/0.5.9/test3/runtime/manifest.json` as a temporary Firefox add-on, reload the affected chat, and repeat the same HTML export with images enabled. If it stops, copy the expanded **Direct export diagnostic**, including `imageReferences` and any `renderedPlan` field. This step collects the missing source structure; successful export is not promised by this diagnostic build.

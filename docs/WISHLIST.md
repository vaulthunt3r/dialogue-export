# Wishlist

These items are proposed future work; no delivery date is promised.

0.5.6 is Mozilla-signed. It includes numbered parts for direct saved-ChatGPT HTML/PDF and a text-only ChatGPT history ZIP with indexes and reports. The user confirmed an image-bearing three-part HTML/PDF export and a 42-chat archive run that saved 36 supported chats. Project-chat coverage remains unverified. ZIP with image files, verified originals and multipart support for other collection paths remain future work.

## More archive message and reference variants

Collect additional issue examples for unsupported rich references, message content types and responses marked unfinished in saved history. The current archive skips these chats with an explanation and preserves successful ones. In the confirmed real run, four chats failed with RICH_REFERENCE, one with MESSAGE_TYPE and one with RESPONSE_UNFINISHED. The existing report only identifies categories; do not claim a specific schema fix without a reproducer. Ask for extension/browser version, error code and minimal structural examples rather than private conversation text or account exports.

## ZIP export with original images

Export a conversation as a ZIP containing a readable conversation file, an `images/` folder and an index that links each image to its message. Prefer the original downloadable image bytes, at their original resolution and format, when the service makes them accessible through the user's authorized session. Repeated references should reuse the same saved file.

The 0.5.5 page reader captures the resolution loaded in the page, which may be a preview. The 0.5.6 direct reader embeds downloaded raster bytes unchanged and can label their resolution, format and source, but does not yet verify equivalence to the original Download file. Enlarging or re-encoding a preview does not recover the original. The proposed ZIP exporter should distinguish original, preview and unavailable assets explicitly; it must not silently describe a preview as an original or imply that unavailable originals were saved. Access and download behavior need investigation for each supported service.

The extension's downloadable release-kit ZIP contains extension packages; it is not this proposed conversation-export feature.

## Automatic numbered parts for large exports

Split oversized conversations automatically into clearly numbered parts with a shared index, preserving message order and image associations. The result should record message ranges and missing/unavailable assets, allow completeness checks, and avoid retaining all image data in memory at once. Exact size limits, archive layout and recovery behavior still need design and testing.

## Reliability for very long image-heavy chats

A long text conversation exported successfully with the tested 0.5.5 runtime. A previous image-heavy conversation exported only a small fraction while reporting success; later testing exhausted memory. With 0.5.6 test 5, the current affected image-bearing chat exported successfully into three parts in HTML/PDF according to the user. Broader coverage, completeness audits and measured peak memory remain work to do; the current result does not establish that every earlier heavy case is fixed.

Investigate collection completeness across remounted message windows, delayed images, useful progress reporting and peak memory use. Validate against the first, middle and last messages and image counts before claiming this case fixed. Existing extension budgets do not cap the website or Firefox's total memory.

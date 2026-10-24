# Wishlist

These items are proposed future work. None is implemented in 0.5.5, and no release date is promised.

## ZIP export with original images

Export a conversation as a ZIP containing a readable conversation file, an `images/` folder and an index that links each image to its message. Prefer the original downloadable image bytes, at their original resolution and format, when the service makes them accessible through the user's authorized session. Repeated references should reuse the same saved file.

The current HTML/PDF export captures the resolution loaded in the page, which may be a preview. Enlarging or re-encoding a preview does not recover the original. The proposed ZIP exporter should distinguish original, preview and unavailable assets explicitly; it must not silently describe a preview as an original or imply that unavailable originals were saved. Access and download behavior need investigation for each supported service.

The extension's downloadable release-kit ZIP contains extension packages; it is not this proposed conversation-export feature.

## Automatic numbered parts for large exports

Split oversized conversations automatically into clearly numbered parts with a shared index, preserving message order and image associations. The result should record message ranges and missing/unavailable assets, allow completeness checks, and avoid retaining all image data in memory at once. Exact size limits, archive layout and recovery behavior still need design and testing.

## Reliability for very long image-heavy chats

A long text conversation exported successfully with the tested 0.5.5 runtime. A previous image-heavy conversation exported only a small fraction while reporting success; later testing exhausted memory. That heavy conversation has not been revalidated, so its problem remains open.

Investigate collection completeness across remounted message windows, delayed images, useful progress reporting and peak memory use. Validate against the first, middle and last messages and image counts before claiming this case fixed. Existing extension budgets do not cap the website or Firefox's total memory.

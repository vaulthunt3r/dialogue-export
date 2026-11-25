# 0.5.8 test 6 — saved image groups

November 25, 2026. Local unsigned build based on test 5. No public release or signed XPI is created. Manifest, permissions and host scope are unchanged.

## Install

Load `release/0.5.8/test6/runtime/manifest.json` through `about:debugging#/runtime/this-firefox`, replacing the previous temporary build, then reload ChatGPT. Retry the affected conversation with the same image and Working / Thinking settings.

## Cause and change

The supplied diagnostic identifies an ordinary assistant answer containing an exact-matched `image_group` reference with six images. Test 5 recognized only `image`, `images` and `image_v2`; it therefore rejected this gallery before any image download. The reported failure was not in Working / Thinking.

The parser now recognizes `image_group` and unwraps `images[].image_result`. This nested result shape is also described in [chatgpt-exporter's source types](https://github.com/pionxzh/chatgpt-exporter/blob/master/src/api.ts) and handled in [chatgpt2obsidian](https://github.com/knu/chatgpt2obsidian/blob/main/chatgpt2obsidian). Flat results with explicit image fields are accepted too. No third-party implementation was imported.

- Direct HTML/PDF exports retain every image in saved order, using the existing bounded download/embed pipeline. Gallery output is static images rather than an interactive carousel.
- The exact saved marker selects the gallery. Search queries, source-page URLs and `safe_urls` are not guessed as image destinations. Explicit thumbnail URLs can be used when no higher-priority image URL is present; original-file equivalence is not promised.
- User/AI image switches cover this reference type. TXT, Markdown and normalized JSON keep an explicit image-gallery placeholder, without downloading image bytes.
- Invalid or missing enabled image results remain errors rather than silently removing a gallery item. Structural diagnostics now identify the presence of `image_result`, `image_search_query` and known nested result fields, without their values.
- All test 5 fixes remain, including the five-second success/error notice and diagnostics in the reopened menu.

## Validation

All **258 automated tests pass** (`release/0.5.8/test6-unit-tests-final.log`). New tests cover six nested results beside an entity, HTML/PDF image bytes and order, credential isolation, explicit thumbnail fallback, flat results, malformed inputs, image switches, text-only formats, and a forty-message direct export with saved activity and only the final message mounted.

Firefox **161.0**, using an isolated profile and local synthetic endpoints, exported forty messages in all five formats with zero scroll writes and unchanged scroll position. HTML/PDF included six gallery images plus the existing card image. Each image decoded offline in the exported HTML and PDF preview, retained its order and had bytes identical to the fixture. Card bar proportions remained correct. Results: `release/0.5.8/image-group-test6-qa/result.json`.

Reproduce with `npm test` and `node tests/static-components-firefox.cjs release/0.5.8/image-group-test6-qa --image-group` using a new output directory. These tests cover the identified reference format; they are not a fresh authenticated export of the user's private conversation. Remote image availability, supported formats and existing memory limits still apply.

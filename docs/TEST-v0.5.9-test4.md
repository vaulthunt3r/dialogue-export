# 0.5.9 test 4 — saved DIL image references

November 27, 2026. Fix build following the test 3 report. Complete live export of the reported conversation has not yet been verified.

## Evidence and changes

The user report contains an unresolved `AsyncImage`, one otherwise unrecognized reference with `matched_text` and 12 safe URLs, and a secondary planning failure involving one rendered answer and 21 generated-image messages. The privacy-preserving report does not expose the actual component data or compiled program. Four illustrations in the affected answer were previously inspected and downloaded through the authorized in-app browser.

Public first-hand captures document search-image results in `model_dil_v2.appData.opGenui.componentResults` ([OpenUI capture analysis](https://www.openui.com/blog/how-chatgpt-intelligent-ui-works)), and compiler-generated `__resolutionId` properties and string constants ([captured implementation analysis](https://github.com/Disdjj/intelligent-ui-demo/blob/main/ANALYSIS.md)). The DIL content-reference variant is also described in an [author's extraction example](https://community.openai.com/t/bad-chatgpt-s-markdown-in-copy-paste-working-solution/1405669). This is the basis for the supported synthetic fixture; it is not a recovered copy of the user's raw API response.

- Read bundles from message metadata and from `type: dil` content references. Bind an exact query to its saved resolution ID and then to the corresponding image result. Result-map order does not affect selection. Prefer the exact saved OpenAI image preview using the existing media pipeline.
- Inspect only literal compiler property records and constant-table string lookups. Never execute the surrounding JavaScript. Bound input size and binding count; ignore quoted/commented pseudo-calls and decline unsupported program syntax, dynamic bindings, spreads and duplicate keys. Singular images must have one completed image result. Missing or conflicting references remain explicit failures.
- Never select images from `safe_urls`, a source-page address, another message's metadata, or a new search.
- Restrict the rendered/generated-image duplication guard to the same user turn. Other turns retain their explicit API image records and order. Exactly identified rendered answers still use the existing branch and DOM verification.
- Extend value-free diagnostics to identify DIL structure without including compiled code, constants, IDs, URLs or conversation text.

## Validation

- New DIL resolution regressions failed before the resolver change. A mixed-export regression then reproduced the separate global planning block before its fix.
- All **312 automated tests passed**. Coverage includes HTML/PDF, four images with deliberately shuffled result insertion order, metadata and content-reference bundle locations, disabled images, conflicting/missing/loading references, page-only and active URLs, non-execution, bounded input, and retained legacy formats.
- Integration fixture: 65 messages containing four search illustrations, one user attachment and 21 visible generated-image outputs. All 26 images embed with exact message order and surrounding text. Both direct export with no mounted answer and the rendered-answer fallback pass for HTML/PDF. Same-turn generated-image ambiguity remains rejected.
- Authorized in-app browser: production normalization, embedding and rendering passed for HTML and PDF preparation, with real `Image.decode()` and local transport. Each output contains all 65 messages and 26 embedded images. The four actual retained JPEG previews preserve order and dimensions: 819×460, 720×720, 681×383, 1024×575. Inspected the HTML preview; all images decoded, none overflowed the document, and no browser console errors were recorded.
- Runtime ZIP, unsigned XPI, source ZIP and SHA256SUMS are checked against the tested workspace. Manifest and permissions are unchanged from test 3. Private source evidence and local browser fixtures remain outside distributable archives.

The browser fixture uses synthetic bindings with retained real image bytes and local downloads. It does not verify live ChatGPT transport, the Firefox background bridge, printed PDF pagination, or the entire original conversation. No personal or isolated Firefox profile was accessed. Load `release/0.5.9/test4/runtime/manifest.json`, reload the affected chat, and repeat its HTML export with images enabled to confirm that final case.

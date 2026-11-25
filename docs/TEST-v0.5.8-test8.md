# 0.5.8 test 8 — static diagrams and rendered-message diagnosis

November 25, 2026. Local unsigned build. Load `release/0.5.8/test8/runtime/manifest.json` through Firefox's temporary-extension controls, then reload ChatGPT. No public release, signed XPI, new permissions or host access is included.

## Changes

Supported SVG diagrams can now be rendered from saved conversation text, whether standalone or nested in a card. Passive geometry, labels, loops, conditionals, local gradients and local element references are preserved. Percentage dimensions use the viewBox; `currentColor` becomes a readable fixed foreground. Presentation styles become attributes, with style precedence preserved. The diagram then passes through the existing bounded SVG sanitizer and image-embedding pipeline. Script, external resources, foreignObject and animation are unsupported. Fenced/inline SVG examples and user markup remain literal; the assistant-image switch excludes diagrams.

`AsyncImage` now also reads exact nested `image_group` results. It rejects ambiguous query matches and source-page-only results. Explicit label/URL markers preserve supplied HTTP(S) destinations and honor the links switch. These supported shapes never cause a page scan.

Already-loaded fallback cards no longer fail just because an unrelated text bubble has no source ID. Only the precisely identified required answers are copied. Ambiguous IDs, foreign branches, duplicate/order/role mismatches and changes during image preparation still stop export. Error text and Last export diagnostic distinguish missing answers, conflicting IDs, branch/order/role changes and empty or disappeared content. Diagnostics contain fixed categories, counts and bounded message positions, not conversation text or IDs.

The Save collected / Discard behavior from [test 7](TEST-v0.5.8-test7.md) is retained.

## Evidence and remaining limits

Live inspection of the reported short chat found inline SVG diagrams and virtualized earlier answers. Existing user and assistant IDs were present in the inspected DOM. A redacted structural fixture reproduced the old parser's rejection of nested SVG; it now normalizes for both HTML and PDF and embeds without a network request. This reproduces a concrete parser defect, but does not prove it was the only cause of the reported screenshot.

All **278 automated tests pass**. Regression tests cover geometry, dimensions, labels, Unicode/entities, repeated shapes, gradients, local references, style precedence, image switches, unsafe content rejection, code preservation, nested image references, explicit URL markers and precise rendered-message diagnostics. Image.decode is stubbed in jsdom: these tests validate serialization and the media pipeline, not browser pixels or a saved PDF's appearance.

Content samples were read from four real chats. The connector supplies Markdown projections, not the original conversation API payload or complete image-reference metadata. Of 20 sampled messages, 17 normalized to HTML, retaining six tables and four code blocks. Three image-gallery messages stopped explicitly because those projections lacked image metadata. These are **not four successful full-chat exports**. Private samples remain outside source packages; the structural regression fixtures contain generic text only.

The full real-chat export and browser rendering of this build remain unverified. Personal Firefox access and the isolated Firefox check were declined. The in-app browser could inspect the conversation, but the attempted local verification page did not load; a subsequent `data:` page was rejected by the browser safety policy and abandoned. No claim of complete export, image-download success or pixel-exact reproduction follows from the automated tests.

## Reproduce

Run `npm test`. The final local test log is `release/0.5.8/test8-unit-tests-final.log`; the content-projection summary is `release/0.5.8/test8-sample-results.json`. Build with `scripts/package.ps1 -OutputDirectory release/0.5.8/test8` into a new directory. Runtime and source ZIPs, an unsigned XPI and SHA256SUMS are generated.

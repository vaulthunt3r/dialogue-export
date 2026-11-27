# Post-0.5.8 rendered-content diagnostics

November 27, 2026. Local source changes only; no new package, signing or public release.

Follow-up: the maintainer supplied the MD export, exposing `<Cite ref="..."/>`. Its singular attribute reproduces the failure and is fixed in [0.5.9 test 1](TEST-v0.5.9-test1.md). The investigation below records what was known before that source file was available.

## Report and observed workaround

An eight-message saved conversation failed HTML export before image preparation. The diagnostic reported six mounted messages, one required rendered message, zero matched rendered messages, and missing message position 2. The generic error called the missing content a card or diagram, although the supplied visible answer contained ordinary instructions and a source citation.

After opening the first assistant answer on the page, the maintainer retried and confirmed that HTML saved. This confirms that the existing rendered-page fallback can complete this export once the answer is mounted. The saved file was not independently audited. The specific saved-data construct that failed direct rendering is still unknown: the copied text and connector-provided text do not reproduce the failure.

## Local changes

- Preserve the static renderer's failure category, element type, parsing/rendering stage, and known attribute types. Reference failures distinguish invalid citation references, invalid entity values, missing image queries, and unavailable or ambiguous image references.
- Include the message position after the complete export plan is available, and retain the existing page-match diagnostic as `renderedMatch`.
- Describe unavailable rendered content generically and include the missing message number, instead of asserting that the answer contains a card or diagram.
- Diagnostics use fixed categories and counts. They exclude source text, values, unknown attribute names, reference IDs and URLs. Array type samples are bounded. Rendering acceptance, resource limits, image requests and automatic-scrolling behavior are unchanged.

## Validation

All **297 automated tests pass** (`npm test`; local log: `release/0.5.9/diagnostics-unit-tests.log`).

New checks cover nested parse, attribute, style, SVG and reference failures, omission of private values, and bounded reference-array diagnostics. A synthetic eight-message scenario starts with only the final six messages mounted and an unsupported inline citation in message 2. The error retains the citation failure and missing-page explanation. Mounting that answer then exports all eight messages in order with its link and zero automatic scrolling.

The synthetic unsupported citation is a test case, not an identification of the maintainer's actual failing syntax. These are simulated DOM tests; the live outcome is the maintainer's confirmation above. No new Firefox UI test was run.

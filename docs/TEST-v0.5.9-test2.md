# 0.5.9 test 2 — formatted metrics and corpus replay

November 27, 2026. Local unsigned build; no signing, publication or permission changes. Includes [test 1](TEST-v0.5.9-test1.md).

## Reproduced failure and change

The supplied 36-message Markdown export fails on messages 8, 12, 24 and 28. Its static cards use numeric `toLocaleString()` expressions, `grid-item` and `title`. These constructs previously required rendered answers to be loaded on the page.

The parser now routes numeric formatting to its own bounded `Intl.NumberFormat` adapter. It accepts a limited locale/options structure, limits cached formatters and output length, and rejects other method calls, nonnumeric receivers, invalid locales and unsupported options. Conversation JavaScript is never executed. Grid items and titles preserve their children; text size, boolean borders and tabular-number styles are rendered directly. SVG title handling and literal code retain their existing paths.

## Evidence and scope

- The two supplied exports contain 8 and 36 messages. All 44 pass local production collection for HTML, PDF preparation and JSON, in order, with zero mounted messages, rendered-page requests or scrolling. Their 3 and 17 tables are retained. The second export contains 119 rendered static components, including formatted values and comparison bars.
- A reusable corpus audit also passes both files in all three formats. Its reader preserves content after internal horizontal rules and ignores message headings in fenced examples. Counts were checked against the supplied conversations.
- A mixed regression combines formatted metrics, SVG and explicit image references with mocked image responses. It verifies image bytes and excludes page access. Existing image, cancellation and multipart checks remain in the full suite.
- The full suite result and package integrity are recorded in `release/0.5.9/test2/verification.json`. Private conversation files and replay outputs are excluded from source and runtime archives.

This is not an all-account pass. The connector listed 39 active chats and no archived chats, but its message projection was incomplete: 10 messages for the known 36-message conversation, without original component syntax. Only the two supplied files have been replayed. The rendered card was inspected in the authorized browser, but the new extension has not been tested live in Firefox.

Markdown lacks original reference metadata and image attachments. The two replays therefore have 1 and 3 unavailable-source labels. They do not establish live image-download success, original citation destinations, Working/Thinking coverage or completeness of project/archive listings.

## Repeating the corpus check

Use Dialogue Export's **ZIP** button from a ChatGPT tab. Keep **Include archived chats** enabled, click **Load list**, then **Select all found**, choose **Markdown**, and click **Export selected**. Keep every ZIP part and the JSON report; failed or unattempted chats remain uncovered. Compare the resulting list with the account, including project chats.

After extracting supplied ZIP files to a local folder, run:

```powershell
node scripts/audit-md-corpus.cjs --report release/0.5.9/corpus-report.json path/to/extracted-chats
```

Individual MD paths can also be passed. The command reads local files without account access or network requests, writes a per-file/per-format report, and exits nonzero for failures. Markdown boundaries are inherently ambiguous if answer text reproduces the export's role heading and separator; compare reported message counts with the original chat or archive report before asserting coverage.

## Temporary installation

Open `about:debugging#/runtime/this-firefox`, choose **Load Temporary Add-on**, and select `release/0.5.9/test2/runtime/manifest.json`. Reload the ChatGPT tab. Test **All messages → HTML** while at the end of the conversation. This unsigned installation lasts until Firefox restarts; the published build remains 0.5.8.

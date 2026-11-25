# Mozilla Add-ons submission — 0.5.8

Mozilla-signed XPI received and compared on November 25, 2026. All 46 runtime files match the submitted package, allowing manifest formatting only; five Mozilla signature files were added. Release code and assets are frozen at test 11. Only privacy-policy wording changed during signing preparation; no runtime file changed after submission.

## Package and source

The submitted package was **Dialogue-Export-v0.5.8-AMO.zip** from `release/0.5.8/signing/`. The ID remains `dialogue-export@extension`, version `0.5.8`, minimum Firefox `142.0`. The archive contains 46 runtime files and the manifest at its root. The AMO ZIP, runtime ZIP and unsigned XPI contain identical bytes. The signing-kit ZIP is not an extension upload. See Mozilla's [packaging guide](https://extensionworkshop.com/documentation/publish/package-your-extension/).

For the minification/generated-code question, select **Yes** and attach **Dialogue-Export-v0.5.8-source.zip**. The runtime includes the pinned upstream minified markdown-it distribution and its readable source map. The source archive includes the matching runtime, lockfile, tests, packaging script and these instructions. First-party JavaScript is readable, unbundled and untranspiled. See Mozilla's [source submission guide](https://extensionworkshop.com/documentation/publish/source-code-submission/).

The exact submitted source is preserved as **Dialogue-Export-v0.5.8-AMO-source.zip**, SHA-256 `ed69cba1b38729c3ff9afb97e383ad31cde5da2166bcf6b6193a9878d1fa27a7`. The public `-source.zip` adds final release documentation without changing the runtime. The runtime ZIP SHA-256 is `5fe99523d15e06c8662fce4562e5c534d018d243951f6ab5d399b3f7c0254e1f`; rebuilding the submitted source reproduced those exact bytes.

The signed XPI is 325,510 bytes, SHA-256 `24031ddf0026bce232aa6c215ada3a2e2bbbf5cb10edaeac331b855cadb943c3`. Its only changed runtime entry is `manifest.json` formatting; parsed manifests are identical. Added signature entries: `META-INF/cose.manifest`, `META-INF/cose.sig`, `META-INF/manifest.mf`, `META-INF/mozilla.rsa`, `META-INF/mozilla.sf`. Install the signed XPI from the [0.5.8 release](https://github.com/vaulthunt3r/dialogue-export/releases/tag/v0.5.8).

## Notes for reviewers

This update extends direct export of saved ChatGPT conversations to all single-chat formats, including normalized JSON. It follows the current conversation branch and validates conversation identity. Unsupported saved content stops with an explanation instead of triggering automatic page scrolling. Temporary chats, selections and Gemini retain their page-based readers.

The new `content/components.js` is a bounded, local parser for supported static component layouts and SVG diagrams. It interprets a restricted grammar for literals, scoped properties, arithmetic, conditionals and repeated elements. It does not evaluate JavaScript or execute message event handlers or page functions. Active and external SVG content is rejected; only passive supported structures are serialized. Supported exact image queries resolve against saved references, never new image searches. Unsupported cards may use an already loaded node only after identity, role and order checks.

The only added permission relative to 0.5.7 is **`scripting`**. The extension's own export controls can restore its bundled content scripts and styles in the top frame of an already selected ChatGPT/Gemini tab when no receiver is present. Existing site permissions still apply. A responding or busy script is not reinitialized. No remote code is injected, no export starts automatically, and host scopes are unchanged.

Direct OpenAI previews now use the existing background reader, restricted to HTTPS `images.openai.com/static-rsc-*/` and `/thumbnails/` paths, from the top-level ChatGPT content-script sender. Downloads omit cookies, authorization tokens and referrers, reject redirects, enforce byte/pixel limits, validate decoding and support cancellation. Preview bytes are embedded without re-encoding. Original Download-file equivalence is not claimed. Explicit supported previews in normalized media are checked for existing host permission before the first image download; each download also retains its own permission check.

Missing access offers the local `popup/image-access.html` page. Permission is requested only on a user click, for the existing image host. That page receives no conversation content and does not restart an export. The permission action and last diagnostic remain available in the export menu after the transient status notice disappears.

Temporary image failures retry at most three times, refreshing supported ChatGPT file download links when available. Completed messages and staged parts remain available. Stop or persistent image failures offer an explicit Save collected / Discard choice. Partial exports are labelled and exclude unfinished messages. Discard, navigation/closure and expiry clean up existing temporary storage; completed downloads remain. Early permission denial creates no image downloads or staged prefix.

Optional saved Working / Thinking records contain only available visible summaries and assistant progress updates. Hidden records, raw tool output, analysis-channel text and service recaps are excluded. Session tokens remain in memory in the content script and never enter exported files, diagnostics, image-host requests or developer services. Structural and image diagnostics contain fixed categories and bounded counts, not conversation text, IDs, URLs or credentials. No analytics, telemetry, developer uploads or remote executable code are included.

The runtime library remains **markdown-it 15.0.3**, pinned in `package.json` and `package-lock.json`. The bundled JavaScript and source map remain unchanged upstream files; licenses are in `shared/vendor/MARKDOWN-LICENSES.txt`. No new runtime dependency is introduced.

## Reproduce

Verified environment: Windows, PowerShell 7, Node.js 24.19.0, npm 12.0.2. From the extracted source root:

```powershell
npm ci --ignore-scripts
node scripts/vendor-markdown.cjs
./scripts/package.ps1 -OutputDirectory ./release/rebuilt-0.5.8
```

Use a new output directory. The script copies runtime files unchanged with deterministic ZIP entries. Compare the rebuilt `Dialogue-Export-v0.5.8.zip` SHA-256 with the AMO runtime hash in the signing kit. The source ZIP may include documentation that is not part of the runtime. Supplied icons and promotional media need no regeneration. Python is used only for local release checks, not by the extension or the package build.

`npm test` runs the automated checks. All **295 tests pass** on the frozen test 11 code. The source includes regressions for 670 messages and 478 images, early permission refusal, retries, static components/SVG, partial exports, cancellation and UI recovery. The maintainer reported successful saving of all images in 66 HTML parts from the affected real conversation. This is a maintainer report, not an independent audit of those final files. Permission APIs in the new regressions are simulated; earlier Firefox checks and the targeted six-file transport replay are described in the test reports. Personal chat exports and local diagnostic downloads are excluded from both packages.

## Suggested release note

Improves direct ChatGPT exports with static cards, SVG diagrams, image galleries and optional saved Working / Thinking records. Fixes OpenAI preview downloads, checks image access before downloading, retries temporary failures and offers clearly marked partial saves after interruptions. Adds reconnection for missing content scripts. Existing host scope is unchanged; the new scripting permission restores only the extension's own bundled code on supported sites.

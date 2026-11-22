# Mozilla Add-ons submission — 0.5.7

Mozilla-signed XPI received and compared on November 22, 2026. All 45 runtime files match the submitted package, allowing manifest formatting only. The submitted runtime is byte-identical to approved 0.5.7 test 4. No runtime changes were made during release preparation.

## Submitted package

The signing handoff used **Dialogue-Export-v0.5.7-AMO.zip** from `release/0.5.7/signing/`. The extension ID remains `dialogue-export@extension`, version `0.5.7`, minimum Firefox `142.0`.

The `-AMO.zip`, regular runtime `.zip` and `-unsigned.xpi` contain the same bytes. The manifest is at the archive root. The signing-kit ZIP and source ZIP are not installation packages. Mozilla documents the accepted structure in its [packaging guide](https://extensionworkshop.com/documentation/publish/package-your-extension/).

For minification/generated-code questions, the signing instructions specified **Yes** and **Dialogue-Export-v0.5.7-source.zip**: the add-on includes the pinned upstream minified markdown-it distribution and its source map. The exact review source is preserved in the public release as **Dialogue-Export-v0.5.7-AMO-source.zip**. The public source ZIP adds final release documentation without changing the runtime. First-party JavaScript remains readable, unbundled and untranspiled. See Mozilla's [source submission guide](https://extensionworkshop.com/documentation/publish/source-code-submission/).

## Notes for reviewers

This update fixes ChatGPT HTML/PDF exports that previously printed internal visual-component source instead of rendered thumbnail cards. Recognized rich-component replies use rendered-page collection with a restricted, inert style subset. No component source is executed, and no remote CSS or JavaScript is imported. Ordinary supported text/Markdown retains the existing direct reader.

For conservative text-bearing API branches, the collector can verify every mounted message by ID, role and order and avoid scrolling. Identity is rechecked after image preparation. Partial, duplicated, reordered or changed messages cannot pass as a complete verified branch. Other cases retain page collection and its resource limits.

The only new host scope relative to 0.5.6 is **https://images.openai.com/**. This lets the background fetch previews already referenced by the current ChatGPT page when canvas capture is blocked by origin restrictions. Requests are restricted to HTTPS `images.openai.com/static-rsc-*/` and `/thumbnails/` paths. They omit cookies, authorization tokens and referrers, reject redirects, enforce download/pixel limits, validate the image bytes and decoding, and support cancellation. The bridge accepts only the extension's top-level ChatGPT content-script sender. No content script is installed on the image host. Downloaded preview bytes are embedded without re-encoding; equivalence to the service's original Download file is not claimed.

Missing image-host permission is checked explicitly. A user-clicked action opens `popup/image-access.html`, a local extension page that requests only that host after another explicit user click. It receives no conversation content and does not restart exports automatically. Error diagnostics use fixed codes and numeric HTTP status, without raw exceptions, URLs, tokens or text.

Added image source/size/quality captions and their settings control have been removed. Existing user/AI image switches remain. Original conversation captions remain content. The archive, optional notification permission, direct reader, existing temporary local multipart storage and privacy policy otherwise retain their documented behavior. No developer uploads, analytics, telemetry or remote code are included.

The runtime parser remains **markdown-it 15.0.3**, pinned in package.json/package-lock.json. `shared/vendor/markdown-it.js` and its source map are unchanged upstream bytes from the [public npm package](https://www.npmjs.com/package/markdown-it/v/15.0.3). Readable source content is in the map, and dependency licenses are in `shared/vendor/MARKDOWN-LICENSES.txt`. No new runtime library is introduced.

## Reproduce

Verified packaging environment: Windows, PowerShell 7, Node.js 24.19.0, npm 12.0.2. From the extracted source root:

```powershell
npm ci --ignore-scripts
node scripts/vendor-markdown.cjs
./scripts/package.ps1 -OutputDirectory ./release/rebuilt-0.5.7
```

Use a new output directory. Packaging copies runtime files unchanged and uses deterministic ZIP entries. `Dialogue-Export-v0.5.7.zip` reproduces the AMO ZIP. Runtime ZIP SHA-256: `0b1ec2dbddb1bf6f89a7adc0e5856150508da4c711a647a1cc24a213b46754e9`.

`npm test` runs the automated checks. Node/npm and Python are not runtime requirements. Supplied PNG assets need no regeneration. Rebuilding icons or the existing promotional trailer is not part of the extension build.

## Validation and handoff

219 automated tests passed. Isolated Firefox 160.0.1 checks verified card alignment, a narrow viewport, offline embedded images and HTML/print output, eight rendered messages with zero scroll writes, and permission-granted/denied cases. Five public preview URLs supplied during debugging were successfully embedded in an isolated profile; those diagnostic files, URLs and personal conversation files are excluded from the packages. The maintainer confirmed the affected HTML export after test 4.

The returned XPI contains the same 45 runtime files and five Mozilla `META-INF` signature files. All runtime bytes match except JSON whitespace in `manifest.json`; the parsed manifests are identical. The signed XPI is 299,123 bytes, SHA-256 `df3062c90e3e8da2437028a5366cbe4d071857d4ea941ce805d32fa24d02c9ef`.

The exact AMO-source archive has SHA-256 `a4da78416a1443a8b10ae3ce2e07fe917481b3482d29a6875ddaf02487c067cc`. Install `Dialogue-Export-v0.5.7-signed.xpi` from the [release](https://github.com/vaulthunt3r/dialogue-export/releases/tag/v0.5.7). Runtime/source ZIPs and the release kit are not installation packages.

## Suggested release note

Improves ChatGPT thumbnail cards and image previews in HTML/PDF exports. Fixes literal visual-component markup and misplaced thumbnails, embeds supported OpenAI previews, and avoids scrolling when the complete rendered conversation can be verified. Adds a clear image-access action and more precise download errors. Removes technical image captions and their setting. Requires image-host access for supported previews; existing limits for long or image-heavy page-collected chats remain.

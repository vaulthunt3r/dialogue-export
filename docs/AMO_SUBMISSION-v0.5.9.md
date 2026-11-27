# Mozilla Add-ons submission — 0.5.9

Mozilla-signed XPI received and compared November 27, 2026. All 46 runtime files match the tested submission, allowing equivalent manifest formatting only; five Mozilla signature files were added. Code and assets remain frozen at test 6. Only development/release documentation changed after submission.

## Submitted files and signature verification

Submit **Dialogue-Export-v0.5.9-AMO.zip** from `release/0.5.9/signing/` as a new version of the existing add-on, keeping its distribution channel. ID: `dialogue-export@extension`; version: `0.5.9`; minimum Firefox: `142.0`. The AMO ZIP, runtime ZIP and unsigned XPI have identical bytes and contain `manifest.json` at the archive root. The signing-kit ZIP is a handoff bundle, not the extension upload. See Mozilla's [packaging guide](https://extensionworkshop.com/documentation/publish/package-your-extension/).

The exact submitted source is preserved as **Dialogue-Export-v0.5.9-AMO-source.zip**, SHA-256 `b48e6b5e83e5d7cb76677b8c6fb4f947370e7b90898262e26a9fbde1785f84ba`. The public `-source.zip` adds final release documentation without runtime changes. The runtime ZIP SHA-256 is `b33464182eaaf3c8683dc5422baaddfbecae7637d2136fdceb86dcbe0be710b4`; rebuilding the extracted submitted source produced those exact bytes.

The signed XPI is 331,715 bytes, SHA-256 `f58dc193f6ed2fdb3611bb5d26892f444733a4bc92481c6cf088c95ca1605877`. Its only differing runtime entry is `manifest.json` formatting; parsed manifests are identical. Added entries: `META-INF/cose.manifest`, `META-INF/cose.sig`, `META-INF/manifest.mf`, `META-INF/mozilla.rsa`, `META-INF/mozilla.sf`. Install the signed XPI from the [0.5.9 release](https://github.com/vaulthunt3r/dialogue-export/releases/tag/v0.5.9).

For the minification/generated-code question, select **Yes** and attach **Dialogue-Export-v0.5.9-source.zip**. The runtime retains the pinned upstream minified markdown-it distribution and its readable source map. The matching source archive includes the runtime, lockfile, tests, packaging script and these instructions. First-party JavaScript is readable, unbundled and untranspiled. See Mozilla's [source submission guide](https://extensionworkshop.com/documentation/publish/source-code-submission/).

## Notes for reviewers

This update fixes supported saved ChatGPT component shapes. The existing restricted parser now supports nested immutable `const` bindings in layout sequences, preserved whitespace, observed citation shorthand, grid/title elements and bounded number formatting. It interprets a restricted expression grammar with explicit limits and local scopes. It does not evaluate JavaScript, execute event handlers or call page functions.

Image queries can resolve from exact query/resolution-ID pairs in saved DIL component data. The parser reads only bounded literal property records and approved constant-string references from the saved compiler output. It never runs that program, guesses by result order, takes URLs from `safe_urls` or performs an image search. Unsupported or ambiguous bindings remain explicit failures. Verified rendered answers may coexist with generated-image records from other user turns; same-turn duplicate-content and exact message checks remain enforced.

Rendered content icons use the existing SVG sanitizer and become inert embedded vectors. Hidden and UI-control icons remain excluded. Small divider content height and clipping are retained to avoid turning padding into a solid bar. Direct supported icons use local static vector data, without new libraries or network requests.

Permissions, optional permissions and host scopes are **unchanged from 0.5.8**. No new runtime dependency is introduced. Existing credentials remain in memory for the existing supported-site requests and are excluded from exported content, diagnostics and third-party image requests. No developer uploads, telemetry or remote executable code are added.

Structural diagnostics contain bounded type categories, field presence, counts and fixed error codes, not conversation text, arbitrary attribute values, URLs, message IDs or credentials. Private conversation exports and local diagnostic artifacts are absent from both submission archives.

## Reproduce

Verified environment: Windows, PowerShell 7.6.9, Node.js 24.19.0, npm 12.0.2. From the extracted source root:

```powershell
npm ci --ignore-scripts
node scripts/vendor-markdown.cjs
./scripts/package.ps1 -OutputDirectory ./release/rebuilt-0.5.9
```

Use a new output directory. The script copies runtime files unchanged with deterministic ZIP entries. Compare the rebuilt runtime ZIP against the AMO ZIP hash in the signing kit. No icon or promotional-media regeneration is needed. Python is used only for release verification, not by the extension or package build.

The runtime library remains **markdown-it 15.0.3**, pinned in the package manifest and lockfile. Its distribution and source map are unchanged upstream files; licenses are included in `shared/vendor/MARKDOWN-LICENSES.txt`.

`npm test` runs all **318 passing checks**. The frozen code has targeted coverage for saved-image binding, prompt scope/whitespace, semantic icons, dividers and existing mixed media/partial-export behavior. Local browser checks validate card appearance and image decoding. User-confirmed exports and the limits of independent coverage are recorded in the [release notes](RELEASE-v0.5.9.md) and linked test reports. A new full Firefox export, printed PDF or all-account audit is not claimed.

## Suggested release note

Fixes supported saved image references and prompt cards, expands static layout and citation support, and preserves status icons and thin separators in exported answers. Improves structural diagnostics. No new permissions, supported sites or runtime dependencies.

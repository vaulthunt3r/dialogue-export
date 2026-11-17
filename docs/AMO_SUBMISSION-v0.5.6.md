# Mozilla Add-ons submission — 0.5.6

Status: Mozilla-signed XPI returned by the maintainer on November 17, 2026. All 43 runtime files were compared with the exact submitted AMO ZIP: only manifest formatting and added META-INF signature files differ. The parsed manifest matches.

Signed XPI SHA-256: `39f6a0a0e4f19813b991f18842183c2a8d513b166757b4bda767c8bc34cfe5b8`.

Submitted runtime ZIP SHA-256: `14fa20d9a4d5d44b2b948144636c1278ef2349b6f8a607b472f5f2798f950d59`.

The instructions below record the submission process. The exact original source ZIP is preserved in the release as `Dialogue-Export-v0.5.6-AMO-source.zip`. The public `-source.zip` additionally includes publication documentation and the trailer project; extension runtime bytes are identical in both.

## Upload

In the existing add-on's **Submit a New Version** flow, upload **Dialogue-Export-v0.5.6-AMO.zip**. ID: `dialogue-export@extension`; version: `0.5.6`; Firefox minimum: `142.0`. The runtime ZIP and unsigned XPI are byte-identical alternatives. Do not upload the signing-kit ZIP or source ZIP as the installation package.

For a question about minification, generated code or preprocessing, select **Yes** and attach **Dialogue-Export-v0.5.6-source.zip**: this version includes the official minified markdown-it browser distribution and a script that prepares the vendored files. First-party JavaScript is readable and is not transpiled, bundled or minified. Source submission instructions are included below.

Mozilla accepts ZIP/XPI packages with the manifest at the root. Its [packaging guide](https://extensionworkshop.com/documentation/publish/package-your-extension/), [source submission guide](https://extensionworkshop.com/documentation/publish/source-code-submission/) and [third-party library requirements](https://extensionworkshop.com/documentation/publish/third-party-library-usage/) describe package layout, reproducibility and pinned library references.

## Notes for reviewers

Dialogue Export processes the user's selected ChatGPT/Gemini conversation locally and saves TXT, Markdown, HTML, normalized JSON or printable PDF. No conversation data is uploaded to the developer, and there is no analytics, telemetry, advertising or remote code.

Saved ChatGPT conversations may be read through authenticated GET requests to ChatGPT after an explicit export action. The existing source-tab session is used; its token stays in content-script memory and is excluded from extension messages, downloads and persistent storage. Response IDs and the active branch are validated. Unsupported cases use page collection. Image requests use explicit conversation references; cross-origin media downloads omit credentials and referrers. HTML rendering disables raw conversation HTML.

The separate ChatGPT archive tab requests history only after Load list, and reads selected chats sequentially only after Export selected. It saves text-only ZIP parts, indexes and per-chat reports. Unsupported chats are skipped with reasons. A terminal read failure saves prepared chats if downloading is still available. The archive is not claimed to cover every project chat or response variant. Reports intentionally contain selected chat titles/IDs; no diagnostic report is sent automatically.

Large single-chat direct HTML/PDF parts are temporarily staged in extension-local IndexedDB, then cleaned after downloading/closing, cancellation or failure; abandoned jobs expire on later access after one hour of inactivity. Archive ZIP buffers remain in memory. The compact page menu measures layout locally; opening it does not start history requests.

Required permissions and host scope remain activeTab, downloads, storage, chatgpt.com and gemini.google.com. **notifications** is newly optional, off by default and requested only when the user enables notifications. Notifications contain generic results and part counts, not conversation text, titles, URLs or filenames. Persistent site access is requested for the current supported site only after a user click when Firefox has not granted it.

The only runtime parser dependency is **markdown-it 15.0.3**, from the public npm package pinned in package.json/package-lock.json. `shared/vendor/markdown-it.js` is byte-identical to npm's `dist/browser/markdown-it.umd.min.js`; its upstream source map is also included with readable source content. Licenses for bundled dependencies are in `shared/vendor/MARKDOWN-LICENSES.txt`. Published package: https://www.npmjs.com/package/markdown-it/v/15.0.3 ; pinned repository: https://github.com/markdown-it/markdown-it/tree/15.0.3 . No runtime CDN is used. The retained legacy icon attribution is in THIRD_PARTY_NOTICES.md.

## Reproduce

Verified build environment: Windows, PowerShell 7, Node.js 24.19.0, npm 12.0.2. First-party code needs no compilation. From the extracted source root:

```powershell
npm ci --ignore-scripts
node scripts/vendor-markdown.cjs
./scripts/package.ps1 -OutputDirectory ./release/rebuilt-0.5.6
```

Use a new output directory. The script copies runtime files unchanged and creates deterministic ZIP entries. `Dialogue-Export-v0.5.6.zip` is identical to the submitted AMO ZIP. The npm dependency and lockfile suffice to retrieve the exact public parser distribution; no private registry is needed. `npm test` runs automated checks. Node/npm are not needed to run the installed extension. PNG icons are supplied assets; the optional `scripts/build-icons.py` regeneration helper uses Python/Pillow and is not required to package the extension.

## Suggested release note

Faster direct exports for saved ChatGPT conversations; improved code formatting; numbered parts for large HTML/PDF exports; separate user/AI image options; a compact monochrome menu and optional completion notifications. Adds text-only ChatGPT ZIP archives with selection, progress, saved/failed counts and error explanations. Ready chats are preserved after a later archive read failure. Some rich references, content types and unfinished responses remain unsupported; image files and PDF are not included in bulk ZIP archives.

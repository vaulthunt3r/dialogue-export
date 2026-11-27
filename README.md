# <img src="icons/icon-48.png" width="32" height="32" alt=""> Dialogue Export

**Keep your ChatGPT conversations. In files you can use.**

**[Project website · Русский / English](https://vaulthunt3r.github.io/dialogue-export/)** — features, video tour and installation.

A Firefox extension for exporting a conversation to **TXT, Markdown, HTML, JSON or PDF**, and saving multiple ChatGPT conversations in a **ZIP archive**. Compact monochrome controls, readable output and local processing.

**[Install 0.5.9 — Mozilla-signed XPI](https://github.com/vaulthunt3r/dialogue-export/releases/download/v0.5.9/Dialogue-Export-v0.5.9-signed.xpi)** · [All release files](https://github.com/vaulthunt3r/dialogue-export/releases/tag/v0.5.9) · [What's new](docs/RELEASE-v0.5.9.md)

**New in 0.5.9:** fixes for saved image references and prompt cards, expanded static layouts and citations, preserved status icons and thin separators. No new permissions. [Release notes and validation](docs/RELEASE-v0.5.9.md) · [Signing record](docs/AMO_SUBMISSION-v0.5.9.md).

## See it in a minute

https://github.com/user-attachments/assets/c4a84b92-d3b3-4237-879a-082efc998ac2

**[Watch the 60-second tour](https://github.com/user-attachments/assets/c4a84b92-d3b3-4237-879a-082efc998ac2)** · [Download MP4](https://github.com/vaulthunt3r/dialogue-export/releases/download/v0.5.6/Dialogue-Export-0.5.6-trailer-EN.mp4)

English titles and original music. This 0.5.6 feature tour uses fictional conversations and demonstration data; its image-details setting was removed in 0.5.7.

## What you can save

| | Current conversation | Multiple ChatGPT conversations |
| --- | --- | --- |
| Formats | TXT, MD, HTML, JSON, PDF | ZIP containing TXT, MD, HTML or normalized JSON |
| Selection | All messages or selected messages | Choose chats, search, select across pages or select all found |
| Code and tables | Code blocks, indentation and structured HTML/PDF | Code and tables in supported text/HTML formats |
| Images | Supported images in HTML/PDF; separate user and AI switches | Text-only; image files are not included |
| Large exports | Numbered parts for large **direct ChatGPT HTML/PDF** exports | Numbered ZIP parts with indexes and a report |
| Status | Progress, elapsed time, Stop and optional notifications | Ready/saved/failed counts and per-chat error explanations |

### Faster reading for saved ChatGPT chats

Version 0.5.6 adds direct reading of saved ChatGPT conversation data using your existing session. Supported **All messages → TXT/MD/HTML/PDF** exports no longer need to scroll the page to collect messages. The reader checks the conversation identity and follows the current response branch.

In **0.5.8**, direct reading also covers single-chat JSON and available saved Working / Thinking records. Saved ChatGPT conversations no longer switch to automatic page scrolling: unsupported content or an unavailable response stops with an explanation. Temporary chats, selected messages and Gemini retain their page readers. The internal ChatGPT API can change, so direct export is not guaranteed for every conversation.

During user testing, a conversation containing **over 35,000 Markdown lines** exported quickly and completely; TXT, HTML and PDF were also confirmed. This is a user-reported result, not a controlled speed benchmark or a guarantee for every chat.

### Images and printable documents

Choose whether to include user images and AI-response images. Images are exported without added technical captions. Downloaded raster bytes are not re-encoded, but an available image may be a preview: equivalence to ChatGPT's **Download** original is not guaranteed.

Supported ChatGPT thumbnail cards retain their layout, badges and links in HTML/PDF through rendered-page collection. This can avoid scrolling when every mounted message matches the complete current conversation branch. If an OpenAI preview needs image-host permission, use **Allow image access**, then retry the export. Interactive widgets and every page style are not reproduced exactly.

Version **0.5.8** builds supported static cards and SVG diagrams directly from saved data, including repeated rows, calculated labels and proportional bars, even when the content is not loaded on the page. Image components use explicit URLs or exact saved references, including nested `image_group` results. Direct OpenAI previews use the extension's existing background download permission, avoiding page CORS failures; an explicitly saved supported preview is preferred over its original third-party image URL. When the normalized image list contains such previews, permission is checked before image downloading begins. Missing access can be enabled from the export menu, then export restarted. Unsupported cards can still use an already loaded, verified page node; they never trigger a scan of a saved chat. Success and error notices disappear after five seconds; the last error and structural diagnostic remain accessible in the export menu. Missing citation metadata is labelled without dropping surrounding text. See [release notes and limits](docs/RELEASE-v0.5.8.md).

In 0.5.8, Stop or an image-embedding error offers **Save collected / Discard** for direct HTML/PDF. Complete messages already prepared can be saved as a clearly marked partial export; the unfinished message is excluded. The choice remains available in the export menu. Already downloaded files remain after discarding. This is not resumable after a page reload.

Version 0.5.8 retries temporary image failures up to three attempts and obtains a fresh download link for each attempt when ChatGPT supplies a file reference. Completed images are retained. Stop also cancels retry waits; a persistent failure still offers Save collected / Discard. This does not establish that every unavailable image can be recovered.

Large direct HTML/PDF exports can split into numbered parts. HTML parts download sequentially. PDF opens a print page; select **Save as PDF** and print each part separately. **Compact PDF pagination** removes message boxes in print so text can flow across pages with fewer large gaps. It does not change the on-screen HTML layout.

### How single-chat export works

For a saved ChatGPT chat, **All messages** reads its saved data with your existing session and follows the current branch. The extension normalizes messages, renders ordinary Markdown and supported static cards/SVG locally, then prepares enabled images. It checks known OpenAI preview permission early, resolves file links, validates downloads and retries temporary failures without discarding the completed prefix.

Large HTML/PDF exports stage numbered parts locally to limit memory. HTML downloads the parts sequentially; PDF opens a print view. Stop or a persistent image failure offers a clearly labelled partial save of complete messages. Unsupported saved content stops with an explanation instead of starting a page scan. Selected messages, temporary chats and Gemini keep their page readers. [Mechanism, failure causes and limits](docs/RELEASE-v0.5.8.md#how-export-works-now).

### Several chats, one ZIP workflow

Choose **ZIP** to open the local archive tab, then **Load list**. Search active or archived conversations, select the ones you need, choose the format inside the ZIP and export. Each ZIP part includes an index and manifest; the final report lists saved, failed and unattempted chats.

Unsupported chats are skipped while the others continue. If a later read error stops the queue, already prepared chats are saved when downloading remains available. **Stop** cancels unsaved work; completed downloads remain.

## Install and start

1. Download the signed XPI from the [latest release](https://github.com/vaulthunt3r/dialogue-export/releases/latest), open it in **Firefox 142 or later** and confirm installation.
2. Open or reload a ChatGPT conversation. Click the dialogue icon in the page margin or on the Firefox toolbar.
3. Choose your messages and format, review **Export options**, then press **Export** or **Prepare PDF**. Keep the source tab open until collection finishes.

**Page icon missing?** Firefox may allow the extension to run only after a toolbar click. Use **Show icon automatically** in the toolbar popup, or grant persistent access to ChatGPT through Firefox's extension menu, then reload the page.

Optional completion notifications are off by default. Enable them if you want a notification while reading another tab. A ready PDF layout still needs to be saved through Firefox's print dialog.

## Current limits

- **ZIP is a text archive, not a complete account backup.** It excludes image files, PDF, Working / Thinking sections and alternative branches. Project-chat coverage is unverified; JSON is the normalized exported message model. There is no automatic resume.
- **Some chat content is still unsupported.** A real 42-chat archive run saved 36 and rejected six: four `RICH_REFERENCE`, one `MESSAGE_TYPE` and one `RESPONSE_UNFINISHED`. These cases remain open. The report explains failures; try exporting an affected chat separately from its page.
- **Very large or image-heavy chats still have limits.** Numbered parts reduce retained output, but response, image and message limits remain. They do not cap Firefox's total RAM. One image-bearing chat was confirmed in three HTML/PDF parts; coverage of every heavy chat is not established.
- **Activity export includes only available content.** Saved-chat export reads available Thinking summaries and Working updates directly; it does not reconstruct missing tool-event details. Selected-message and temporary-chat exports still need expanded sections. Interactive applications and arbitrary component programs are not supported by the static renderer.

Check the beginning, middle and end of important exports. [Report a problem](https://github.com/vaulthunt3r/dialogue-export/issues) with the extension/browser version and error code; private conversation text is usually unnecessary. Archive reports contain chat titles and IDs, so review them before sharing.

**Coming next:** more supported message variants, ZIP with separate original image files where available, and broader large-chat testing. See the [wishlist](docs/WISHLIST.md).

## Compatibility and privacy

ChatGPT is the focus of the direct-reading and ZIP features. **Google Gemini remains supported for current-conversation exports through page collection**; it does not have the ChatGPT direct reader or history ZIP workflow.

Processing takes place in Firefox. There are no developer uploads, analytics or telemetry. Direct export makes authenticated requests to ChatGPT after your action; it is not an offline retrieval method. Temporary multipart storage, image requests and permissions are explained in the [privacy policy](PRIVACY.md).

**Upgrading from 0.5.2?** That version could mix messages from another conversation. Review important old exports and re-export affected files with the current version. [Details of the 0.5.3 fix](docs/RELEASE-v0.5.3.md).

## Development and acknowledgments

From the source archive, run `npm ci --ignore-scripts` and `npm test`. Runtime files are readable JavaScript plus a pinned local Markdown parser. [Reproduction and packaging instructions](docs/AMO_SUBMISSION-v0.5.8.md) document the submitted package; the [release notes](docs/RELEASE-v0.5.8.md) summarize validation. For a temporary Firefox installation, extract the runtime ZIP and load its `manifest.json` through `about:debugging#/runtime/this-firefox`.

The direct-reading approach was inspired by **[John2022 / ChatGPT Conversation Export](https://github.com/John2022/chatgpt-conversation-export)**. Thank you for demonstrating the benefit of retrieving conversation data directly. Dialogue Export combines direct reading with its existing page collector, validation, output formats and archive workflow. [markdown-it](https://github.com/markdown-it/markdown-it) handles Markdown rendering locally; dependency and icon notices are in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

[MIT License](LICENSE) · [Changelog](CHANGELOG.md) · [Security](SECURITY.md) · [Trailer sources](promo/0.5.6/README.md)

Created by **vaulthunt3r**. Independent project; not affiliated with or endorsed by OpenAI or Google.

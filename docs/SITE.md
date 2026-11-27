# Project website

The public landing page is served by GitHub Pages from `main` → `/docs` at https://vaulthunt3r.github.io/dialogue-export/.

`index.html`, `site.css` and `site.js` are buildless. `.nojekyll` disables Jekyll processing. Media is hosted in `docs/media`; no third-party video embed, font service, analytics or installation is needed.

The original HTML contains Russian content and links to the permanent latest-release page. JavaScript adds RU/EN switching, remembers only the selected language in localStorage, and makes one public GitHub release API request without credentials. A validated stable release's signed XPI replaces the installation links. If GitHub is unavailable or rate-limited, those links keep pointing to the latest-release page. `?lang=ru` and `?lang=en` override the saved/browser language.

The video is the existing 0.5.6 tour, explicitly labelled as such. `tour.en.vtt` follows its original English captions; `tour.ru.vtt` supplies Russian subtitles. No autoplay. The sample export is fictional, copied from the existing promo assets; no private conversation data is included.

Preview the `docs` folder with a static HTTP server. Verify desktop and narrow layouts, both languages, video playback/captions, the example link, and installation links with successful and unavailable release API responses. The extension runtime and signed release archives are independent of these site files.

To update the website, edit these source files and publish a commit to `main`. GitHub's Pages deployment publishes `/docs`. The repository website field points to the public URL. Extension release notes and private diagnostics remain maintained separately.

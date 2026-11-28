# Project website

The public landing page is served by GitHub Pages from `main` → `/docs` at https://vaulthunt3r.github.io/dialogue-export/.

`index.html`, `site.css` and `site.js` are buildless. `.nojekyll` disables Jekyll processing. The native video player streams the public GitHub Releases MP4; the poster, captions and a mirror of the movie are in `docs/media`. No third-party video player, font service, analytics or installation is needed.

The original HTML contains Russian content and links to the permanent latest-release page. JavaScript adds RU/EN switching, remembers only the selected language in localStorage, and makes one public GitHub release API request without credentials. A validated stable release's signed XPI replaces the installation links. If GitHub is unavailable or rate-limited, those links keep pointing to the latest-release page. `?lang=ru` and `?lang=en` override the saved/browser language.

The version-neutral tour was refreshed on November 28, 2026, with current menu captures, the original score and the project website in its closing frame. Sources are in `promo/tour`. `tour.en.vtt` and `tour.ru.vtt` supply English captions and Russian subtitles; update the media revision query when replacing them. No autoplay. The sample export is fictional, copied from the existing promo assets; no private conversation data is included.

Preview the `docs` folder with a static HTTP server. Verify desktop and narrow layouts, both languages, video playback/captions, the example link, and installation links with successful and unavailable release API responses. The extension runtime and signed release archives are independent of these site files.

To update the website, edit these source files and publish a commit to `main`. GitHub's Pages deployment publishes `/docs`. The repository website field points to the public URL. Extension release notes and private diagnostics remain maintained separately.

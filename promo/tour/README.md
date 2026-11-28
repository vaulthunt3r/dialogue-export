# Dialogue Export — feature tour

Updated November 28, 2026. A version-neutral, 60-second feature tour with the original instrumental score and monochrome animation. It shows message selection, supported images in HTML/PDF, numbered parts, text-only ChatGPT ZIP archives, reports and local processing. The closing frame links to the project website.

The menu captures use the current packaged HTML/CSS with fictional state. The removed image-details option is absent. Version numbers are omitted from both the menu footer and the video titles. The release used to check this update was 0.5.9; future UI changes still need review even though the tour has no version label.

All chats, document contents and report counts are fictional. Screens were captured in the in-app browser from local fixtures, without opening Firefox or a real chat account. Browser-native controls can differ from Firefox. The large report graphic is an illustration, not a literal screenshot. The export example is retained from the original tour.

## Watch and download

- [Watch on the project website](https://vaulthunt3r.github.io/dialogue-export/#demo)
- [Download MP4](https://github.com/vaulthunt3r/dialogue-export/releases/download/v0.5.9/Dialogue-Export-trailer-EN.mp4)
- [English captions](../../docs/media/tour.en.vtt) · [Russian subtitles](../../docs/media/tour.ru.vtt)

## Reproduce

The committed captures are enough to render the movie. Python, Pillow, NumPy and FFmpeg are required, plus Segoe UI and Consolas from the Windows font directory. Font files are not distributed.

```powershell
python promo/tour/render.py --preview
python promo/tour/render.py
```

`output/` is ignored. The renderer creates `Dialogue-Export-trailer-EN.mp4`, `Dialogue-Export-tour-poster.png`, `Dialogue-Export-tour.en.srt`, eight scene images, a storyboard and the original synthesized music master. There are no external music samples. The score and timing are retained from the original tour.

To refresh UI captures, run `node promo/tour/prepare.cjs`, serve the repository with a local HTTP server and open `promo/tour/output/preview/`. The script only prepares fictional pages; it does not launch a browser. Capture the menu pages at 440×880, with the PDF settings scrolled enough to show compact pagination. Capture the archive at width 1200 with the Save ZIP section visible. Store JPEG captures in `assets/` using the existing names. Verify framing with `--preview` before encoding. The movie crops/pans the archive image within its frame.

Keep the GitHub Releases MP4 and its mirror in `docs/media/Dialogue-Export-trailer-EN.mp4`, the tour poster and both subtitle tracks in sync. The site streams the release asset and uses a media revision query to refresh cached captions. GitHub README uses a playable uploaded video attachment; replace its URL when publishing a new cut. Historical versioned trailers remain archival.

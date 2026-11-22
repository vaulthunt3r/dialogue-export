# 0.5.7 test 2 — rendered cards and embedded previews

Unsigned local test build. Published 0.5.6 and the earlier test1 package are unchanged.

## Report and changes

The supplied HTML had five external `images.openai.com/static-rsc-4/` previews. A checked preview returned image bytes without an Access-Control-Allow-Origin header: it could be displayed on the page while canvas capture was blocked. The page collector now requests supported OpenAI previews through the extension background and embeds the validated bytes without re-encoding. This requires the new `https://images.openai.com/*` host permission. These requests omit cookies, authorization and referrers. These are the page's preview files, not a promise of original Download-file quality.

Hidden icons were removed before matching original and cloned media by position, which could shift subsequent thumbnails. They now remain until matching completes, and are then removed.

For recognized rich-component replies, the reader retains a conservative manifest of the current API branch. When mounted rendered messages match all IDs, roles and order, collection waits for images, rechecks the match and returns without scrolling. It never relies on message count alone. A partial mounted chat may still require scrolling; uncertain or changed identity cannot pass this completeness check. Unsupported image-bearing API structures still use the existing fallback.

## Verification

- Unit regressions cover hidden-icon/media order, complete eight-message collection with zero scroll writes, incomplete/reordered/duplicate/mutated messages, background request restrictions, Stop, tab closure and failed preview downloads.
- `node tests/rich-page-firefox.cjs release/0.5.7/rich-page-qa` uses a fresh Firefox profile and two synthetic local origins. The image server deliberately sends no CORS headers. The check exercises production API parsing, rendered collection, background fetching and offline HTML/print output with eight messages and two thumbnails. It does not access a personal browser or live chat.
- `node tests/rich-cards-firefox.cjs release/0.5.7/rich-cards-test2-qa` checks portable card styling and narrow-screen layout separately.
- Results: 213 automated tests passed. Both browser checks passed on Firefox 160.0.1: eight messages with zero scroll writes; two unchanged embedded preview files; offline HTML and print-page loading; aligned thumbnails, readable badges and no horizontal overflow at narrow width. The actual affected live chat still needs a user retest.

## User check

1. Load `release/0.5.7/test2/runtime/manifest.json` via **about:debugging → This Firefox → Load Temporary Add-on**. Remove/reload the earlier temporary build as needed; the signed 0.5.6 XPI does not contain this change.
2. Allow the extension's site access, including `images.openai.com` if Firefox asks, then refresh the affected ChatGPT tab.
3. Export the same conversation as HTML with AI images enabled. Check that each thumbnail appears beside its own title, without the long linked-image notice.
4. Open the saved HTML without relying on an online session, and check PDF if desired. For a fully mounted, ID-verified conversation there should be no collection scroll.

The live chat was not controlled or inspected. Exact reproduction of arbitrary interactive widgets is not claimed. Large rich chats can still require the existing page collector and its media/memory limits; direct-export multipart staging does not automatically apply to this fallback.

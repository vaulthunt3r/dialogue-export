(() => {
  'use strict';
  const english = {
    skip: 'Skip to content', navigation: 'Navigation', navFeatures: 'Features', navInstall: 'Get started',
    eyebrow: 'FIREFOX · CHATGPT + GEMINI', heroFirst: 'Keep the conversation.', heroSecond: 'Come back to what matters.',
    heroDescription: 'Ideas, code, and useful answers. In files that stay with you. Export the whole conversation or just the messages you need.',
    download: 'Install in Firefox', watch: 'Watch the one-minute tour', requirements: 'Free · Open source · Firefox 142+', formats: 'Export formats', zipTiny: 'chat archive',
    demoTitle: 'See it in action', demoDuration: '60 SECONDS · SOUND ON', videoLabel: 'Dialogue Export feature tour', downloadVideo: 'Download video',
    demoNote: 'A one-minute tour of message selection, images, PDF, and ZIP archives. All conversations shown are fictional.',
    featuresTitle: 'From conversation to document', featureFirst: 'The useful parts.', featureSecond: 'In a format that fits.',
    readableTitle: 'Open it. Pick up where you left off.', readableText: 'HTML for reading, PDF for printing, Markdown for your notes. TXT and JSON when you need plain text or structured data.',
    richTitle: 'Code, tables, and images, too.', richText: 'Keep formatting and supported images in HTML and PDF. Choose images from your messages and AI responses separately.',
    archiveTitle: 'Several chats. One ZIP workflow.', archiveText: 'Select saved ChatGPT conversations and create a text archive with an index and report. Image files are not included in this ZIP.',
    saved: 'SAVED', sampleAria: 'Open a sample HTML export in a new tab', sampleAlt: 'A saved conversation with code, a table, and an illustration', sampleCaption: 'A fictional conversation, exported', sampleOpen: 'Open HTML',
    privacyEyebrow: 'PROCESSED LOCALLY', privacyFirst: 'Your conversations.', privacySecond: 'Your files.',
    privacyText: 'The extension processes conversations in your Firefox. It does not send them to the developer, collect analytics, or require a separate account.',
    privacyDetail: 'Your connection to ChatGPT or Gemini is used to retrieve conversations and images.', privacyLink: 'Read the privacy policy',
    installTitle: 'Start with one conversation', stepOneTitle: 'Add it to Firefox', stepOneText: 'Download the Mozilla-signed XPI file, open it in Firefox, and confirm installation.',
    stepTwoTitle: 'Open a conversation', stepTwoText: 'Reload your ChatGPT or Gemini tab. Click the Dialogue Export icon on the page or in the Firefox toolbar.',
    stepThreeTitle: 'Choose what to keep', stepThreeText: 'Select messages and a format, then choose Export. For PDF, choose Prepare PDF, then Save as PDF in the print dialog.',
    installHint: 'If the file only downloads: about:addons → ⚙ → Install Add-on From File… Keep the conversation tab open until export finishes.',
    faqTitle: 'Before your first export', faqIntro: 'A few details to help you get the result you expect.', reportIssue: 'Report a problem',
    faq1q: 'Do ChatGPT and Gemini work the same way?', faq1a: 'Both support current-conversation export. Direct reading of saved conversations and multi-chat archives are ChatGPT features. Gemini collects messages from the page.',
    faq2q: 'Can I save a long conversation?', faq2a: 'Large HTML/PDF exports of saved ChatGPT chats can split into numbered parts. PDF parts are printed separately. Size and supported-content limits still apply.',
    faq3q: 'Will every image be saved in original quality?', faq3a: 'The extension saves available, supported images. Sometimes the service provides a preview rather than the original. Unavailable images or unsupported components can stop export with an explanation.',
    faq4q: 'Is this a full account backup?', faq4a: 'No. The ZIP contains text from selected ChatGPT conversations, without images, PDF, or alternative branches. Check the beginning, middle, and end of important exports.',
    footerNote: 'Open source. Good conversations, to go.', releases: 'Releases'
  };
  const attributes = [['data-i18n', null], ['data-i18n-aria', 'aria-label'], ['data-i18n-alt', 'alt']];
  const elements = attributes.flatMap(([selector, target]) => [...document.querySelectorAll(`[${selector}]`)].map(element => ({
    element, target, key: element.getAttribute(selector), original: target ? element.getAttribute(target) : element.textContent
  })));
  const originalTitle = document.title, description = document.querySelector('meta[name="description"]'), originalDescription = description.content;
  function setLanguage(language, remember = false) {
    if (!['ru', 'en'].includes(language)) language = 'ru';
    for (const item of elements) {
      const value = language === 'en' ? english[item.key] || item.original : item.original;
      if (item.target) item.element.setAttribute(item.target, value); else item.element.textContent = value;
    }
    document.documentElement.lang = language;
    document.title = language === 'en' ? 'Dialogue Export — keep your ChatGPT and Gemini conversations' : originalTitle;
    description.content = language === 'en' ? 'Save ChatGPT and Gemini conversations as TXT, Markdown, HTML, JSON, or PDF. A free, open-source Firefox extension with local processing.' : originalDescription;
    document.querySelectorAll('[data-language]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.language === language)));
    document.querySelectorAll('#tour track').forEach(track => {
      track.default = language === 'ru' && track.srclang === 'ru';
      track.track.mode = track.default ? 'showing' : 'disabled';
    });
    if (remember) {
      try { localStorage.setItem('dialogue-export-language', language); } catch (_) { /* Language switching also works without storage. */ }
      const url = new URL(location.href); url.searchParams.set('lang', language);
      try { history.replaceState(null, '', url); } catch (_) { /* The current page still changes without URL persistence. */ }
    }
  }
  let preferred;
  try { preferred = localStorage.getItem('dialogue-export-language'); } catch (_) { /* Use the browser language. */ }
  setLanguage(new URLSearchParams(location.search).get('lang') || preferred || (navigator.language.startsWith('ru') ? 'ru' : 'en'));
  document.querySelectorAll('[data-language]').forEach(button => button.addEventListener('click', () => setLanguage(button.dataset.language, true)));

  // The permanent release page is usable without JS, GitHub API access, or a
  // matching asset. Upgrade its link only after validating a stable signed XPI.
  const repo = 'https://github.com/vaulthunt3r/dialogue-export';
  async function latestDownload() {
    const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), 8000);
    try {
      const response = await fetch('https://api.github.com/repos/vaulthunt3r/dialogue-export/releases/latest', { credentials: 'omit', signal: controller.signal, headers: { Accept: 'application/vnd.github+json' } });
      if (!response.ok) return;
      const release = await response.json();
      if (release.draft || release.prerelease || !/^v\d+\.\d+\.\d+$/.test(release.tag_name) || !Array.isArray(release.assets)) return;
      const name = `Dialogue-Export-${release.tag_name}-signed.xpi`;
      const asset = release.assets.find(item => item.name === name && item.state === 'uploaded');
      const url = `${repo}/releases/download/${release.tag_name}/${name}`;
      if (!asset || asset.browser_download_url !== url) return;
      document.querySelectorAll('[data-release-download]').forEach(link => { link.href = url; });
      const version = document.querySelector('[data-release-version]'); version.textContent = release.tag_name; version.hidden = false;
    } catch (_) { /* The release-page link remains available on network errors. */ }
    finally { clearTimeout(timeout); }
  }
  latestDownload();
})();

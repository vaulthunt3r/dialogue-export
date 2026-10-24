// Paste into Firefox's Web Console on the chat with the image visible.
// Copies structural diagnostics only. No page changes or network requests.
(() => {
  const selector = '[data-user-message-bubble], [data-chatgpt-selection-message-id], [data-message-author-role]';
  const keyNames = ['data-turn-key', 'data-message-id', 'data-chatgpt-selection-message-id', 'data-chatgpt-selection-conversation-id', 'data-chatgpt-search-unit-key', 'data-chatgpt-search-message-ids', 'data-content-search-unit-key'];
  const keys = new Map();
  const anonymousKey = value => {
    if (!keys.has(value)) keys.set(value, `key-${keys.size + 1}`);
    return keys.get(value);
  };
  const report = {
    diagnosticVersion: 1,
    mainCount: document.querySelectorAll('main, [role="main"]').length,
    messageMarkerCount: document.querySelectorAll(selector).length,
    images: [...document.images].map((img, index) => {
      const ancestors = [];
      for (let el = img; el && el !== document.documentElement; el = el.parentElement) {
        const style = getComputedStyle(el);
        ancestors.push({
          tag: el.localName,
          markers: [...el.attributes].map(a => a.name).filter(name => /^data-|^aria-|^hidden$|^inert$/.test(name)),
          keys: Object.fromEntries(keyNames.filter(name => el.hasAttribute(name)).map(name => [name, anonymousKey(el.getAttribute(name))])),
          role: ['user', 'assistant'].includes(el.getAttribute('data-message-author-role')) ? el.getAttribute('data-message-author-role') : null,
          legacyTurn: (el.getAttribute('data-testid') || '').startsWith('conversation-turn-'),
          hidden: el.hidden || el.hasAttribute('inert') || el.getAttribute('aria-hidden') === 'true' || style.display === 'none' || ['hidden', 'collapse'].includes(style.visibility) || style.contentVisibility === 'hidden',
          descendantMessages: el.querySelectorAll(selector).length,
          children: el.children.length
        });
      }
      return { index, size: [img.naturalWidth, img.naturalHeight], loaded: img.complete && img.naturalWidth > 0, ancestors };
    })
  };
  copy(JSON.stringify(report, null, 2));
  return `Copied diagnostics for ${report.images.length} images. No message text, image content or URLs included.`;
})();

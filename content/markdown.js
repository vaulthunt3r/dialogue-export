(function () {
  const parser = globalThis.markdownit({ html: false, linkify: false, typographer: false, breaks: false, maxNesting: 64 });
  const escape = parser.utils.escapeHtml;
  parser.renderer.rules.fence = (tokens, index) => {
    const token = tokens[index];
    const info = token.info.trim().split(/\s+/)[0];
    const language = /^[\w+#.-]{1,40}$/.test(info) ? info : '';
    const short = token.content.length < 1200 && token.content.split('\n').length <= 13;
    return `<div class="chat-archive-code${short ? ' chat-archive-code-short' : ''}">${language ? `<div class="chat-archive-code-label">${escape(language)}</div>` : ''}<pre><code${language ? ` class="language-${escape(language)}"` : ''}>${escape(token.content)}</code></pre></div>\n`;
  };
  parser.renderer.rules.image = (tokens, index, options, env, self) => {
    if (!env.includeImages) return '';
    const token = tokens[index], src = token.attrGet('src') || '';
    const alt = self.renderInlineAsText(token.children || [], options, env);
    const source = src.startsWith('archive-asset:') ? env.assets[Number(src.slice(14))] : { url: src };
    if (!source) throw new Error('An image reference could not be resolved. No file was saved.');
    const placeholder = `<span class="export-image-placeholder" data-export-image="${env.images.length}">${escape(alt || 'Image')}</span>`;
    env.images.push({ source, alt, placeholder });
    return placeholder;
  };
  parser.renderer.rules.link_open = (tokens, index, options, env, self) => {
    if (env.includeLinks === false) return '';
    const href = tokens[index].attrGet('href') || '';
    if (!/^(?:https?:|mailto:|#)/i.test(href)) return '<span>';
    tokens[index].attrSet('rel', 'noopener noreferrer');
    return self.renderToken(tokens, index, options);
  };
  parser.renderer.rules.link_close = (tokens, index, options, env) => {
    if (env.includeLinks === false) return '';
    // Links cannot nest in CommonMark; find the matching opening token.
    let opening = index - 1;
    while (opening >= 0 && tokens[opening].type !== 'link_open') opening--;
    const href = tokens[opening]?.attrGet('href') || '';
    return /^(?:https?:|mailto:|#)/i.test(href) ? '</a>' : '</span>';
  };
  window.ChatArchiveMarkdown = {
    render(source, { assets = [], includeLinks = true, includeImages = true } = {}) {
      const env = { assets, images: [], includeLinks, includeImages };
      const html = parser.render(source, env);
      return { html, images: env.images };
    }
  };
})();

(function (root) {
  const esc = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const role = (value, provider) => value === 'user' ? 'User' : (provider || 'Assistant');
  const date = iso => new Date(iso).toLocaleString('en-US');
  function activityText(message, options, markdown = false) {
    if (!options.includeActivity) return '';
    return (message.activities || []).map(a => `${markdown ? '### ' : ''}${a.title}\n\n${a.expanded ? (markdown ? a.markdown : a.text) : '[Section was collapsed; its contents were not collected.]'}\n\n`).join('');
  }
  function activityHtml(message, options) {
    if (!options.includeActivity) return '';
    return (message.activities || []).map(a => `<details class="export-activity" open><summary>${esc(a.title)}</summary>${a.expanded ? a.html : '<p>Section was collapsed; its contents were not collected.</p>'}</details>`).join('');
  }

  function timestamp(message, options) {
    return options.includeTimestamps ? root.ChatArchiveTimestamps.display(message.createdAt) : '';
  }

  function timestampWarning(data, options) {
    if (!options.includeTimestamps) return '';
    const summary = root.ChatArchiveTimestamps.summarize(data.messages);
    return summary.available < summary.total ? root.ChatArchiveTimestamps.notice(summary) : '';
  }

  function header(data, options, markdown = false) {
    if (!options.includeTitle) return '';
    return markdown
      ? `# ${data.title}\n\nSaved: ${date(data.exportedAt)}\n\nSource: ${data.url}\n\n---\n\n`
      : `${data.title}\nSaved: ${date(data.exportedAt)}\nSource: ${data.url}\n\n`;
  }

  const api = {
    txt(data, options = {}) {
      const warning = timestampWarning(data, options);
      return header(data, options) + (warning ? `${warning}\n\n` : '') + data.messages.map(m => {
        const time = timestamp(m, options);
        return `${role(m.role, data.provider)}:${time ? `\n${time}` : ''}\n${activityText(m, options)}${m.text}`;
      }).join('\n\n' + '─'.repeat(48) + '\n\n') + '\n';
    },
    md(data, options = {}) {
      const warning = timestampWarning(data, options);
      return header(data, options, true) + (warning ? `*${warning}*\n\n` : '') + data.messages.map(m => {
        const time = timestamp(m, options);
        return `## ${role(m.role, data.provider)}\n\n${time ? `*${time}*\n\n` : ''}${activityText(m, options, true)}${m.markdown || m.text}`;
      }).join('\n\n---\n\n') + '\n';
    },
    json(data, options = {}) {
      const output = { ...data, messages: data.messages.map(message => {
        const item = { ...message };
        if (!options.includeActivity) delete item.activities;
        if (options.includeTimestamps) item.createdAt = root.ChatArchiveTimestamps.normalize(item.createdAt);
        else { delete item.createdAt; delete item.messageId; }
        return item;
      }) };
      if (options.includeTimestamps) output.messageTimestamps = root.ChatArchiveTimestamps.summarize(output.messages);
      else delete output.messageTimestamps;
      return JSON.stringify(output, null, 2);
    },
    html(data, options = {}, printPage = false) {
      const meta = options.includeTitle ? `<header><h1>${esc(data.title)}</h1><p>Saved: ${esc(date(data.exportedAt))}</p><p><a href="${esc(data.url)}">${esc(data.url)}</a></p></header>` : '';
      const warning = timestampWarning(data, options);
      const timestampNote = warning ? `<p class="timestamp-note">${esc(warning)}</p>` : '';
      const messages = data.messages.map(m => {
        const time = timestamp(m, options);
        const timeElement = time ? `<time class="message-time" datetime="${esc(root.ChatArchiveTimestamps.normalize(m.createdAt))}">${esc(time)}</time>` : '';
        return `<article class="${m.role}"><h2>${role(m.role, data.provider)}</h2>${timeElement}<div class="message">${activityHtml(m, options)}${m.html}</div></article>`;
      }).join('');
      const printToolbar = printPage ? `<aside class="print-toolbar"><div><strong>Your PDF layout is ready</strong><span>Click the button, then choose “Save to PDF” in Firefox.</span></div><button type="button" onclick="window.print()">Save as PDF</button></aside>` : '';
      return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(data.title)}</title><style>
      :root{color-scheme:light;font:16px/1.6 system-ui,sans-serif}body{max-width:900px;margin:40px auto;padding:0 24px;background:#fff;color:#1d2026}.print-toolbar{position:sticky;top:12px;z-index:10;display:flex;align-items:center;justify-content:space-between;gap:20px;margin:0 0 28px;padding:14px 16px;border:1px solid #cfd6e5;border-radius:10px;background:#f4f7ff;box-shadow:0 8px 30px #2432521f}.print-toolbar div{display:grid}.print-toolbar span{font-size:13px;color:#596273}.print-toolbar button{flex:none;border:0;border-radius:7px;padding:10px 15px;background:#15994a;color:#fff;font:600 14px system-ui;cursor:pointer}.print-toolbar button:hover{background:#1eb85c}header{border-bottom:1px solid #d8dce4;margin-bottom:30px}h1{font-size:28px}article{padding:20px 22px;margin:0 0 16px;border:1px solid #dfe3ea;border-radius:12px;break-inside:avoid}article.user{background:#f4f7ff}h2{font-size:13px;text-transform:uppercase;letter-spacing:.08em;color:#596273;margin:0 0 10px}.message>:first-child{margin-top:0}.message>:last-child{margin-bottom:0}.chat-archive-text-block,.chat-archive-embedded-block{margin:14px 0;padding:14px;border:1px solid #cfd6e5;border-radius:8px;background:#f8f9fc}pre{overflow:auto;padding:14px;background:#17191e;color:#f2f3f5;border-radius:8px;white-space:pre-wrap}code{font-family:ui-monospace,monospace}table{border-collapse:collapse;width:100%}th,td{border:1px solid #cfd4dc;padding:7px;text-align:left}img{max-width:100%;height:auto}@media print{body{margin:0;max-width:none}.print-toolbar{display:none}article{border-color:#bbb;box-shadow:none}a{color:inherit;text-decoration:none}}
      .message-time{display:block;font-size:12px;line-height:1.5;color:#596273;margin:-4px 0 14px}.timestamp-note{font-size:13px;color:#596273;border-left:3px solid #a8adb5;padding:8px 12px;margin:0 0 20px}
      .chat-archive-code{margin:16px 0;border:1px solid #cfd4dc;border-radius:8px;background:#17191e;color:#f2f3f5}.chat-archive-code-label{padding:8px 14px;border-bottom:1px solid #596273;font:600 12px system-ui,sans-serif}.chat-archive-code pre{margin:0;border-radius:0 0 8px 8px;font-size:13px;line-height:1.5;tab-size:4;overflow-wrap:anywhere}.export-code-keyword{color:#c4a7ff}.export-code-string{color:#a6df9a}.export-code-literal{color:#ffca85}.export-code-comment{color:#a4aebc}@media print{.chat-archive-code,.chat-archive-code pre{color:#1d2026;background:#f6f8fa}.chat-archive-code .export-code-keyword{color:#6b21a8}.chat-archive-code .export-code-string{color:#166534}.chat-archive-code .export-code-literal{color:#9a3412}.chat-archive-code .export-code-comment{color:#4b5563}}
      ${options.compactPagination === true ? '@media print{article{display:contents;break-inside:auto}.message{margin-bottom:20px}article>h2{break-after:avoid}.message p{orphans:3;widows:3}.message pre,.message img,.message tr{break-inside:avoid}.chat-archive-code-label{break-after:avoid}.chat-archive-code pre{break-inside:auto;overflow:visible;orphans:3;widows:3}}' : ''}
      </style></head><body>${printToolbar}${meta}${timestampNote}<main>${messages}</main></body></html>`;
    }
  };
  root.ChatArchiveRenderers = api;
})(typeof globalThis !== 'undefined' ? globalThis : window);

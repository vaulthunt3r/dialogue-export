(function (root) {
  const esc = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const role = value => value === 'user' ? 'User' : 'ChatGPT';
  const date = iso => new Date(iso).toLocaleString('en-US');

  function header(data, options, markdown = false) {
    if (!options.includeTitle) return '';
    return markdown
      ? `# ${data.title}\n\nSaved: ${date(data.exportedAt)}\n\nSource: ${data.url}\n\n---\n\n`
      : `${data.title}\nSaved: ${date(data.exportedAt)}\nSource: ${data.url}\n\n`;
  }

  const api = {
    txt(data, options) {
      return header(data, options) + data.messages.map(m => `${role(m.role)}:\n${m.text}`).join('\n\n' + '─'.repeat(48) + '\n\n') + '\n';
    },
    md(data, options) {
      return header(data, options, true) + data.messages.map(m => `## ${role(m.role)}\n\n${m.text}`).join('\n\n---\n\n') + '\n';
    },
    json(data) { return JSON.stringify(data, null, 2); },
    html(data, options, printPage = false) {
      const meta = options.includeTitle ? `<header><h1>${esc(data.title)}</h1><p>Saved: ${esc(date(data.exportedAt))}</p><p><a href="${esc(data.url)}">${esc(data.url)}</a></p></header>` : '';
      const messages = data.messages.map(m => `<article class="${m.role}"><h2>${role(m.role)}</h2><div class="message">${m.html}</div></article>`).join('');
      const printToolbar = printPage ? `<aside class="print-toolbar"><div><strong>Your PDF layout is ready</strong><span>Click the button, then choose “Save to PDF” in Firefox.</span></div><button type="button" onclick="window.print()">Save as PDF</button></aside>` : '';
      return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(data.title)}</title><style>
      :root{color-scheme:light;font:16px/1.6 system-ui,sans-serif}body{max-width:900px;margin:40px auto;padding:0 24px;background:#fff;color:#1d2026}.print-toolbar{position:sticky;top:12px;z-index:10;display:flex;align-items:center;justify-content:space-between;gap:20px;margin:0 0 28px;padding:14px 16px;border:1px solid #cfd6e5;border-radius:10px;background:#f4f7ff;box-shadow:0 8px 30px #2432521f}.print-toolbar div{display:grid}.print-toolbar span{font-size:13px;color:#596273}.print-toolbar button{flex:none;border:0;border-radius:7px;padding:10px 15px;background:#15994a;color:#fff;font:600 14px system-ui;cursor:pointer}.print-toolbar button:hover{background:#1eb85c}header{border-bottom:1px solid #d8dce4;margin-bottom:30px}h1{font-size:28px}article{padding:20px 22px;margin:0 0 16px;border:1px solid #dfe3ea;border-radius:12px;break-inside:avoid}article.user{background:#f4f7ff}h2{font-size:13px;text-transform:uppercase;letter-spacing:.08em;color:#596273;margin:0 0 10px}.message>:first-child{margin-top:0}.message>:last-child{margin-bottom:0}.chat-archive-text-block,.chat-archive-embedded-block{margin:14px 0;padding:14px;border:1px solid #cfd6e5;border-radius:8px;background:#f8f9fc}pre{overflow:auto;padding:14px;background:#17191e;color:#f2f3f5;border-radius:8px;white-space:pre-wrap}code{font-family:ui-monospace,monospace}table{border-collapse:collapse;width:100%}th,td{border:1px solid #cfd4dc;padding:7px;text-align:left}img{max-width:100%;height:auto}@media print{body{margin:0;max-width:none}.print-toolbar{display:none}article{border-color:#bbb;box-shadow:none}a{color:inherit;text-decoration:none}}
      </style></head><body>${printToolbar}${meta}<main>${messages}</main></body></html>`;
    }
  };
  root.ChatArchiveRenderers = api;
})(typeof globalThis !== 'undefined' ? globalThis : window);

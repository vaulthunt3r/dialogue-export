// Build fictional capture pages from the current packaged UI. Does not launch a browser.
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../..');
const preview = path.join(__dirname, 'output', 'preview');
const read = name => fs.readFileSync(path.join(root, name), 'utf8');
const strip = html => html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, '');
fs.mkdirSync(preview, {recursive:true});
for (const name of ['popup/popup.css', 'archive/archive.css', 'icons/dialogue.svg']) {
  const target = path.join(preview, name);
  fs.mkdirSync(path.dirname(target), {recursive:true});
  fs.copyFileSync(path.join(root, name), target);
}
for (const format of ['md', 'html', 'pdf']) {
  const page = strip(read('popup/popup.html'))
    .replace('href="popup.css"', 'href="popup/popup.css"')
    .replace('src="../icons/dialogue.svg"', 'src="icons/dialogue.svg"')
    .replace('</head>', '<style>html{background:#111;overflow:hidden}body{transform:scale(2);transform-origin:0 0}#version{display:none}</style></head>')
    .replace('</body>', `<script>
      document.body.dataset.theme='dark';
      document.body.dataset.state='ready';
      document.querySelector('#controls').disabled=false;
      document.querySelector('#exportButton').disabled=false;
      document.querySelector('#archiveChats').hidden=false;
      document.querySelector('#status').textContent='ChatGPT · ready';
      document.querySelector('#filename').value='Weekend-project';
      document.querySelector('#extension').textContent='.${format}';
      document.querySelector('[name=format][value=${format}]').checked=true;
      document.querySelector('#exportLabel').textContent=${JSON.stringify(format === 'pdf' ? 'Prepare PDF' : 'Export ' + format.toUpperCase())};
      if (${format !== 'md'}) {
        document.querySelector('#imageOptions').hidden=false;
        document.querySelector('#imageOptions').open=${format === 'html'};
      }
      if (${format === 'pdf'}) {
        document.querySelector('#compactPaginationOption').hidden=false;
        document.querySelector('#compactPaginationOption').open=true;
        document.querySelector('#compactPagination').checked=true;
      }
      document.querySelector('#exportForm').addEventListener('submit', event => event.preventDefault());
    </script></body>`);
  fs.writeFileSync(path.join(preview, `menu-${format}.html`), page);
}
const names = ['Weekend project','A reading list','Astronomy website','Recipe notebook','Learning JavaScript','Product ideas','Travel checklist','A small garden','Writing workshop','Design references','Research notes','Next steps'];
const archive = strip(read('archive/archive.html'))
  .replace('href="archive.css"', 'href="archive/archive.css"')
  .replace('src="../icons/dialogue.svg"', 'src="icons/dialogue.svg"')
  .replace('</head>', '<style>:root{color-scheme:dark;--bg:#111;--fg:#fff;--muted:#bbb;--line:#777}h1 img{filter:invert(1)}</style></head>')
  .replace('</body>', `<script>
    document.querySelector('#selection').hidden=false;
    document.querySelector('#count').textContent='12 found · 12 selected';
    document.querySelector('#page').textContent='1 / 1 · showing 1–12 of 12';
    document.querySelector('#run').disabled=false;
    ${JSON.stringify(names)}.forEach(title => {
      const row=document.createElement('label');row.className='chat';
      const check=document.createElement('input');check.type='checkbox';check.checked=true;
      const label=document.createElement('span');label.textContent=title;
      row.append(check,label);document.querySelector('#list').append(row);
    });
    document.querySelector('#status').textContent='Finished. ZIP parts and report saved to Downloads.';
    document.querySelector('#progress').textContent='12 / 12 processed · 0 ready to save · 12 saved · 0 failed · 1 ZIP part saved';
    document.querySelector('#activityBar').textContent='[############]';
    document.querySelector('#elapsed').textContent='';
    document.querySelector('#report').hidden=false;
  </script></body>`);
fs.writeFileSync(path.join(preview, 'archive.html'), archive);
// The existing exported example is fictional and contains no retired controls.
fs.copyFileSync(path.join(root, 'docs/media/example-export.html'), path.join(preview, 'document.html'));
fs.copyFileSync(path.join(root, 'docs/media/example-export.png'), path.join(__dirname, 'assets/document.png'));
console.log('Prepared four current-UI capture pages and the fictional export example.');
console.log('Capture menu-*.html at 440×880; use a tall archive viewport to include Save ZIP.');

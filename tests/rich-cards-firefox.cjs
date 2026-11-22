// Synthetic local fixture only. Never connects to a personal browser profile.
// node tests/rich-cards-firefox.cjs <output-directory>
const fs = require('node:fs'), path = require('node:path'), { spawn } = require('node:child_process');
const { pathToFileURL } = require('node:url');
const assert = require('node:assert/strict');
const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
(async () => {
  const out = path.resolve(process.argv[2]); fs.mkdirSync(out, { recursive: true });
  const profile = fs.mkdtempSync(path.join(out, 'profile-'));
  fs.writeFileSync(path.join(out, 'fixture.html'), read('tests/fixtures/rich-cards.html'));
  const proc = spawn('C:/Program Files/Mozilla Firefox/firefox.exe', ['--headless', '--no-remote', '--profile', profile, '--remote-debugging-port', '9252'], { windowsHide: true });
  let ws;
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(Error('Isolated Firefox startup timeout')), 20000);
      proc.on('error', error => { clearTimeout(timer); reject(error); });
      proc.stderr.on('data', data => { if (data.toString().includes('WebDriver BiDi listening')) { clearTimeout(timer); resolve(); } });
    });
    ws = new WebSocket('ws://127.0.0.1:9252/session');
    await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
    let seq = 0; const pending = new Map();
    ws.onmessage = event => { const message = JSON.parse(event.data); pending.get(message.id)?.(message); pending.delete(message.id); };
    async function cmd(method, params) {
      const id = ++seq;
      const result = await new Promise((resolve, reject) => {
        const timer = setTimeout(() => { pending.delete(id); reject(Error(method + ' timeout')); }, 30000);
        pending.set(id, value => { clearTimeout(timer); resolve(value); });
        ws.send(JSON.stringify({ id, method, params }));
      });
      if (result.type === 'error') throw Error(JSON.stringify(result));
      return result.result;
    }
    const session = await cmd('session.new', { capabilities: { alwaysMatch: {} } });
    const { context } = await cmd('browsingContext.create', { type: 'tab' });
    const evaluate = async expression => {
      const result = await cmd('script.evaluate', { target: { context }, expression, awaitPromise: true });
      if (result.type === 'exception') throw Error(JSON.stringify(result));
      return result.result.value;
    };
    const navigate = async file => cmd('browsingContext.navigate', { context, url: pathToFileURL(path.join(out, file)).href, wait: 'complete' });
    const screenshot = async name => { const result = await cmd('browsingContext.captureScreenshot', { context }); fs.writeFileSync(path.join(out, name + '.png'), Buffer.from(result.data, 'base64')); };
    await cmd('browsingContext.setViewport', { context, viewport: { width: 1100, height: 900 }, devicePixelRatio: 1 });
    await navigate('fixture.html');
    await evaluate(`(async()=>{for(const [i,img] of [...document.images].entries()){const c=document.createElement('canvas');c.width=408;c.height=306;const x=c.getContext('2d');x.fillStyle=i?'#dce6f5':'#243047';x.fillRect(0,0,408,306);x.fillStyle=i?'#35506d':'#d9e7ff';x.fillRect(24,24,360,40);x.font='28px sans-serif';x.fillText('Browser '+(i+1),30,130);img.src=c.toDataURL('image/png');await img.decode();}return true})()`);
    await screenshot('source');
    for (const file of ['content/media.js', 'content/extract.js', 'shared/renderers.js']) await evaluate(read(file));
    const html = await evaluate(`ChatArchiveRenderers.html(ChatArchiveExtractor.collect({outputFormat:'html'}),{compactPagination:true})`);
    assert.doesNotMatch(html, /<button|<script/);
    fs.writeFileSync(path.join(out, 'export.html'), html);
    const printHtml = read('print/print.html').replace('<link rel="stylesheet" href="print.css">', `<style>${read('print/print.css')}</style>`)
      .replace('<script src="print.js"></script>', `<script>window.browser={runtime:{sendMessage:async()=>(${JSON.stringify({ok:true,content:html,compactPagination:true,filename:'cards.pdf'})})}};</script><script>${read('print/print.js')}</script>`);
    fs.writeFileSync(path.join(out, 'print.html'), printHtml);
    const checks = [];
    for (const name of ['export', 'print']) {
      await cmd('browsingContext.navigate', { context, url: pathToFileURL(path.join(out, name + '.html')).href + (name === 'print' ? '?id=synthetic' : ''), wait: 'complete' });
      await evaluate(`(async()=>{for(let i=0;!document.querySelector('.chat-archive-card')&&i<50;i++)await new Promise(r=>setTimeout(r,20));await Promise.all([...document.images].map(img=>img.decode()));return true})()`);
      const result = JSON.parse(await evaluate(`JSON.stringify((()=>{const cards=[...document.querySelectorAll('.chat-archive-card')];return {cards:cards.length,images:[...document.images].filter(i=>i.naturalWidth===408&&i.src.startsWith('data:')).length,rows:cards.map(c=>{const image=c.querySelector('img').getBoundingClientRect(),text=c.querySelector('.card-text').getBoundingClientRect();return {imageWidth:image.width,imageRight:image.right,textLeft:text.left,imageTop:image.top,textTop:text.top};}),badge:getComputedStyle(document.querySelector('.badge')).backgroundColor,overflow:document.documentElement.scrollWidth>innerWidth};})())`));
      assert.equal(result.cards, 2); assert.equal(result.images, 2); assert.equal(result.overflow, false);
      assert.equal(result.badge, 'rgb(216, 243, 227)');
      assert.equal(await evaluate(`document.querySelector('.badge').getBoundingClientRect().width < document.querySelector('.card-text').getBoundingClientRect().width / 2`), true, 'badge fits its label');
      assert.equal(await evaluate(`document.querySelector('hr').getBoundingClientRect().width > 500`), true, 'divider spans the card list');
      for (const row of result.rows) { assert.ok(Math.abs(row.imageWidth - 136) < 1); assert.ok(row.textLeft > row.imageRight); assert.ok(Math.abs(row.textTop-row.imageTop)<1); }
      await screenshot(name); checks.push({ page: name, ...result });
    }
    await navigate('export.html');
    await cmd('browsingContext.setViewport', { context, viewport: { width: 390, height: 844 }, devicePixelRatio: 1 });
    assert.equal(await evaluate('document.documentElement.scrollWidth <= innerWidth'), true, 'mobile: no horizontal overflow');
    assert.equal(await evaluate(`(()=>{const c=document.querySelector('.chat-archive-card');return c.querySelector('.card-text').getBoundingClientRect().top>=c.querySelector('img').getBoundingClientRect().bottom})()`), true, 'mobile: text stacks below thumbnail');
    await screenshot('mobile');
    const report = { firefox: session.capabilities.browserVersion, checks, mobile: 'stacked; no horizontal overflow', temporaryProfileOnly: true };
    fs.writeFileSync(path.join(out, 'result.json'), JSON.stringify(report, null, 2)); console.log(JSON.stringify(report));
    await cmd('session.end', {});
  } finally { ws?.close(); proc.kill(); }
})().catch(error => { console.error(error); process.exitCode = 1; });

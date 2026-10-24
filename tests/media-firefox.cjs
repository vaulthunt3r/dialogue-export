// Local Firefox test: node tests/media-firefox.cjs <output-directory> [local-code-fixture.html | --repair-export local-export.html]
// Uses a temporary profile and synthetic content; no live chat or network fetches.
const fs = require('node:fs'), path = require('node:path'), { spawn } = require('node:child_process');
const { pathToFileURL } = require('node:url');
const assert = require('node:assert/strict');
const read = name => fs.readFileSync(path.join(__dirname, '..', name), 'utf8');
(async () => {
  const out = path.resolve(process.argv[2]); fs.mkdirSync(out, { recursive: true });
  const profile = fs.mkdtempSync(path.join(out, 'profile-'));
  let codeFixture = '', expectedCode = '';
  if (process.argv[3] && process.argv[3] !== '--repair-export') {
    const { JSDOM } = require('jsdom');
    const input = new JSDOM(fs.readFileSync(process.argv[3], 'utf8'));
    const block = input.window.document.querySelector('[data-code-block]');
    assert.ok(block, 'Input must contain a code block');
    codeFixture = block.outerHTML;
    expectedCode = [...block.querySelectorAll('.cm-line')].map(line => line.textContent).join('\n');
    input.window.close();
  }
  const fixture = `<!doctype html><meta http-equiv="Content-Security-Policy" content="img-src 'self' data: blob:"><title>Media preservation fixture</title><main hidden>Home</main><main></main><main>
    <div data-turn-key="image-turn"><div data-content-search-turn-key="image-turn"><div data-talvt-turn-state><div>
      <div data-chatgpt-search-message-ids="question"><div data-user-message-bubble>Create three colored shapes</div></div>
      <div><div data-chatgpt-search-message-ids="generated-image"><div><div class="group/generated-image-gallery-controls" style="height:360px"><div style="height:360px"><div data-web-image-tile><button aria-hidden="false"><img alt="Generated shapes"></button><button>Download</button></div></div></div></div></div></div>
    </div></div></div></div>
    <div data-chatgpt-selection-message-id="svg"><svg width="320" height="110" viewBox="0 0 320 110"><title>Flow chart</title><rect x="5" y="5" width="310" height="100" fill="#e0f2fe" stroke="#0369a1"/><text x="30" y="60" font-size="22" fill="#0c4a6e">Input → Process → Output</text></svg><span><img src="https://t0.gstatic.com/faviconV2?client=SOCIAL&amp;type=FAVICON&amp;url=https://example.com&amp;size=32" alt="">Source citation</span></div>
    <div data-chatgpt-selection-message-id="canvas"><canvas width="320" height="100"></canvas></div>${codeFixture ? `<div data-chatgpt-selection-message-id="code">${codeFixture}</div>` : ''}</main>`;
  fs.writeFileSync(path.join(out, 'fixture.html'), fixture);
  const proc = spawn('C:/Program Files/Mozilla Firefox/firefox.exe', ['--headless', '--no-remote', '--profile', profile, '--remote-debugging-port', '9238'], { windowsHide: true });
  let ws;
  try {
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(Error('Firefox startup timeout')), 20000);
      proc.on('error', reject); proc.stderr.on('data', value => { if (value.toString().includes('WebDriver BiDi listening')) { clearTimeout(timeout); resolve(); } });
    });
    ws = new WebSocket('ws://127.0.0.1:9238/session'); await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
    let seq = 0; const pending = new Map();
    ws.onmessage = event => { const m = JSON.parse(event.data); if (pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
    async function cmd(method, params) {
      const id = ++seq;
      const m = await new Promise((resolve, reject) => { const t = setTimeout(() => reject(Error(method + ' timeout')), 30000); pending.set(id, v => { clearTimeout(t); resolve(v); }); ws.send(JSON.stringify({ id, method, params })); });
      if (m.type === 'error') throw Error(JSON.stringify(m)); return m.result;
    }
    const session = await cmd('session.new', { capabilities: { alwaysMatch: {} } });
    console.log('Firefox', session.capabilities.browserVersion);
    const { context } = await cmd('browsingContext.create', { type: 'tab' });
    async function evaluate(expression) {
      const result = await cmd('script.evaluate', { target: { context }, expression, awaitPromise: true });
      if (result.type === 'exception') throw Error(JSON.stringify(result));
      return result.result.value;
    }
    await cmd('browsingContext.navigate', { context, url: pathToFileURL(path.join(out, 'fixture.html')).href, wait: 'complete' });
    await evaluate(`(async()=>{const c=document.createElement('canvas');c.width=1448;c.height=1086;const x=c.getContext('2d');x.fillStyle='white';x.fillRect(0,0,c.width,c.height);x.fillStyle='#ef4444';x.beginPath();x.arc(270,543,170,0,Math.PI*2);x.fill();x.fillStyle='#22c55e';x.fillRect(554,373,340,340);x.fillStyle='#2563eb';x.beginPath();x.moveTo(1178,350);x.lineTo(1368,713);x.lineTo(988,713);x.closePath();x.fill();const img=document.querySelector('img');img.src=URL.createObjectURL(await new Promise(resolve=>c.toBlob(resolve,'image/png')));await img.decode();const y=document.querySelector('canvas').getContext('2d');y.fillStyle='#fef3c7';y.fillRect(0,0,320,100);y.fillStyle='#92400e';y.font='22px sans-serif';y.fillText('Live canvas snapshot',20,55);return true})()`);
    for (const file of ['content/media.js', 'content/extract.js', 'shared/renderers.js']) await evaluate(read(file));
    const waited = JSON.parse(await evaluate(`(async()=>{ChatArchiveMedia.beginExport();const img=document.querySelector('img'),src=img.src;img.removeAttribute('src');img.setAttribute('loading','lazy');const start=performance.now();setTimeout(()=>{img.src=src},500);await ChatArchiveMedia.waitForImages(()=>ChatArchiveExtractor.nodes().map((node,i)=>({node,owner:ChatArchiveExtractor.idOf(node,i)})));return JSON.stringify({elapsed:performance.now()-start,width:img.naturalWidth,lazy:img.getAttribute('loading')})})()`));
    assert.ok(waited.elapsed >= 450, 'collector waits for delayed image source');
    assert.equal(waited.width, 1448); assert.equal(waited.lazy, 'lazy');
    console.log('PASS source image: delayed pixels awaited and lazy attribute restored');
    const exported = await evaluate(`JSON.stringify(ChatArchiveExtractor.collect({outputFormat:'html'}))`);
    const messages = JSON.parse(exported).messages;
    assert.ok(messages.every(message => !('markdown' in message)), 'HTML does not duplicate embedded images in Markdown');
    assert.ok(messages.every(message => !message.html.includes('faviconV2')), 'blocked gstatic UI icon is excluded without blocking source capture');
    assert.equal(await evaluate(`ChatArchiveMedia.resourceUsage().assets`), 3, 'waiting and capture charge each asset once');
    assert.equal(await evaluate(`ChatArchiveMedia.endExport();ChatArchiveMedia.resourceUsage().assets`), 0, 'source media budget released');
    assert.equal(messages.length, codeFixture ? 5 : 4);
    assert.equal(messages[0].role, 'user');
    assert.equal(messages[1].role, 'assistant');
    assert.match(messages[1].id, /generated-image/);
    assert.doesNotMatch(messages[1].text, /Download|Create three/);
    const html = await evaluate(`ChatArchiveRenderers.html(JSON.parse(${JSON.stringify(exported)}),{includeTitle:true,compactPagination:true})`);
    fs.writeFileSync(path.join(out, 'export.html'), html);
    const printPage = read('print/print.html').replace('<link rel="stylesheet" href="print.css">', `<style>${read('print/print.css')}</style>`)
      .replace('<script src="print.js"></script>', `<script>window.browser={runtime:{sendMessage:async()=>(${JSON.stringify({ ok: true, content: html, compactPagination: true, filename: 'media.pdf' })})}};</script><script>${read('print/print.js')}</script>`);
    fs.writeFileSync(path.join(out, 'print.html'), printPage);
    for (const name of ['export', 'print']) {
      await cmd('browsingContext.navigate', { context, url: pathToFileURL(path.join(out, name + '.html')).href + (name === 'print' ? '?id=fixture' : ''), wait: 'complete' });
      const count = await evaluate(`(async()=>{const images=[...document.querySelectorAll('img')];await Promise.all(images.map(i=>i.decode()));return images.filter(i=>i.naturalWidth>0&&i.src.startsWith('data:image/')).length})()`);
      assert.equal(count, 3, `${name}: all media embedded and decoded`);
      assert.equal(await evaluate(`document.querySelector('img[alt="Generated shapes"]').naturalWidth`), 1448, `${name}: generated image keeps loaded resolution`);
      assert.equal(await evaluate(`(()=>{const img=document.querySelector('img[alt="Generated shapes"]');return img.getBoundingClientRect().bottom<=img.closest('article').nextElementSibling.getBoundingClientRect().top})()`), true, `${name}: following message does not overlap image`);
      if (codeFixture) assert.equal(await evaluate(`document.querySelector('pre code').textContent`), expectedCode, `${name}: exact code lines and indentation`);
      const screenshot = await cmd('browsingContext.captureScreenshot', { context });
      fs.writeFileSync(path.join(out, name + '.png'), Buffer.from(screenshot.data, 'base64'));
      const pdf = await cmd('browsingContext.print', { context, background: true });
      fs.writeFileSync(path.join(out, name + '.pdf'), Buffer.from(pdf.data, 'base64'));
      console.log(`PASS ${name}: 3 embedded images decoded; screenshot and PDF saved`);
    }
    if (process.argv[3] === '--repair-export') {
      // The supplied export stays local; load scripts/styles only from the repo.
      const { JSDOM } = require('jsdom');
      const supplied = new JSDOM(fs.readFileSync(process.argv[4], 'utf8'), { runScripts: 'outside-only' });
      const doc = supplied.window.document;
      const beforeImages = [...doc.images].map(img => img.getAttribute('src'));
      const beforeText = [...doc.querySelectorAll('article')].map(el => el.textContent);
      supplied.window.eval(read('content/media.js'));
      supplied.window.ChatArchiveMedia.normalizeGalleries(doc.body);
      assert.deepEqual([...doc.images].map(img => img.getAttribute('src')), beforeImages);
      assert.deepEqual([...doc.querySelectorAll('article')].map(el => el.textContent), beforeText);
      assert.ok([...doc.images].every(img => img.src.startsWith('data:image/')), 'Local repair fixture must have embedded images');
      doc.querySelectorAll('script,link,iframe,object,embed').forEach(el => el.remove());
      fs.writeFileSync(path.join(out, 'repaired.html'), supplied.serialize());
      supplied.window.close();
      await cmd('browsingContext.navigate', { context, url: pathToFileURL(path.join(out, 'repaired.html')).href, wait: 'complete' });
      await evaluate(`Promise.all([...document.images].map(img=>img.decode()))`);
      assert.equal(await evaluate(`(()=>{const img=document.querySelector('img');return img.getBoundingClientRect().bottom<=img.closest('article').nextElementSibling.getBoundingClientRect().top})()`), true, 'Supplied export: following text clears the image');
      const pdf = await cmd('browsingContext.print', { context, background: true });
      fs.writeFileSync(path.join(out, 'repaired.pdf'), Buffer.from(pdf.data, 'base64'));
      console.log('PASS supplied export: image data and article text unchanged; no image/text overlap');
    }
    await cmd('session.end', {});
  } finally { ws?.close(); proc.kill(); }
})().catch(error => { console.error(error); process.exitCode = 1; });

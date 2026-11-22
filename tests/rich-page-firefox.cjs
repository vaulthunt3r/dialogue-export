// Full API -> rendered DOM -> background image download, in an isolated Firefox.
// Two local origins, no CORS headers, no personal profile or external requests.
const fs = require('node:fs'), path = require('node:path'), http = require('node:http');
const { spawn } = require('node:child_process');
const { pathToFileURL } = require('node:url');
const assert = require('node:assert/strict');
const root = path.join(__dirname, '..'), read = file => fs.readFileSync(path.join(root, file), 'utf8');
(async () => {
  const out = path.resolve(process.argv[2] || 'release/0.5.7/rich-page-qa'); fs.mkdirSync(out, { recursive: true });
  const run = fs.mkdtempSync(path.join(out, 'run-')), profile = path.join(run, 'profile'), extension = path.join(run, 'extension');
  fs.mkdirSync(profile); fs.mkdirSync(extension);
  const id = '12345678-1234-1234-1234-123456789abc';
  const raw = { conversation_id: id, current_node: 'm7', mapping: { root: { id: 'root', parent: null, message: null } } };
  for (let i = 0; i < 8; i++) raw.mapping[`m${i}`] = { id: `m${i}`, parent: i ? `m${i-1}` : 'root', message: {
    id: `m${i}`, author: { role: i % 2 ? 'assistant' : 'user' }, status: 'finished_successfully',
    content: { content_type: 'text', parts: [i === 1 ? '<box gap={3}><AsyncImage query="preview"/><Entity value="Example"/></box>' : `Message ${i}`] }
  } };
  const imageRequests = [], bytes = fs.readFileSync(path.join(__dirname, 'fixtures/api-color-fixture.png'));
  const images = http.createServer((req, res) => {
    imageRequests.push({ path: req.url, cookie: req.headers.cookie || null, authorization: req.headers.authorization || null, referer: req.headers.referer || null });
    res.setHeader('Content-Type', 'image/png'); res.setHeader('Cache-Control', 'no-store'); res.end(bytes);
  });
  await new Promise(resolve => images.listen(0, '127.0.0.1', resolve));
  const imageOrigin = `http://127.0.0.1:${images.address().port}`;
  let finish; const finished = new Promise(resolve => { finish = resolve; });
  let fixture = read('tests/fixtures/rich-cards.html').replace('message-id="answer"', 'message-id="m1"');
  let number = 0;
  fixture = fixture.replace(/<div class="thumbnail">/g, '<div class="thumbnail" data-d-component="box" data-d-image-frame>')
    .replace(/<img /g, () => `<svg style="display:none"><path d="M0 0"/></svg><img src="${imageOrigin}/static-rsc-4/image-${++number}.png" `);
  fixture = fixture.replace('<main>', '<main><div data-chatgpt-search-message-ids=\'["m0"]\'><div data-user-message-bubble>Message 0</div></div>');
  fixture = fixture.replace('</main>', Array.from({ length: 6 }, (_, n) => {
    const i = n + 2; return i % 2 ? `<div data-chatgpt-selection-message-id="m${i}"><p>Message ${i}</p></div>`
      : `<div data-chatgpt-search-message-ids='["m${i}"]'><div data-user-message-bubble>Message ${i}</div></div>`;
  }).join('') + '</main>');
  const server = http.createServer((req, res) => {
    if (req.url === '/report') {
      let body = ''; req.on('data', data => { body += data; }); req.on('end', () => { finish(JSON.parse(body)); res.end('ok'); }); return;
    }
    if (req.url.startsWith('/c/')) { res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.setHeader('Set-Cookie', 'fixture_session=local; Path=/'); res.end(fixture); return; }
    res.setHeader('Content-Type', 'application/json');
    if (req.url === '/api/auth/session') res.end(JSON.stringify({ accessToken: 'SYNTHETIC_TOKEN' }));
    else if (req.url === `/backend-api/conversation/${id}`) res.end(JSON.stringify(raw));
    else { res.writeHead(404); res.end('{}'); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  for (const name of ['content', 'shared', 'print', 'popup', 'icons', 'archive', 'background.js']) fs.cpSync(path.join(root, name), path.join(extension, name), { recursive: true });
  // Redirect only production origin guards to the two synthetic servers.
  for (const name of ['content/chatgpt-api.js', 'content/media.js', 'background.js', 'content/api-media.js']) {
    let source = read(name).replaceAll('https://chatgpt.com', origin).replaceAll('https://images.openai.com', imageOrigin);
    // Firefox permission match patterns do not include a localhost port.
    if (name === 'background.js') source = source.replace(`origins: ['${imageOrigin}/*']`, "origins: ['http://127.0.0.1/*']");
    if (name === 'content/media.js') source = source.replace("location.hostname !== 'chatgpt.com'", `location.origin !== '${origin}'`);
    if (name === 'content/api-media.js') source = source.replace('if (url.origin === location.origin', `if (url.origin === '${imageOrigin}') return url;\n    if (url.origin === location.origin`);
    fs.writeFileSync(path.join(extension, name), source);
  }
  fs.writeFileSync(path.join(extension, 'content/content.js'), read('content/content.js').replace('browser.runtime.onMessage.addListener(request => {', 'window.fixtureCollect = collectComplete;\n  browser.runtime.onMessage.addListener(request => {'));
  const manifest = JSON.parse(read('manifest.json'));
  manifest.name = 'Local rich-page fixture'; manifest.host_permissions = ['http://127.0.0.1/*'];
  manifest.content_scripts[0].matches = ['http://127.0.0.1/*'];
  manifest.content_scripts[0].js = manifest.content_scripts[0].js.filter(file => !['content/panel.js', 'content/history.js'].includes(file));
  manifest.content_scripts[0].js.push('shared/renderers.js', 'runner.js');
  manifest.browser_specific_settings.gecko.id = 'local-rich-page@example.test';
  fs.writeFileSync(path.join(extension, 'manifest.json'), JSON.stringify(manifest));
  fs.writeFileSync(path.join(extension, 'runner.js'), `(async()=>{try {
    await Promise.all([...document.images].map(i=>i.decode()));
    let tainted=false; const canvas=document.createElement('canvas'); canvas.width=1; canvas.height=1;
    canvas.getContext('2d').drawImage(document.images[0],0,0);
    try{canvas.toDataURL()}catch(error){tainted=error.name==='SecurityError'}
    const host=document.querySelector('main'); host.style.cssText='height:420px;overflow:auto';host.scrollTop=host.scrollHeight;
    const prop=Object.getOwnPropertyDescriptor(Element.prototype,'scrollTop');let scrollWrites=0;
    Object.defineProperty(host,'scrollTop',{get(){return prop.get.call(this)},set(v){scrollWrites++;prop.set.call(this,v)}});
    const data=await fixtureCollect({outputFormat:'html',waitForImages:true,includeLinks:true,includeImageDetails:true});
    const html=ChatArchiveRenderers.html(data,{compactPagination:true});
    await fetch('/report',{method:'POST',body:JSON.stringify({tainted,scrollWrites,count:data.messages.length,method:data.collectionMethod,html})});
  }catch(error){await fetch('/report',{method:'POST',body:JSON.stringify({error:String(error),stack:error.stack})})}})();`);
  const proc = spawn('C:/Program Files/Mozilla Firefox/firefox.exe', ['--headless', '--no-remote', '--profile', profile, '--remote-debugging-port', '9253'], { windowsHide: true });
  let ws, timer;
  try {
    await new Promise((resolve, reject) => { const t = setTimeout(() => reject(Error('Firefox startup timeout')), 20000); proc.on('error', reject); proc.stderr.on('data', data => { if (data.toString().includes('WebDriver BiDi listening')) { clearTimeout(t); resolve(); } }); });
    ws = new WebSocket('ws://127.0.0.1:9253/session'); await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
    let seq = 0; const pending = new Map(); ws.onmessage = event => { const m = JSON.parse(event.data); pending.get(m.id)?.(m); };
    const cmd = (method, params) => new Promise((resolve, reject) => { const id = ++seq, t = setTimeout(() => { pending.delete(id); reject(Error(method + ' timeout')); }, 25000); pending.set(id, m => { clearTimeout(t); pending.delete(id); m.type === 'error' ? reject(Error(JSON.stringify(m))) : resolve(m.result); }); ws.send(JSON.stringify({ id, method, params })); });
    const session = await cmd('session.new', { capabilities: { alwaysMatch: {} } });
    await cmd('webExtension.install', { extensionData: { type: 'path', path: extension } });
    const { context } = await cmd('browsingContext.create', { type: 'tab' });
    await cmd('browsingContext.setViewport', { context, viewport: { width: 1100, height: 900 } });
    await cmd('browsingContext.navigate', { context, url: `${origin}/c/${id}`, wait: 'complete' });
    const result = await Promise.race([finished, new Promise((_, reject) => { timer = setTimeout(() => reject(Error('Fixture report timeout')), 40000); })]);
    assert.equal(result.error, undefined, result.stack || result.error); assert.equal(result.tainted, true);
    assert.equal(result.scrollWrites, 0); assert.equal(result.count, 8); assert.equal(result.method, 'chatgpt-page-verified');
    assert.doesNotMatch(result.html, /SYNTHETIC_TOKEN|Image is linked|AsyncImage|data-export-hidden|<figcaption|original file not verified|Image from ChatGPT response/);
    const embedded = [...result.html.matchAll(/src="data:image\/png;base64,([^"]+)"/g)];
    assert.equal(embedded.length, 2);
    for (const image of embedded) assert.ok(Buffer.from(image[1], 'base64').equals(bytes), 'downloaded preview bytes are unchanged');
    const downloaded = imageRequests.filter(r => !r.referer);
    assert.equal(downloaded.length, 2); assert.ok(downloaded.every(r => !r.cookie && !r.authorization));
    fs.writeFileSync(path.join(out, 'export.html'), result.html);
    const print = read('print/print.html').replace('<link rel="stylesheet" href="print.css">', `<style>${read('print/print.css')}</style>`)
      .replace('<script src="print.js"></script>', `<script>window.browser={runtime:{sendMessage:async()=>(${JSON.stringify({ ok: true, content: result.html, compactPagination: true, strictImages: true, filename: 'cards.pdf' })})}};</script><script>${read('print/print.js')}</script>`);
    fs.writeFileSync(path.join(out, 'print.html'), print);
    // Shut down the image server: files must work offline.
    images.closeAllConnections(); await new Promise(resolve => images.close(resolve));
    const evaluate = async expression => { const r = await cmd('script.evaluate', { target: { context }, expression, awaitPromise: true }); if (r.type === 'exception') throw Error(JSON.stringify(r)); return r.result.value; };
    for (const page of ['export', 'print']) {
      await cmd('browsingContext.navigate', { context, url: pathToFileURL(path.join(out, page + '.html')).href + (page === 'print' ? '?id=fixture' : ''), wait: 'complete' });
      assert.equal(await evaluate(`(async()=>{for(let i=0;!document.images.length&&i<50;i++)await new Promise(r=>setTimeout(r,20));await Promise.all([...document.images].map(i=>i.decode()));return document.images.length===2&&[...document.images].every(i=>i.src.startsWith('data:image/png;base64,')&&i.naturalWidth===640)})()`), true);
      assert.equal(await evaluate(`(()=>{const cards=[...document.querySelectorAll('.chat-archive-card')];return cards.length===2&&cards.every(c=>{const i=c.querySelector('img').getBoundingClientRect(),t=c.querySelector('.card-text').getBoundingClientRect();return i.width===136&&t.left>i.right&&Math.abs(i.top-t.top)<1})})()`), true);
      assert.equal(await evaluate(`document.documentElement.scrollWidth<=innerWidth`), true);
      if (page === 'print') assert.equal(await evaluate(`document.querySelector('#printButton').disabled`), false);
      const shot = await cmd('browsingContext.captureScreenshot', { context }); fs.writeFileSync(path.join(out, page + '.png'), Buffer.from(shot.data, 'base64'));
      const pdf = await cmd('browsingContext.print', { context, background: true }); fs.writeFileSync(path.join(out, page + '.pdf'), Buffer.from(pdf.data, 'base64'));
    }
    const report = { firefox: session.capabilities.browserVersion, messages: result.count, scrollWrites: result.scrollWrites, blockedCanvasReproduced: result.tainted, embeddedImages: 2, originalBytes: true, cookieTokenReferrerOmitted: true, htmlAndPrintVerifiedOffline: true, temporaryProfileOnly: true };
    fs.writeFileSync(path.join(out, 'result.json'), JSON.stringify(report, null, 2)); console.log(JSON.stringify(report));
  } finally {
    clearTimeout(timer); ws?.close(); proc.kill();
    for (const s of [images, server]) { s.closeAllConnections(); await new Promise(resolve => s.close(resolve)); }
  }
})().catch(error => { console.error(error); process.exitCode = 1; });

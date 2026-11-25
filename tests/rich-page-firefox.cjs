// Full API -> rendered DOM -> background image download, in an isolated Firefox.
// Two local origins, no CORS headers, no personal profile or external requests.
const fs = require('node:fs'), path = require('node:path'), http = require('node:http');
const { spawn } = require('node:child_process');
const { pathToFileURL } = require('node:url');
const assert = require('node:assert/strict');
const root = path.join(__dirname, '..'), read = file => fs.readFileSync(path.join(root, file), 'utf8');
(async () => {
  const out = path.resolve(process.argv[2] || 'release/0.5.7/rich-page-qa'); fs.mkdirSync(out, { recursive: true });
  const unidentifiedNeighbours = process.argv.includes('--unidentified-neighbours');
  const diagram = '<svg xmlns="http://www.w3.org/2000/svg" width="600" height="220" viewBox="0 0 600 220"><title>Local flow diagram</title><rect x="20" y="20" width="220" height="70" rx="12" fill="#e0f2fe" stroke="#2563eb" stroke-width="2"/><text x="60" y="62" font-family="sans-serif" font-size="24">Device A</text><rect x="360" y="20" width="220" height="70" rx="12" fill="#dcfce7" stroke="#16a34a" stroke-width="2"/><text x="400" y="62" font-family="sans-serif" font-size="24">Device B</text><path d="M130 90 V120 H470 V90 M300 120 V150" stroke="#d97706" stroke-width="3" fill="none"/><rect x="170" y="150" width="260" height="60" rx="12" fill="#fff7ed" stroke="#d97706" stroke-width="2"/><text x="230" y="188" font-family="sans-serif" font-size="24">Power bank</text></svg>';
  const run = fs.mkdtempSync(path.join(out, 'run-')), profile = path.join(run, 'profile'), extension = path.join(run, 'extension');
  fs.mkdirSync(profile); fs.mkdirSync(extension);
  const id = '12345678-1234-1234-1234-123456789abc';
  const raw = { conversation_id: id, current_node: 'm7', mapping: { root: { id: 'root', parent: null, message: null } } };
  for (let i = 0; i < 8; i++) raw.mapping[`m${i}`] = { id: `m${i}`, parent: i ? `m${i-1}` : 'root', message: {
    id: `m${i}`, author: { role: i % 2 ? 'assistant' : 'user' }, status: 'finished_successfully',
    content: { content_type: 'text', parts: [i === 1 || i === 3 ? '<card><AsyncImage query="Unmapped comparison image"/></card>' : `Message ${i}`] }
  } };
  if (unidentifiedNeighbours) raw.mapping.m3.message.content.parts = [`<card>${diagram}</card>`];
  const imageRequests = [], bytes = fs.readFileSync(path.join(__dirname, 'fixtures/api-color-fixture.png'));
  const images = http.createServer((req, res) => {
    imageRequests.push({ path: req.url, cookie: req.headers.cookie || null, authorization: req.headers.authorization || null, referer: req.headers.referer || null });
    res.setHeader('Content-Type', 'image/png'); res.setHeader('Cache-Control', 'no-store'); res.end(bytes);
  });
  await new Promise(resolve => images.listen(0, '127.0.0.1', resolve));
  const imageOrigin = `http://127.0.0.1:${images.address().port}`;
  let finish; const finished = new Promise(resolve => { finish = resolve; });
  let fixture = read('tests/fixtures/rich-cards.html').replace('message-id="answer"', 'message-id="m1"');
  fixture = fixture.replace('</style>', read('tests/fixtures/components.css') + '</style>');
  let number = 0;
  fixture = fixture.replace(/<div class="thumbnail">/g, '<div class="thumbnail" data-d-component="box" data-d-image-frame>')
    .replace(/<img /g, () => `<svg style="display:none"><path d="M0 0"/></svg><img src="${imageOrigin}/static-rsc-4/image-${++number}.png" `);
  fixture = fixture.replace('<main>', unidentifiedNeighbours
    ? '<main><div data-user-message-bubble>PAGE_ONLY_NEIGHBOUR</div>'
    : '<main><div data-chatgpt-search-message-ids=\'["m0"]\'><div data-user-message-bubble>Message 0</div></div>');
  fixture = fixture.replace('</main>', Array.from({ length: 6 }, (_, n) => {
    const i = n + 2; return i % 2 ? `<div data-chatgpt-selection-message-id="m${i}">${i === 3 ? read('tests/fixtures/component-table.html') + read('tests/fixtures/tariff-card.html') + (unidentifiedNeighbours ? diagram : '') : `<p>Message ${i}</p>`}</div>`
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
  const proc = spawn('C:/Program Files/Mozilla Firefox/firefox.exe', ['--headless', '--no-remote', '--profile', profile, '--remote-debugging-port', '0'], { windowsHide: true });
  proc.stderr.on('data', data => fs.appendFileSync(path.join(run, 'firefox-stderr.log'), data));
  proc.stdout.on('data', data => fs.appendFileSync(path.join(run, 'firefox-stdout.log'), data));
  let ws, timer;
  try {
    const debuggerUrl = await new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(Error('Firefox startup timeout')), 30000);
      proc.on('error', error => { clearTimeout(t); reject(error); });
      proc.on('exit', code => { clearTimeout(t); reject(Error('Firefox exited during startup: '+code)); });
      let log = '';
      proc.stderr.on('data', data => {
        log += data.toString();
        const address = log.match(/WebDriver BiDi listening on (ws:\/\/\S+)/)?.[1];
        if (address) { clearTimeout(t); resolve(address); }
      });
    });
    ws = new WebSocket(debuggerUrl.replace(/\/$/,'')+'/session'); await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
    let seq = 0; const pending = new Map(); ws.onmessage = event => { const m = JSON.parse(event.data); pending.get(m.id)?.(m); };
    const cmd = (method, params) => new Promise((resolve, reject) => { const id = ++seq, t = setTimeout(() => { pending.delete(id); reject(Error(method + ' timeout')); }, 25000); pending.set(id, m => { clearTimeout(t); pending.delete(id); m.type === 'error' ? reject(Error(JSON.stringify(m))) : resolve(m.result); }); ws.send(JSON.stringify({ id, method, params })); });
    const session = await cmd('session.new', { capabilities: { alwaysMatch: {} } });
    await cmd('webExtension.install', { extensionData: { type: 'path', path: extension } });
    const { context } = await cmd('browsingContext.create', { type: 'tab' });
    await cmd('browsingContext.setViewport', { context, viewport: { width: 1100, height: 900 } });
    await cmd('browsingContext.navigate', { context, url: `${origin}/c/${id}`, wait: 'complete' });
    const result = await Promise.race([finished, new Promise((_, reject) => { timer = setTimeout(() => reject(Error('Fixture report timeout')), 40000); })]);
    assert.equal(result.error, undefined, result.stack || result.error); assert.equal(result.tainted, true);
    assert.equal(result.scrollWrites, 0); assert.equal(result.count, 8); assert.equal(result.method, 'chatgpt-api-rendered');
    assert.doesNotMatch(result.html, /SYNTHETIC_TOKEN|Image is linked|AsyncImage|data-export-hidden|<figcaption|original file not verified|Image from ChatGPT response/);
    if (unidentifiedNeighbours) {
      assert.doesNotMatch(result.html, /PAGE_ONLY_NEIGHBOUR/);
      assert.match(result.html, /Message 0/);
      const svg = decodeURIComponent(result.html.match(/src="data:image\/svg\+xml;charset=utf-8,([^"]+)"/)[1]);
      assert.match(svg, /Device A/); assert.match(svg, /Device B/); assert.match(svg, /Power bank/);
      assert.equal((svg.match(/<rect\b/g) || []).length, 3); assert.equal((svg.match(/<path\b/g) || []).length, 1);
    }
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
    const componentChecks = [];
    const checkComponents = async page => {
      const values = JSON.parse(await evaluate(`JSON.stringify([...document.querySelectorAll('[data-d-has-width][data-d-has-height]')].map(el=>{
        const fill=el.getBoundingClientRect(),track=el.parentElement.getBoundingClientRect();
        return {ratio:fill.width/track.width,height:fill.height,trackHeight:track.height,color:getComputedStyle(el).backgroundColor};
      }))`));
      assert.equal(values.length,4);
      values.forEach((value,i)=>{
        assert.ok(Math.abs(value.ratio-[.1,.3,.5,1][i])<.001, page+' responsive chart proportions');
        assert.equal(value.height,12); assert.equal(value.trackHeight,12); assert.equal(value.color,'rgb(22, 163, 74)');
      });
      assert.equal(await evaluate(`getComputedStyle(document.querySelector('[data-d-component="card"]')).printColorAdjust`),'exact');
      assert.equal(await evaluate(`document.documentElement.scrollWidth<=innerWidth`),true);
      componentChecks.push({page,values});
    };
    for (const page of ['export', 'print']) {
      await cmd('browsingContext.navigate', { context, url: pathToFileURL(path.join(out, page + '.html')).href + (page === 'print' ? '?id=fixture' : ''), wait: 'complete' });
      assert.equal(await evaluate(`(async()=>{for(let i=0;!document.images.length&&i<50;i++)await new Promise(r=>setTimeout(r,20));await Promise.all([...document.images].map(i=>i.decode()));return document.images.length===${unidentifiedNeighbours ? 3 : 2}&&[...document.images].every(i=>i.src.startsWith('data:image/png;base64,')?i.naturalWidth===640:i.src.startsWith('data:image/svg+xml;')&&i.naturalWidth===600&&i.naturalHeight===220)})()`), true);
      assert.equal(await evaluate(`(()=>{const cards=[...document.querySelectorAll('.chat-archive-card')];return cards.length===2&&cards.every(c=>{const i=c.querySelector('img').getBoundingClientRect(),t=c.querySelector('.card-text').getBoundingClientRect();return i.width===136&&t.left>i.right&&Math.abs(i.top-t.top)<1})})()`), true);
      assert.equal(await evaluate(`document.documentElement.scrollWidth<=innerWidth`), true);
      if (page === 'print') assert.equal(await evaluate(`document.querySelector('#printButton').disabled`), false);
      await checkComponents(page);
      const tableSpacing = JSON.parse(await evaluate(`JSON.stringify((()=>{
        const table=document.querySelector('[data-d-component="table"] table');
        return {overlays:document.querySelectorAll('.Edges-example').length,
          gap:document.querySelector('.after-table').getBoundingClientRect().top-table.getBoundingClientRect().bottom,
          rowHeight:table.rows[1].getBoundingClientRect().height};
      })())`));
      assert.equal(tableSpacing.overlays,0);
      assert.ok(tableSpacing.gap>=0&&tableSpacing.gap<=26,'no table-sized blank area after a rendered table');
      assert.ok(tableSpacing.rowHeight<50,'cell paragraph margins do not double table row height');
      componentChecks.push({page,tableSpacing});
      const shot = await cmd('browsingContext.captureScreenshot', { context }); fs.writeFileSync(path.join(out, page + '.png'), Buffer.from(shot.data, 'base64'));
      const pdf = await cmd('browsingContext.print', { context, background: true }); fs.writeFileSync(path.join(out, page + '.pdf'), Buffer.from(pdf.data, 'base64'));
      if (unidentifiedNeighbours) {
        await evaluate(`document.querySelector('img[src^="data:image/svg+xml;"]').scrollIntoView({block:'center'})`);
        const diagramShot = await cmd('browsingContext.captureScreenshot', { context });
        fs.writeFileSync(path.join(out, page + '-diagram.png'), Buffer.from(diagramShot.data, 'base64'));
      }
    }
    // A standalone preview of the supplied card makes visual comparison easy.
    await cmd('browsingContext.navigate', { context, url: pathToFileURL(path.join(out,'export.html')).href, wait:'complete' });
    const cardHtml = await evaluate(`(()=>{const d=document.documentElement.cloneNode(true);for(const a of d.querySelectorAll('article'))if(!a.querySelector('[data-d-component="card"]'))a.remove();return '<!doctype html>'+d.outerHTML})()`);
    fs.writeFileSync(path.join(out,'tariff-card.html'),cardHtml);
    await cmd('browsingContext.navigate', { context, url: pathToFileURL(path.join(out,'tariff-card.html')).href, wait:'complete' });
    const cardShot = await cmd('browsingContext.captureScreenshot',{context});fs.writeFileSync(path.join(out,'tariff-card.png'),Buffer.from(cardShot.data,'base64'));
    const cardPdf = await cmd('browsingContext.print',{context,background:false});fs.writeFileSync(path.join(out,'tariff-card.pdf'),Buffer.from(cardPdf.data,'base64'));
    await cmd('browsingContext.setViewport',{context,viewport:{width:390,height:844}});
    await checkComponents('mobile');
    const mobileShot = await cmd('browsingContext.captureScreenshot',{context});fs.writeFileSync(path.join(out,'tariff-mobile.png'),Buffer.from(mobileShot.data,'base64'));
    const report = { firefox: session.capabilities.browserVersion, messages: result.count, scrollWrites: result.scrollWrites, blockedCanvasReproduced: result.tainted, embeddedImages: 2, originalBytes: true, cookieTokenReferrerOmitted: true, htmlAndPrintVerifiedOffline: true, componentChecks, temporaryProfileOnly: true, unidentifiedNeighbours, svgDiagrams: unidentifiedNeighbours ? 1 : 0 };
    fs.writeFileSync(path.join(out, 'result.json'), JSON.stringify(report, null, 2)); console.log(JSON.stringify(report));
  } finally {
    clearTimeout(timer); ws?.close(); proc.kill();
    for (const s of [images, server]) { s.closeAllConnections(); await new Promise(resolve => s.close(resolve)); }
  }
})().catch(error => { console.error(error); process.exitCode = 1; });

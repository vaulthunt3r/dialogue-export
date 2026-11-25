// Production content scripts in an isolated Firefox profile, using local data.
const fs = require('node:fs'), path = require('node:path'), http = require('node:http');
const { spawn } = require('node:child_process');
const { pathToFileURL } = require('node:url');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');
const root = path.join(__dirname, '..'), read = file => fs.readFileSync(path.join(root, file), 'utf8');
(async () => {
  const out = path.resolve(process.argv[2] || 'release/0.5.8/static-card-qa'); fs.mkdirSync(out, { recursive: true });
  const imageGroup = process.argv.includes('--image-group');
  const groupMarker = '\uE200image_group\uE202{"query":["Synthetic gallery"]}\uE201';
  const run = fs.mkdtempSync(path.join(out, 'run-')), profile = path.join(run, 'profile'), extension = path.join(run, 'extension');
  fs.mkdirSync(profile); fs.mkdirSync(extension);
  const id = '12345678-1234-1234-1234-123456789abc', raw = { conversation_id: id, title: 'Direct cards and activity', current_node: 'root', mapping: { root: { id: 'root', parent: null, message: null } } };
  const add = (message) => { raw.mapping[message.id] = { id: message.id, parent: raw.current_node, message }; raw.current_node = message.id; };
  for (let i = 0; i < 40; i++) {
    if (i === 1) {
      add({ id: 'thinking', author: { role: 'assistant' }, status: 'finished_successfully', channel: 'analysis', content: { content_type: 'thoughts', thoughts: [{ summary: 'Comparing plans', content: 'Checking the included data and monthly price.' }] } });
      add({ id: 'working', author: { role: 'assistant' }, status: 'finished_successfully', channel: 'commentary', content: { content_type: 'text', parts: ['Reviewing the saved source.'] } });
    }
    add({ id: `m${i}`, author: { role: i % 2 ? 'assistant' : 'user' }, status: 'finished_successfully', content: { content_type: 'text', parts: [i === 1 ? read('tests/fixtures/static-card.txt') + '\n\n<row><AsyncImage query="Synthetic preview" maxWidth="136px"/><box flex={1}>Saved image and text.</box></row>' : `Message ${i}`] } });
  }
  if (imageGroup) raw.mapping.m1.message.content.parts[0] += `\n\nGallery before\n\n${groupMarker}\n\nGallery after`;
  const requests = [], bytes = fs.readFileSync(path.join(__dirname, 'fixtures/api-color-fixture.png'));
  let finish; const finished = new Promise(resolve => { finish = resolve; });
  const server = http.createServer((req, res) => {
    if (req.url === '/report') { let body = ''; req.on('data', data => { body += data; }); req.on('end', () => { finish(JSON.parse(body)); res.end('ok'); }); return; }
    if (req.url.startsWith('/c/')) { res.setHeader('Content-Type', 'text/html'); res.setHeader('Set-Cookie', 'fixture_session=local; Path=/'); res.end('<!doctype html><title>Local test</title><main style="height:400px;overflow:auto"><div style="height:20000px"></div><div data-chatgpt-selection-message-id="m39">Message 39</div></main>'); return; }
    requests.push({ path: req.url, method: req.method, authorized: req.headers.authorization === 'Bearer SYNTHETIC_TOKEN' });
    res.setHeader('Content-Type', 'application/json');
    if (req.url === '/api/auth/session') res.end(JSON.stringify({ accessToken: 'SYNTHETIC_TOKEN' }));
    else if (req.url === `/backend-api/conversation/${id}`) res.end(JSON.stringify(raw));
    else if (req.url === '/backend-api/fixture.png' || /^\/backend-api\/fixture\.png\?image=\d$/.test(req.url)) { res.setHeader('Content-Type', 'image/png'); res.end(bytes); }
    else { res.writeHead(404); res.end('{}'); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  raw.mapping.m1.message.metadata = { content_references: [{ type: 'image_v2', query: 'Synthetic preview', images: [{ content_url: `${origin}/backend-api/fixture.png` }] }] };
  if (imageGroup) raw.mapping.m1.message.metadata.content_references.push({ type: 'image_group', matched_text: groupMarker, safe_urls: [], alt: '',
    images: Array.from({ length: 6 }, (_, index) => ({ image_search_query: 'Synthetic gallery', image_result: { content_url: `${origin}/backend-api/fixture.png?image=${index}`, title: `Gallery image ${index}` } })) });
  for (const name of ['content', 'shared', 'print', 'popup', 'icons', 'archive', 'background.js']) fs.cpSync(path.join(root, name), path.join(extension, name), { recursive: true });
  fs.writeFileSync(path.join(extension, 'content/chatgpt-api.js'), read('content/chatgpt-api.js').replaceAll('https://chatgpt.com', origin));
  fs.writeFileSync(path.join(extension, 'content/content.js'), read('content/content.js').replace('browser.runtime.onMessage.addListener(request => {', 'window.fixtureCollect=collectComplete;\n  browser.runtime.onMessage.addListener(request => {'));
  const manifest = JSON.parse(read('manifest.json')); manifest.name = 'Local direct-card test'; manifest.host_permissions = ['http://127.0.0.1/*'];
  manifest.content_scripts[0].matches = ['http://127.0.0.1/*']; manifest.content_scripts[0].js = manifest.content_scripts[0].js.filter(file => !['content/panel.js', 'content/history.js'].includes(file));
  manifest.content_scripts[0].js.push('shared/renderers.js', 'runner.js'); manifest.browser_specific_settings.gecko.id = 'local-static-card@example.test';
  fs.writeFileSync(path.join(extension, 'manifest.json'), JSON.stringify(manifest));
  fs.writeFileSync(path.join(extension, 'runner.js'), `(async()=>{try{
    const host=document.querySelector('main');host.scrollTop=host.scrollHeight;const initial=host.scrollTop;
    let scrollWrites=0;const prop=Object.getOwnPropertyDescriptor(Element.prototype,'scrollTop');
    Object.defineProperty(Element.prototype,'scrollTop',{get(){return prop.get.call(this)},set(v){scrollWrites++;prop.set.call(this,v)},configurable:true});window.scrollTo=()=>{scrollWrites++};
    const results=[];let html;
    for(const outputFormat of ['txt','md','json','html','pdf']){
      const data=await fixtureCollect({outputFormat,includeActivity:true,includeLinks:true});
      results.push({format:outputFormat,count:data.messages.length,method:data.collectionMethod,ids:data.messages.map(m=>m.id),activities:data.messages[1].activities.map(a=>a.title),images:data.embeddedImages||0,scrollWrites,positionUnchanged:host.scrollTop===initial,tokenLeaked:JSON.stringify(data).includes('SYNTHETIC_TOKEN')});
      if(outputFormat==='html')html=ChatArchiveRenderers.html({...data,messages:data.messages.slice(0,2)},{includeActivity:true,compactPagination:true});
    }
    await fetch('/report',{method:'POST',body:JSON.stringify({results,html})});
  }catch(error){await fetch('/report',{method:'POST',body:JSON.stringify({error:String(error),stack:error.stack})})}})();`);
  const proc = spawn('C:/Program Files/Mozilla Firefox/firefox.exe', ['--headless', '--no-remote', '--profile', profile, '--remote-debugging-port', '0'], { windowsHide: true });
  let ws, timer;
  try {
    const address = await new Promise((resolve, reject) => {
      const deadline = setTimeout(() => reject(Error('Firefox startup timed out')), 25000); let output = '';
      proc.on('error', error => { clearTimeout(deadline); reject(error); });
      proc.on('exit', code => { clearTimeout(deadline); reject(Error('Firefox startup exit: ' + code)); });
      proc.stderr.on('data', value => { output += value; fs.appendFileSync(path.join(run, 'firefox.log'), value); const match = output.match(/WebDriver BiDi listening on (ws:\/\/\S+)/); if (match) { clearTimeout(deadline); resolve(match[1]); } });
    });
    ws = new WebSocket(address.replace(/\/$/, '') + '/session'); await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
    let seq = 0; const pending = new Map(); ws.onmessage = event => { const message = JSON.parse(event.data); pending.get(message.id)?.(message); };
    const command = (method, params) => new Promise((resolve, reject) => {
      const id = ++seq, deadline = setTimeout(() => { pending.delete(id); reject(Error(method + ' timed out')); }, 25000);
      pending.set(id, message => { clearTimeout(deadline); pending.delete(id); message.type === 'error' ? reject(Error(JSON.stringify(message))) : resolve(message.result); }); ws.send(JSON.stringify({ id, method, params }));
    });
    const session = await command('session.new', { capabilities: { alwaysMatch: {} } });
    await command('webExtension.install', { extensionData: { type: 'path', path: extension } });
    const { context } = await command('browsingContext.create', { type: 'tab' });
    await command('browsingContext.setViewport', { context, viewport: { width: 1100, height: 1000 } });
    await command('browsingContext.navigate', { context, url: `${origin}/c/${id}`, wait: 'complete' });
    const result = await Promise.race([finished, new Promise((_, reject) => { timer = setTimeout(() => reject(Error('Fixture timed out')), 40000); })]);
    assert.equal(result.error, undefined, result.stack || result.error);
    for (const item of result.results) {
      assert.equal(item.count, 40); assert.equal(item.method, 'chatgpt-api'); assert.equal(item.scrollWrites, 0); assert.equal(item.positionUnchanged, true); assert.equal(item.tokenLeaked, false);
      assert.deepEqual(item.ids, Array.from({ length: 40 }, (_, i) => `m${i}`)); assert.deepEqual(item.activities, ['Comparing plans', 'Working']);
      assert.equal(item.images, ['html', 'pdf'].includes(item.format) ? imageGroup ? 7 : 1 : 0);
    }
    assert.equal(requests.filter(r => r.path === '/backend-api/fixture.png').length, 2);
    if (imageGroup) for (let index = 0; index < 6; index++) assert.equal(requests.filter(r => r.path === `/backend-api/fixture.png?image=${index}`).length, 2);
    assert.ok(requests.filter(r => r.path.startsWith('/backend-api/')).every(r => r.authorized && r.method === 'GET'));
    assert.doesNotMatch(result.html, /SYNTHETIC_TOKEN|\{#each|&lt;card|\u0001CAE/);
    fs.writeFileSync(path.join(out, 'export.html'), result.html);
    const print = read('print/print.html').replace('<link rel="stylesheet" href="print.css">', `<style>${read('print/print.css')}</style>`)
      .replace('<script src="print.js"></script>', `<script>window.browser={runtime:{sendMessage:async()=>(${JSON.stringify({ ok: true, content: result.html, compactPagination: true, strictImages: true, filename: 'static-card.pdf' })})}};</script><script>${read('print/print.js')}</script>`);
    fs.writeFileSync(path.join(out, 'print.html'), print);
    const files = ['export', 'print'];
    if (process.argv[3] && !process.argv[3].startsWith('--')) {
      const source = fs.readFileSync(process.argv[3], 'utf8'); const answer = source.split('## ChatGPT')[1]; assert.ok(answer, 'sample has an assistant answer');
      const d = new JSDOM('', { url: `https://chatgpt.com/c/${id}`, runScripts: 'outside-only' });
      try {
        for (const file of ['shared/vendor/markdown-it.js', 'content/components.js', 'content/markdown.js', 'content/chatgpt-api.js', 'shared/renderers.js']) d.window.eval(read(file));
        const sample = { conversation_id: id, title: 'Проверка карточки тарифов', current_node: 'answer', mapping: { answer: { id: 'answer', parent: null, message: { id: 'answer', author: { role: 'assistant' }, status: 'finished_successfully', content: { content_type: 'text', parts: [answer] } } } } };
        const data = d.window.ChatArchiveApi.normalize(sample, `https://chatgpt.com/c/${id}`, { outputFormat: 'html' });
        fs.writeFileSync(path.join(out, 'sample.html'), d.window.ChatArchiveRenderers.html(data, { compactPagination: true })); files.push('sample');
      } finally { d.window.close(); }
    }
    server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
    const evaluate = async expression => { const result = await command('script.evaluate', { target: { context }, expression, awaitPromise: true }); if (result.type === 'exception') throw Error(JSON.stringify(result)); return result.result.value; };
    const geometry = [];
    for (const name of files) {
      await command('browsingContext.navigate', { context, url: pathToFileURL(path.join(out, `${name}.html`)).href + (name === 'print' ? '?id=fixture' : ''), wait: 'complete' });
      await evaluate('(async()=>{for(let i=0;!document.querySelector("[data-d-component]")&&i<50;i++)await new Promise(r=>setTimeout(r,20));await Promise.all([...document.images].map(i=>i.decode()));return true})()');
      if (imageGroup) {
        const images = JSON.parse(await evaluate('JSON.stringify([...document.images].map(image=>({src:image.src,alt:image.alt,loaded:image.complete&&image.naturalWidth>0})))'));
        assert.equal(images.length, 7); assert.ok(images.every(image => image.loaded));
        assert.deepEqual(images.slice(1).map(image => image.alt), Array.from({ length: 6 }, (_, i) => `Gallery image ${i}`));
        for (const image of images) assert.deepEqual(Buffer.from(image.src.split(',')[1], 'base64'), bytes);
      }
      const values = JSON.parse(await evaluate(`JSON.stringify([...document.querySelectorAll('[data-d-component="box"]')].filter(el=>el.style.backgroundColor==='rgb(22, 163, 74)').map(el=>({ratio:el.getBoundingClientRect().width/el.parentElement.getBoundingClientRect().width,height:el.getBoundingClientRect().height,track:el.parentElement.getBoundingClientRect().height})))`));
      assert.equal(values.length, 4); values.forEach((value, i) => { assert.ok(Math.abs(value.ratio - [.1, .3, .5, 1][i]) < .001, `${name} bar ${i}`); assert.equal(value.height, 12); assert.equal(value.track, 12); });
      assert.equal(await evaluate('document.documentElement.scrollWidth<=innerWidth'), true);
      if (name === 'print') assert.equal(await evaluate('document.querySelector("#printButton").disabled'), false);
      geometry.push({ page: name, values });
      const shot = await command('browsingContext.captureScreenshot', { context }); fs.writeFileSync(path.join(out, `${name}.png`), Buffer.from(shot.data, 'base64'));
      const pdf = await command('browsingContext.print', { context, background: false }); fs.writeFileSync(path.join(out, `${name}.pdf`), Buffer.from(pdf.data, 'base64'));
    }
    await command('browsingContext.setViewport', { context, viewport: { width: 390, height: 844 } });
    assert.equal(await evaluate('document.documentElement.scrollWidth<=innerWidth'), true);
    const mobile = await command('browsingContext.captureScreenshot', { context }); fs.writeFileSync(path.join(out, 'mobile.png'), Buffer.from(mobile.data, 'base64'));
    const summary = { firefox: session.capabilities.browserVersion, formats: result.results, geometry, offlineImagesVerified: true, imageGroupImages: imageGroup ? 6 : 0, sampleRendered: files.includes('sample'), temporaryProfileOnly: true };
    fs.writeFileSync(path.join(out, 'result.json'), JSON.stringify(summary, null, 2)); console.log(JSON.stringify({ firefox: summary.firefox, formats: result.results.map(r => ({ format: r.format, messages: r.count, scrollWrites: r.scrollWrites })), geometry, sampleRendered: summary.sampleRendered }));
  } finally { clearTimeout(timer); ws?.close(); proc.kill(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error); process.exitCode = 1; });

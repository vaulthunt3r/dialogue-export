// Exercise production Stop/error recovery, IndexedDB staging and file handoff
// in an isolated Firefox profile. All conversation and image endpoints are local.
const fs = require('node:fs'), path = require('node:path'), http = require('node:http');
const { spawn } = require('node:child_process'), { createHash } = require('node:crypto');
const assert = require('node:assert/strict');
(async () => {
  const root = path.join(__dirname, '..'), out = path.resolve(process.argv[2]);
  fs.mkdirSync(out, { recursive: true });
  const run = fs.mkdtempSync(path.join(out, 'run-')), profile = path.join(run, 'profile'), extension = path.join(run, 'extension'), downloads = path.join(run, 'downloads');
  for (const dir of [profile, extension, downloads]) fs.mkdirSync(dir);
  fs.writeFileSync(path.join(profile, 'user.js'), `user_pref("browser.download.folderList",2);\nuser_pref("browser.download.dir",${JSON.stringify(downloads)});\nuser_pref("browser.download.useDownloadDir",true);\nuser_pref("browser.download.alwaysOpenPanel",false);`);
  const bytes = Buffer.alloc(4 * 1024 * 1024); fs.readFileSync(path.join(__dirname, 'fixtures/api-color-fixture.png')).copy(bytes);
  const id = '12345678-1234-1234-1234-123456789abc';
  const raw = { conversation_id: id, title: 'Partial recovery fixture', current_node: 'm3', mapping: { root: { id: 'root', parent: null, message: null } } };
  for (let i = 0; i < 4; i++) raw.mapping[`m${i}`] = { id: `m${i}`, parent: i ? `m${i - 1}` : 'root', message: {
    id: `m${i}`, author: { role: i % 2 ? 'assistant' : 'user' }, status: 'finished_successfully',
    content: { content_type: 'multimodal_text', parts: [`Message ${i}`, { content_type: 'image_asset_pointer', asset_pointer: `sediment://file_${i}` }] } } };
  let mode = 'error', waitingImage = false, reportResolve, eventResolve;
  const events = [], reportPromise = new Promise(resolve => { reportResolve = resolve; });
  const nextEvent = () => events.length ? Promise.resolve(events.shift()) : new Promise(resolve => { eventResolve = resolve; });
  const server = http.createServer((req, res) => {
    if (req.url === '/report' || req.url === '/decision') {
      let body = ''; req.on('data', chunk => { body += chunk; }); req.on('end', () => {
        const data = JSON.parse(body);
        if (req.url === '/report') { reportResolve(data); res.end('ok'); }
        else { const event = { data, res }; if (eventResolve) { const resolve = eventResolve; eventResolve = null; resolve(event); } else events.push(event); }
      }); return;
    }
    res.setHeader('Content-Type', 'application/json');
    if (req.url.startsWith('/scenario?')) { mode = new URL(req.url, 'http://fixture').searchParams.get('mode'); waitingImage = false; res.end('{}'); return; }
    if (req.url === '/probe') { res.end(JSON.stringify({ waitingImage })); return; }
    if (req.url.startsWith('/c/')) { res.setHeader('Content-Type', 'text/html'); res.end('<!doctype html><title>Recovery fixture</title><main style="width:600px;margin:40px auto"><h1>Partial export check</h1><p>Only the final message is mounted.</p><div data-chatgpt-selection-message-id="m3">Message 3</div></main>'); return; }
    if (req.url === '/api/auth/session') res.end(JSON.stringify({ accessToken: 'FIXTURE_SECRET' }));
    else if (req.url === `/backend-api/conversation/${id}`) res.end(JSON.stringify(raw));
    else if (/\/attachment\/file_[0-3]\/download$/.test(req.url)) res.end(JSON.stringify({ download_url: req.url.replace('/download', '/image') }));
    else if (req.url.endsWith('/image')) {
      if (req.url.includes('/file_3/')) {
        waitingImage = true;
        if (mode === 'stop') { req.on('close', () => res.destroy()); return; }
        res.writeHead(503); res.end('Synthetic image failure'); return;
      }
      res.setHeader('Content-Type', 'image/png'); res.end(bytes);
    } else { res.writeHead(404); res.end('{}'); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  for (const item of ['content', 'shared', 'print', 'popup', 'icons', 'archive', 'background.js']) fs.cpSync(path.join(root, item), path.join(extension, item), { recursive: true });
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json')));
  manifest.name = 'Partial recovery fixture'; manifest.browser_specific_settings.gecko.id = 'partial-fixture@example.test';
  manifest.host_permissions = ['http://127.0.0.1/*']; manifest.content_scripts[0].matches = ['http://127.0.0.1/*'];
  manifest.content_scripts[0].js = manifest.content_scripts[0].js.filter(file => file !== 'content/history.js');
  manifest.content_scripts[0].js.push('fixture-runner.js');
  fs.writeFileSync(path.join(extension, 'manifest.json'), JSON.stringify(manifest));
  for (const file of ['content/chatgpt-api.js', 'content/extract.js']) {
    const dest = path.join(extension, file); fs.writeFileSync(dest, fs.readFileSync(dest, 'utf8').replaceAll('https://chatgpt.com', origin));
  }
  const background = path.join(extension, 'background.js');
  fs.writeFileSync(background, fs.readFileSync(background, 'utf8').replace('browser.runtime.onMessage.addListener(async (request, sender = {}) => {',
    `browser.runtime.onMessage.addListener(async (request, sender = {}) => {
      if(request.type==='FIXTURE_SEND') return browser.tabs.sendMessage(sender.tab.id,request.payload);
      if(request.type==='FIXTURE_JOBS') return (await ChatArchiveParts.allJobs()).map(({count,messages,state,saved})=>({count,messages,state,saved}));`));
  fs.writeFileSync(path.join(extension, 'fixture-runner.js'), `(async()=>{try{
    const send=payload=>browser.runtime.sendMessage({type:'FIXTURE_SEND',payload});
    const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
    let scrollWrites=0;const prop=Object.getOwnPropertyDescriptor(Element.prototype,'scrollTop');
    Object.defineProperty(Element.prototype,'scrollTop',{get(){return prop.get.call(this)},set(v){scrollWrites++;prop.set.call(this,v)},configurable:true});window.scrollTo=()=>{scrollWrites++};
    const results=[];
    for(const [mode,action,format] of [['stop','save','html'],['error','save','html'],['error','discard','html'],['error','save','pdf']]){
      await fetch('/scenario?mode='+mode);
      const name=mode+'-'+action+'-'+format;
      await send({type:'BEGIN_EXPORT',job:{format,filename:name+'.'+format,options:{includeTitle:false,compactPagination:true}}});
      if(mode==='stop'){
        for(let i=0;i<400;i++){if((await(await fetch('/probe')).json()).waitingImage)break;await sleep(100);}
        document.querySelector('.chat-archive-dismiss').click();
      }
      let ping;
      for(let i=0;i<400;i++){ping=await send({type:'PING'});if(ping.exportStatus?.state==='decision'||!ping.activeExport)break;await sleep(100);}
      if(ping.exportStatus.state!=='decision')throw Error('No decision: '+ping.exportStatus.label);
      const jobs=await browser.runtime.sendMessage({type:'FIXTURE_JOBS'});
      await fetch('/decision',{method:'POST',body:JSON.stringify({name,mode,action,format,status:ping.exportStatus,jobs,scrollWrites})});
      document.querySelector('.chat-archive-stop-choice [data-action="'+action+'"]').click();
      for(let i=0;i<400;i++){await sleep(100);ping=await send({type:'PING'});if(!ping.activeExport)break;}
      if(ping.activeExport)throw Error('Choice did not finish');
      results.push({name,status:ping.exportStatus, jobs:await browser.runtime.sendMessage({type:'FIXTURE_JOBS'}),scrollWrites});
    }
    await fetch('/report',{method:'POST',body:JSON.stringify({results})});
  }catch(error){await fetch('/report',{method:'POST',body:JSON.stringify({error:String(error),stack:error.stack})});}})();`);
  const proc = spawn('C:/Program Files/Mozilla Firefox/firefox.exe', ['--headless', '--no-remote', '--profile', profile, '--remote-debugging-port', '0'], { windowsHide: true, env: { ...process.env, MOZ_REMOTE_ALLOW_SYSTEM_ACCESS: '1' } });
  let ws, timer;
  try {
    const address = await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(Error('Firefox startup timed out')), 25000); let log = '';
      proc.on('error', error => { clearTimeout(timeout); reject(error); });
      proc.stderr.on('data', chunk => { log += chunk; const match = log.match(/WebDriver BiDi listening on (ws:\/\/\S+)/); if (match) { clearTimeout(timeout); resolve(match[1]); } });
    });
    ws = new WebSocket(address.replace(/\/$/, '') + '/session'); await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
    let next = 0; const pending = new Map(); ws.onmessage = event => { const result = JSON.parse(event.data); pending.get(result.id)?.(result); };
    const command = (method, params) => new Promise((resolve, reject) => {
      const id = ++next, deadline = setTimeout(() => { pending.delete(id); reject(Error(method + ' timed out')); }, 25000);
      pending.set(id, result => { clearTimeout(deadline); pending.delete(id); result.type === 'error' ? reject(Error(JSON.stringify(result))) : resolve(result.result); });
      ws.send(JSON.stringify({ id, method, params }));
    });
    const session = await command('session.new', { capabilities: { alwaysMatch: {} } });
    await command('webExtension.install', { extensionData: { type: 'path', path: extension } });
    const { context } = await command('browsingContext.create', { type: 'tab' });
    await command('browsingContext.setViewport', { context, viewport: { width: 1400, height: 1000 } });
    await command('browsingContext.navigate', { context, url: `${origin}/c/${id}`, wait: 'complete' });
    const decisions = [];
    for (let index = 0; index < 4; index++) {
      const event = await Promise.race([nextEvent(), reportPromise.then(report => { throw Error(report.stack || report.error || 'Early completion'); }), new Promise((_, reject) => { timer = setTimeout(() => reject(Error('Decision timed out')), 60000); })]);
      clearTimeout(timer);
      const { data, res } = event; decisions.push(data);
      assert.equal(data.status.processed, 3); assert.equal(data.status.canSaveCollected, true); assert.equal(data.scrollWrites, 0);
      assert.deepEqual(data.jobs.map(job => [job.count, job.messages, job.state, job.saved]), [[2, 3, 'preparing', 0]]);
      if (data.mode === 'error') assert.equal(data.status.mediaDiagnostic.download.httpStatus, 503);
      const shot = await command('browsingContext.captureScreenshot', { context }); fs.writeFileSync(path.join(out, `${data.name}-choice.png`), Buffer.from(shot.data, 'base64'));
      res.end('ok');
    }
    const report = await Promise.race([reportPromise, new Promise((_, reject) => { timer = setTimeout(() => reject(Error('Recovery timed out')), 60000); })]);
    clearTimeout(timer); assert.equal(report.error, undefined, report.stack || report.error);
    for (const result of report.results) {
      assert.equal(result.scrollWrites, 0);
      if (result.name.includes('discard')) { assert.equal(result.status.state, 'error'); assert.match(result.status.label, /discarded/); }
      else { assert.equal(result.status.state, 'done'); assert.match(result.status.label, /Partial export/); }
      assert.equal(result.jobs.length, result.name.endsWith('pdf') ? 1 : 0);
    }
    const files = fs.readdirSync(downloads).filter(file => file.endsWith('.html')).sort(); assert.equal(files.length, 4);
    let imageCount = 0; const hash = createHash('sha256').update(bytes).digest('hex');
    for (const file of files) {
      assert.match(file, /partial-part-00[12]-of-002\.html$/); assert.doesNotMatch(file, /discard/);
      const html = fs.readFileSync(path.join(downloads, file), 'utf8');
      assert.match(html, /Partial export/); assert.match(html, /3 of 4 complete messages/); assert.doesNotMatch(html, /Message 3|FIXTURE_SECRET|export-image-placeholder/);
      for (const match of html.matchAll(/src="data:image\/png;base64,([^"]+)"/g)) { assert.equal(createHash('sha256').update(Buffer.from(match[1], 'base64')).digest('hex'), hash); imageCount++; }
      fs.copyFileSync(path.join(downloads, file), path.join(out, file));
    }
    assert.equal(imageCount, 6);
    const tree = await command('browsingContext.getTree', {}), print = tree.contexts.find(tab => tab.url.includes('/print/print.html?parts=')); assert.ok(print);
    const evaluate = async expression => { const result = await command('script.evaluate', { target: { context: print.context }, expression, awaitPromise: true }); if (result.type === 'exception') throw Error(JSON.stringify(result)); return result.result.value; };
    for (let part = 1; part <= 2; part++) {
      assert.equal(await evaluate(`(async()=>{for(let i=0;i<100;i++){if(!document.querySelector('#printButton').disabled&&document.querySelector('#partStatus').textContent.startsWith('Part ${part} '))return true;await new Promise(r=>setTimeout(r,50));}return false})()`), true);
      assert.equal(await evaluate('document.images.length'), part === 1 ? 2 : 1);
      assert.match(await evaluate('document.querySelector(".export-partial-note").textContent'), /3 of 4/);
      assert.equal(await evaluate('Promise.all([...document.images].map(image=>image.decode())).then(()=>true)'), true);
      const shot = await command('browsingContext.captureScreenshot', { context: print.context }); fs.writeFileSync(path.join(out, `partial-print-${part}.png`), Buffer.from(shot.data, 'base64'));
      if (part === 1) await evaluate('document.querySelector("#nextPart").click();true');
    }
    const result = { firefox: session.capabilities.browserVersion, decisions, results: report.results, files, embeddedHtmlImages: imageCount, originalImageBytesMatch: true, partialPdfParts: 2, scrollWrites: 0, temporaryProfileOnly: true };
    fs.writeFileSync(path.join(out, 'result.json'), JSON.stringify(result, null, 2)); console.log(JSON.stringify({ firefox: result.firefox, decisions: decisions.length, files, partialPdfParts: 2, scrollWrites: 0 }));
  } finally { clearTimeout(timer); ws?.close(); proc.kill(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error); process.exitCode = 1; });

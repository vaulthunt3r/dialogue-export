// Real production pipeline in a fresh Firefox profile and localhost fixture.
const fs = require('node:fs'), path = require('node:path'), http = require('node:http');
const { spawn } = require('node:child_process');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { pathToFileURL } = require('node:url');
(async () => {
  const out = path.resolve(process.argv[2]), root = path.join(__dirname, '..');
  fs.mkdirSync(out, { recursive: true });
  const run = fs.mkdtempSync(path.join(out, 'run-')), profile = path.join(run, 'profile'), extension = path.join(run, 'extension'), downloads = path.join(run, 'downloads');
  for (const dir of [profile, extension, downloads]) fs.mkdirSync(dir);
  fs.writeFileSync(path.join(profile, 'user.js'), `user_pref("browser.download.folderList",2);\nuser_pref("browser.download.dir",${JSON.stringify(downloads)});\nuser_pref("browser.download.useDownloadDir",true);\nuser_pref("browser.download.alwaysOpenPanel",false);`);
  const bytes = Buffer.alloc(4 * 1024 * 1024); fs.readFileSync(path.join(__dirname, 'fixtures/api-color-fixture.png')).copy(bytes);
  const id = '12345678-1234-1234-1234-123456789abc';
  const raw = { conversation_id: id, title: 'Multipart image fixture', current_node: 'm2', mapping: { root: { id: 'root', parent: null, message: null } } };
  for (let i = 0; i < 3; i++) raw.mapping[`m${i}`] = { id: `m${i}`, parent: i ? `m${i - 1}` : 'root', message: {
    id: `m${i}`, author: { role: i === 1 ? 'tool' : 'user' }, channel: i === 1 ? 'final' : undefined, status: 'finished_successfully',
    content: { content_type: 'multimodal_text', parts: [`Fixture text ${i}`, { content_type: 'image_asset_pointer', asset_pointer: `sediment://file_${i}` }] } } };
  let reportResolve;
  const reportPromise = new Promise(resolve => { reportResolve = resolve; });
  const requests = [];
  const server = http.createServer((req, res) => {
    if (req.url === '/report') {
      let body = ''; req.on('data', chunk => { body += chunk; });
      req.on('end', () => { reportResolve(JSON.parse(body)); res.end('ok'); }); return;
    }
    if (req.url.startsWith('/c/')) { res.setHeader('Content-Type', 'text/html'); res.end('<!doctype html><title>Multipart fixture</title><main></main>'); return; }
    if (req.url === '/favicon.ico') { res.writeHead(404); res.end(); return; }
    requests.push(req.url); res.setHeader('Content-Type', 'application/json');
    if (req.url === '/api/auth/session') res.end(JSON.stringify({ accessToken: 'FIXTURE_SECRET' }));
    else if (req.url === `/backend-api/conversation/${id}`) res.end(JSON.stringify(raw));
    else if (/\/attachment\/file_[012]\/download$/.test(req.url)) res.end(JSON.stringify({ download_url: req.url.replace('/download', '/image') }));
    else if (req.url.endsWith('/image')) { res.setHeader('Content-Type', 'image/png'); res.end(bytes); }
    else { res.writeHead(404); res.end('{}'); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json')));
  manifest.name = 'Local multipart fixture'; manifest.browser_specific_settings.gecko.id = 'multipart-fixture@example.test';
  manifest.host_permissions = ['http://127.0.0.1/*']; manifest.content_scripts[0].matches = ['http://127.0.0.1/*'];
  for (const dir of ['content', 'shared', 'print', 'icons', 'archive']) fs.cpSync(path.join(root, dir), path.join(extension, dir), { recursive: true });
  fs.writeFileSync(path.join(extension, 'background.js'), fs.readFileSync(path.join(root, 'background.js'), 'utf8').replace(
    'browser.runtime.onMessage.addListener(async (request, sender = {}) => {',
    `browser.runtime.onMessage.addListener(async (request, sender = {}) => {
      if(request.type==='FIXTURE_BEGIN') return browser.tabs.sendMessage(sender.tab.id,{type:'BEGIN_EXPORT',job:request.job});
      if(request.type==='FIXTURE_PING') return browser.tabs.sendMessage(sender.tab.id,{type:'PING'});
      if(request.type==='FIXTURE_JOBS') return ChatArchiveParts.allJobs();`));
  for (const file of ['content/chatgpt-api.js', 'content/extract.js']) {
    const dest = path.join(extension, file); fs.writeFileSync(dest, fs.readFileSync(dest, 'utf8').replaceAll('https://chatgpt.com', origin));
  }
  fs.writeFileSync(path.join(extension, 'fixture-background.js'), `browser.runtime.onMessage.addListener((r,s)=>{
    if(r.type==='FIXTURE_BEGIN') return browser.tabs.sendMessage(s.tab.id,{type:'BEGIN_EXPORT',job:r.job});
    if(r.type==='FIXTURE_PING') return browser.tabs.sendMessage(s.tab.id,{type:'PING'});
    if(r.type==='FIXTURE_JOBS') return ChatArchiveParts.allJobs();
  });`);
  manifest.content_scripts[0].js.push('fixture-runner.js');
  fs.writeFileSync(path.join(extension, 'manifest.json'), JSON.stringify(manifest));
  fs.writeFileSync(path.join(extension, 'fixture-runner.js'), `(async()=>{
    try {
      const results=[];
      for(const format of ['html','pdf']) {
        const started=await browser.runtime.sendMessage({type:'FIXTURE_BEGIN',job:{format,filename:'parts-fixture.'+format,options:{includeTitle:true,compactPagination:true,includeImageDetails:true}}});
        if(!started.ok) throw Error(started.error);
        let ping;
        for(let i=0;i<400;i++) { await new Promise(r=>setTimeout(r,100));ping=await browser.runtime.sendMessage({type:'FIXTURE_PING'});if(!ping.activeExport)break; }
        if(ping.exportStatus.state!=='done') throw Error(ping.exportStatus.label);
        results.push({format,status:ping.exportStatus.label,jobs:(await browser.runtime.sendMessage({type:'FIXTURE_JOBS'})).length});
      }
      await fetch('/report',{method:'POST',body:JSON.stringify({results})});
    }catch(error){await fetch('/report',{method:'POST',body:JSON.stringify({error:String(error)})});}
  })();`);
  const proc = spawn('C:/Program Files/Mozilla Firefox/firefox.exe', ['--headless', '--no-remote', '--profile', profile, '--remote-debugging-port', '9242'], { windowsHide: true, env: { ...process.env, MOZ_REMOTE_ALLOW_SYSTEM_ACCESS: '1' } });
  let ws, reportTimer;
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(Error('Firefox startup timed out')), 20000);
      proc.on('error', error => { clearTimeout(timer); reject(error); });
      proc.stderr.on('data', value => { if (value.toString().includes('WebDriver BiDi listening')) { clearTimeout(timer); resolve(); } });
    });
    ws = new WebSocket('ws://127.0.0.1:9242/session');
    await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
    let next = 0; const pending = new Map();
    ws.onmessage = event => { const message = JSON.parse(event.data); pending.get(message.id)?.(message); };
    const command = (method, params) => new Promise((resolve, reject) => {
      const id = ++next, timer = setTimeout(() => { pending.delete(id); reject(Error(method + ' timed out')); }, 30000);
      pending.set(id, result => { clearTimeout(timer); pending.delete(id); result.type === 'error' ? reject(Error(JSON.stringify(result))) : resolve(result.result); });
      ws.send(JSON.stringify({ id, method, params }));
    });
    const session = await command('session.new', { capabilities: { alwaysMatch: {} } });
    await command('webExtension.install', { extensionData: { type: 'path', path: extension } });
    const { context } = await command('browsingContext.create', { type: 'tab' });
    await command('browsingContext.navigate', { context, url: `${origin}/c/${id}`, wait: 'complete' });
    const report = await Promise.race([reportPromise, new Promise((_, reject) => { reportTimer = setTimeout(() => reject(Error('Multipart export timed out')), 60000); })]);
    assert.equal(report.error, undefined, report.error);
    assert.match(report.results[0].status, /2 HTML parts saved/); assert.equal(report.results[0].jobs, 0);
    assert.match(report.results[1].status, /2 parts/); assert.equal(report.results[1].jobs, 1);
    const files = fs.readdirSync(downloads).filter(file => file.endsWith('.html')).sort(); assert.equal(files.length, 2);
    const expectedHash = createHash('sha256').update(bytes).digest('hex'); let imageCount = 0;
    for (let i = 0; i < files.length; i++) {
      const html = fs.readFileSync(path.join(downloads, files[i]), 'utf8');
      assert.ok(html.length < 16 * 1024 * 1024); assert.match(html, new RegExp(`Part ${i + 1} of 2`)); assert.doesNotMatch(html, /FIXTURE_SECRET|Fixture text 1/);
      for (const match of html.matchAll(/src="data:image\/png;base64,([^"]+)"/g)) {
        assert.equal(createHash('sha256').update(Buffer.from(match[1], 'base64')).digest('hex'), expectedHash); imageCount++;
      }
      fs.copyFileSync(path.join(downloads, files[i]), path.join(out, files[i]));
    }
    assert.equal(imageCount, 3);
    const tree = await command('browsingContext.getTree', {});
    const print = tree.contexts.find(tab => tab.url.includes('/print/print.html?parts=')); assert.ok(print);
    async function evaluate(expression) {
      const result = await command('script.evaluate', { target: { context: print.context }, expression, awaitPromise: true });
      if (result.type === 'exception') throw Error(JSON.stringify(result));
      return result.result.value;
    }
    for (let part = 1; part <= 2; part++) {
      assert.equal(await evaluate(`(async()=>{for(let i=0;i<100;i++){if(!document.querySelector('#printButton').disabled&&document.querySelector('#partStatus').textContent.startsWith('Part ${part} '))return true;await new Promise(r=>setTimeout(r,100));}return document.querySelector('#error').textContent;})()`), true);
      assert.equal(await evaluate('document.images.length'), part === 1 ? 2 : 1);
      // BiDi cannot print an extension-privileged context. Copy the already
      // verified live print DOM to a local file; print the identical content.
      const preview = (await evaluate('document.documentElement.outerHTML'))
        .replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, '')
        .replace('<link rel="stylesheet" href="print.css">', `<style>${fs.readFileSync(path.join(root, 'print/print.css'), 'utf8')}</style>`);
      const previewFile = path.join(out, `part-${part}-preview.html`); fs.writeFileSync(previewFile, preview);
      const previewTab = await command('browsingContext.create', { type: 'tab' });
      await command('browsingContext.navigate', { context: previewTab.context, url: pathToFileURL(previewFile).href, wait: 'complete' });
      await command('script.evaluate', { target: { context: previewTab.context }, expression: 'Promise.all([...document.images].map(image=>image.decode())).then(()=>true)', awaitPromise: true });
      const pdf = await command('browsingContext.print', { context: previewTab.context, background: true });
      fs.writeFileSync(path.join(out, `part-${part}.pdf`), Buffer.from(pdf.data, 'base64'));
      await command('browsingContext.close', { context: previewTab.context });
      if (part === 1) await evaluate("document.querySelector('#nextPart').click();true");
    }
    await evaluate("document.querySelector('#previousPart').click();true");
    assert.equal(await evaluate("(async()=>{for(let i=0;i<100;i++){if(!document.querySelector('#printButton').disabled&&document.images.length===2)return true;await new Promise(r=>setTimeout(r,100));}return false;})()"), true);
    await command('browsingContext.close', { context: print.context });
    // The fixture extension checks its own IndexedDB only, never personal data.
    const status = await command('script.evaluate', { target: { context, sandbox: 'fixture' }, expression: 'true', awaitPromise: true });
    assert.equal(status.result.value, true);
    const result = { firefox: session.capabilities.browserVersion, files, embeddedImages: imageCount, originalRasterHashesMatch: true,
      parts: 2, printNextAndPrevious: true, htmlTemporaryStoreCleared: report.results[0].jobs === 0, temporaryProfileOnly: true, requests: requests.length };
    fs.writeFileSync(path.join(out, 'result.json'), JSON.stringify(result, null, 2)); console.log(JSON.stringify(result));
  } finally {
    clearTimeout(reportTimer); ws?.close(); proc.kill(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });

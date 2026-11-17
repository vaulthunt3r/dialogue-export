// Production extension against a synthetic localhost account; never a personal profile.
const fs = require('node:fs'), path = require('node:path'), http = require('node:http');
const { spawn } = require('node:child_process');
const assert = require('node:assert/strict');
(async () => {
  const root = path.resolve(__dirname, '..'), out = path.resolve(process.argv[2]); fs.mkdirSync(out, { recursive: true });
  const run = fs.mkdtempSync(path.join(out, 'run-')), profile = path.join(run, 'profile'), extension = path.join(run, 'extension'), downloads = path.join(run, 'downloads');
  for (const dir of [profile, extension, downloads]) fs.mkdirSync(dir);
  const id = n => `12345678-1234-1234-1234-${String(n).padStart(12, '0')}`;
  const requests = [], formats = [], token = 'SYNTHETIC_PRIVATE_TOKEN';
  const archiveFailure = process.argv.includes('--archive-failure');
  const archiveUi = process.argv.includes('--archive-ui') || archiveFailure;
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost'); res.setHeader('Content-Type', 'application/json');
    if (url.pathname.startsWith('/c/')) {
      res.setHeader('Content-Type', 'text/html'); res.setHeader('Set-Cookie', 'fixture_session=local; HttpOnly; SameSite=Strict; Path=/');
      res.end('<!doctype html><title>Synthetic chat</title><style>body{font:18px Arial}main{margin:100px auto;width:750px}article{margin:30px}</style><main><article data-testid="conversation-turn-0" data-message-author-role="user"><p>Local fixture question</p></article><article data-testid="conversation-turn-1" data-message-author-role="assistant"><p>Local fixture answer</p></article></main>'); return;
    }
    if (url.pathname === '/favicon.ico') { res.writeHead(404); res.end('{}'); return; }
    requests.push({ path: req.url, method: req.method, authorized: req.headers.authorization === `Bearer ${token}` });
    if (req.headers.cookie !== 'fixture_session=local') { res.writeHead(401); res.end('{}'); return; }
    if (url.pathname === '/api/auth/session') { res.end(JSON.stringify({ accessToken: token })); return; }
    if (req.headers.authorization !== `Bearer ${token}`) { res.writeHead(403); res.end('{}'); return; }
    if (url.pathname === '/backend-api/conversations') {
      const archived = url.searchParams.get('is_archived') === 'true', offset = Number(url.searchParams.get('offset'));
      const all = archived ? archiveUi ? [104] : [104, 105] : Array.from({ length: archiveUi ? 41 : 103 }, (_, i) => i + 1);
      res.end(JSON.stringify({ offset, total: all.length, items: all.slice(offset, offset + 100).map(n => ({ id: id(n), title: n === 1 ? 'Привет <script>#%' : 'Chat ' + n })) })); return;
    }
    if (url.pathname.startsWith('/backend-api/conversation/')) {
      const chat = url.pathname.split('/').at(-1); if (chat === id(102)) { res.writeHead(404); res.end('{}'); return; }
      if (archiveFailure && chat === id(40)) { res.writeHead(502); res.end('{}'); return; }
      const text = archiveFailure && [id(30), id(31)].includes(chat) ? '\uE200unsupported\uE201' : '# Привет\n\n```python\n    print("hello")\n```\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n\n' + ('Text for ' + chat + ' keeps UTF-8 and message ordering.\n').repeat(archiveFailure ? 1 : 280);
      const response = JSON.stringify({ conversation_id: chat, title: 'Chat ' + chat, current_node: 'a', mapping: {
        root: { id: 'root', parent: null, message: null },
        u: { id: 'u', parent: 'root', message: { id: 'u', author: { role: 'user' }, status: 'finished_successfully', content: { content_type: 'text', parts: ['Question ' + chat] } } },
        a: { id: 'a', parent: 'u', message: { id: 'a', author: { role: 'assistant' }, status: archiveFailure && chat === id(26) ? 'in_progress' : 'finished_successfully', content: { content_type: 'text', parts: [text] } } },
        hidden: { id: 'hidden', parent: 'u', message: { id: 'hidden', author: { role: 'assistant' }, channel: 'analysis', content: { content_type: 'text', parts: ['PRIVATE_HIDDEN_BRANCH'] } } }
      } });
      if (archiveUi && !archiveFailure) setTimeout(() => res.end(response), 750); else res.end(response); return;
    }
    res.writeHead(404); res.end('{}');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json')));
  manifest.browser_specific_settings.gecko.id = 'archive-fixture@example.test'; manifest.host_permissions = ['http://127.0.0.1/*'];
  manifest.content_scripts[0].matches = ['http://127.0.0.1/*']; manifest.web_accessible_resources[0].matches = ['http://127.0.0.1/*'];
  for (const name of ['content', 'shared', 'print', 'popup', 'icons', 'archive', 'background.js']) fs.cpSync(path.join(root, name), path.join(extension, name), { recursive: true });
  for (const name of ['content/history.js', 'content/chatgpt-api.js', 'content/panel.js', 'archive/background.js']) {
    const file = path.join(extension, name); let text = fs.readFileSync(file, 'utf8').replaceAll('https://chatgpt.com', origin);
    // Lower only the ZIP budget to exercise multipart with small synthetic fixtures.
    if (name === 'archive/background.js') text = text.replace('32 * 1024 * 1024, RESERVE_BYTES = 2 * 1024 * 1024', '65536, RESERVE_BYTES = 8192');
    fs.writeFileSync(file, text);
  }
  fs.writeFileSync(path.join(extension, 'manifest.json'), JSON.stringify(manifest));
  const prefs = { 'browser.download.folderList': 2, 'browser.download.dir': downloads, 'browser.download.useDownloadDir': true, 'browser.download.always_ask_before_handling_new_types': false };
  fs.writeFileSync(path.join(profile, 'user.js'), Object.entries(prefs).map(([key, value]) => `user_pref(${JSON.stringify(key)}, ${JSON.stringify(value)});`).join('\n'));
  const proc = spawn('C:/Program Files/Mozilla Firefox/firefox.exe', ['--headless', '--no-remote', '--profile', profile, '--remote-debugging-port', '9244'], { windowsHide: true, env: { ...process.env, MOZ_REMOTE_ALLOW_SYSTEM_ACCESS: '1' } });
  let ws;
  try {
    await new Promise((resolve, reject) => { const t = setTimeout(() => reject(Error('Firefox start timeout')), 20000); proc.on('error', reject); proc.stderr.on('data', data => { if (data.toString().includes('WebDriver BiDi listening')) { clearTimeout(t); resolve(); } }); });
    ws = new WebSocket('ws://127.0.0.1:9244/session'); await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
    let next = 0; const pending = new Map(); ws.onmessage = event => { const m = JSON.parse(event.data); pending.get(m.id)?.(m); };
    const command = (method, params) => new Promise((resolve, reject) => { const num = ++next, timer = setTimeout(() => { pending.delete(num); reject(Error(method + ' timeout')); }, 25000); pending.set(num, m => { clearTimeout(timer); pending.delete(num); m.type === 'error' ? reject(Error(JSON.stringify(m))) : resolve(m.result); }); ws.send(JSON.stringify({ id: num, method, params })); });
    const session = await command('session.new', { capabilities: { alwaysMatch: {} } });
    await command('webExtension.install', { extensionData: { type: 'path', path: extension } });
    const { context } = await command('browsingContext.create', { type: 'tab' });
    await command('browsingContext.setViewport', { context, viewport: { width: 1920, height: 1080 } });
    await command('browsingContext.navigate', { context, url: origin + '/c/' + id(1), wait: 'complete' });
    async function evaluate(ctx, expression) { const r = await command('script.evaluate', { target: { context: ctx }, expression, awaitPromise: true }); if (r.type === 'exception') throw Error(JSON.stringify(r)); return r.result.value; }
    async function wait(ctx, condition) { const ok = await evaluate(ctx, `(async()=>{for(let i=0;i<150;i++){if(${condition})return true;await new Promise(r=>setTimeout(r,100));}return false})()`); if (!ok) console.log(await evaluate(ctx, 'document.body.innerText')); assert.equal(ok, true, condition); }
    await wait(context, `document.querySelector('.chat-archive-launcher')`);
    assert.equal(await evaluate(context, `document.querySelectorAll('.chat-archive-launcher').length`), 1);
    await evaluate(context, `document.querySelector('.chat-archive-launcher').click();true`);
    let panel;
    for (let i = 0; i < 60 && !panel; i++) { panel = (await command('browsingContext.getTree', {})).contexts.find(c => c.context === context).children.find(c => c.url.includes('/popup/popup.html'))?.context; if (!panel) await new Promise(r => setTimeout(r, 100)); }
    await wait(panel, `!document.querySelector('#archiveChats').hidden`);
    assert.equal(requests.length, 0);
    assert.equal(await evaluate(panel, `(()=>{const zip=document.querySelector('#archiveChats'),pdf=document.querySelector('.format-pdf span'),z=zip.getBoundingClientRect(),p=pdf.getBoundingClientRect();return !!zip.closest('.formats') && zip.textContent==='[ZIP]' && z.right<=innerWidth && Math.abs(z.height-p.height)<1 && Math.abs(z.width-p.width)<1;})()`), true);
    const menuShot = await command('browsingContext.captureScreenshot', { context }); fs.writeFileSync(path.join(out, 'single-menu.png'), Buffer.from(menuShot.data, 'base64'));
    await evaluate(panel, `document.querySelector('#archiveChats').click();true`);
    let archive;
    for (let i = 0; i < 60 && !archive; i++) { archive = (await command('browsingContext.getTree', {})).contexts.find(c => c.url.includes('/archive/archive.html'))?.context; if (!archive) await new Promise(r => setTimeout(r, 100)); }
    assert.ok(archive); await wait(archive, `document.querySelector('#load') && !document.querySelector('#load').disabled`);
    assert.equal(requests.length, 0);
    if (process.argv.includes('--menu-only')) {
      await command('browsingContext.activate', { context });
      await command('browsingContext.setViewport', { context, viewport: { width: 980, height: 800 } });
      await wait(context, `document.querySelector('.chat-archive-dock').dataset.room==='false'`);
      assert.equal(await evaluate(context, `(()=>{const buttons=[...document.querySelectorAll('.chat-archive-launcher')].map(n=>n.getBoundingClientRect());const main=document.querySelector('main').getBoundingClientRect();return buttons.length===1 && buttons.every(r=>r.left>main.right && r.right<=innerWidth);})()`), true);
      const shot = await command('browsingContext.captureScreenshot', { context }); fs.writeFileSync(path.join(out, 'narrow-launcher.png'), Buffer.from(shot.data, 'base64'));
      const result={firefox:session.capabilities.browserVersion,localOnly:true,singleLauncher:true,archiveFromMenu:true,noHistoryReadOnOpen:true,narrowFallback:true};
      fs.writeFileSync(path.join(out,'result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));return;
    }
    await evaluate(archive, `document.querySelector('#load').click();true`);
    await wait(archive, `!document.querySelector('#selection').hidden`);
    assert.match(await evaluate(archive, `document.querySelector('#count').textContent`), archiveUi ? /42 found/ : /105 found/);
    assert.equal(requests.filter(r => r.path.startsWith('/backend-api/conversations?')).length, archiveUi ? 2 : 3);
    if (archiveFailure) {
      await evaluate(archive, `document.querySelector('#all').click();document.querySelector('#run').click();true`);
      await wait(archive, `document.querySelector('#progress').textContent.includes('3 failed')`);
      assert.match(await evaluate(archive, `document.querySelector('#progress').textContent`), /ready to save/);
      const runningShot=await command('browsingContext.captureScreenshot',{context:archive});fs.writeFileSync(path.join(out,'archive-progress.png'),Buffer.from(runningShot.data,'base64'));
      await wait(archive, `document.querySelector('#error').textContent.includes('HTTP_502') && !document.querySelector('#report').hidden`);
      const state=JSON.parse(await evaluate(archive, `send('ARCHIVE_STATE').then(r=>JSON.stringify(r))`));
      assert.equal(state.saved,36);assert.equal(state.failed,4);assert.equal(state.notAttempted,2);assert.equal(state.parts,1);assert.equal(state.errorCode,'HTTP_502');
      assert.match(await evaluate(archive, `document.querySelector('#status').textContent`), /36 chats saved/);
      assert.equal(await evaluate(archive, `document.querySelector('#failureList').children.length`),4);
      await evaluate(archive, `document.querySelector('#failureDetails').open=true;true`);
      const shot=await command('browsingContext.captureScreenshot',{context:archive});fs.writeFileSync(path.join(out,'archive-failures.png'),Buffer.from(shot.data,'base64'));
      const files=fs.readdirSync(downloads).filter(name=>/\.(zip|json)$/.test(name));assert.equal(files.length,2);
      for(const file of files)fs.copyFileSync(path.join(downloads,file),path.join(out,file));
      assert.equal(requests.filter(r=>r.path.includes('/conversation/')).length,40);assert.ok(requests.every(r=>r.method==='GET'));
      const result={firefox:session.capabilities.browserVersion,localOnly:true,mode:'partial-failure',saved:state.saved,failed:state.failed,notAttempted:state.notAttempted,parts:state.parts,errorCode:state.errorCode};
      fs.writeFileSync(path.join(out,'result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));return;
    }
    if (archiveUi) {
      assert.match(await evaluate(archive, `document.querySelector('#page').textContent`), /1 \/ 3.*1–20 of 42/);
      await evaluate(archive, `document.querySelector('#list input').click();document.querySelector('#next').click();document.querySelector('#list input').click();document.querySelector('#next').click();true`);
      assert.equal(await evaluate(archive, `document.querySelector('#list').children.length`), 2);
      assert.match(await evaluate(archive, `document.querySelector('#count').textContent`), /2 selected/);
      await evaluate(archive, `document.querySelector('#run').click();true`);
      await wait(archive, `document.querySelector('[data-stage=read]').className==='current' && !document.querySelector('#stop').hidden`);
      assert.equal(await evaluate(archive, `getComputedStyle(document.querySelector('.archive-activity')).position`), 'fixed');
      await evaluate(archive, `document.querySelector('#selection').scrollIntoView();true`);
      const runningShot=await command('browsingContext.captureScreenshot',{context:archive});fs.writeFileSync(path.join(out,'archive-progress.png'),Buffer.from(runningShot.data,'base64'));
      await wait(archive, `document.querySelector('#status').textContent.startsWith('Finished. ZIP') && document.querySelector('#stop').hidden`);
      assert.equal(await evaluate(archive, `document.querySelector('#activityBar').textContent`), '[############]');
      assert.equal(await evaluate(archive, `document.querySelector('.archive-activity').getBoundingClientRect().bottom<=innerHeight`), true);
      const doneShot=await command('browsingContext.captureScreenshot',{context:archive});fs.writeFileSync(path.join(out,'archive-complete.png'),Buffer.from(doneShot.data,'base64'));
      const result={firefox:session.capabilities.browserVersion,localOnly:true,singleLauncher:true,archiveFromMenu:true,noHistoryReadOnOpen:true,discovered:42,pages:3,selectionAcrossPages:true,pinnedProgress:true,stages:true,stopAvailable:true,completed:true};
      fs.writeFileSync(path.join(out,'result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));return;
    }
    const ready = await command('browsingContext.captureScreenshot', { context: archive }); fs.writeFileSync(path.join(out, 'archive-list.png'), Buffer.from(ready.data, 'base64'));
    for (const format of ['md', 'txt', 'html', 'json']) {
      // Select across active pagination and the archived list through production UI state.
      await evaluate(archive, `selected=new Set(${JSON.stringify([id(1), id(101), id(104), id(102)])});drawList();document.querySelector('#format').value=${JSON.stringify(format)};document.querySelector('#run').click();true`);
      await wait(archive, `!document.querySelector('#stop').hidden`);
      await wait(archive, `document.querySelector('#status').textContent.includes('Finished with skipped') && !document.querySelector('#report').hidden`);
      const state = JSON.parse(await evaluate(archive, `send('ARCHIVE_STATE').then(r=>JSON.stringify(r))`));
      assert.equal(state.saved, 3); assert.equal(state.failed, 1); assert.ok(state.parts >= 2); formats.push({ format, saved: state.saved, failed: state.failed, parts: state.parts });
    }
    await evaluate(archive, `document.querySelector('.actions').scrollIntoView();true`);
    const done = await command('browsingContext.captureScreenshot', { context: archive }); fs.writeFileSync(path.join(out, 'archive-done.png'), Buffer.from(done.data, 'base64'));
    const files = fs.readdirSync(downloads).filter(name => /\.(zip|json)$/.test(name));
    for (const file of files) fs.copyFileSync(path.join(downloads, file), path.join(out, file));
    assert.ok(requests.every(r => r.method === 'GET')); assert.equal(requests.filter(r => r.path.includes('/conversation/')).length, 16);
    const result = { firefox: session.capabilities.browserVersion, localOnly: true, explicitLoad: true, discovered: 105, paginationRequests: 3, formats, requests: requests.length, files: files.length };
    fs.writeFileSync(path.join(out, 'result.json'), JSON.stringify(result, null, 2)); console.log(JSON.stringify(result));
  } finally { ws?.close(); proc.kill(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error); process.exitCode = 1; });

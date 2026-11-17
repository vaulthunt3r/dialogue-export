// Isolated MV3 integration check. Only a local synthetic server and a fresh
// Firefox profile are used; no personal tabs, accounts or ChatGPT requests.
const fs = require('node:fs'), path = require('node:path'), http = require('node:http');
const { spawn } = require('node:child_process');
const assert = require('node:assert/strict');
const { pathToFileURL } = require('node:url');
const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
if (process.argv.includes('--archive')) require('./archive-firefox.cjs');
else if (process.argv.includes('--parts')) require('./parts-firefox.cjs');
else if (process.argv.includes('--ui')) require('./ui-firefox.cjs');
else (async () => {
  const out = path.resolve(process.argv[2] || 'release/0.5.6/api-firefox');
  fs.mkdirSync(out, { recursive: true });
  const run = fs.mkdtempSync(path.join(out, 'run-'));
  const profile = path.join(run, 'profile'), extension = path.join(run, 'extension');
  fs.mkdirSync(profile); fs.mkdirSync(extension);
  const id = '12345678-1234-1234-1234-123456789abc';
  const raw = { conversation_id: id, title: 'Local fixture', current_node: 'm1199', mapping: { root: { id: 'root', parent: null, message: null } } };
  for (let i = 0; i < 1200; i++) raw.mapping[`m${i}`] = { id: `m${i}`, parent: i ? `m${i - 1}` : 'root',
    message: { id: `m${i}`, author: { role: i % 2 ? 'assistant' : 'user' }, status: 'finished_successfully',
      content: { content_type: 'text', parts: [`Message ${i}\n\n\`\`\`python\n    print(${i})\n\`\`\``] } } };
  const longCode = Array.from({ length: 65 }, (_, i) => `    print("line ${i + 1}")`).join('\n') + '\n';
  raw.mapping.m1.message.content.parts = ['## Formatting check / Проверка\n\n> A quoted explanation.\n\n- First item\n  - Nested item\n\n| Item | Value | Note |\n| --- | --- | --- |\n| Code | 65 lines | Indentation preserved |\n| Diagram | SVG | Embedded offline |\n\n```python\n' + longCode + '```\n\nEnd of long code block.'];
  raw.mapping.m2.message.content.parts = ['Before image.', { content_type: 'image_asset_pointer', asset_pointer: 'sediment://file_fixture' }, 'After image.'];
  raw.mapping.m2.message.content.content_type = 'multimodal_text';
  raw.mapping.generated = { id: 'generated', parent: 'm2', message: { id: 'generated', author: { role: 'tool', name: 'fixture_image_tool' },
    status: 'finished_successfully', channel: 'commentary', metadata: { is_visually_hidden_from_conversation: false },
    content: { content_type: 'multimodal_text', parts: ['PRIVATE_TOOL_PROMPT', { content_type: 'image_asset_pointer', asset_pointer: 'sediment://file_generated' }] } } };
  raw.mapping.hidden = { id: 'hidden', parent: 'generated', message: { id: 'hidden', author: { role: 'tool', name: 'fixture_image_tool' },
    status: 'finished_successfully', channel: 'commentary', metadata: { is_visually_hidden_from_conversation: true },
    content: { content_type: 'multimodal_text', parts: [{ content_type: 'image_asset_pointer', asset_pointer: 'sediment://file_hidden' }] } } };
  raw.mapping.m3.parent = 'hidden';
  raw.mapping.m3.message.content.parts = ['![Diagram](/backend-api/fixture-diagram.svg)\n\nText following the diagram.'];
  const diagram = '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="160" viewBox="0 0 640 160"><rect x="10" y="10" width="620" height="140" fill="#e0f2fe"/><rect x="30" y="40" width="170" height="80" rx="12" fill="#0369a1"/><text x="65" y="90" fill="white" font-size="24">Input</text><path d="M220 80 L400 80 L380 65 M400 80 L380 95" stroke="#0369a1" stroke-width="5" fill="none"/><text x="440" y="90" font-size="24">Output</text></svg>';
  const requests = [];
  let finishReport;
  const reportPromise = new Promise(resolve => { finishReport = resolve; });
  const server = http.createServer((req, res) => {
    if (req.url === '/report' && req.method === 'POST') {
      let body = '';
      req.on('data', value => { body += value; });
      req.on('end', () => { finishReport(JSON.parse(body)); res.end('ok'); });
      return;
    }
    if (req.url.startsWith('/c/')) {
      res.setHeader('Content-Type', 'text/html');
      res.setHeader('Set-Cookie', 'fixture_session=local; HttpOnly; SameSite=Strict; Path=/');
      res.end('<!doctype html><title>Local synthetic conversation</title><main></main>');
      return;
    }
    if (req.url === '/favicon.ico') { res.writeHead(404); res.end(); return; }
    requests.push({ path: req.url, method: req.method, cookie: req.headers.cookie, authorized: req.headers.authorization === 'Bearer SYNTHETIC_TOKEN' });
    res.setHeader('Content-Type', 'application/json');
    if (req.headers.cookie !== 'fixture_session=local') { res.writeHead(401); res.end('{}'); }
    else if (req.url === '/api/auth/session') res.end(JSON.stringify({ accessToken: 'SYNTHETIC_TOKEN' }));
    else if (req.url === `/backend-api/conversation/${id}` && req.headers.authorization === 'Bearer SYNTHETIC_TOKEN') res.end(JSON.stringify(raw));
    else if (req.url === `/backend-api/conversation/${id}/attachment/file_fixture/download`) res.end(JSON.stringify({ download_url: '/backend-api/fixture.png' }));
    else if (req.url === `/backend-api/conversation/${id}/attachment/file_generated/download`) res.end(JSON.stringify({ download_url: '/backend-api/fixture.png' }));
    else if (req.url === '/backend-api/fixture.png') { res.setHeader('Content-Type', 'image/png'); res.end(fs.readFileSync(path.join(__dirname, 'fixtures/api-color-fixture.png'))); }
    else if (req.url === '/backend-api/fixture-diagram.svg') { res.setHeader('Content-Type', 'image/svg+xml'); res.end(diagram); }
    else { res.writeHead(403); res.end('{}'); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  fs.writeFileSync(path.join(extension, 'manifest.json'), JSON.stringify({ manifest_version: 3, name: 'Local API fixture', version: '1.0',
    browser_specific_settings: { gecko: { id: 'local-api-fixture@example.test' } },
    host_permissions: ['http://127.0.0.1/*'], content_scripts: [{ matches: ['http://127.0.0.1/*'], js: ['parser.js', 'markdown.js', 'media.js', 'renderers.js', 'reader.js', 'runner.js'] }] }));
  for (const [source, name] of [['shared/vendor/markdown-it.js', 'parser.js'], ['content/markdown.js', 'markdown.js'], ['content/api-media.js', 'media.js'], ['shared/renderers.js', 'renderers.js']]) fs.writeFileSync(path.join(extension, name), read(source));
  // Only the origin restriction is redirected to the local fixture. Fetch,
  // credentials, streaming response reader and parser are production code.
  fs.writeFileSync(path.join(extension, 'reader.js'), read('content/chatgpt-api.js').replaceAll('https://chatgpt.com', origin));
  fs.writeFileSync(path.join(extension, 'runner.js'), `(async()=>{
    try {
      const results=[]; let artifactHTML;
      for(const outputFormat of ['md','txt','html','pdf']) {
        const result=await ChatArchiveApi.collect({outputFormat},()=>{});
        if(!result.data) throw Error(result.fallback);
        const data=result.data;
        results.push({format:outputFormat,count:data.messages.length,first:data.messages[0],middle:data.messages.find(m=>m.id==='m600'),last:data.messages.at(-1),method:data.collectionMethod,hasToken:JSON.stringify(data).includes('SYNTHETIC_TOKEN'),hasPrivateData:JSON.stringify(data).includes('PRIVATE_TOOL_PROMPT'),generatedIndex:data.messages.findIndex(m=>m.id==='generated'),images:data.embeddedImages||0});
        if(outputFormat==='html') artifactHTML=ChatArchiveRenderers.html({...data,messages:data.messages.slice(0,7)},{includeTitle:true,compactPagination:true});
      }
      await fetch('/report',{method:'POST',body:JSON.stringify({results,artifactHTML})});
    } catch(error) { await fetch('/report',{method:'POST',body:JSON.stringify({error:String(error)})}); }
  })();`);
  const proc = spawn('C:/Program Files/Mozilla Firefox/firefox.exe', ['--headless', '--no-remote', '--profile', profile, '--remote-debugging-port', '9241'], { windowsHide: true });
  let ws, reportTimeout;
  try {
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(Error('Isolated Firefox startup timed out')), 20000);
      proc.on('error', error => { clearTimeout(timeout); reject(error); });
      proc.stderr.on('data', value => { if (value.toString().includes('WebDriver BiDi listening')) { clearTimeout(timeout); resolve(); } });
    });
    ws = new WebSocket('ws://127.0.0.1:9241/session');
    await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
    let nextId = 0; const pending = new Map();
    ws.onmessage = event => { const message = JSON.parse(event.data); pending.get(message.id)?.(message); };
    async function command(method, params) {
      const id = ++nextId;
      return await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => { pending.delete(id); reject(Error(`${method} timed out`)); }, 20000);
        pending.set(id, message => { clearTimeout(timeout); pending.delete(id); message.type === 'error' ? reject(Error(JSON.stringify(message))) : resolve(message.result); });
        ws.send(JSON.stringify({ id, method, params }));
      });
    }
    const session = await command('session.new', { capabilities: { alwaysMatch: {} } });
    await command('webExtension.install', { extensionData: { type: 'path', path: extension } });
    const { context } = await command('browsingContext.create', { type: 'tab' });
    await command('browsingContext.navigate', { context, url: `${origin}/c/${id}`, wait: 'complete' });
    const report = await Promise.race([reportPromise, new Promise((_, reject) => { reportTimeout = setTimeout(() => reject(Error('Content-script report timed out')), 35000); })]);
    assert.equal(report.error, undefined, report.error);
    for (const result of report.results) {
      const rich = ['html', 'pdf'].includes(result.format);
      assert.equal(result.count, rich ? 1201 : 1200); assert.equal(result.method, 'chatgpt-api'); assert.equal(result.hasToken, false);
      assert.equal(result.hasPrivateData, false); assert.equal(result.generatedIndex, rich ? 3 : -1);
      for (const [field, index] of [['first', 0], ['middle', 600], ['last', 1199]]) {
        assert.equal(result[field].id, `m${index}`);
        assert.match(result[field][result.format === 'md' ? 'markdown' : result.format === 'txt' ? 'text' : 'html'], new RegExp(`    print\\(${index}\\)`));
      }
    }
    assert.equal(requests.filter(request => request.path === '/api/auth/session').length, 4);
    assert.ok(requests.every(request => request.method === 'GET' && request.cookie === 'fixture_session=local'));
    assert.ok(requests.filter(request => request.path.includes('conversation')).every(request => request.authorized));
    assert.equal(requests.some(request => request.path.includes('file_hidden')), false);
    for (const result of report.results.filter(result => ['html', 'pdf'].includes(result.format))) assert.equal(result.images, 3);
    fs.writeFileSync(path.join(out, 'export.html'), report.artifactHTML);
    const printPage = read('print/print.html').replace('<link rel="stylesheet" href="print.css">', `<style>${read('print/print.css')}</style>`)
      .replace('<script src="print.js"></script>', `<script>window.browser={runtime:{sendMessage:async()=>(${JSON.stringify({ ok: true, content: report.artifactHTML, strictImages: true, compactPagination: true, filename: 'API-layout.pdf' })})}};</script><script>${read('print/print.js')}</script>`);
    fs.writeFileSync(path.join(out, 'print.html'), printPage);
    async function evaluate(expression) {
      const result = await command('script.evaluate', { target: { context }, expression, awaitPromise: true });
      if (result.type === 'exception') throw Error(JSON.stringify(result));
      return result.result.value;
    }
    for (const name of ['export', 'print']) {
      await command('browsingContext.navigate', { context, url: pathToFileURL(path.join(out, name + '.html')).href + (name === 'print' ? '?id=fixture' : ''), wait: 'complete' });
      assert.equal(await evaluate('(async()=>{await Promise.all([...document.images].map(i=>i.decode()));return [...document.images].filter(i=>i.naturalWidth===640&&i.src.startsWith("data:image/")).length})()'), 3);
      assert.equal(await evaluate('document.querySelector(".message table").rows.length'), 3);
      assert.equal(await evaluate('[...document.querySelectorAll("pre code")].find(n=>n.textContent.includes("line 65")).textContent'), longCode);
      assert.equal(await evaluate('[...document.images].every(image=>image.getBoundingClientRect().bottom<image.closest("article").nextElementSibling.getBoundingClientRect().top)'), true);
      if (name === 'print') assert.equal(await evaluate('document.querySelector("#printButton").disabled'), false);
      const screenshot = await command('browsingContext.captureScreenshot', { context });
      fs.writeFileSync(path.join(out, name + '.png'), Buffer.from(screenshot.data, 'base64'));
      const pdf = await command('browsingContext.print', { context, background: true });
      fs.writeFileSync(path.join(out, name + '.pdf'), Buffer.from(pdf.data, 'base64'));
    }
    const summary = { firefox: session.capabilities.browserVersion, messagesPerExport: Object.fromEntries(report.results.map(result => [result.format, result.count])), formats: report.results.map(result => result.format),
      visualFixtureMessages: 7, embeddedImages: 3, visibleToolImageInOrder: true, hiddenToolImageNotRequested: true, codeLines: 65, htmlAndPdfGenerated: true,
      getRequests: requests.length, cookieAndBearerVerified: true, temporaryProfileOnly: true };
    fs.writeFileSync(path.join(out, 'result.json'), JSON.stringify(summary, null, 2));
    console.log(JSON.stringify(summary));
  } finally {
    clearTimeout(reportTimeout);
    ws?.close(); proc.kill();
    server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });

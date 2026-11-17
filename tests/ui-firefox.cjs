// UI integration/visual checks use only synthetic localhost pages and a fresh Firefox profile.
const fs = require('node:fs'), path = require('node:path'), http = require('node:http');
const { spawn } = require('node:child_process');
const assert = require('node:assert/strict');
(async () => {
  const out = path.resolve(process.argv[2]), root = path.join(__dirname, '..');
  fs.mkdirSync(out, { recursive: true });
  const run = fs.mkdtempSync(path.join(out, 'run-'));
  const profile = path.join(run, 'profile'), extension = path.join(run, 'extension');
  fs.mkdirSync(profile); fs.mkdirSync(extension);
  const html = `<!doctype html><html class="light"><head><title>Reading app fixture</title><style>
    *{box-sizing:border-box}body{margin:0;font:18px/1.6 Arial;color:#111;background:#fff}nav{position:fixed;left:0;top:0;bottom:0;width:260px;padding:35px;background:#f6f6f6}nav p{margin-top:36px;color:#555}
    main{margin-left:260px;padding:70px 0 160px}article{width:min(760px,calc(100vw - 300px));margin:20px auto 50px}article[data-message-author-role=user]{background:#eee;border-radius:18px;padding:18px}h2{font-size:22px}form{position:fixed;bottom:25px;left:calc(260px + (100vw - 260px - min(760px,100vw - 300px))/2);width:min(760px,calc(100vw - 300px));border:1px solid #bbb;border-radius:28px;padding:13px 24px;background:#fff}#prompt-textarea{min-height:30px;color:#777}.dark body{background:#111;color:#eee}.dark nav,.dark form{background:#222;color:#eee}.dark article[data-message-author-role=user]{background:#333}
    </style></head><body><nav><b>ChatGPT</b><p>New chat</p><p>Reading app</p><p>Weekend project</p></nav><main>
    <article data-message-author-role="user" data-testid="conversation-turn-0"><p>Help me plan a small reading app for the weekend.</p></article>
    <article data-message-author-role="assistant" data-testid="conversation-turn-1"><h2>Keep the first version small</h2><p>Start with a reading view, a simple library and saved reading progress.</p><ul><li>Readable text and adjustable font size.</li><li>A local list of books.</li><li>Remember the last page.</li></ul><p>Build one complete reading flow first.</p></article>
    <form><div id="prompt-textarea" contenteditable="true" role="textbox">Ask anything</div></form></main></body></html>`;
  const server = http.createServer((req, res) => {res.setHeader('Content-Type','text/html');res.setHeader('Content-Security-Policy',"script-src 'none'; frame-src 'none'; style-src 'unsafe-inline'");res.end(html);});
  await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const manifest = JSON.parse(fs.readFileSync(path.join(root,'manifest.json')));
  manifest.name = 'Local UI fixture'; manifest.browser_specific_settings.gecko.id='ui-fixture@example.test';
  manifest.host_permissions=['http://127.0.0.1/*'];manifest.content_scripts[0].matches=['http://127.0.0.1/*'];
  manifest.web_accessible_resources[0].matches=['http://127.0.0.1/*'];
  for (const dir of ['content','shared','print','popup','icons','archive']) fs.cpSync(path.join(root,dir),path.join(extension,dir),{recursive:true});
  fs.writeFileSync(path.join(extension,'background.js'),fs.readFileSync(path.join(root,'background.js'),'utf8').replace('browser.runtime.onMessage.addListener(async (request, sender = {}) => {',`browser.runtime.onMessage.addListener(async (request, sender = {}) => { if(request.type==='FIXTURE_SENDER')return {url:sender.url,tab:sender.tab?.id,frame:sender.frameId};`));
  fs.writeFileSync(path.join(extension,'manifest.json'),JSON.stringify(manifest));
  const proc=spawn('C:/Program Files/Mozilla Firefox/firefox.exe',['--headless','--no-remote','--profile',profile,'--remote-debugging-port','9243'],{windowsHide:true,env:{...process.env,MOZ_REMOTE_ALLOW_SYSTEM_ACCESS:'1'}});
  let ws;
  try {
    await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Firefox start timeout')),20000);proc.on('error',reject);proc.stderr.on('data',v=>{if(v.toString().includes('WebDriver BiDi listening')){clearTimeout(timer);resolve();}});});
    ws=new WebSocket('ws://127.0.0.1:9243/session');await new Promise((resolve,reject)=>{ws.onopen=resolve;ws.onerror=reject;});
    let next=0;const pending=new Map();ws.onmessage=event=>{const m=JSON.parse(event.data);pending.get(m.id)?.(m);};
    const command=(method,params)=>new Promise((resolve,reject)=>{const id=++next,timer=setTimeout(()=>{pending.delete(id);reject(Error(method+' timeout: '+String(params.expression||'').slice(0,200)));},20000);pending.set(id,m=>{clearTimeout(timer);pending.delete(id);m.type==='error'?reject(Error(JSON.stringify(m))):resolve(m.result);});ws.send(JSON.stringify({id,method,params}));});
    const session=await command('session.new',{capabilities:{alwaysMatch:{}}});
    await command('webExtension.install',{extensionData:{type:'path',path:extension}});
    const {context}=await command('browsingContext.create',{type:'tab'});
    await command('browsingContext.setViewport',{context,viewport:{width:1920,height:1080},devicePixelRatio:1});
    await command('browsingContext.navigate',{context,url:origin+'/c/fixture',wait:'complete'});
    async function evaluate(ctx,expression){const r=await command('script.evaluate',{target:{context:ctx},expression,awaitPromise:true});if(r.type==='exception')throw Error(JSON.stringify(r));return r.result.value;}
    async function wait(ctx,condition){const ok=await evaluate(ctx,`(async()=>{for(let i=0;i<100;i++){if(${condition})return true;await new Promise(r=>setTimeout(r,80));}return false;})()`);if(!ok)console.log(await evaluate(ctx,`(async()=>JSON.stringify({body:document.body.innerText,...(typeof browser!=='undefined'?await browser.runtime.sendMessage({type:'FIXTURE_SENDER'}):{})}))()`));assert.equal(ok,true,condition);}
    async function snap(name){const r=await command('browsingContext.captureScreenshot',{context});fs.writeFileSync(path.join(out,name+'.png'),Buffer.from(r.data,'base64'));}
    async function frameContext(){for(let i=0;i<100;i++){const tree=await command('browsingContext.getTree',{});const found=tree.contexts.find(t=>t.context===context).children.find(c=>c.url.includes('popup/popup.html'));if(found)return found.context;await new Promise(r=>setTimeout(r,80));}throw Error('Panel frame did not load');}
    const measure=()=>evaluate(context,`JSON.stringify({chat:document.querySelector('article').getBoundingClientRect().toJSON(),dock:document.querySelector('.chat-archive-dock').getBoundingClientRect().toJSON(),composer:document.querySelector('form').getBoundingClientRect().toJSON()})`);
    await wait(context,`document.querySelector('.chat-archive-launcher')`);
    await wait(context,`document.querySelector('.chat-archive-launcher img')?.naturalWidth>0`);
    // A generated image can sit inside a viewport-wide turn without export IDs.
    // It must neither hide the launcher nor run the collector's ID checks.
    await evaluate(context,`(()=>{const turn=document.createElement('article');turn.id='image-layout-fixture';turn.dataset.testid='conversation-turn-image';turn.style.cssText='width:100%;margin:0;height:440px';turn.innerHTML='<div data-web-image-tile style="width:760px;margin:auto"><img alt="Local image fixture" width="500" height="340" style="display:block;background:#ddd" src="data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%22500%22 height=%22340%22%3E%3Crect width=%22500%22 height=%22340%22 fill=%22%23ddd%22/%3E%3Ccircle cx=%22250%22 cy=%22170%22 r=%22100%22 fill=%22%23999%22/%3E%3C/svg%3E"></div>';document.querySelector('main').prepend(turn);window.dispatchEvent(new Event('resize'));return true;})()`);
    assert.equal(await evaluate(context,`document.querySelector('#image-layout-fixture').getBoundingClientRect().right===innerWidth`),true);
    await wait(context,`document.querySelector('.chat-archive-dock').dataset.room==='true'`);
    assert.equal(await evaluate(context,`getComputedStyle(document.querySelector('.chat-archive-dock')).display!=='none' && document.querySelectorAll('.chat-archive-launcher').length===1`),true);
    await snap('image-gutter-launcher');
    await evaluate(context,`document.querySelector('#image-layout-fixture').remove();window.dispatchEvent(new Event('resize'));true`);
    await snap('dialogue-launcher');
    const before=JSON.parse(await measure());
    await evaluate(context,`document.querySelector('.chat-archive-launcher').click();true`);
    await wait(context,`document.querySelector('.chat-archive-menu')`);
    let tree=await command('browsingContext.getTree',{});
    let panel=await frameContext();
    assert.ok(panel,JSON.stringify(tree));
    await wait(panel,`document.body.dataset.state==='ready'`);
    await wait(panel,`document.querySelector('.dialogue-mark').naturalWidth>0`);
    const after=JSON.parse(await measure());assert.equal(after.chat.x,before.chat.x);assert.equal(after.chat.width,before.chat.width);
    assert.ok(after.dock.x>=after.chat.right+8);assert.ok(after.dock.x>=after.composer.right+8);assert.ok(after.dock.width<=220);
    // Simulate a full-width form around a centered rounded composer, as used by host apps.
    await evaluate(context,`(()=>{const form=document.querySelector('form'),box=document.createElement('div');box.style.cssText='width:760px;margin:auto;border-radius:28px';box.append(...form.childNodes);const button=document.createElement('button');button.textContent='Send';box.append(button);form.append(box);form.style.cssText='left:260px;width:calc(100vw - 260px);border:0;border-radius:0;padding:0';return true;})()`);
    await evaluate(context,`window.dispatchEvent(new Event('resize'));true`);
    assert.equal(await evaluate(context,`document.querySelector('.chat-archive-dock').dataset.room`),'true');
    await snap('light-compact');
    await evaluate(panel,`document.querySelector('[name=format][value=html]').click();true`);
    assert.equal(await evaluate(panel,`[...document.querySelectorAll('.option-group')].every(g=>!g.open)`),true);
    await snap('html-compact');
    await evaluate(panel,`document.querySelectorAll('details').forEach(d=>d.open=true);true`);
    await wait(context,`document.querySelector('.chat-archive-menu').getBoundingClientRect().height>=440`);
    await wait(panel,`document.querySelector('#controls').scrollHeight>document.querySelector('#controls').clientHeight`);
    const footerTop=await evaluate(panel,`document.querySelector('#exportButton').getBoundingClientRect().top`);
    assert.equal(await evaluate(panel,`document.querySelector('#exportButton').getBoundingClientRect().bottom<=innerHeight && document.documentElement.scrollHeight<=innerHeight`),true);
    await snap('html-options-top');
    await evaluate(panel,`document.querySelector('#controls').scrollTop=10000;true`);
    assert.equal(await evaluate(panel,`document.querySelector('#exportButton').getBoundingClientRect().top`),footerTop);
    await snap('html-options-bottom');
    assert.equal(await evaluate(panel,`document.documentElement.scrollWidth<=innerWidth`),true);
    await evaluate(context,`document.documentElement.className='dark';true`);await wait(panel,`document.body.dataset.theme==='dark'`);
    await evaluate(panel,`document.querySelectorAll('details').forEach(d=>d.open=false);document.querySelector('#controls').scrollTop=0;true`);
    await snap('dark-compact');
    await command('browsingContext.setViewport',{context,viewport:{width:1920,height:480},devicePixelRatio:1});
    await wait(context,`document.querySelector('.chat-archive-menu').getBoundingClientRect().bottom<=innerHeight`);
    await evaluate(panel,`document.querySelectorAll('details').forEach(d=>d.open=true);true`);
    assert.equal(await evaluate(panel,`document.querySelector('#exportButton').getBoundingClientRect().bottom<=innerHeight && document.documentElement.scrollHeight<=innerHeight`),true);
    await snap('short-pinned-export');
    await command('browsingContext.setViewport',{context,viewport:{width:1920,height:1080},devicePixelRatio:1});
    // Connecting while another tab is active must retain this iframe's owner.
    const other=await command('browsingContext.create',{type:'tab'});await command('browsingContext.navigate',{context:other.context,url:origin+'/other',wait:'complete'});
    assert.equal(await evaluate(panel,`connect().then(()=>document.querySelector('#filename').value)`),'Reading-app-fixture');
    await command('browsingContext.close',{context:other.context});
    await evaluate(panel,`document.querySelector('[name=scope][value=selected]').click();true`);
    await wait(panel,`!document.querySelector('#selectionTools').hidden`);
    await evaluate(panel,`document.querySelector('#selectionMode').click();true`);
    await wait(context,`document.querySelectorAll('.chat-archive-picker').length===2 && !document.querySelector('.chat-archive-menu')`);
    await evaluate(context,`document.querySelectorAll('.chat-archive-picker').forEach(b=>b.click());document.querySelector('.chat-archive-selection-bar button:last-child').click();document.querySelector('.chat-archive-launcher').click();true`);
    panel=await frameContext();
    await wait(panel,`document.body.dataset.state==='ready'`);
    await evaluate(panel,`document.querySelector('[name=format][value=pdf]').click();document.querySelector('#exportButton').click();true`);
    await wait(context,`document.querySelector('.chat-archive-progress')?.dataset.state==='done'`);
    assert.equal(await evaluate(context,`document.querySelector('.chat-archive-menu')===null`),true);await snap('done-status');
    tree=await command('browsingContext.getTree',{});assert.ok(tree.contexts.some(t=>t.url.includes('/print/print.html')));
    await command('browsingContext.activate',{context});
    await command('browsingContext.setViewport',{context,viewport:{width:1280,height:800},devicePixelRatio:1});
    await wait(context,`document.querySelector('.chat-archive-dock').dataset.room==='false'`);
    assert.equal(await evaluate(context,`getComputedStyle(document.querySelector('.chat-archive-progress')).display`),'none');await snap('narrow-collapsed');
    const result={firefox:session.capabilities.browserVersion,menuWidth:after.dock.width,singleLauncher:true,fullWidthImageTurn:true,imageWithoutIds:true,dialogueIconsLoaded:true,pinnedExport:true,settingsScrollOnly:true,collapsedOptionGroups:true,shortViewportPinnedExport:true,unchangedChatGeometry:true,wideFormComposer:true,strictPageCsp:true,iframeOwnerBound:true,selectedPdf:true,autoCollapse:true,narrowCollapsed:true,localOnly:true};
    fs.writeFileSync(path.join(out,'result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
  } finally { ws?.close();proc.kill();server.closeAllConnections();await new Promise(resolve=>server.close(resolve)); }
})().catch(error=>{console.error(error);process.exitCode=1;});

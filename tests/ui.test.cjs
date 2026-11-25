const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const FakeTimers = require('@sinonjs/fake-timers');
const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const copy = value => JSON.parse(JSON.stringify(value));

function environment(html, url='https://chatgpt.com/c/test') {
  const dom = new JSDOM(html, { url, runScripts:'outside-only', pretendToBeVisual:true });
  const w = dom.window;
  w.matchMedia = () => ({ matches:false });
  const clock = FakeTimers.withGlobal(w).install({ toFake:['Date','setTimeout','clearTimeout','setInterval','clearInterval'] });
  const closeWindow = w.close.bind(w);
  return { w, clock, close(){w.dispatchEvent(new w.Event('pagehide'));clock.uninstall();closeWindow();} };
}
async function popup(config={}) {
  const env = environment(read('popup/popup.html'), 'https://fixture.invalid/popup.html'+(config.panel?'?panel=1':''));
  const {w,clock} = env;
  const model = { info:{ ok:true,title:'Weekend ideas',provider:'ChatGPT',count:8,selected:0,picking:false,theme:'light',activeExport:false,exportStatus:null,...config.info },saved:config.saved||{},calls:[],opened:[],closed:false,queries:0,contexts:0 };
  w.close = () => { model.closed=true; };
  w.browser = {
    runtime:{getURL:file=>`moz-extension://fixture/${file}`,getManifest:()=>({version:'0.5.1'}),sendMessage:async req=>{
      if(req.type==='PANEL_CONTEXT'){model.contexts++;return {ok:true,tabId:42,notifications:true};}
      if(req.type==='PANEL_SEND')return w.browser.tabs.sendMessage(42,req.message);
      return {ok:true};
    }},
    permissions:config.permissions || {contains:async()=>false,request:async()=>false},
    storage:{local:{get:async()=>copy(model.saved),set:async p=>{model.saved={...model.saved,...p};}}},
    tabs:{create:async args=>{model.opened.push(copy(args));return{id:2};},query:async()=>{model.queries++;return [{id:1,url:config.url||'https://chatgpt.com/c/test'}];},sendMessage:async(_,req)=>{
      model.calls.push(req);
      if(model.fail) throw Error('Receiving end does not exist');
      if(config.handle) { const result=await config.handle(req,model); if(result!==undefined) return result; }
      if(req.type==='PING') return copy(model.info);
      if(req.type==='SET_PICKING') model.info.picking=req.enabled;
      if(req.type==='CLEAR_SELECTION') model.info.selected=0;
      if(req.type==='BEGIN_EXPORT') {model.info.activeExport=true;model.info.exportStatus={state:'running',label:'Preparing export',processed:0,startedAt:w.Date.now(),format:req.job.format};}
      return {ok:true,exportStatus:model.info.exportStatus};
    }}
  };
  model.fail=config.fail;
  w.eval(read('popup/popup.js'));
  const $=id=>w.document.getElementById(id);
  const radio=(name,value)=>w.document.querySelector(`input[name="${name}"][value="${value}"]`).click();
  return {...env,model,$,radio};
}

test('image access page requests only its declared origin on click and does not restart exports', async () => {
  for (const granted of [false, true]) {
    const env = environment(read('popup/image-access.html'), 'https://fixture.invalid/image-access.html');
    try {
      const calls = [];
      env.w.browser = { permissions: { contains: async () => false, request: async args => { calls.push(copy(args)); return granted; } } };
      env.w.eval(read('popup/image-access.js'));
      await env.clock.tickAsync(0);
      assert.equal(calls.length, 0);
      env.w.document.getElementById('enable').click(); await env.clock.tickAsync(0);
      assert.deepEqual(calls, [{ origins: ['https://images.openai.com/*'] }]);
      assert.equal(env.w.document.getElementById('enable').hidden, granted);
      assert.match(env.w.document.getElementById('result').textContent, granted ? /Return to your chat and retry/ : /remains off/);
    } finally { env.close(); }
  }
});

test('reopened toolbar and in-page menus keep image permission repair accessible without restarting export', async () => {
  for (const panel of [false, true]) {
    const p = await popup({ panel, info: { exportStatus: { state: 'error', label: 'Image access is required.', startedAt: -12000, finishedAt: -10000,
      mediaDiagnostic: { phase: 'permission', download: { code: 'IMAGE_PERMISSION_REQUIRED' } } } } });
    try {
      await p.clock.tickAsync(6100); assert.equal(p.$('allowImageAccess').hidden, false);
      p.$('allowImageAccess').click(); await p.clock.tickAsync(0);
      assert.deepEqual(p.model.opened, [{ url: 'moz-extension://fixture/popup/image-access.html' }]);
      assert.equal(p.model.calls.some(r => r.type === 'BEGIN_EXPORT'), false);
      p.model.info.exportStatus = { state: 'error', mediaDiagnostic: { download: { code: 'IMAGE_NETWORK_ERROR' } } };
      await p.clock.tickAsync(1100); assert.equal(p.$('allowImageAccess').hidden, true);
    } finally { p.close(); }
  }
});

test('popup keeps export disabled until the first connection completes',async()=>{
  let resolvePing;
  const p=await popup({handle:req=>req.type==='PING'?new Promise(resolve=>{resolvePing=resolve;}):undefined});
  await p.clock.tickAsync(1);
  assert.equal(p.$('controls').disabled,true); assert.equal(p.$('exportButton').disabled,true);
  resolvePing(copy(p.model.info));await p.clock.tickAsync(1);
  assert.equal(p.$('exportButton').disabled,false);assert.match(p.$('status').textContent,/ChatGPT.*ready/);p.close();
});
test('failed connection offers Retry and recovers in the same popup',async()=>{
  const p=await popup({fail:true}); await p.clock.tickAsync(400);
  assert.equal(p.$('retry').hidden,false);assert.equal(p.$('exportButton').disabled,true);
  p.model.fail=false;p.$('retry').click();await p.clock.tickAsync(10);
  assert.equal(p.$('errorBox').hidden,true);assert.equal(p.$('exportButton').disabled,false);p.close();
});
test('a never-resolving connection has a bounded timeout',async()=>{
  const p=await popup({handle:()=>new Promise(()=>{})});await p.clock.tickAsync(6400);
  assert.equal(p.$('retry').hidden,false);assert.match(p.$('error').textContent,/did not respond/);p.close();
});
test('unsupported pages explain the next action',async()=>{
  for(const config of [{url:'https://example.com/'}]){
    const p=await popup(config);await p.clock.tickAsync(10);
    assert.equal(p.$('exportButton').disabled,true);assert.equal(p.$('errorBox').hidden,false);assert.match(p.$('error').textContent,/Open a conversation/);p.close();
  }
});

test('empty/loading conversations become ready automatically without another click',async()=>{
  const p=await popup({info:{count:0}});
  try {
    await p.clock.tickAsync(10);
    assert.equal(p.$('exportButton').disabled,true);
    assert.equal(p.$('errorBox').hidden,true);
    assert.match(p.$('status').textContent,/Waiting for conversation/);
    p.model.info.count=4;
    await p.clock.tickAsync(1100);
    assert.equal(p.$('exportButton').disabled,false);
    assert.match(p.$('status').textContent,/ready/);
    assert.equal(p.model.calls.some(r=>r.type==='BEGIN_EXPORT'),false);
  }finally{p.close();}
});

test('a temporary disconnect recovers automatically and never starts an export',async()=>{
  const p=await popup();
  try {
    await p.clock.tickAsync(10);p.model.fail=true;await p.clock.tickAsync(1100);
    assert.equal(p.$('exportButton').disabled,true);
    p.model.fail=false;await p.clock.tickAsync(2100);
    assert.equal(p.$('errorBox').hidden,true);assert.equal(p.$('exportButton').disabled,false);
    assert.equal(p.model.calls.some(r=>r.type==='BEGIN_EXPORT'),false);
  }finally{p.close();}
});

test('a missing receiver is restored once through the background before reconnecting',async()=>{
  const p=await popup({fail:true});
  try {
    let restores=0;
    p.w.browser.runtime.sendMessage=async req=>{if(req.type==='ENSURE_CONTENT'){restores++;p.model.fail=false;}return {ok:true};};
    await p.clock.tickAsync(10);
    assert.equal(restores,1);assert.equal(p.$('exportButton').disabled,false);
    await p.clock.tickAsync(2100);assert.equal(restores,1);
  }finally{p.close();}
});
test('Selected enables only with messages; All ends picking and hides selection tools',async()=>{
  const p=await popup();await p.clock.tickAsync(10);p.radio('scope','selected');await p.clock.tickAsync(10);
  assert.equal(p.$('selectionTools').hidden,false);assert.equal(p.$('exportButton').disabled,true);
  p.model.info.selected=3;p.model.info.picking=true;await p.clock.tickAsync(1050);
  assert.equal(p.$('exportButton').disabled,false);assert.match(p.$('scopeHint').textContent,/3 selected/);
  p.radio('scope','all');await p.clock.tickAsync(10);
  assert.equal(p.model.info.picking,false);assert.equal(p.$('selectionTools').hidden,true);assert.equal(p.$('exportButton').disabled,false);p.close();
});
test('format preferences, safe filenames and optional date produce the submitted filename',async()=>{
  const p=await popup({saved:{format:'pdf',appendDate:true,includeLinks:false}});await p.clock.tickAsync(10);
  assert.match(p.$('formatHint').textContent,/Save to PDF/);assert.equal(p.$('includeLinks').checked,false);
  p.$('filename').value='CON.pdf';p.$('filename').dispatchEvent(new p.w.Event('input'));
  assert.match(p.$('filenamePreview').textContent,/conversation-CON-\d{4}-\d{2}-\d{2}\.pdf/);
  p.$('filename').value='🙂'.repeat(100);p.$('filename').dispatchEvent(new p.w.Event('input'));
  assert.ok(Buffer.byteLength(p.$('filenamePreview').title, 'utf8') < 220);
  p.radio('format','md');await p.clock.tickAsync(10);assert.equal(p.model.saved.format,'md');
  p.$('exportButton').click();p.$('exportButton').click();await p.clock.tickAsync(10);
  const jobs=p.model.calls.filter(r=>r.type==='BEGIN_EXPORT');assert.equal(jobs.length,1);
  assert.equal(jobs[0].job.options.includeLinks,false);assert.match(jobs[0].job.filename,/\.md$/);
  assert.equal(p.$('exportButton').disabled,true);assert.equal(p.model.closed,false);p.close();
});
test('reopened popup restores live progress, elapsed time and finished state',async()=>{
  const p=await popup({info:{activeExport:true,theme:'dark',exportStatus:{state:'running',label:'Loading earlier messages',processed:32,format:'md',startedAt:-45000}}});await p.clock.tickAsync(10);
  assert.equal(p.$('activity').hidden,false);assert.equal(p.$('controls').disabled,true);assert.match(p.$('activityDetail').textContent,/32 messages collected/);
  assert.equal(p.w.document.body.dataset.theme,'dark');assert.equal(p.$('elapsed').textContent,'0:45');
  p.model.info.activeExport=false;Object.assign(p.model.info.exportStatus,{state:'done',label:'File sent to Firefox',finishedAt:0});p.model.info.theme='light';
  await p.clock.tickAsync(1050);assert.equal(p.$('exportButton').disabled,false);assert.equal(p.w.document.body.dataset.theme,'light');p.close();
});
test('connection loss disables further exports until reconnect',async()=>{
  const p=await popup();await p.clock.tickAsync(10);p.model.fail=true;await p.clock.tickAsync(1050);
  assert.equal(p.$('retry').hidden,false);assert.equal(p.$('exportButton').disabled,true);p.close();
});

test('reopened popup and page menu retain error diagnostics after the transient notice expires',async()=>{
  for(const panel of [true,false]) {
    const diagnostic={version:2,reason:'unsupported-rich-reference',context:'activity',marker:'entity',referenceCount:0};
    const p=await popup({panel,info:{exportStatus:{state:'error',label:'Unsupported reference',startedAt:-12000,finishedAt:-10000,format:'html',sourceDiagnostic:diagnostic}}});
    try {
      let copied;Object.defineProperty(p.w.navigator,'clipboard',{value:{writeText:async value=>{copied=value;}}});
      await p.clock.tickAsync(10);
      assert.equal(p.$('exportDiagnostic').hidden,false);assert.equal(p.$('exportDiagnostic').open,false);
      p.$('exportDiagnostic').open=true;p.$('copyDiagnostic').click();await p.clock.tickAsync(0);
      assert.deepEqual(JSON.parse(copied),diagnostic);assert.match(p.$('copyDiagnostic').textContent,/Copied/);
      await p.clock.tickAsync(1050);assert.equal(p.$('exportDiagnostic').open,true);assert.match(p.$('copyDiagnostic').textContent,/Copied/);
      p.model.info.exportStatus={state:'running',startedAt:0,format:'html'};p.model.info.activeExport=true;
      await p.clock.tickAsync(1050);assert.equal(p.$('exportDiagnostic').hidden,true);assert.equal(p.$('diagnosticText').textContent,'');
    } finally {p.close();}
  }
});

test('embedded menu binds to its owner, keeps settings and collapses only after accepted export',async()=>{
  const p=await popup({panel:true,saved:{format:'html',includeUserImages:false,notifyOnCompletion:true}});
  try {
    await p.clock.tickAsync(10);assert.equal(p.model.queries,0);assert.equal(p.model.contexts,1);
    assert.equal(p.$('collapsePanel').hidden,false);assert.equal(p.$('notifyOnCompletion').checked,true);
    p.$('exportButton').click();await p.clock.tickAsync(10);
    const sent=p.model.calls.find(r=>r.type==='BEGIN_EXPORT');assert.equal(sent.job.format,'html');assert.equal(sent.job.options.includeUserImages,false);
    assert.ok(p.model.calls.some(r=>r.type==='PANEL_COLLAPSE'));assert.equal(p.model.closed,false);
  } finally {p.close();}
});

test('an empty ChatGPT tab still offers the archive without enabling single-chat export',async()=>{
  const p=await popup({info:{count:0}});
  try {await p.clock.tickAsync(10);assert.equal(p.$('archiveChats').hidden,false);assert.equal(p.$('archiveChats').matches(':disabled'),false);assert.equal(p.$('exportButton').disabled,true);}
  finally {p.close();}
});

test('ZIP sits with formats, opens the archive, and does not change the single-chat format',async()=>{
  const p=await popup({saved:{format:'md'}});try {
    await p.clock.tickAsync(10);
    let archiveRequest;
    p.w.browser.runtime.sendMessage=async request=>{archiveRequest=request;return {ok:true};};
    assert.ok(p.$('archiveChats').closest('.formats'));
    assert.equal(p.$('archiveChats').textContent,'[ZIP]');
    assert.match(p.$('archiveChats').getAttribute('aria-label'),/all chats archive/);
    p.$('archiveChats').click();await p.clock.tickAsync(10);
    assert.equal(archiveRequest.type,'ARCHIVE_OPEN');assert.equal(archiveRequest.tabId,1);
    assert.equal(p.model.calls.some(r=>r.type==='BEGIN_EXPORT'),false);
    assert.equal(p.w.document.querySelector('[name=format]:checked').value,'md');
  }finally{p.close();}
});

test('missing persistent site access offers opt-in for only the current supported site',async()=>{
  for(const hostname of ['chatgpt.com','gemini.google.com']) {
    const requests=[];let granted=false;
    const p=await popup({url:`https://${hostname}/c/test`,permissions:{contains:async r=>r.origins?granted:false,request:async r=>{requests.push(JSON.parse(JSON.stringify(r)));granted=true;return true;}}});try {
      await p.clock.tickAsync(10);assert.equal(p.$('siteAccess').hidden,false);assert.equal(requests.length,0);
      p.$('enableSiteAccess').click();await p.clock.tickAsync(10);
      assert.deepEqual(requests,[{origins:[`https://${hostname}/*`]}]);
      assert.equal(p.$('enableSiteAccess').hidden,true);assert.match(p.$('siteAccessStatus').textContent,/enabled/);
    }finally{p.close();}
  }
});

test('site access denial keeps export usable, while existing permission and embedded menus show no prompt',async()=>{
  const denied=await popup({permissions:{contains:async()=>false,request:async()=>false}});try {
    await denied.clock.tickAsync(10);denied.$('enableSiteAccess').click();await denied.clock.tickAsync(10);
    assert.equal(denied.$('enableSiteAccess').hidden,false);assert.match(denied.$('siteAccessStatus').textContent,/not enabled/);
    assert.equal(denied.$('exportButton').disabled,false);
  }finally{denied.close();}
  for(const config of [{permissions:{contains:async()=>true}},{panel:true},{url:'https://example.com/'}]) {
    const p=await popup(config);try{await p.clock.tickAsync(10);assert.equal(p.$('siteAccess').hidden,true);}finally{p.close();}
  }
});

test('toolbar Stop remains available when in-page status is collapsed on a narrow viewport',async()=>{
  const p=await popup({info:{activeExport:true,exportStatus:{state:'running',startedAt:0,format:'html',cancellable:true}}});
  try {await p.clock.tickAsync(10);assert.equal(p.$('stopExport').hidden,false);p.$('stopExport').click();await p.clock.tickAsync(10);assert.ok(p.model.calls.some(r=>r.type==='STOP_EXPORT'));}
  finally {p.close();}
});

test('toolbar and embedded menu restore pending Save/Discard choices and do not decide automatically',async()=>{
  for(const panel of [true,false])for(const canSaveCollected of [true,false]){
    const p=await popup({panel,info:{activeExport:true,exportStatus:{state:'decision',label:'Export stopped',stopDetail:'2 complete messages ready.',canSaveCollected,phase:'collecting',startedAt:-10000,finishedAt:0}}});
    try{
      await p.clock.tickAsync(6000);assert.equal(p.$('stopChoices').hidden,false);assert.equal(p.$('stopExport').hidden,true);
      assert.equal(p.$('saveCollected').disabled,!canSaveCollected);assert.equal(p.$('exportButton').disabled,true);
      assert.equal(p.model.calls.some(request=>request.type==='RESOLVE_STOP'),false);
      p.$(canSaveCollected?'saveCollected':'discardCollected').click();await p.clock.tickAsync(10);
      assert.deepEqual(copy(p.model.calls.filter(request=>request.type==='RESOLVE_STOP')),[{type:'RESOLVE_STOP',action:canSaveCollected?'save':'discard'}]);
    }finally{p.close();}
  }
});

test('dedicated notification settings request permission only on click and persist success',async()=>{
  for(const granted of [true,false]){
    const e=environment(read('popup/notifications.html'));let requests=0,saved=null;
    try {
      e.w.browser={permissions:{request:async()=>{requests++;return granted;}},storage:{local:{set:async value=>{saved=value;}}}};
      e.w.eval(read('popup/notifications.js'));assert.equal(requests,0);
      e.w.document.getElementById('enable').click();await e.clock.tickAsync(1);
      assert.equal(requests,1);assert.equal(saved?.notifyOnCompletion===true,granted);
      assert.match(e.w.document.getElementById('result').textContent,granted?/Enabled/:/remain off/);
    } finally {e.close();}
  }
});

test('notifications default off and request permission only from the opt-in gesture, then persist with the job',async()=>{
  let requests=0,grant;
  const p=await popup({permissions:{contains:async()=>true,request:()=>{requests++;return new Promise(resolve=>{grant=resolve;});}}});
  try {
    await p.clock.tickAsync(10);assert.equal(p.$('notifyOnCompletion').checked,false);assert.equal(requests,0);
    p.$('notifyOnCompletion').click();assert.equal(requests,1);assert.equal(p.$('controls').disabled,true);
    grant(true);await p.clock.tickAsync(10);assert.equal(p.model.saved.notifyOnCompletion,true);assert.equal(p.$('controls').disabled,false);
    p.$('exportButton').click();await p.clock.tickAsync(10);
    assert.equal(p.model.calls.find(r=>r.type==='BEGIN_EXPORT').job.options.notifyOnCompletion,true);
  } finally {p.close();}
});

test('notification permission denial or failure leaves export available and notifications off',async()=>{
  for(const request of [async()=>false,()=>{throw Error('Permission unavailable');}]){
    const p=await popup({permissions:{contains:async()=>false,request}});
    try {
      await p.clock.tickAsync(10);p.$('notifyOnCompletion').click();await p.clock.tickAsync(10);
      assert.equal(p.model.saved.notifyOnCompletion,false);assert.equal(p.$('notifyOnCompletion').checked,false);
      assert.equal(p.$('exportButton').disabled,false);assert.match(p.$('error').textContent,/status is still shown/);
    } finally {p.close();}
  }
});

test('notification preference restores only with permission; switching it off does not request permission',async()=>{
  for(const granted of [true,false]){
    let requests=0;
    const p=await popup({saved:{notifyOnCompletion:true},permissions:{contains:async()=>granted,request:async()=>{requests++;return true;}}});
    try {
      await p.clock.tickAsync(10);assert.equal(p.$('notifyOnCompletion').checked,granted);assert.equal(requests,0);
      if(granted){p.$('notifyOnCompletion').click();await p.clock.tickAsync(10);assert.equal(p.model.saved.notifyOnCompletion,false);assert.equal(requests,0);}
    } finally {p.close();}
  }
});

function content() {
  const env=environment('<!doctype html><html class="light"><head><title>Weekend ideas</title></head><body><main><article data-testid="conversation-turn-0" data-message-author-role="user"><p>First question</p></article><article data-testid="conversation-turn-1" data-message-author-role="assistant"><p>An answer with a <a href="https://example.com/read">reference</a>.</p></article></main></body></html>');
  const {w}=env;let listener;const sent=[];let readyResult={ok:true};
  w.browser={runtime:{onMessage:{addListener:fn=>{listener=fn;}},sendMessage:async req=>{sent.push(req);return typeof readyResult==='function'?readyResult(req):readyResult;}}};
  w.eval(read('shared/timestamps.js'));w.eval(read('content/timestamps.js'));w.eval(read('content/extract.js'));w.eval(read('content/content.js'));
  return {...env,sent,send:req=>listener(req),result:value=>{readyResult=value;},nodes:()=>w.document.querySelectorAll('[data-message-author-role]')};
}
const job={format:'md',filename:'example.md',options:{selectedOnly:true,includeTitle:true,includeLinks:true}};

test('Stop and image failure offer a persistent explicit choice before a partial single-file handoff',async()=>{
  for(const reason of ['stopped','image-error'])for(const action of ['save','discard']){
    const c=content();
    try{
      c.w.ChatArchiveApi={eligible:()=>true,collect:async()=>{
        await new Promise(resolve=>c.w.setTimeout(resolve,20));
        const error=Error('Image 3 unavailable');error[reason==='stopped'?'exportStopped':'imageEmbedFailed']=true;
        if(reason==='image-error')error.mediaDiagnostic={version:3,phase:'download',image:3,total:8,download:{code:'IMAGE_HTTP_ERROR',httpStatus:403}};
        error.partialData={provider:'ChatGPT',url:c.w.location.href,messages:[{order:0,role:'user',html:'<p>Complete</p>'}],partialExport:{reason,messages:1,totalMessages:5}};
        throw error;
      }};
      await c.send({type:'BEGIN_EXPORT',job:{format:'html',filename:'partial.html',options:{}}});
      if(reason==='stopped')await c.send({type:'STOP_EXPORT'});
      await c.clock.tickAsync(50);
      assert.equal((await c.send({type:'PING'})).exportStatus.state,'decision');
      assert.ok(c.w.document.querySelector('.chat-archive-stop-choice'));
      assert.equal((await c.send({type:'BEGIN_EXPORT',job})).ok,false);
      assert.equal((await c.send({type:'RESOLVE_STOP',action:'unknown'})).ok,false);
      await c.clock.tickAsync(6000);assert.ok(c.w.document.querySelector('.chat-archive-stop-choice'));
      assert.equal(c.sent.some(request=>request.type==='EXPORT_READY'),false);
      if(reason==='image-error')assert.match(c.w.document.querySelector('.chat-archive-image-diagnostic pre').textContent,/403/);
      c.w.document.querySelector(`.chat-archive-stop-choice [data-action="${action}"]`).click();await c.clock.tickAsync(10);
      const ready=c.sent.filter(request=>request.type==='EXPORT_READY');assert.equal(ready.length,action==='save'?1:0);
      const status=(await c.send({type:'PING'})).exportStatus;
      assert.equal(status.state,action==='save'?'done':'error');
      assert.match(status.label,action==='save'?/Partial export/:/discarded/);
      if(action==='save'){assert.equal(ready[0].data.messages.length,1);assert.equal(ready[0].data.partialExport.reason,reason);}
      await c.clock.tickAsync(5000);assert.equal(c.w.document.querySelector('.chat-archive-progress'),null);
    }finally{c.close();}
  }
});

test('staged partial parts survive the choice, save in order for HTML/PDF, and discard cleans them',async()=>{
  for(const format of ['html','pdf'])for(const action of ['save','discard','navigate']){
    const c=content();
    try{
      c.result(request=>request.type==='EXPORT_PARTS_START'?{ok:true,id:'staged'}:{ok:true});
      c.w.ChatArchiveApi={eligible:()=>true,collect:async(options,check,progress,onPart)=>{
        for(let order=0;order<2;order++)await onPart({url:c.w.location.href,messages:[{order,html:'<p>Complete</p>'}]});
        const error=Error('Stopped');error.exportStopped=true;
        error.partialData={url:c.w.location.href,messages:[],multipart:{parts:2,messages:2},partialExport:{reason:'stopped',messages:2,totalMessages:9}};throw error;
      }};
      await c.send({type:'BEGIN_EXPORT',job:{format,filename:`partial.${format}`,options:{}}});await c.clock.tickAsync(10);
      assert.equal(c.sent.filter(request=>request.type==='EXPORT_PARTS_ABORT').length,0);
      assert.equal((await c.send({type:'PING'})).exportStatus.state,'decision');
      if(action==='navigate')c.w.history.pushState({},'','/c/different');
      else await c.send({type:'RESOLVE_STOP',action});
      await c.clock.tickAsync(200);
      const sealed=c.sent.filter(request=>request.type==='EXPORT_PARTS_SEAL');
      if(action==='save'){
        assert.equal(sealed.length,1);assert.equal(sealed[0].summary.partialExport.messages,2);
        assert.deepEqual(c.sent.filter(request=>request.type==='EXPORT_PARTS_SAVE').map(request=>request.index),format==='html'?[1,2]:[]);
        assert.equal(c.sent.filter(request=>request.type==='EXPORT_PARTS_PRINT').length,format==='pdf'?1:0);
        assert.equal(c.sent.filter(request=>request.type==='EXPORT_PARTS_ABORT').length,0);
        assert.match((await c.send({type:'PING'})).exportStatus.label,/Partial export/);
      }else{
        assert.equal(sealed.length,0);assert.ok(c.sent.some(request=>request.type==='EXPORT_PARTS_ABORT'));
        assert.equal(c.sent.some(request=>['EXPORT_READY','EXPORT_PARTS_SAVE','EXPORT_PARTS_PRINT'].includes(request.type)),false);
      }
      assert.equal((await c.send({type:'PING'})).activeExport,false);
    }finally{c.close();}
  }
});

test('early Stop disables saving when no complete message is available',async()=>{
  const c=content();try{
    c.w.ChatArchiveApi={eligible:()=>true,collect:async()=>{const error=Error('Stopped');error.exportStopped=true;throw error;}};
    await c.send({type:'BEGIN_EXPORT',job:{...job,format:'html'}});await c.clock.tickAsync(10);
    assert.equal(c.w.document.querySelector('.chat-archive-stop-choice [data-action="save"]').disabled,true);
    assert.equal((await c.send({type:'RESOLVE_STOP',action:'save'})).ok,false);
    assert.equal((await c.send({type:'RESOLVE_STOP',action:'discard'})).ok,true);await c.clock.tickAsync(10);
    assert.equal((await c.send({type:'PING'})).activeExport,false);assert.equal(c.sent.some(request=>request.type==='EXPORT_READY'),false);
  }finally{c.close();}
});

test('closing a source page with a pending stop choice releases the job without recreating the status',async()=>{
  const c=content();try{
    c.w.ChatArchiveApi={eligible:()=>true,collect:async()=>{const error=Error('Stopped');error.exportStopped=true;throw error;}};
    await c.send({type:'BEGIN_EXPORT',job:{...job,format:'html'}});await c.clock.tickAsync(10);
    assert.equal((await c.send({type:'PING'})).exportStatus.state,'decision');
    c.w.dispatchEvent(new c.w.Event('pagehide'));await c.clock.tickAsync(10);
    assert.equal((await c.send({type:'PING'})).activeExport,false);
    assert.equal(c.w.document.querySelector('.chat-archive-progress'),null);
    assert.equal(c.sent.some(request=>request.type==='EXPORT_READY'),false);
  }finally{c.close();}
});

test('Stop during HTML saving finishes the current file then offers saving or discarding the remainder',async()=>{
  for(const action of ['save','discard']){
    const c=content();try{
      let finishFirst;
      c.result(request=>request.type==='EXPORT_PARTS_START'?{ok:true,id:'staged'}:request.type==='EXPORT_PARTS_SAVE'&&request.index===1?new Promise(resolve=>{finishFirst=resolve;}):{ok:true});
      c.w.ChatArchiveApi={eligible:()=>true,collect:async(options,check,progress,onPart)=>{
        for(let order=0;order<2;order++)await onPart({url:c.w.location.href,messages:[{order,html:'<p>Complete</p>'}]});
        return {data:{url:c.w.location.href,messages:[],multipart:{parts:2,messages:2}}};
      }};
      await c.send({type:'BEGIN_EXPORT',job:{format:'html',filename:'full.html',options:{}}});await c.clock.tickAsync(10);
      await c.send({type:'STOP_EXPORT'});await c.clock.tickAsync(200);
      assert.deepEqual(c.sent.filter(request=>request.type==='EXPORT_PARTS_SAVE').map(request=>request.index),[1]);
      assert.equal(c.sent.some(request=>request.type==='EXPORT_PARTS_ABORT'),false);
      finishFirst({ok:true});await c.clock.tickAsync(10);
      assert.equal((await c.send({type:'PING'})).exportStatus.state,'decision');
      assert.match((await c.send({type:'PING'})).exportStatus.stopDetail,/1 file\(s\) already saved/);
      await c.send({type:'RESOLVE_STOP',action});await c.clock.tickAsync(10);
      assert.deepEqual(c.sent.filter(request=>request.type==='EXPORT_PARTS_SAVE').map(request=>request.index),action==='save'?[1,2]:[1]);
      assert.equal((await c.send({type:'PING'})).activeExport,false);
    }finally{c.close();}
  }
});
test('image permission failure offers a repair button; other download failures do not', async () => {
  for (const code of ['IMAGE_PERMISSION_REQUIRED', 'IMAGE_NETWORK_ERROR']) {
    const c = content();
    try {
      c.w.ChatArchiveApi = { eligible: () => true, collect: async () => {
        const error = new Error('Preview unavailable'); error.mediaDiagnostic = { version: 2, phase: 'download', download: { code } }; throw error;
      } };
      await c.send({ type: 'BEGIN_EXPORT', job: { ...job, format: 'html' } }); await c.clock.tickAsync(10);
      const button = c.w.document.querySelector('.chat-archive-image-access');
      assert.equal(!!button, code === 'IMAGE_PERMISSION_REQUIRED');
      assert.equal(c.sent.some(r => r.type === 'EXPORT_READY'), false);
      if (button) { button.click(); await c.clock.tickAsync(10); assert.equal(c.sent.filter(r => r.type === 'IMAGE_ACCESS_OPEN').length, 1); }
    } finally { c.close(); }
  }
});
test('page picker updates count and accessibility, clear and Escape work without leaking controls into exports',async()=>{
  const c=content();await c.send({type:'SET_PICKING',enabled:true});await c.clock.tickAsync(10);
  c.w.document.querySelector('.chat-archive-picker').click();await c.clock.tickAsync(10);
  assert.match(c.w.document.querySelector('.chat-archive-selection-bar').textContent,/1 selected/);
  assert.equal(c.w.document.querySelector('.chat-archive-picker').getAttribute('aria-pressed'),'true');
  let data=c.w.ChatArchiveExtractor.collect({selectedOnly:true});assert.equal(data.messages.length,1);assert.equal(data.messages[0].text,'First question');
  c.w.document.querySelector('.chat-archive-clear').click();await c.clock.tickAsync(10);assert.equal((await c.send({type:'PING'})).selected,0);
  c.w.document.querySelector('.chat-archive-picker').click();c.w.document.dispatchEvent(new c.w.KeyboardEvent('keydown',{key:'Escape',bubbles:true}));
  assert.equal(c.w.document.querySelectorAll('.chat-archive-picker').length,0);assert.equal(c.w.document.querySelectorAll('.chat-archive-picked').length,0);assert.equal((await c.send({type:'PING'})).selected,1);c.close();
});
test('new messages get pickers without a MutationObserver feedback loop; theme follows body and root',async()=>{
  const c=content();await c.send({type:'SET_PICKING',enabled:true});await c.clock.tickAsync(10);
  const node=c.w.document.createElement('article');node.dataset.messageAuthorRole='user';node.textContent='Another question';c.w.document.querySelector('main').append(node);await c.clock.tickAsync(10);
  assert.equal(c.w.document.querySelectorAll('.chat-archive-picker').length,3);
  c.w.document.documentElement.className='';c.w.document.body.className='dark-theme';await c.clock.tickAsync(1010);
  assert.equal(c.w.document.querySelector('.chat-archive-selection-bar').dataset.theme,'dark');
  c.w.document.body.className='';c.w.document.documentElement.style.backgroundColor='white';await c.clock.tickAsync(1010);
  assert.equal((await c.send({type:'PING'})).theme,'light');c.close();
});
test('content locks duplicate exports and selection changes, then reports success honestly',async()=>{
  const c=content();c.nodes()[1].dataset.chatArchiveSelected='true';let finish;
  c.result(req=>req.type==='EXPORT_READY'?new Promise(resolve=>{finish=resolve;}):{ok:true});
  const first=await c.send({type:'BEGIN_EXPORT',job});assert.equal(first.ok,true);
  let listeners=0;c.w.browser.runtime.onMessage.addListener=()=>listeners++;
  c.w.eval(read('content/content.js'));assert.equal(listeners,0,'restoring scripts cannot replace the active export listener');
  const second=await c.send({type:'BEGIN_EXPORT',job});assert.equal(second.ok,false);
  assert.equal((await c.send({type:'CLEAR_SELECTION'})).ok,false);await c.clock.tickAsync(10);
  const ping=await c.send({type:'PING'});assert.equal(ping.activeExport,true);assert.equal(ping.exportStatus.processed,1);
  const data=c.sent.find(r=>r.type==='EXPORT_READY').data;assert.equal(data.messages.length,1);assert.match(data.messages[0].markdown,/\[reference\]\(https:\/\/example.com\/read\)/);
  finish({ok:true});await c.clock.tickAsync(10);assert.equal((await c.send({type:'PING'})).activeExport,false);assert.equal((await c.send({type:'PING'})).exportStatus.state,'done');
  assert.match(c.w.document.querySelector('.chat-archive-progress').textContent,/File sent to Firefox/);c.close();
});
test('failed file handoff leaves a readable error that can be dismissed',async()=>{
  const c=content();c.nodes()[0].dataset.chatArchiveSelected='true';c.result({ok:false,error:'The save dialog was cancelled.'});
  await c.send({type:'BEGIN_EXPORT',job});await c.clock.tickAsync(20);
  const ping=await c.send({type:'PING'});assert.equal(ping.activeExport,false);assert.equal(ping.exportStatus.state,'error');
  assert.match(c.w.document.querySelector('.chat-archive-progress').textContent,/save dialog was cancelled/);
  c.w.document.querySelector('.chat-archive-dismiss').click();assert.equal(c.w.document.querySelector('.chat-archive-progress'),null);c.close();
});

test('successful export disappears after five seconds and notifies only once',async()=>{
  const c=content();
  try {
    c.nodes()[0].dataset.chatArchiveSelected='true';
    await c.send({type:'BEGIN_EXPORT',job:{...job,options:{...job.options,notifyOnCompletion:true}}});
    await c.clock.tickAsync(10);
    const status = (await c.send({type:'PING'})).exportStatus;
    await c.clock.tickAsync(status.finishedAt + 4999 - c.w.Date.now());
    assert.equal((await c.send({type:'PING'})).exportStatus.state,'done');
    assert.match(c.w.document.querySelector('.chat-archive-progress').textContent,/File sent to Firefox/);
    assert.deepEqual(copy(c.sent.filter(r=>r.type==='EXPORT_COMPLETE')),[{type:'EXPORT_COMPLETE',format:'md',parts:1,notify:true}]);
    await c.clock.tickAsync(1);
    assert.equal(c.w.document.querySelector('.chat-archive-progress'),null);
    assert.equal(c.sent.filter(r=>r.type==='EXPORT_DISMISSED').length,1);
    await c.clock.tickAsync(60000);
    assert.equal(c.sent.filter(r=>r.type==='EXPORT_DISMISSED').length,1);
  } finally {c.close();}
});

test('an old dismissal timer cannot remove a later running export; errors get their own five seconds',async()=>{
  const c=content();
  try {
    c.nodes()[0].dataset.chatArchiveSelected='true';
    await c.send({type:'BEGIN_EXPORT',job}); await c.clock.tickAsync(1000);
    let finish;
    c.result(req=>req.type==='EXPORT_READY'?new Promise(resolve=>{finish=resolve;}):{ok:true});
    await c.send({type:'BEGIN_EXPORT',job}); await c.clock.tickAsync(6000);
    assert.equal(c.w.document.querySelector('.chat-archive-progress').dataset.state,'running');
    finish({ok:false,error:'Download unavailable'}); await c.clock.tickAsync(10);
    const status=(await c.send({type:'PING'})).exportStatus;
    await c.clock.tickAsync(status.finishedAt+4999-c.w.Date.now());
    assert.equal(c.w.document.querySelector('.chat-archive-progress').dataset.state,'error');
    assert.match(c.w.document.querySelector('.chat-archive-progress').textContent,/Download unavailable/);
    assert.equal(c.sent.filter(r=>r.type==='EXPORT_DISMISSED').length,0);
    await c.clock.tickAsync(1);
    assert.equal(c.w.document.querySelector('.chat-archive-progress'),null);
    assert.equal(c.sent.filter(r=>r.type==='EXPORT_DISMISSED').length,1);
  } finally {c.close();}
});

test('manual dismissal clears completion timers; restored pages honor the original five-second deadline for success and error',async()=>{
  for (const manual of [true,false]) for (const failed of [true,false]) {
    const c=content();
    try {
      c.nodes()[0].dataset.chatArchiveSelected='true';
      if(failed)c.result({ok:false,error:'Download unavailable'});
      await c.send({type:'BEGIN_EXPORT',job}); await c.clock.tickAsync(1000);
      if (manual) c.w.document.querySelector('.chat-archive-dismiss').click();
      else c.w.dispatchEvent(new c.w.Event('pagehide'));
      await c.clock.tickAsync(10000);
      c.w.dispatchEvent(new c.w.PageTransitionEvent('pageshow',{persisted:true}));
      await c.clock.tickAsync(1);
      assert.equal(c.w.document.querySelector('.chat-archive-progress'),null);
      assert.equal(c.sent.filter(r=>r.type==='EXPORT_DISMISSED').length,1);
    } finally {c.close();}
  }
});

test('multipart completion sends one final notification only after every HTML part or PDF handoff',async()=>{
  for(const format of ['html','pdf']){
    const c=content();
    try {
      c.w.ChatArchiveApi={eligible:()=>true,collect:async(options,check,progress,onPart)=>{
        const data={provider:'ChatGPT',url:c.w.location.href};
        for(let order=0;order<3;order++)await onPart({...data,messages:[{id:`m${order}`,order,role:'user',html:'<p>Test</p>'}]});
        return {data:{...data,messages:[],multipart:{parts:3,messages:3}}};
      }};
      c.result(req=>req.type==='EXPORT_PARTS_START'?{ok:true,id:'fixture'}:{ok:true});
      await c.send({type:'BEGIN_EXPORT',job:{format,filename:`test.${format}`,options:{notifyOnCompletion:true}}});await c.clock.tickAsync(1000);
      const completed=c.sent.filter(r=>r.type==='EXPORT_COMPLETE');
      assert.deepEqual(copy(completed),[{type:'EXPORT_COMPLETE',format,parts:3,notify:true}]);
      const handoffs=c.sent.filter(r=>r.type===(format==='html'?'EXPORT_PARTS_SAVE':'EXPORT_PARTS_PRINT'));
      assert.equal(handoffs.length,format==='html'?3:1);
      assert.ok(c.sent.indexOf(completed[0])>c.sent.indexOf(handoffs.at(-1)));
    } finally {c.close();}
  }
});

test('an unsupported saved-chat export retains its diagnostic without starting page image collection',async()=>{
  const c=content();
  try {
    const sourceDiagnostic={version:1,reason:'unmapped-tool-images',imageParts:3,images:[]};
    c.w.ChatArchiveApi={eligible:()=>true,conversationId:()=> 'saved-chat',collect:async()=>({fallback:'This generated-image response needs collection from the page.',sourceDiagnostic})};
    let imageChecks=0;
    c.w.ChatArchiveMedia={beginExport(){},endExport(){},async waitForImages(){
      imageChecks++;
      const error=Error('This export exceeds the image memory limit.');
      error.mediaDiagnostic={version:2,phase:'budget',exceeded:'imageCharacters',attempted:{assets:3,imageCharacters:17000000}};
      throw error;
    }};
    await c.send({type:'BEGIN_EXPORT',job:{format:'html',filename:'images.html',options:{selectedOnly:false}}});
    await c.clock.tickAsync(10);
    const status=(await c.send({type:'PING'})).exportStatus;
    assert.equal(status.state,'error');
    assert.match(c.w.document.querySelector('.chat-archive-progress-detail').textContent,/generated-image response/);
    assert.equal(JSON.parse(c.w.document.querySelector('.chat-archive-source-diagnostic pre').textContent).imageParts,3);
    assert.equal(imageChecks,0);
    assert.equal(c.w.document.querySelector('.chat-archive-image-diagnostic pre'),null);
    assert.equal(c.sent.some(request=>request.type==='EXPORT_READY'),false);
    await c.clock.tickAsync(30000);
    assert.equal(c.w.document.querySelector('.chat-archive-progress'),null);
    assert.equal((await c.send({type:'PING'})).exportStatus.sourceDiagnostic.imageParts,3);
  } finally {c.close();}
});
test('All still collects the entire already-loaded fixture through the unchanged scan',async()=>{
  const c=content();await c.send({type:'BEGIN_EXPORT',job:{...job,options:{...job.options,selectedOnly:false}}});await c.clock.tickAsync(30000);
  const ready=c.sent.find(r=>r.type==='EXPORT_READY');assert.ok(ready);assert.equal(ready.data.messages.length,2);assert.equal(ready.data.messages[0].text,'First question');
  assert.equal((await c.send({type:'PING'})).exportStatus.state,'done');c.close();
});

test('image switches persist for HTML/PDF and the removed details preference is ignored',async()=>{
  const p=await popup({saved:{includeImageDetails:true}});
  try {
    await p.clock.tickAsync(10);
    assert.equal(p.$('includeUserImages').checked,true);assert.equal(p.$('includeAssistantImages').checked,true);
    assert.equal(p.$('includeImageDetails'),null);assert.equal(p.$('imageOptions').hidden,true);
    p.radio('format','html');assert.equal(p.$('imageOptions').hidden,false);
    p.$('includeUserImages').click();await p.clock.tickAsync(10);
    assert.equal(p.model.saved.includeUserImages,false);assert.equal(p.model.saved.includeAssistantImages,true);
    p.$('exportButton').click();await p.clock.tickAsync(10);
    const options=p.model.calls.find(r=>r.type==='BEGIN_EXPORT').job.options;
    assert.equal(options.includeUserImages,false);assert.equal(options.includeAssistantImages,true);assert.equal(options.includeImageDetails,undefined);
  } finally {p.close();}
  const q=await popup({saved:{format:'md',includeUserImages:false,includeAssistantImages:false,includeImageDetails:true}});
  try {await q.clock.tickAsync(10);q.$('exportButton').click();await q.clock.tickAsync(10);
    const options=q.model.calls.find(r=>r.type==='BEGIN_EXPORT').job.options;
    assert.equal(options.includeUserImages,true);assert.equal(options.includeAssistantImages,true);assert.equal(options.includeImageDetails,undefined);
  } finally {q.close();}
});

test('multipart handoff seals all parts first and reports an incomplete download without claiming full success',async()=>{
  const c=content();
  try {
    c.w.ChatArchiveApi={eligible:()=>true,collect:async(options,check,progress,onPart)=>{
      const data={provider:'ChatGPT',url:c.w.location.href};
      for(let order=0;order<2;order++)await onPart({...data,messages:[{id:`m${order}`,order,role:'user',html:'<p>Test</p>'}]});
      return {data:{...data,messages:[],multipart:{parts:2,messages:2}}};
    }};
    c.result(req=>req.type==='EXPORT_PARTS_START'?{ok:true,id:'fixture'}:req.type==='EXPORT_PARTS_SAVE'&&req.index===2?{ok:false,error:'Download interrupted'}:{ok:true});
    await c.send({type:'BEGIN_EXPORT',job:{format:'html',filename:'test.html',options:{notifyOnCompletion:true}}});await c.clock.tickAsync(1000);
    const status=(await c.send({type:'PING'})).exportStatus;
    assert.equal(status.state,'error');assert.match(status.label,/Export incomplete\. 1 part\(s\) confirmed saved/);
    const steps=c.sent.filter(req=>req.type.startsWith('EXPORT_PARTS_')).map(req=>req.type);
    assert.deepEqual(steps,['EXPORT_PARTS_START','EXPORT_PARTS_STAGE','EXPORT_PARTS_STAGE','EXPORT_PARTS_SEAL','EXPORT_PARTS_SAVE','EXPORT_PARTS_SAVE','EXPORT_PARTS_ABORT']);
    assert.equal(c.sent.some(req=>req.type==='EXPORT_READY'),false);
    assert.equal(c.sent.some(req=>req.type==='EXPORT_COMPLETE'),false);
    assert.deepEqual(copy(c.sent.filter(req=>req.type==='EXPORT_FAILED')),[{type:'EXPORT_FAILED',notify:true}]);
  } finally {c.close();}
});

test('page fallback applies image choices before decoding/capture and preserves the other role',async()=>{
  for(const includeUserImages of [true,false]) {
    const c=content();
    try {
      c.w.eval(read('content/media.js'));
      for(const [index,node] of [...c.nodes()].entries()) {
        node.dataset.chatArchiveSelected='true';
        const img=c.w.document.createElement('img');img.src='data:image/png;base64,iVBORw0KGgo=';node.append(img);
        Object.defineProperties(img,{complete:{value:true},naturalWidth:{value:1},naturalHeight:{value:1}});
        img.decode=async()=>{if((index===0)!==includeUserImages)throw Error('Excluded image must not decode');};
      }
      await c.send({type:'BEGIN_EXPORT',job:{format:'html',filename:'test.html',options:{selectedOnly:true,includeUserImages,includeAssistantImages:!includeUserImages,includeImageDetails:true}}});
      await c.clock.tickAsync(1000);
      const ready=c.sent.find(req=>req.type==='EXPORT_READY');assert.ok(ready,(await c.send({type:'PING'})).exportStatus.label);
      assert.equal(ready.data.messages.length,2);
      assert.equal(ready.data.messages[0].html.includes('<img'),includeUserImages);
      assert.equal(ready.data.messages[1].html.includes('<img'),!includeUserImages);
      assert.doesNotMatch(ready.data.messages[includeUserImages?0:1].html,/figcaption|original file not verified|Image from ChatGPT response/);
    } finally {c.close();}
  }
});

test('a rejected new export is not hidden by an older completed export',async()=>{
  const p=await popup({info:{exportStatus:{state:'done',label:'File sent to Firefox',startedAt:-5000,finishedAt:-1000,format:'md'}},handle:req=>req.type==='BEGIN_EXPORT'?{ok:false,error:'Please wait for the page to finish loading.'}:undefined});
  await p.clock.tickAsync(10);p.$('exportButton').click();await p.clock.tickAsync(10);
  assert.equal(p.$('errorBox').hidden,false);assert.match(p.$('error').textContent,/Please wait/);assert.equal(p.$('exportButton').disabled,false);p.close();
});
for (const compactPagination of [false,true]) test(`PDF handoff preserves document, filename and pagination (${compactPagination})`,async()=>{
  const env=environment('<html></html>');const {w}=env;let handler;let created;
  w.ChatArchiveRenderers={html:()=>'<html><head><title>Original title</title></head><body><main><article>Readable dialogue</article></main></body></html>'};
  w.browser={runtime:{onMessage:{addListener:fn=>handler=fn},getURL:p=>`https://extension.invalid/${p}`},downloads:{onChanged:{addListener:()=>{}}},action:{setBadgeText:async()=>{},setBadgeBackgroundColor:async()=>{}},tabs:{create:async({url})=>{created=url;}}};
  w.eval(read('background.js'));
  assert.equal((await handler({type:'EXPORT_READY',job:{...job,options:{...job.options,compactPagination},format:'pdf',filename:'my-notes-2026-09-10.pdf'},data:{messages:[]}})).ok,true);
  const id=new URL(created).searchParams.get('id');const result=await handler({type:'GET_PRINT_PAGE',id});
  assert.equal(result.filename,'my-notes-2026-09-10.pdf');
  assert.equal(result.compactPagination,compactPagination);
  const printEnv=environment(read('print/print.html'),created);printEnv.w.browser={runtime:{sendMessage:async()=>result}};
  printEnv.w.eval(read('print/print.js'));await printEnv.clock.tickAsync(10);
  assert.equal(printEnv.w.document.title,'my-notes-2026-09-10');assert.equal(printEnv.w.document.getElementById('printButton').disabled,false);
  assert.equal(printEnv.w.document.querySelector('#document main').textContent,'Readable dialogue');
  assert.equal(printEnv.w.document.body.classList.contains('compact-pagination'),compactPagination);
  assert.match(printEnv.w.document.querySelector('#paginationStatus').textContent,compactPagination?/on —/:/off —/);
  assert.match(printEnv.w.document.getElementById('suggestedName').textContent,/my-notes-2026-09-10.pdf/);printEnv.close();env.close();
});
test('an expired PDF has an honest status and no active print button',async()=>{
  const p=environment(read('print/print.html'),'https://extension.invalid/print/print.html?id=expired');
  p.w.browser={runtime:{sendMessage:async()=>({ok:false})}};p.w.eval(read('print/print.js'));await p.clock.tickAsync(10);
  assert.equal(p.w.document.getElementById('printButton').disabled,true);assert.match(p.w.document.getElementById('printStatus').textContent,/Could not prepare/);assert.match(p.w.document.getElementById('error').textContent,/expired/);p.close();
});

test('compact pagination defaults off, persists, and is sent only for HTML/PDF',async()=>{
  const p=await popup(); await p.clock.tickAsync(10);
  assert.equal(p.$('compactPagination').checked,false);
  assert.equal(p.$('compactPaginationOption').hidden,true);
  p.radio('format','pdf');
  assert.equal(p.$('compactPaginationOption').hidden,false);
  p.$('compactPagination').click(); await p.clock.tickAsync(10);
  assert.equal(p.model.saved.compactPagination,true);
  const saved=copy(p.model.saved); p.close();
  for(const format of ['pdf','html','md','txt','json']) {
    const q=await popup({saved:{...saved,format}}); await q.clock.tickAsync(10);
    assert.equal(q.$('compactPagination').checked,true);
    assert.equal(q.$('compactPaginationOption').hidden,!['pdf','html'].includes(format));
    q.$('exportButton').click(); await q.clock.tickAsync(10);
    assert.equal(q.model.calls.find(r=>r.type==='BEGIN_EXPORT').job.options.compactPagination,['pdf','html'].includes(format));
    q.close();
  }
});

test('PDF waits for image decoding before enabling print and reports failed images',async()=>{
  for (const fails of [false, true]) {
    const e=environment(read('print/print.html'),'https://fixture.invalid/print.html?id=media');
    let finish;
    e.w.HTMLImageElement.prototype.decode=()=>new Promise((resolve,reject)=>{finish=()=>fails?reject(Error('Unavailable')):resolve();});
    e.w.browser={runtime:{sendMessage:async()=>({ok:true,content:'<main><img src="https://fixture.invalid/image.png"></main>'})}};
    e.w.eval(read('print/print.js'));
    await e.clock.tickAsync(1);
    assert.equal(e.w.document.querySelector('#printButton').disabled,true);
    finish();await e.clock.tickAsync(1);
    assert.equal(e.w.document.querySelector('#printButton').disabled,false);
    assert.equal(e.w.document.querySelector('#error').textContent.includes('could not be loaded'),fails);
    e.close();
  }
});

test('PDF preview retains the partial-export warning even when document title is disabled',async()=>{
  const e=environment(read('print/print.html'),'https://fixture.invalid/print.html?id=partial');
  try{
    e.w.eval(read('shared/renderers.js'));
    const content=e.w.ChatArchiveRenderers.html({title:'Example',messages:[{role:'user',html:'<p>Complete</p>'}],partialExport:{reason:'image-error',messages:1,totalMessages:9}},{includeTitle:false});
    e.w.browser={runtime:{sendMessage:async()=>({ok:true,content,filename:'example-partial.pdf'})}};
    e.w.eval(read('print/print.js'));await e.clock.tickAsync(10);
    assert.match(e.w.document.querySelector('#document .export-partial-note').textContent,/1 of 9/);
    assert.match(e.w.document.querySelector('#printStatus').textContent,/partial PDF/);
    assert.equal(e.w.document.querySelector('#printButton').disabled,false);
  }finally{e.close();}
});

test('activity option defaults off, persists, and is disabled for Gemini',async()=>{
 const p=await popup();await p.clock.tickAsync(10);assert.equal(p.$('includeActivity').checked,false);
 p.$('includeActivity').click();await p.clock.tickAsync(10);const saved=copy(p.model.saved);
 p.$('exportButton').click();await p.clock.tickAsync(10);assert.equal(p.model.calls.find(r=>r.type==='BEGIN_EXPORT').job.options.includeActivity,true);p.close();
 const q=await popup({saved,info:{provider:'Gemini'}});await q.clock.tickAsync(10);assert.equal(q.$('includeActivity').checked,true);assert.equal(q.$('includeActivity').disabled,true);
 q.$('exportButton').click();await q.clock.tickAsync(10);assert.equal(q.model.calls.find(r=>r.type==='BEGIN_EXPORT').job.options.includeActivity,false);q.close();
});

test('direct PDF keeps printing disabled when an embedded image cannot be decoded',async()=>{
  const e=environment(read('print/print.html'),'https://fixture.invalid/print.html?id=direct');
  try {
    e.w.HTMLImageElement.prototype.decode=async()=>{throw Error('Broken image');};
    e.w.browser={runtime:{sendMessage:async()=>({ok:true,strictImages:true,content:'<main><img src="data:image/png;base64,invalid"></main>'})}};
    e.w.eval(read('print/print.js'));
    await e.clock.tickAsync(1);
    assert.equal(e.w.document.querySelector('#printButton').disabled,true);
    assert.match(e.w.document.querySelector('#error').textContent,/PDF preparation stopped/);
  } finally {e.close();}
});

test('message timestamps default off, persist when enabled and travel with the export job',async()=>{
  const p=await popup();await p.clock.tickAsync(10);
  assert.equal(p.$('includeTimestamps').checked,false);assert.equal(p.$('includeTimestamps').disabled,false);
  p.$('includeTimestamps').click();await p.clock.tickAsync(10);assert.equal(p.model.saved.includeTimestamps,true);
  p.$('exportButton').click();await p.clock.tickAsync(10);
  assert.equal(p.model.calls.find(r=>r.type==='BEGIN_EXPORT').job.options.includeTimestamps,true);
  const saved=copy(p.model.saved);p.close();
  const reopened=await popup({saved});await reopened.clock.tickAsync(10);assert.equal(reopened.$('includeTimestamps').checked,true);reopened.close();
});
test('Gemini explains the timestamp limitation and never requests unsupported timestamps',async()=>{
  const p=await popup({info:{provider:'Gemini'},saved:{includeTimestamps:true},url:'https://gemini.google.com/app/example'});await p.clock.tickAsync(10);
  assert.equal(p.$('includeTimestamps').disabled,true);assert.match(p.$('timestampsHint').textContent,/ChatGPT only/);
  p.$('exportButton').click();await p.clock.tickAsync(10);
  assert.equal(p.model.calls.find(r=>r.type==='BEGIN_EXPORT').job.options.includeTimestamps,false);p.close();
});
test('Selected timestamps describe only exported messages and missing dates do not prevent saving',async()=>{
  const c=content();c.nodes()[1].dataset.chatArchiveSelected='true';
  await c.send({type:'BEGIN_EXPORT',job:{...job,options:{...job.options,includeTimestamps:true}}});await c.clock.tickAsync(20);
  const ready=c.sent.find(r=>r.type==='EXPORT_READY');assert.equal(ready.data.messages.length,1);
  assert.equal(ready.data.messages[0].createdAt,null);assert.equal(ready.data.messageTimestamps.total,1);assert.equal(ready.data.messageTimestamps.available,0);
  const info=await c.send({type:'PING'});assert.equal(info.exportStatus.state,'done');assert.match(info.exportStatus.timestampNotice,/0 of 1/);
  assert.match(c.w.document.querySelector('.chat-archive-progress-detail').textContent,/Missing times/);
  const p=await popup({info});await p.clock.tickAsync(10);assert.match(p.$('activityDetail').textContent,/0 of 1/);p.close();c.close();
});
test('collection retains a known time when metadata disappears but rejects it for a regenerated message id',async()=>{
  for(const regenerate of [false,true]){
    const c=content(),host=c.w.document.querySelector('main'),node=c.nodes()[1];
    Object.defineProperty(c.w.document,'scrollingElement',{value:host});
    Object.defineProperties(host,{clientHeight:{value:600},scrollHeight:{value:600},scrollTop:{get:()=>0,set:()=>{}}});
    node.dataset.messageId='answer-original';node.__reactProps$fixture={message:{id:'answer-original',author:{role:'assistant'},create_time:1788777720}};
    c.w.setTimeout(()=>{delete node.__reactProps$fixture;if(regenerate)node.dataset.messageId='answer-regenerated';},100);
    await c.send({type:'BEGIN_EXPORT',job:{...job,options:{...job.options,selectedOnly:false,includeTimestamps:true}}});await c.clock.tickAsync(30000);
    const data=c.sent.find(r=>r.type==='EXPORT_READY')?.data;assert.ok(data);
    assert.equal(data.messages[1].createdAt,regenerate?null:'2026-09-07T10:42:00.000Z');
    c.close();
  }
});
test('virtualised conversation batches keep their own timestamps after earlier nodes are removed',async()=>{
  const c=content(),w=c.w,host=w.document.querySelector('main');let stage=2,top=1200,pending=false;
  const show=()=>{
    const nodes=[];
    for(let i=stage*2;i<stage*2+2;i++){
      const article=w.document.createElement('article');article.dataset.testid=`conversation-turn-${i}`;article.dataset.messageAuthorRole=i%2?'assistant':'user';article.dataset.messageId=`message-${i}`;article.textContent=`Message ${i}`;
      article.__reactFiber$fixture={memoizedProps:{message:{id:`message-${i}`,author:{role:article.dataset.messageAuthorRole},create_time:1788777720+i*60}}};nodes.push(article);
    }
    host.replaceChildren(...nodes);
  };
  show();Object.defineProperty(w.document,'scrollingElement',{value:host});
  Object.defineProperties(host,{clientHeight:{value:600},scrollHeight:{value:1800},scrollTop:{
    get:()=>top,set:value=>{
      top=Math.max(0,Math.min(1200,value));
      if(top===0&&stage>0&&!pending){pending=true;w.setTimeout(()=>{stage--;show();top=600;pending=false;},350);}
      else if(top>=1000&&stage<2&&!pending){stage++;show();top=600;}
    }
  }});
  await c.send({type:'BEGIN_EXPORT',job:{...job,options:{...job.options,selectedOnly:false,includeTimestamps:true}}});await c.clock.tickAsync(60000);
  const data=c.sent.find(r=>r.type==='EXPORT_READY')?.data;assert.ok(data);assert.equal(data.messages.length,6);assert.equal(data.messageTimestamps.available,6);
  data.messages.forEach((message,i)=>{assert.equal(message.text,`Message ${i}`);assert.equal(message.createdAt,new Date((1788777720+i*60)*1000).toISOString());});
  c.close();
});

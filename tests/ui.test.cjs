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
  const env = environment(read('popup/popup.html'), 'https://fixture.invalid/popup.html');
  const {w,clock} = env;
  const model = { info:{ ok:true,title:'Weekend ideas',provider:'ChatGPT',count:8,selected:0,picking:false,theme:'light',activeExport:false,exportStatus:null,...config.info },saved:config.saved||{},calls:[],closed:false };
  w.close = () => { model.closed=true; };
  w.browser = {
    runtime:{getManifest:()=>({version:'0.5.1'})},
    storage:{local:{get:async()=>copy(model.saved),set:async p=>{model.saved={...model.saved,...p};}}},
    tabs:{query:async()=>[{id:1,url:config.url||'https://chatgpt.com/c/test'}],sendMessage:async(_,req)=>{
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
test('unsupported pages and empty conversations explain the next action',async()=>{
  for(const config of [{url:'https://example.com/'},{info:{count:0}}]){
    const p=await popup(config);await p.clock.tickAsync(10);
    assert.equal(p.$('exportButton').disabled,true);assert.equal(p.$('errorBox').hidden,false);assert.match(p.$('error').textContent,/Open a conversation/);p.close();
  }
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

function content() {
  const env=environment('<!doctype html><html class="light"><head><title>Weekend ideas</title></head><body><main><article data-testid="conversation-turn-0" data-message-author-role="user"><p>First question</p></article><article data-testid="conversation-turn-1" data-message-author-role="assistant"><p>An answer with a <a href="https://example.com/read">reference</a>.</p></article></main></body></html>');
  const {w}=env;let listener;const sent=[];let readyResult={ok:true};
  w.browser={runtime:{onMessage:{addListener:fn=>{listener=fn;}},sendMessage:async req=>{sent.push(req);return typeof readyResult==='function'?readyResult(req):readyResult;}}};
  w.eval(read('shared/timestamps.js'));w.eval(read('content/timestamps.js'));w.eval(read('content/extract.js'));w.eval(read('content/content.js'));
  return {...env,sent,send:req=>listener(req),result:value=>{readyResult=value;},nodes:()=>w.document.querySelectorAll('[data-message-author-role]')};
}
const job={format:'md',filename:'example.md',options:{selectedOnly:true,includeTitle:true,includeLinks:true}};
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
test('All still collects the entire already-loaded fixture through the unchanged scan',async()=>{
  const c=content();await c.send({type:'BEGIN_EXPORT',job:{...job,options:{...job.options,selectedOnly:false}}});await c.clock.tickAsync(30000);
  const ready=c.sent.find(r=>r.type==='EXPORT_READY');assert.ok(ready);assert.equal(ready.data.messages.length,2);assert.equal(ready.data.messages[0].text,'First question');
  assert.equal((await c.send({type:'PING'})).exportStatus.state,'done');c.close();
});

test('a rejected new export is not hidden by an older completed export',async()=>{
  const p=await popup({info:{exportStatus:{state:'done',label:'File sent to Firefox',startedAt:-5000,finishedAt:-1000,format:'md'}},handle:req=>req.type==='BEGIN_EXPORT'?{ok:false,error:'Please wait for the page to finish loading.'}:undefined});
  await p.clock.tickAsync(10);p.$('exportButton').click();await p.clock.tickAsync(10);
  assert.equal(p.$('errorBox').hidden,false);assert.match(p.$('error').textContent,/Please wait/);assert.equal(p.$('exportButton').disabled,false);p.close();
});
test('PDF handoff carries the requested filename and preserves the generated document',async()=>{
  const env=environment('<html></html>');const {w}=env;let handler;let created;
  w.ChatArchiveRenderers={html:()=>'<html><head><title>Original title</title></head><body><main><article>Readable dialogue</article></main></body></html>'};
  w.browser={runtime:{onMessage:{addListener:fn=>handler=fn},getURL:p=>`https://extension.invalid/${p}`},downloads:{onChanged:{addListener:()=>{}}},action:{setBadgeText:async()=>{},setBadgeBackgroundColor:async()=>{}},tabs:{create:async({url})=>{created=url;}}};
  w.eval(read('background.js'));
  assert.equal((await handler({type:'EXPORT_READY',job:{...job,format:'pdf',filename:'my-notes-2026-09-10.pdf'},data:{}})).ok,true);
  const id=new URL(created).searchParams.get('id');const result=await handler({type:'GET_PRINT_PAGE',id});
  assert.equal(result.filename,'my-notes-2026-09-10.pdf');
  const printEnv=environment(read('print/print.html'),created);printEnv.w.browser={runtime:{sendMessage:async()=>result}};
  printEnv.w.eval(read('print/print.js'));await printEnv.clock.tickAsync(10);
  assert.equal(printEnv.w.document.title,'my-notes-2026-09-10');assert.equal(printEnv.w.document.getElementById('printButton').disabled,false);
  assert.equal(printEnv.w.document.querySelector('#document main').textContent,'Readable dialogue');
  assert.match(printEnv.w.document.getElementById('suggestedName').textContent,/my-notes-2026-09-10.pdf/);printEnv.close();env.close();
});
test('an expired PDF has an honest status and no active print button',async()=>{
  const p=environment(read('print/print.html'),'https://extension.invalid/print/print.html?id=expired');
  p.w.browser={runtime:{sendMessage:async()=>({ok:false})}};p.w.eval(read('print/print.js'));await p.clock.tickAsync(10);
  assert.equal(p.w.document.getElementById('printButton').disabled,true);assert.match(p.w.document.getElementById('printStatus').textContent,/Could not prepare/);assert.match(p.w.document.getElementById('error').textContent,/expired/);p.close();
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

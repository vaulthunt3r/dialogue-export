const {test}=require('node:test'), assert=require('node:assert/strict'), fs=require('node:fs'), path=require('node:path');
const {JSDOM}=require('jsdom'), FakeTimers=require('@sinonjs/fake-timers');
const read=name=>fs.readFileSync(path.join(__dirname,'..',name),'utf8');
function fixture() {
  const dom=new JSDOM(read('archive/archive.html'),{url:'https://fixture.invalid/archive/archive.html?id=test',runScripts:'outside-only'}),w=dom.window;
  const clock=FakeTimers.withGlobal(w).install({now:65000,toFake:['setTimeout','clearTimeout','Date']});
  const model={state:{state:'listed',stage:'load',running:false,count:42,listReady:true,selected:0},items:Array.from({length:42},(_,i)=>({id:String(i),title:'Chat '+i,archived:false}))};
  w.browser={runtime:{sendMessage:async request=>{if(model.fail)throw Error('Session unavailable');return {ok:true,...(request.type==='ARCHIVE_STATE'?model.state:request.type==='ARCHIVE_ITEMS'?{items:model.items}:{})};}}};
  w.eval(read('archive/archive.js'));
  return {w,model,clock,$:id=>w.document.getElementById(id),close:()=>{clock.uninstall();w.close();}};
}
test('42 chats paginate as 20/20/2 and selection survives navigation and filtering',async()=>{
  const f=fixture();try {
    await f.clock.tickAsync(1);assert.equal(f.$('list').children.length,20);assert.match(f.$('page').textContent,/1 \/ 3.*1–20 of 42/);assert.equal(f.$('next').disabled,false);
    f.$('list').querySelector('input').click();f.$('next').click();assert.match(f.$('page').textContent,/21–40/);
    f.$('list').querySelector('input').click();f.$('next').click();assert.equal(f.$('list').children.length,2);assert.equal(f.$('next').disabled,true);
    f.$('previous').click();assert.equal(f.$('list').querySelector('input').checked,true);f.$('previous').click();assert.equal(f.$('list').querySelector('input').checked,true);assert.match(f.$('count').textContent,/2 selected/);
    f.$('search').value='Chat 41';f.$('search').dispatchEvent(new f.w.Event('input'));assert.equal(f.$('list').children.length,1);assert.equal(f.$('next').disabled,true);assert.equal(f.$('previous').disabled,true);
    f.$('all').click();assert.match(f.$('count').textContent,/42 selected/);
  }finally{f.close();}
});
test('archive activity shows stages, elapsed time and Stop; completion freezes the timer honestly',async()=>{
  const f=fixture();try {
    Object.assign(f.model.state,{state:'exporting',running:true,stage:'read',startedAt:0,finishedAt:null,processed:2,selected:5,saved:0,failed:0,parts:0,label:'Reading chat 3 / 5'});
    await f.clock.tickAsync(801);assert.match(f.$('activityBar').textContent,/>/);assert.equal(f.w.document.querySelector('[data-stage=read]').className,'current');assert.equal(f.$('stop').hidden,false);assert.equal(f.$('elapsed').textContent,'1:05');
    Object.assign(f.model.state,{state:'partial',running:false,finishedAt:70000,label:'',saved:4,failed:1,processed:5});await f.clock.tickAsync(800);
    assert.match(f.$('activityBar').textContent,/!/);assert.match(f.$('status').textContent,/skipped/);assert.equal(f.$('stop').hidden,true);assert.equal(f.$('elapsed').textContent,'1:10');
    await f.clock.tickAsync(5000);assert.equal(f.$('elapsed').textContent,'1:10');
    f.model.fail=true;await f.clock.tickAsync(800);assert.equal(f.$('status').textContent,'Archive status unavailable.');assert.equal(f.$('run').disabled,true);
  }finally{f.close();}
});

test('ready counts and failure explanations are visible without opening the report and titles stay text',async()=>{
  const f=fixture();try {
    Object.assign(f.model.state,{state:'exporting',running:true,selected:42,processed:39,ready:36,saved:0,failed:3,parts:0,
      failures:[{id:'12345678-1234-1234-1234-123456789012',title:'<img src=x onerror=alert(1)>',code:'RICH_REFERENCE',reason:'Unsupported reference.',suggestion:'Open this chat and export it separately.'}]});
    await f.clock.tickAsync(801);assert.match(f.$('progress').textContent,/36 ready to save/);assert.equal(f.$('failureDetails').hidden,false);
    assert.match(f.$('failureHint').textContent,/last 1/);assert.match(f.$('failureList').textContent,/Unsupported reference/);
    assert.equal(f.$('failureList').querySelector('img'),null);assert.equal(f.$('failureList').querySelector('a').protocol,'https:');
    f.$('failureDetails').open=true;
    Object.assign(f.model.state,{state:'error',running:false,ready:0,saved:36,failed:4,notAttempted:2,errorCode:'HTTP_502',error:'ChatGPT returned HTTP 502.'});
    await f.clock.tickAsync(800);assert.match(f.$('status').textContent,/36 chats saved/);assert.match(f.$('error').textContent,/HTTP_502/);
    assert.match(f.$('progress').textContent,/2 not attempted/);assert.equal(f.$('failureDetails').open,true);
    Object.assign(f.model.state,{state:'partial',saved:0,errorCode:'',error:''});await f.clock.tickAsync(800);
    assert.match(f.$('status').textContent,/No chats exported/);
  }finally{f.close();}
});

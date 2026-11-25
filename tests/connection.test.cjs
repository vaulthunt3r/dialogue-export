const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const FakeTimers=require('@sinonjs/fake-timers');
const manifest=JSON.parse(fs.readFileSync(path.join(__dirname,'../manifest.json'),'utf8'));
function fixture(){
  let listener;const state={url:'https://chatgpt.com/c/example',mode:'missing',scripts:[],css:[],pings:0};
  const context=vm.createContext({setTimeout,clearTimeout,Date,URL,Map,Promise,AbortController,browser:{
    runtime:{getURL:f=>'moz-extension://fixture/'+f,getManifest:()=>manifest,onMessage:{addListener:fn=>listener=fn}},
    tabs:{get:async id=>({id,url:state.url}),sendMessage:async()=>{state.pings++;if(state.mode==='missing')throw Error('Could not establish connection. Receiving end does not exist.');if(state.mode==='busy')return new Promise(()=>{});if(state.mode==='invalid')throw Error('Message identity unavailable');return {ok:true,activeExport:true};},onRemoved:{addListener(){}}},
    downloads:{onChanged:{addListener(){}}},
    scripting:{insertCSS:async request=>state.css.push(request),executeScript:async request=>{state.scripts.push(request);if(state.denied)throw Error('Missing host permission');state.mode='ready';return [{frameId:0,result:null}];}}
  }});
  const clock=FakeTimers.withGlobal(context).install({toFake:['setTimeout','clearTimeout']});
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../background.js'),'utf8'),context);
  return {state,clock,send:(req={type:'ENSURE_CONTENT',tabId:4},sender={url:'moz-extension://fixture/popup/popup.html'})=>listener(req,sender),close:()=>clock.uninstall()};
}
test('only extension controls can restore scripts and only on supported sites',async()=>{
  const f=fixture();try{
    assert.equal((await f.send(undefined,{url:'https://chatgpt.com/',tab:{id:4}})).ok,false);
    f.state.url='https://example.org/';assert.equal((await f.send()).code,'UNSUPPORTED_PAGE');
    assert.equal(f.state.scripts.length,0);
  }finally{f.close();}
});
test('missing receivers are initialized once in the top frame even with concurrent requests',async()=>{
  const f=fixture();try{
    const results=await Promise.all([f.send(),f.send()]);assert.ok(results.every(r=>r.ok));
    assert.equal(f.state.scripts.length,1);assert.equal(f.state.css.length,1);
    assert.deepEqual(JSON.parse(JSON.stringify(f.state.scripts[0].target)),{tabId:4,frameIds:[0]});
    assert.deepEqual(f.state.scripts[0].files,manifest.content_scripts[0].js);
    await f.send();assert.equal(f.state.scripts.length,1);
  }finally{f.close();}
});
test('a busy export or invalid transient DOM is never reinitialized',async()=>{
  for(const mode of ['ready','busy','invalid']){
    const f=fixture();try{
      f.state.mode=mode;const pending=f.send();await f.clock.tickAsync(2600);const result=await pending;
      assert.equal(result.ok,mode==='ready');assert.equal(f.state.scripts.length,0);assert.equal(f.clock.countTimers(),0);
    }finally{f.close();}
  }
});
test('embedded restoration binds to the containing tab and permission refusal is explicit',async()=>{
  const f=fixture();try{
    f.state.denied=true;
    const result=await f.send({type:'ENSURE_CONTENT',tabId:99},{url:'moz-extension://fixture/popup/popup.html?panel=1',tab:{id:7},frameId:3});
    assert.equal(f.state.scripts[0].target.tabId,7);assert.equal(result.code,'SITE_ACCESS_REQUIRED');
  }finally{f.close();}
});

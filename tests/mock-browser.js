/* Development fixture only. This file is not loaded by the extension. */
(() => {
  const params = new URLSearchParams(location.search);
  const theme = params.get('theme') || 'light';
  const scenario = params.get('scenario') || 'ready';
  let saved = {};
  let fail = scenario === 'error';
  let current = { ok:true, title:'A little room for good ideas', provider:'ChatGPT', theme, count:8, selected:scenario==='selected'?3:0, picking:false, activeExport:false, exportStatus:null };
  if (scenario === 'running') {
    current.activeExport = true;
    current.exportStatus = { state:'running', label:'Loading earlier messages', processed:84, startedAt:Date.now()-48000, format:'md' };
  }
  if (scenario === 'selected') saved.scope = 'selected';
  window.browser = {
    runtime:{ getManifest:()=>({version:'0.5.0'}) },
    storage:{ local:{ get:async()=>saved, set:async next=>{saved={...saved,...next};} } },
    tabs:{ query:async()=>[{id:1,url:'https://chatgpt.com/c/ui-fixture'}], sendMessage:async (_,request)=>{
      if (fail) { fail = false; throw Error('Receiving end does not exist'); }
      if(request.type==='PING') return structuredClone(current);
      if(request.type==='CLEAR_SELECTION') current.selected=0;
      if(request.type==='SET_PICKING') current.picking=request.enabled;
      if(request.type==='BEGIN_EXPORT') {
        current.activeExport=true;
        current.exportStatus={state:'running',label:'Loading earlier messages',processed:8,startedAt:Date.now(),format:request.job.format};
        setTimeout(()=>{current.activeExport=false; current.exportStatus={...current.exportStatus,state:'done',label:request.job.format==='pdf'?'Print page opened':'File sent to Firefox',processed:96,finishedAt:Date.now()};},5000);
        return {ok:true,exportStatus:current.exportStatus};
      }
      return {ok:true};
    } }
  };
})();

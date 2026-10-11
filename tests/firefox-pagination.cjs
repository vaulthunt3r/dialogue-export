// Local Firefox print diagnostic. Input files and generated PDFs stay local.
// Usage: node tests/firefox-pagination.cjs <html> <output-directory> <pdfjs-module>
const fs=require('node:fs'),path=require('node:path'),{spawn}=require('node:child_process'),{pathToFileURL}=require('node:url');
const assert=require('node:assert/strict');
(async()=>{
 const input=path.resolve(process.argv[2]),out=path.resolve(process.argv[3]);fs.mkdirSync(out,{recursive:true});
 const profile=fs.mkdtempSync(path.join(out,'profile-'));
 const proc=spawn('C:/Program Files/Mozilla Firefox/firefox.exe',['--headless','--no-remote','--profile',profile,'--remote-debugging-port','9237'],{windowsHide:true});
 let ws;
 try {
  await new Promise((resolve,reject)=>{const t=setTimeout(()=>reject(Error('Firefox startup timeout')),20000);proc.on('error',reject);proc.stderr.on('data',s=>{if(s.toString().includes('WebDriver BiDi listening')){clearTimeout(t);resolve();}});});
  ws=new WebSocket('ws://127.0.0.1:9237/session');await new Promise((r,j)=>{ws.onopen=r;ws.onerror=j;});
  let seq=0;const pending=new Map();ws.onmessage=e=>{const m=JSON.parse(e.data);if(pending.has(m.id)){pending.get(m.id)(m);pending.delete(m.id);}};
  async function cmd(method,params){const id=++seq;const m=await new Promise((resolve,reject)=>{const t=setTimeout(()=>reject(Error(method+' timeout')),30000);pending.set(id,v=>{clearTimeout(t);resolve(v)});ws.send(JSON.stringify({id,method,params}));});if(m.type==='error')throw Error(JSON.stringify(m));return m.result;}
  const session=await cmd('session.new',{capabilities:{alwaysMatch:{}}});console.log('Firefox',session.capabilities.browserVersion);
  const {context}=await cmd('browsingContext.create',{type:'tab'});
  const pdfjs=await import(pathToFileURL(path.resolve(process.argv[4])).href);
  let baseline;
  for(const [name,css] of [['original',''],['compact-flow','article{display:contents}.message{margin-bottom:20px}'],['long-answer','article{display:contents}.message{margin-bottom:20px}']]){
   await cmd('browsingContext.navigate',{context,url:pathToFileURL(input).href,wait:'complete'});
   if(name==='long-answer')await cmd('script.evaluate',{target:{context},expression:`(()=>{const m=document.querySelector('article.assistant .message');m.insertAdjacentHTML('afterbegin',Array.from({length:50},(_,i)=>'<p>Pagination marker '+i+' continues across pages.</p>').join(''))})()`,awaitPromise:false});
   if(css)await cmd('script.evaluate',{target:{context},expression:`(()=>{const s=document.createElement('style');s.textContent=${JSON.stringify('@media print{'+css+'}')};document.head.append(s)})()`,awaitPromise:false});
   const {data}=await cmd('browsingContext.print',{context,background:false,shrinkToFit:true,page:{width:21.59,height:27.94},margin:{top:1.27,bottom:1.27,left:1.27,right:1.27}});
   const bytes=Buffer.from(data,'base64');fs.writeFileSync(path.join(out,name+'.pdf'),bytes);
   const pdf=await pdfjs.getDocument({data:new Uint8Array(bytes),useSystemFonts:true}).promise;
   const texts=[];for(let i=1;i<=pdf.numPages;i++)texts.push((await(await pdf.getPage(i)).getTextContent()).items.map(x=>x.str).join(' '));
   const normalized=texts.join('').replace(/\s/g,'');
   if(name==='original')baseline=normalized;
   if(name==='compact-flow'){assert.equal(normalized,baseline,'PDF text must be preserved');assert.ok(texts[0].includes('CHATGPT'),'First answer must start on page 1');}
   if(name==='long-answer'){assert.ok(texts[0].includes('Pagination marker 0'));assert.ok(texts.slice(1).join('').includes('Pagination marker 49'));}
   console.log(JSON.stringify({name,pages:pdf.numPages,answerOnFirstPage:texts[0].includes('CHATGPT'),textVerified:name==='compact-flow',longAnswerSplits:name==='long-answer'}));await pdf.destroy();
  }
  await cmd('session.end',{});
 }finally{ws?.close();proc.kill();}
})().catch(e=>{console.error(e);process.exitCode=1;});

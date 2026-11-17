// Promotional fixtures: real packaged UI + fictional data, isolated Firefox only.
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),vm=require('node:vm');
const {spawn}=require('node:child_process');
const root=path.resolve(__dirname,'../..'),assets=path.join(__dirname,'assets');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');
const strip=s=>s.replace(/<script\b[^>]*>[\s\S]*?<\/script>/g,'');
const art=`<svg xmlns="http://www.w3.org/2000/svg" width="900" height="280" viewBox="0 0 900 280"><rect width="900" height="280" fill="#111"/><g stroke="#ccc" fill="none"><ellipse cx="450" cy="140" rx="275" ry="80" transform="rotate(-16 450 140)"/><ellipse cx="450" cy="140" rx="330" ry="105" transform="rotate(-16 450 140)"/><circle cx="450" cy="140" r="88" fill="#111"/><path d="M385 82 Q455 70 520 105 M367 125 Q455 105 535 150 M375 173 Q445 155 520 190"/></g><g fill="#fff"><circle cx="703" cy="83" r="7"/><circle cx="141" cy="178" r="4"/><circle cx="749" cy="201" r="2"/><circle cx="230" cy="50" r="2"/><circle cx="664" cy="37" r="2"/></g><text x="32" y="247" fill="#aaa" font-family="monospace" font-size="14">EXPLORATION / 001</text></svg>`;
fs.writeFileSync(path.join(assets,'orbit.svg'),art);
const ctx=vm.createContext({Date,URL});vm.runInContext(read('shared/timestamps.js'),ctx);vm.runInContext(read('shared/renderers.js'),ctx);
const html=ctx.ChatArchiveRenderers.html({provider:'ChatGPT',title:'A weekend worth building',url:'https://chatgpt.com',exportedAt:'2026-11-17T12:00:00Z',messages:[
 {role:'user',text:'Plan a small astronomy website.',html:'<p>Plan a small astronomy website. Keep the first version simple.</p>'},
 {role:'assistant',text:'Start small. Make it real.',html:`<h2>Start small. Make it real.</h2><p>One idea, a clear plan, and the details you want to keep.</p><pre><code class="language-javascript">const launch = {\n  idea: "Explore the night sky",\n  next: "Build the first page"\n};</code></pre><table><thead><tr><th>Step</th><th>Outcome</th></tr></thead><tbody><tr><td>01 / Explore</td><td>A focused idea</td></tr><tr><td>02 / Build</td><td>A working page</td></tr></tbody></table><figure><img src="data:image/svg+xml;base64,${Buffer.from(art).toString('base64')}" alt="An original monochrome orbit illustration"></figure>`}
]},{includeTitle:true,includeLinks:true,compactPagination:true});
fs.writeFileSync(path.join(assets,'sample-export.html'),html);
function popup(format){return strip(read('popup/popup.html')).replace('href="popup.css"','href="/popup/popup.css"').replace('</head>',`<style>html{background:#111;overflow:hidden}body{transform:scale(2);transform-origin:0 0}body footer{font-size:9px}</style></head>`).replace('</body>',`<script>
document.body.dataset.theme='dark';document.body.dataset.state='ready';document.querySelector('#controls').disabled=false;document.querySelector('#exportButton').disabled=false;document.querySelector('#archiveChats').hidden=false;document.querySelector('#status').textContent='ChatGPT · ready';document.querySelector('#version').textContent='v0.5.6';document.querySelector('#filename').value='Weekend-project';document.querySelector('#extension').textContent='.${format}';document.querySelector('[name=format][value=${format}]').checked=true;document.querySelector('#exportLabel').textContent=${JSON.stringify(format==='pdf'?'Prepare PDF':'Export '+format.toUpperCase())};
if('${format}'==='html'){document.querySelector('#imageOptions').hidden=false;document.querySelector('#imageOptions').open=true;}if('${format}'==='pdf'){document.querySelector('#compactPaginationOption').hidden=false;document.querySelector('#compactPaginationOption').open=true;document.querySelector('#compactPagination').checked=true;}
</script></body>`);}
const names=['Weekend project','A reading list','Astronomy website','Recipe notebook','Learning JavaScript','Product ideas','Travel checklist','A small garden','Writing workshop','Design references','Research notes','Next steps'];
function archive(){return strip(read('archive/archive.html')).replace('href="archive.css"','href="/archive/archive.css"').replace('</head>','<style>:root{color-scheme:dark;--bg:#111;--fg:#fff;--muted:#bbb;--line:#777}h1 img{filter:invert(1)}</style></head>').replace('</body>',`<script>
document.querySelector('#selection').hidden=false;document.querySelector('#count').textContent='12 found · 12 selected';document.querySelector('#page').textContent='1 / 1 · showing 1–12 of 12';document.querySelector('#run').disabled=false;
${JSON.stringify(names)}.forEach(title=>{const row=document.createElement('label');row.className='chat';const check=document.createElement('input');check.type='checkbox';check.checked=true;const label=document.createElement('span');label.textContent=title;row.append(check,label);document.querySelector('#list').append(row);});
document.querySelector('#status').textContent='Finished. ZIP parts and report saved to Downloads.';document.querySelector('#progress').textContent='12 / 12 processed · 0 ready to save · 12 saved · 0 failed · 1 ZIP part saved';document.querySelector('#activityBar').textContent='[############]';document.querySelector('#elapsed').textContent='';document.querySelector('#report').hidden=false;
</script></body>`);}
(async()=>{
 const server=http.createServer((req,res)=>{
  const pathname=new URL(req.url,'http://localhost').pathname;
  if(pathname==='/demo-menu'){res.setHeader('Content-Type','text/html');res.end(popup(new URL(req.url,'http://localhost').searchParams.get('format')||'md'));return;}
  if(pathname==='/demo-archive'){res.setHeader('Content-Type','text/html');res.end(archive());return;}
  if(pathname==='/demo-export'){res.setHeader('Content-Type','text/html');res.end(html);return;}
  if(['/popup/popup.css','/archive/archive.css','/icons/dialogue.svg'].includes(pathname)){res.setHeader('Content-Type',pathname.endsWith('.css')?'text/css':'image/svg+xml');res.end(read(pathname.slice(1)));return;}
  res.writeHead(404);res.end();
 });await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const profile=fs.mkdtempSync(path.join(__dirname,'capture-profile-'));
 const proc=spawn('C:/Program Files/Mozilla Firefox/firefox.exe',['--headless','--no-remote','--profile',profile,'--remote-debugging-port','9257'],{windowsHide:true});let ws;
 try{
  await new Promise((resolve,reject)=>{const t=setTimeout(()=>reject(Error('Firefox start timeout')),20000);proc.on('error',reject);proc.stderr.on('data',d=>{if(d.toString().includes('WebDriver BiDi listening')){clearTimeout(t);resolve();}});});
  ws=new WebSocket('ws://127.0.0.1:9257/session');await new Promise((r,j)=>{ws.onopen=r;ws.onerror=j;});let serial=0;const pending=new Map();ws.onmessage=e=>{const m=JSON.parse(e.data);pending.get(m.id)?.(m);};
  const command=(method,params)=>new Promise((resolve,reject)=>{const id=++serial;const t=setTimeout(()=>reject(Error(method+' timeout')),20000);pending.set(id,m=>{clearTimeout(t);pending.delete(id);m.type==='error'?reject(Error(JSON.stringify(m))):resolve(m.result);});ws.send(JSON.stringify({id,method,params}));});
  await command('session.new',{capabilities:{alwaysMatch:{}}});const {context}=await command('browsingContext.create',{type:'tab'});
  for(const [name,url,width,height] of [['menu-md','/demo-menu?format=md',440,880],['menu-html','/demo-menu?format=html',440,880],['menu-pdf','/demo-menu?format=pdf',440,880],['archive','/demo-archive',1200,1120],['document','/demo-export',980,1260]]){
   await command('browsingContext.setViewport',{context,viewport:{width,height},devicePixelRatio:1});
   await command('browsingContext.navigate',{context,url:`http://127.0.0.1:${server.address().port}${url}`,wait:'complete'});
   await command('script.evaluate',{target:{context},expression:'Promise.all([...document.images].map(i=>i.decode().catch(()=>{}))).then(()=>document.fonts.ready).then(()=>true)',awaitPromise:true});
   const shot=await command('browsingContext.captureScreenshot',{context});fs.writeFileSync(path.join(assets,name+'.png'),Buffer.from(shot.data,'base64'));
  }
  console.log(JSON.stringify({assets:5,profile:'isolated',content:'fictional',ui:'production markup and CSS',output:assets}));
 }finally{ws?.close();proc.kill();server.closeAllConnections();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);process.exitCode=1;});

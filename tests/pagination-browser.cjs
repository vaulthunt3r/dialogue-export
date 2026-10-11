// Optional real print-layout check: node tests/pagination-browser.cjs <playwright path>
const {chromium}=require(process.argv[2]||'playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const read=file=>fs.readFileSync(path.join(__dirname,'..',file),'utf8');
require('../shared/renderers.js');
(async()=>{
  const browser=await chromium.launch({channel:'msedge',headless:true});
  try {
    const page=await browser.newPage();
    const data={title:'Pagination fixture',provider:'ChatGPT',messages:Array.from({length:4},(_,i)=>({role:'assistant',html:Array.from({length:15},(_,j)=>`<p>Message ${i+1}, paragraph ${j+1}: local pagination fixture.</p>`).join('')}))};
    for(const mode of ['html','pdf-tab']) {
    const counts=[];
    for(const compactPagination of [false,true]) {
      const content=ChatArchiveRenderers.html(data,{compactPagination});
      if(mode==='html') await page.setContent(content);
      else {
        await page.route('https://fixture.invalid/**',route=>route.fulfill({contentType:'text/html',body:read('print/print.html').replace('<link rel="stylesheet" href="print.css">',`<style>${read('print/print.css')}</style>`).replace('<script src="print.js"></script>','')}));
        await page.goto('https://fixture.invalid/print.html?id=fixture');
        await page.evaluate(result=>{window.browser={runtime:{sendMessage:async()=>result}};},{ok:true,content,compactPagination});
        await page.addScriptTag({content:read('print/print.js')});
        await page.waitForFunction(()=>!document.querySelector('#printButton').disabled);
      }
      await page.emulateMedia({media:'screen'});
      assert.equal(await page.locator('article').first().evaluate(el=>getComputedStyle(el).breakInside),'avoid');
      await page.emulateMedia({media:'print'});
      assert.equal(await page.locator('article').first().evaluate(el=>getComputedStyle(el).breakInside),compactPagination?'auto':'avoid');
      assert.equal(await page.locator('article p').count(),60);
      const pdf=await page.pdf({format:'A4',margin:{top:'15mm',bottom:'15mm',left:'15mm',right:'15mm'}});
      counts.push((pdf.toString('latin1').match(/\/Type\s*\/Page\b/g)||[]).length);
    }
    assert.ok(counts[1]>0 && counts[1]<counts[0],`Expected fewer pages: ${counts}`);
    console.log(`Local Edge ${mode}: normal ${counts[0]} pages; compact ${counts[1]} pages; all 60 paragraphs retained in DOM.`);
    }
  } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});

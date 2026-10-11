const { test } = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');
require('../shared/renderers.js');
const data = { title:'Pagination', provider:'ChatGPT', url:'https://chatgpt.com/c/test', exportedAt:'2026-10-10T12:00:00Z', messages:[{role:'assistant', text:'Example', html:'<p>First paragraph</p><pre><code>const n = 1;</code></pre><table><tr><td>Cell</td></tr></table><p>Last paragraph</p>'}] };

test('compact pagination changes print rules without changing exported message content', () => {
  for (const printPage of [false,true]) {
    const normal = new JSDOM(ChatArchiveRenderers.html(data,{},printPage));
    const compact = new JSDOM(ChatArchiveRenderers.html(data,{compactPagination:true},printPage));
    try {
      assert.equal(normal.window.document.querySelector('main').innerHTML,compact.window.document.querySelector('main').innerHTML);
      function articleBreaks(dom) {
        let screen, print;
        for(const rule of dom.window.document.styleSheets[0].cssRules) {
          if(rule.selectorText==='article' && rule.style.getPropertyValue('break-inside')) screen=rule.style.getPropertyValue('break-inside');
          if(rule.conditionText==='print') for(const child of rule.cssRules) {
            if(child.selectorText==='article' && child.style.getPropertyValue('break-inside')) print=child.style.getPropertyValue('break-inside');
          }
        }
        return {screen, print:print||screen};
      }
      assert.deepEqual(articleBreaks(normal),{screen:'avoid',print:'avoid'});
      assert.deepEqual(articleBreaks(compact),{screen:'avoid',print:'auto'});
      const printRules=[...compact.window.document.styleSheets[0].cssRules].filter(r=>r.conditionText==='print').flatMap(r=>[...r.cssRules]);
      assert.ok(printRules.some(r=>r.selectorText==='article' && r.style.getPropertyValue('display')==='contents'));
    } finally {normal.window.close();compact.window.close();}
  }
});

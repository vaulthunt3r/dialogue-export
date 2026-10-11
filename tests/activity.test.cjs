const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {JSDOM}=require('jsdom');
// Structure follows the supplied expanded activity fragment; text and IDs are synthetic.
function activity(expanded=true){return `<div class="flex min-w-0 flex-col"><div class="group/activity-header"><button aria-labelledby="activity-label" aria-expanded="${expanded}"></button><span id="activity-label">Worked for 24s</span></div><div style="overflow:hidden;height:auto;opacity:1"><div><div data-markdown-text-style="assistant-message"><p>Checking <a href="https://example.com">sources</a>.</p><p hidden>HIDDEN SECRET</p></div><div><div class="flex min-w-0 flex-col"><div class="group/activity-header"><img src="https://example.com/favicon"><div data-markdown-text-style="assistant-message"><p>Searched 12 websites</p></div></div></div></div></div></div></div>`;}
const answer='<div data-chatgpt-selection-conversation-id="test" data-chatgpt-selection-message-id="a">Final answer</div>';
function fixture(html){const d=new JSDOM(`<main>${html}</main>`,{url:'https://chatgpt.com/c/test',runScripts:'outside-only'});for(const f of ['content/extract.js','shared/renderers.js'])d.window.eval(fs.readFileSync(path.join(__dirname,'..',f),'utf8'));return d;}
test('expanded activity is associated within one turn, nested summaries appear once, hidden content is omitted',()=>{
 const d=fixture(`<div data-turn-key="turn-a">${activity()}${answer}</div>`);try{
 const e=d.window.ChatArchiveExtractor;
 assert.equal(e.collect().messages[0].activities,undefined);
 const data=e.collect({includeActivity:true}),m=data.messages[0];
 assert.equal(m.activities.length,1);assert.match(m.activities[0].text,/Checking/);
 assert.equal((m.activities[0].text.match(/Searched 12 websites/g)||[]).length,1);
 assert.doesNotMatch(m.activities[0].html,/HIDDEN SECRET|<img|\sstyle=|<button/);
 for(const format of ['html','md','txt','json']){
 const out=d.window.ChatArchiveRenderers[format](data,{includeActivity:true});assert.match(out,/Worked for 24s/);assert.match(out,/Final answer/);
 assert.doesNotMatch(d.window.ChatArchiveRenderers[format](data,{}),/Worked for 24s/);
 }
 assert.match(d.window.ChatArchiveRenderers.html(data,{includeActivity:true}),/<details[^>]+open>/);
 }finally{d.window.close();}
});
test('collapsed sections export only label and an explicit missing-content note',()=>{
 const d=fixture(`<div data-turn-key="a">${activity(false)}${answer}</div>`);try{
 const data=d.window.ChatArchiveExtractor.collect({includeActivity:true});
 assert.equal(data.messages[0].activities[0].text,'');
 const html=d.window.ChatArchiveRenderers.html(data,{includeActivity:true});assert.match(html,/collapsed/);assert.doesNotMatch(html,/Checking/);
 }finally{d.window.close();}
});
test('unbounded or ambiguous activity fails rather than crossing conversation boundaries',()=>{
 for(const html of [activity()+answer,`<div data-turn-key="a">${activity()}${answer}${answer.replace('message-id="a"','message-id="b"')}</div>`]){
 const d=fixture(html);try{assert.throws(()=>d.window.ChatArchiveExtractor.collect({includeActivity:true}),/safely linked/);assert.doesNotThrow(()=>d.window.ChatArchiveExtractor.collect());}finally{d.window.close();}
 }
});
test('activity inside the answer is not duplicated, and selected export retains its association',()=>{
 const d=fixture(`<div data-turn-key="a"><div data-chatgpt-selection-message-id="a" data-chat-archive-selected="true">${activity()}<p>Final answer</p></div></div>`);try{
 const data=d.window.ChatArchiveExtractor.collect({includeActivity:true,selectedOnly:true});assert.equal(data.messages.length,1);assert.equal(data.messages[0].text,'Final answer');assert.equal(data.messages[0].activities.length,1);
 }finally{d.window.close();}
});

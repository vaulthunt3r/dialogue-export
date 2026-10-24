const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {JSDOM}=require('jsdom');
test('CodeMirror lines become portable highlighted code with indentation and no editor controls',()=>{
  const d=new JSDOM(`<main><div data-chatgpt-selection-message-id="a"><div data-code-block="true"><div>Python<button>Copy</button></div><div class="cm-content" data-language="python"><div class="cm-line"><span class="Comment-fixture"># Example</span></div><div class="cm-line"><span class="text-codex-syntax-keyword">if</span> x &lt; 3:</div><div class="cm-line">    print(<span class="text-codex-syntax-string">"a &amp; b"</span>)</div><div class="cm-line"><br></div><div class="cm-line">done()</div></div></div></div></main>`,{url:'https://chatgpt.com/c/test',runScripts:'outside-only'});
  try {
    for(const f of ['content/extract.js','shared/renderers.js'])d.window.eval(fs.readFileSync(path.join(__dirname,'..',f),'utf8'));
    const data=d.window.ChatArchiveExtractor.collect();
    const output=new JSDOM(d.window.ChatArchiveRenderers.html(data));
    const code=output.window.document.querySelector('pre code');
    assert.equal(code.textContent,'# Example\nif x < 3:\n    print("a & b")\n\ndone()');
    assert.equal(output.window.document.querySelectorAll('.chat-archive-code-label').length,1);
    assert.equal(output.window.document.querySelector('.export-code-keyword').textContent,'if');
    assert.equal(output.window.document.querySelector('.cm-content,button'),null);
    output.window.close();
  } finally {d.window.close();}
});

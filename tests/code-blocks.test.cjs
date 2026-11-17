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

function exportedCode(markup, provider = 'gemini') {
  const content = provider === 'gemini'
    ? `<model-response><message-content><div class="markdown">${markup}</div></message-content></model-response>`
    : `<div data-chatgpt-selection-message-id="code-answer">${markup}</div>`;
  const dom = new JSDOM(`<main>${content}</main>`, {
    url: provider === 'gemini' ? 'https://gemini.google.com/app/fixture' : 'https://chatgpt.com/c/fixture',
    runScripts: 'outside-only'
  });
  try {
    for (const file of ['content/extract.js', 'shared/renderers.js']) {
      dom.window.eval(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'));
    }
    const extractor = dom.window.ChatArchiveExtractor, renderers = dom.window.ChatArchiveRenderers;
    const data = extractor.collect({outputFormat: 'json'});
    return {
      message: JSON.parse(renderers.json(data)).messages[0],
      markdown: renderers.md(extractor.collect({outputFormat: 'md'})),
      text: renderers.txt(extractor.collect({outputFormat: 'txt'}))
    };
  } finally { dom.window.close(); }
}

test('Gemini JSON markdown and Markdown exports preserve Python fences and exact code whitespace', () => {
  const code = 'def hello():\n    print("Hello, world!")\n\nhello()\n';
  const result = exportedCode(`<p>Example:</p><pre><code class="language-python"><span>def</span> hello():\n    print("Hello, world!")\n\nhello()\n</code></pre><p>Done.</p>`);
  const expected = `Example:\n\n\`\`\`python\n${code}\`\`\`\n\nDone.`;
  assert.equal(result.message.markdown, expected);
  assert.equal(result.markdown, `## Gemini\n\n${expected}\n`);
  assert.ok(result.message.text.includes(code));
  assert.ok(!result.text.includes('```'));
  assert.ok(result.message.html.includes('<pre><code class="language-python">'));
});

test('code fences preserve literal backticks and link text without rewriting code as Markdown links', () => {
  const result = exportedCode('<pre><code data-language="Markdown">```python\nx = 1\n```\n````\n<a href="https://example.com/">literal</a>\n</code></pre>');
  const expected = '`````markdown\n```python\nx = 1\n```\n````\nliteral\n`````';
  assert.equal(result.message.markdown, expected);
  assert.ok(!result.message.markdown.includes('https://example.com'));
});

test('code language is kept only when explicitly available in portable metadata', () => {
  for (const [markup, expected] of [
    ['<pre class="language-python"><code>print(1)</code></pre>', '```python\nprint(1)\n```'],
    ['<pre data-language="python">print(1)</pre>', '```python\nprint(1)\n```'],
    ['<pre><code class="hljs lang-c++">int x;</code></pre>', '```c++\nint x;\n```'],
    ['<pre><code>print(1)</code></pre>', '```\nprint(1)\n```'],
    ['<pre><code data-language="python&#10;injected">print(1)</code></pre>', '```\nprint(1)\n```']
  ]) assert.equal(exportedCode(markup).message.markdown, expected);
});

test('ChatGPT CodeMirror code also gets fenced Markdown without a duplicate language label', () => {
  const result = exportedCode('<div data-code-block><div>Python<button>Copy</button></div><div class="cm-content" data-language="python"><div class="cm-line">if True:</div><div class="cm-line">    print(1)</div><div class="cm-line"><br></div><div class="cm-line">done()</div></div></div>', 'chatgpt');
  const expected = '```python\nif True:\n    print(1)\n\ndone()\n```';
  assert.equal(result.message.markdown, expected);
  assert.equal(result.markdown, `## ChatGPT\n\n${expected}\n`);
  assert.ok(result.message.html.includes('chat-archive-code-label'));
});

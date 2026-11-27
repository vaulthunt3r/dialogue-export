// Offline check of Dialogue Export Markdown. No account access or media downloads.
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const MarkdownIt = require('markdown-it');
const root = path.resolve(__dirname, '..');
const url = 'https://chatgpt.com/c/12345678-1234-1234-1234-123456789abc';
const scripts = ['shared/vendor/markdown-it.js', 'content/components.js', 'content/markdown.js',
  'content/api-media.js', 'content/chatgpt-api.js', 'shared/renderers.js'].map(file => fs.readFileSync(path.join(root, file), 'utf8'));

function parseExport(source) {
  const lines = source.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').split('\n');
  const tokens = new MarkdownIt().parse(lines.join('\n'), {}), boundaries = [];
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i], previous = tokens[i - 1], heading = tokens[i + 1];
    if (token.type !== 'heading_open' || token.tag !== 'h2' || token.level !== 0 ||
        !/^(User|ChatGPT)$/.test(heading?.content || '')) continue;
    // The exporter separates messages with a top-level horizontal rule. Fenced
    // examples and ordinary in-message rules must not truncate a response.
    if (boundaries.length && previous?.type !== 'hr') continue;
    boundaries.push({ role: heading.content === 'User' ? 'user' : 'assistant',
      start: token.map[1], separator: previous?.type === 'hr' ? previous.map[0] : token.map[0] });
  }
  if (!boundaries.length) throw new Error('No Dialogue Export message headings found.');
  return boundaries.map((item, index) => ({ role: item.role,
    text: lines.slice(item.start, boundaries[index + 1]?.separator ?? lines.length).join('\n').trim() }));
}

function conversation(messages) {
  const raw = { conversation_id: url.split('/').pop(), current_node: 'root', mapping: { root: { id: 'root', parent: null, message: null } } };
  for (const [index, source] of messages.entries()) {
    const id = 'm' + index;
    raw.mapping[id] = { id, parent: raw.current_node, message: { id, author: { role: source.role },
      status: 'finished_successfully', content: { content_type: 'text', parts: [source.text] }, metadata: {} } };
    raw.current_node = id;
  }
  return raw;
}

function auditText(source) {
  const messages = parseExport(source), dom = new JSDOM('<main/>', { url, runScripts: 'outside-only' });
  const w = dom.window, formats = [];
  w.fetch = () => { throw new Error('Network access is forbidden in the offline corpus audit.'); };
  try {
    scripts.forEach(script => w.eval(script));
    for (const outputFormat of ['html', 'pdf', 'json']) {
      const failures = [];
      for (const [index, message] of messages.entries()) {
        try { w.ChatArchiveApi.normalize(conversation([message]), url, { outputFormat }); }
        catch (error) { failures.push({ messagePosition: index + 1, code: error.code || null,
          diagnostic: error.sourceDiagnostic || null }); }
      }
      const report = { outputFormat, failures, passed: false };
      if (!failures.length) {
        const data = w.ChatArchiveApi.normalize(conversation(messages), url, { outputFormat });
        if (data.messages.length !== messages.length || data.messages.some((m, i) => m.id !== 'm' + i)) {
          throw new Error('Normalized message count or order changed.');
        }
        const html = w.ChatArchiveRenderers.html(data, {}), doc = new w.DOMParser().parseFromString(html, 'text/html');
        Object.assign(report, { passed: true, renderedMessages: data.messages.length,
          components: doc.querySelectorAll('[data-d-component]').length, tables: doc.querySelectorAll('table').length,
          unavailableCitations: data.unavailableCitations || 0 });
      }
      formats.push(report);
    }
    return { messages: messages.length, formats, passed: formats.every(format => format.passed) };
  } finally { w.close(); }
}

function inputFiles(inputs) {
  const found = new Set();
  function visit(file) {
    const absolute = path.resolve(file), stat = fs.lstatSync(absolute);
    if (stat.isSymbolicLink()) return;
    if (stat.isDirectory()) fs.readdirSync(absolute).sort().forEach(name => visit(path.join(absolute, name)));
    else if (/\.md$/i.test(absolute)) found.add(absolute);
  }
  inputs.forEach(visit);
  return [...found];
}

function main(args) {
  const reportIndex = args.indexOf('--report');
  if (reportIndex < 0 || !args[reportIndex + 1]) throw new Error('Usage: node scripts/audit-md-corpus.cjs --report output.json file.md [folder ...]');
  const destination = path.resolve(args[reportIndex + 1]);
  args.splice(reportIndex, 2);
  if (!args.length) throw new Error('Provide at least one Markdown file or extracted archive folder.');
  const files = inputFiles(args);
  if (!files.length) throw new Error('No Markdown files found.');
  const reports = files.map(file => {
    try { return { file, ...auditText(fs.readFileSync(file, 'utf8')) }; }
    catch (error) { return { file, passed: false, inputError: error.message }; }
  });
  const result = { scope: 'Offline text/component rendering from exported Markdown, not complete live exports.',
    limitations: ['Original API metadata, image attachments, media downloads and Working/Thinking are not verified.',
      'Markdown message boundaries can be ambiguous; compare counts with the original chat/archive report.',
      'Coverage includes only supplied files; compare them with the account list, including projects and archives.'],
    chats: reports.length, passed: reports.filter(report => report.passed).length,
    messages: reports.reduce((sum, report) => sum + (report.messages || 0), 0), reports };
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.writeFileSync(destination, JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify({ chats: result.chats, passed: result.passed, messages: result.messages, report: destination }));
  if (result.passed !== result.chats) process.exitCode = 1;
}
module.exports = { parseExport, auditText };
if (require.main === module) { try { main(process.argv.slice(2)); } catch (error) { console.error(error.message); process.exitCode = 1; } }

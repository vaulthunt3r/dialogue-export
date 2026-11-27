const test = require('node:test');
const assert = require('node:assert/strict');
const { parseExport, auditText } = require('../scripts/audit-md-corpus.cjs');

test('corpus replay preserves internal rules and ignores message headings in fenced code', () => {
  const body = 'Before\n\n---\n\nAfter\n\n```md\n---\n\n## User\n\nExample\n```';
  const parsed = parseExport('# Export\n\nSaved: today\n\n---\n\n## User\n\nQuestion\n\n---\n\n## ChatGPT\n\n' + body + '\n');
  assert.equal(parsed.length, 2);
  assert.equal(parsed[1].text, body);
  assert.equal(parsed[1].role, 'assistant');
});

test('corpus replay checks unsupported content after an internal rule in every format', () => {
  const report = auditText('## User\n\nQuestion\n\n---\n\n## ChatGPT\n\nBefore\n\n---\n\n<text>{(1).notAllowed()}</text>\n');
  assert.equal(report.messages, 2);
  assert.equal(report.passed, false);
  assert.deepEqual(report.formats.map(format => [format.outputFormat, format.failures[0]?.messagePosition]), [['html', 2], ['pdf', 2], ['json', 2]]);
});

test('corpus replay checks complete message order and static components without metadata', () => {
  const report = auditText('## User\n\nQuestion\n\n---\n\n## ChatGPT\n\n<grid><grid-item><title size="xl">Value</title><text>{(12500).toLocaleString("en-US")}</text></grid-item></grid>\n');
  assert.equal(report.passed, true);
  assert.ok(report.formats.every(format => format.renderedMessages === 2 && format.components === 4));
  assert.throws(() => parseExport('ordinary text'), /No Dialogue Export/);
});

// Run after npm ci. Ship a pinned local parser, never a runtime CDN dependency.
const fs = require('node:fs'), path = require('node:path');
const root = path.resolve(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'node_modules/markdown-it/package.json'), 'utf8'));
if (pkg.version !== '15.0.3') throw Error('Review and pin the parser version before updating the vendor copy.');
const destination = path.join(root, 'shared/vendor');
fs.mkdirSync(destination, { recursive: true });
// Keep upstream bytes intact so AMO can match the published npm distribution.
fs.copyFileSync(path.join(root, 'node_modules/markdown-it/dist/browser/markdown-it.umd.min.js'), path.join(destination, 'markdown-it.js'));
fs.copyFileSync(path.join(root, 'node_modules/markdown-it/dist/browser/markdown-it.umd.min.js.map'), path.join(destination, 'markdown-it.umd.min.js.map'));
const licenses = ['markdown-it', 'entities', 'linkify-it', 'mdurl', 'punycode.js', 'uc.micro'].map(name => {
  const dir = path.join(root, 'node_modules', name);
  const file = ['LICENSE', 'LICENSE.txt', 'LICENSE-MIT.txt'].find(file => fs.existsSync(path.join(dir, file)));
  if (!file) throw Error(`Missing bundled license: ${name}`);
  return `${name}\n${fs.readFileSync(path.join(dir, file), 'utf8')}`;
});
fs.writeFileSync(path.join(destination, 'MARKDOWN-LICENSES.txt'), licenses.join('\n\n--------------------\n\n'));

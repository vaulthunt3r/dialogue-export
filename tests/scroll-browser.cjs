// Optional real-layout check: node tests/scroll-browser.cjs [path-to-playwright]
// Requires Playwright and an installed Edge browser. No live ChatGPT requests.
const { chromium } = require(process.argv[2] || 'playwright');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const read = file => readFileSync(path.join(__dirname, '..', file), 'utf8');

(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  try {
    await Promise.all([
      { name: 'hidden overflow', overflow: 'hidden', reverse: false, height: 240 },
      { name: 'negative scrollTop', overflow: 'auto', reverse: true, height: 240 },
      { name: 'small hidden range', overflow: 'hidden', reverse: false, height: 450 }
    ].map(async config => {
      const page = await browser.newPage();
      await page.route('**/*', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><html><body></body></html>' }));
      await page.goto('https://chatgpt.com/c/scroll-fixture');
      await page.evaluate(config => {
        document.body.innerHTML = `<main style="height:${config.height}px;overflow-y:${config.overflow};${config.reverse ? 'display:flex;flex-direction:column-reverse;' : ''}"><div style="flex:none"></div></main>`;
        const host = document.querySelector('main'), content = host.firstElementChild;
        let stage = 2, pending = false;
        const maximum = () => host.scrollHeight - host.clientHeight;
        const logical = () => host.scrollTop + (config.reverse ? maximum() : 0);
        const move = value => { host.scrollTop = value - (config.reverse ? maximum() : 0); };
        const show = () => {
          content.innerHTML = Array.from({ length: 4 }, (_, j) => {
            const i = stage * 4 + j;
            const marker = i % 2 ? `data-chatgpt-selection-message-id="message-${i}"` : 'data-user-message-bubble';
            return `<div data-turn-key="turn-${i}" data-chatgpt-search-message-ids="message-${i}" style="height:130px"><div ${marker}>Message ${i}</div></div>`;
          }).join('');
        };
        show(); move(maximum());
        window.fixture = { get stage() { return stage; }, get position() { return host.scrollTop; }, positions: [] };
        host.addEventListener('scroll', () => {
          window.fixture.positions.push(host.scrollTop);
          if (pending || !window.exporting) return;
          if (logical() <= 1 && stage > 0) {
            pending = true;
            setTimeout(() => { stage--; show(); move(maximum() / 2); pending = false; }, 350);
          } else if (logical() >= maximum() - 1 && stage < 2) {
            stage++; show(); move(maximum() / 2);
          }
        });
        host.style.scrollBehavior = 'smooth';
        window.sent = [];
        window.browser = { runtime: {
          onMessage: { addListener: fn => { window.receive = fn; } },
          sendMessage: async req => { window.sent.push(req); return { ok: true }; }
        } };
      }, config);
      for (const file of ['shared/timestamps.js', 'content/timestamps.js', 'content/extract.js', 'content/content.js']) await page.addScriptTag({ content: read(file) });
      await page.evaluate(async () => {
        window.exporting = true;
        await window.receive({ type: 'BEGIN_EXPORT', job: { format: 'json', filename: 'fixture.json', options: {} } });
      });
      await page.waitForFunction(() => window.sent.some(req => ['EXPORT_READY', 'EXPORT_FAILED'].includes(req.type)), { }, { timeout: 45000 });
      const result = await page.evaluate(async () => ({
        data: window.sent.find(req => req.type === 'EXPORT_READY')?.data,
        info: await window.receive({ type: 'PING' }),
        positions: window.fixture.positions,
        behavior: document.querySelector('main').style.scrollBehavior
      }));
      assert.ok(result.data, `${config.name}: ${JSON.stringify(result.info)}`);
      assert.deepEqual(result.data.messages.map(m => m.text), Array.from({ length: 12 }, (_, i) => `Message ${i}`));
      assert.ok(new Set(result.positions).size > 2);
      if (config.reverse) assert.ok(result.positions.some(position => position < 0));
      assert.equal(result.behavior, 'smooth');
      console.log(`PASS ${config.name}: 12 messages, correct order, real browser scrolling`);
      await page.close();
    }));
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });

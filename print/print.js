const params = new URLSearchParams(location.search);
const id = params.get('id');
const button = document.querySelector('#printButton');
const error = document.querySelector('#error');

button.addEventListener('click', () => window.print());

(async function loadDocument() {
  try {
    if (!id) throw new Error('The print job ID is missing.');
    const result = await browser.runtime.sendMessage({ type: 'GET_PRINT_PAGE', id });
    if (!result?.ok || !result.content) throw new Error('This print job has expired. Create it again.');
    const parsed = new DOMParser().parseFromString(result.content, 'text/html');
    const target = document.querySelector('#document');
    const header = parsed.querySelector('header');
    const main = parsed.querySelector('main');
    if (header) target.append(document.importNode(header, true));
    if (main) target.append(document.importNode(main, true));
    if (!main) throw new Error('The conversation content could not be read.');
    document.title = result.filename ? result.filename.replace(/\.pdf$/i, '') : parsed.title || document.title;
    if (result.filename) {
      const suggestedName = document.querySelector('#suggestedName');
      suggestedName.textContent = `Suggested file name: ${result.filename}`;
      suggestedName.hidden = false;
    }
    document.querySelector('#printStatus').textContent = 'Your PDF layout is ready';
    button.disabled = false;
  } catch (reason) {
    document.querySelector('#printStatus').textContent = 'Could not prepare the PDF';
    error.textContent = reason?.message || String(reason);
  }
})();

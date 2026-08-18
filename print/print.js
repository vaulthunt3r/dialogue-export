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
    document.title = parsed.title ? `PDF — ${parsed.title}` : document.title;
    button.disabled = false;
  } catch (reason) {
    error.textContent = reason?.message || String(reason);
  }
})();

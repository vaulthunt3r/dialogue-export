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
    result.content = ''; // Release the serialized copy before waiting for pixels.
    const target = document.querySelector('#document');
    const header = parsed.querySelector('header');
    const main = parsed.querySelector('main');
    if (header) target.append(document.adoptNode(header));
    if (main) target.append(document.adoptNode(main));
    if (!main) throw new Error('The conversation content could not be read.');
    const compact = result.compactPagination === true;
    document.body.classList.toggle('compact-pagination', compact);
    document.querySelector('#paginationStatus').textContent = compact
      ? 'Compact pagination: on — print without message boxes for continuous text flow.'
      : 'Compact pagination: off — keep messages together when possible.';
    document.title = result.filename ? result.filename.replace(/\.pdf$/i, '') : parsed.title || document.title;
    if (result.filename) {
      const suggestedName = document.querySelector('#suggestedName');
      suggestedName.textContent = `Suggested file name: ${result.filename}`;
      suggestedName.hidden = false;
    }
    const images = [...target.querySelectorAll('img')];
    if (images.length) {
      document.querySelector('#printStatus').textContent = 'Preparing images for PDF…';
      const loaded = await Promise.all(images.map(image => new Promise(resolve => {
        const timer = setTimeout(() => resolve(false), 60000);
        image.decode().then(() => { clearTimeout(timer); resolve(true); }, () => { clearTimeout(timer); resolve(false); });
      })));
      if (loaded.some(ok => !ok)) error.textContent = 'Some images could not be loaded for printing. Check the preview and the original conversation.';
    }
    document.querySelector('#printStatus').textContent = 'Your PDF layout is ready';
    button.disabled = false;
  } catch (reason) {
    document.querySelector('#printStatus').textContent = 'Could not prepare the PDF';
    error.textContent = reason?.message || String(reason);
  }
})();

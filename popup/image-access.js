const button = document.getElementById('enable'), result = document.getElementById('result');
const origins = ['https://images.openai.com/*'];
const enabled = () => { button.hidden = true; result.textContent = '[OK] Image access is enabled. Return to your chat and retry the export.'; };
browser.permissions.contains({ origins }).then(granted => { if (granted) enabled(); }).catch(() => {});
button.addEventListener('click', async () => {
  try {
    const permission = browser.permissions.request({ origins });
    button.disabled = true;
    if (await permission) enabled();
    else result.textContent = 'Image access remains off. You can retry or export with images disabled.';
  } catch (_) { result.textContent = 'Firefox could not grant image access. Check Dialogue Export permissions in the Firefox Add-ons Manager.'; }
  finally { button.disabled = false; }
});

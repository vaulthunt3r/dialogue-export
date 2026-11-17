document.getElementById('enable').addEventListener('click', async () => {
  const button = document.getElementById('enable'), result = document.getElementById('result');
  try {
    // This top-level extension page has the API and a direct user gesture.
    const permission = browser.permissions.request({ permissions: ['notifications'] });
    button.disabled = true;
    if (await permission) {
      await browser.storage.local.set({ notifyOnCompletion: true });
      result.textContent = '[OK] Enabled. You can close this tab and return to your conversation.';
      button.hidden = true;
    } else result.textContent = 'Notifications remain off. You can return to your conversation.';
  } catch (_) { result.textContent = 'Could not enable notifications. Export still works without them.'; }
  finally { button.disabled = false; }
});

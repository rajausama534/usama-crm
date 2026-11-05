// Runs on the CRM's Unit Finder page. Lets the page ask this extension to read a listing link.
(() => {
  const VERSION = chrome.runtime.getManifest().version;
  document.documentElement.dataset.usamaExt = VERSION;
  const announce = () => window.postMessage({ source: 'usama-ext', type: 'READY', version: VERSION }, location.origin);
  announce();
  window.addEventListener('message', event => {
    if (event.source !== window || event.origin !== location.origin) return;
    const m = event.data;
    if (!m || m.source !== 'usama-crm') return;
    if (m.type === 'PING') return announce();
    if (m.type !== 'READ_LINK') return;
    chrome.runtime.sendMessage({ type: 'USAMA_READ_LINK', url: m.url }, response => {
      const err = chrome.runtime.lastError?.message;
      window.postMessage({ source: 'usama-ext', type: 'READ_RESULT', id: m.id, ...(err ? { ok: false, error: err } : response) }, location.origin);
    });
  });
})();

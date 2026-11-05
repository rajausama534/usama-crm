// Unit Finder: when the CRM page asks, open the listing in a background tab of this Chrome,
// let it load like a normal visit, read it with content.js, close the tab and hand the details back.
const PORTALS = /^https:\/\/(www\.bayut\.com|dubai\.dubizzle\.com|www\.propertyfinder\.ae)\//i;
const sleep = ms => new Promise(r => setTimeout(r, ms));

function waitForLoad(tabId, timeoutMs) {
  return new Promise(resolve => {
    const done = () => { chrome.tabs.onUpdated.removeListener(listener); clearTimeout(timer); resolve(); };
    const listener = (id, info) => { if (id === tabId && info.status === 'complete') done(); };
    const timer = setTimeout(done, timeoutMs);
    chrome.tabs.onUpdated.addListener(listener);
  });
}

async function readListing(url) {
  if (!PORTALS.test(url)) throw new Error('Only Bayut, Dubizzle and Property Finder links can be read.');
  const tab = await chrome.tabs.create({ url, active: false });
  try {
    await waitForLoad(tab.id, 30000);
    let last = null;
    // The listing loads its details after the page itself; try for up to ~15 seconds.
    for (let i = 0; i < 15; i++) {
      await sleep(1000);
      try {
        const res = await chrome.tabs.sendMessage(tab.id, { type: 'USAMA_EXTRACT_LISTING' });
        if (res?.ok) {
          last = res.data;
          const text = last.pageText || '';
          if (/security check|verify you are human|pardon our interruption/i.test(text.slice(0, 600))) continue;
          if (/sq\.?\s*ft|sqft|sqm/i.test(text) || last.sizeSqft) return last;
        }
      } catch { /* content script not ready yet */ }
    }
    if (last && !/security check|verify you are human|pardon our interruption/i.test((last.pageText || '').slice(0, 600))) return last;
    throw new Error('The portal did not show the listing (it may want you to open it once and pass its check).');
  } finally {
    chrome.tabs.remove(tab.id).catch(() => {});
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type !== 'USAMA_READ_LINK') return;
  readListing(String(message.url || ''))
    .then(data => sendResponse({ ok: true, data }))
    .catch(error => sendResponse({ ok: false, error: error.message || 'Could not read the listing.' }));
  return true; // async response
});

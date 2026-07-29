let extracted = null;
const esc = value => String(value ?? '-').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));
const cell = (label, value) => `<div class="item"><div class="label">${esc(label)}</div><div class="value">${esc(value || '-')}</div></div>`;
const status = document.getElementById('status');
const grid = document.getElementById('grid');
const openBtn = document.getElementById('open');

document.getElementById('extract').addEventListener('click', async () => {
  status.textContent = 'Reading the current listing page…';
  grid.classList.remove('show');
  openBtn.disabled = true;
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) throw new Error('No active tab found.');
    const response = await chrome.tabs.sendMessage(tab.id, { type: 'USAMA_EXTRACT_LISTING' });
    if (!response?.ok) throw new Error(response?.error || 'Could not read this page. Reload the listing and try again.');
    extracted = response.data;
    grid.innerHTML = [
      cell('Platform', extracted.platform),
      cell('Listing ID', extracted.listingId),
      cell('Permit', extracted.permitNumber),
      cell('Reference', extracted.referenceNumber),
      cell('Project', extracted.project),
      cell('Area', extracted.area),
      cell('Bedrooms', extracted.bedrooms ? `${extracted.bedrooms} BR` : '-'),
      cell('Size', extracted.sizeSqft ? `${Number(extracted.sizeSqft).toLocaleString('en-US')} sqft` : '-'),
      cell('Price', extracted.price ? `AED ${Number(extracted.price).toLocaleString('en-US')}` : '-'),
      cell('Broker', extracted.broker)
    ].join('');
    grid.classList.add('show');
    openBtn.disabled = false;
    status.textContent = 'Page data extracted. Open it in CRM to check saved mappings or confirm the unit.';
  } catch (error) {
    status.innerHTML = `<span class="error">${esc(error.message)}</span>`;
  }
});

openBtn.addEventListener('click', async () => {
  if (!extracted) return;
  const encoded = encodeURIComponent(btoa(unescape(encodeURIComponent(JSON.stringify(extracted)))));
  await chrome.tabs.create({ url: `https://usama-crm.vercel.app/unit-finder.html#extension=${encoded}` });
});

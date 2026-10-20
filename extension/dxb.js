(() => {
  // DXBinteract → Usama CRM. Reads only the sales rows already shown on the page you are viewing
  // (your own logged-in session), when you click the button. Nothing runs in the background and
  // nothing is downloaded; the rows are handed to the CRM in the page address (never sent to a server).
  if (window.__usamaDxb) return;
  window.__usamaDxb = true;

  const clean = v => String(v ?? '').replace(/\s+/g, ' ').trim();
  const num = v => { const n = Number(String(v ?? '').replace(/[^\d.]/g, '')); return Number.isFinite(n) && n > 0 ? n : null; };
  const MONTHS = { Jan: 1, Feb: 2, Mar: 3, Apr: 4, May: 5, Jun: 6, Jul: 7, Aug: 8, Sep: 9, Oct: 10, Nov: 11, Dec: 12 };
  const DATE = /(\d{1,2}),\s*([A-Z][a-z]{2})\s+(\d{4})/;

  const isRow = el => {
    const t = el.innerText || '';
    return /AED\s*[\d,]+/.test(t) && /sqft/.test(t) && (t.match(new RegExp(DATE.source, 'g')) || []).length === 1;
  };

  function parseRow(tr) {
    const lines = (tr.innerText || '').split('\n').map(clean).filter(Boolean);
    const location = lines[0] || '';
    const statusLine = lines.find(l => /,\s*No\.\s*\w+/i.test(l) || /^(Ready|Off-?plan|Offplan)/i.test(l)) || '';
    const unitMatch = statusLine.match(/No\.\s*0*(\d+)/i);
    const priceIdx = lines.findIndex(l => l === 'AED');
    const price = priceIdx >= 0 ? num(lines[priceIdx + 1]) : num((lines.find(l => /^AED\s*[\d,]+$/.test(l)) || '').replace('AED', ''));
    const specs = lines.find(l => /sqft/.test(l) && !/\/sqft/.test(l)) || '';
    const sizes = [...specs.matchAll(/([\d,]+)\s*sqft(\s*BUA)?/gi)].map(m => ({ v: num(m[1]), bua: !!m[2] }));
    const bua = sizes.find(s => s.bua)?.v || null;
    const first = sizes.find(s => !s.bua)?.v || null;
    const isVillaLike = /villa|townhouse|land|plot/i.test(statusLine);
    const beds = (lines.find(l => /\b(\d+)\s*Beds?\b|Studio/i.test(l)) || '').match(/(\d+)\s*Beds?|Studio/i);
    const dateLine = lines.find(l => DATE.test(l)) || '';
    const dm = dateLine.match(DATE);
    const soldBy = lines[lines.indexOf(dateLine) + 1] || '';
    return {
      location, status_line: statusLine,
      unit_no: unitMatch ? unitMatch[1] : null,
      amount: price,
      plot_sqft: isVillaLike && bua ? first : null,
      bua_sqft: bua,
      area_sqft: !isVillaLike || !bua ? first : null,
      beds: beds ? (beds[1] ? `${beds[1]}BR` : 'Studio') : null,
      date: dm ? `${dm[3]}-${String(MONTHS[dm[2]] || 0).padStart(2, '0')}-${dm[1].padStart(2, '0')}` : null,
      sold_by: /individual|developer|bank|company/i.test(soldBy) ? soldBy : null,
      label: `${location} · ${statusLine}`.slice(0, 200),
    };
  }

  function collect() {
    const rows = [...document.querySelectorAll('tr')].filter(isRow).filter(tr => ![...tr.children].some(isRow));
    return rows.map(parseRow).filter(r => r.amount && r.date);
  }

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.textContent = 'Send sales to Usama CRM';
  Object.assign(btn.style, {
    position: 'fixed', right: '20px', bottom: '84px', zIndex: 2147483646, padding: '12px 16px', border: '0', borderRadius: '10px',
    background: '#4f5bd5', color: '#fff', font: '600 14px Inter,system-ui,sans-serif', boxShadow: '0 8px 24px rgba(15,23,42,.25)', cursor: 'pointer',
  });
  btn.addEventListener('click', () => {
    const rows = collect();
    if (!rows.length) { alert('No sales rows found on this page. Open a project\'s Sales list on DXBinteract first.'); return; }
    const withUnit = rows.filter(r => r.unit_no).length;
    const payload = { source: 'dxbinteract', page: location.href, captured_at: new Date().toISOString(), rows };
    const encoded = encodeURIComponent(btoa(unescape(encodeURIComponent(JSON.stringify(payload)))));
    window.open(`https://usama-crm.vercel.app/#dxb=${encoded}`, '_blank', 'noopener');
    btn.textContent = `Sent ${rows.length} sales (${withUnit} with unit no.)`;
    setTimeout(() => { btn.textContent = 'Send sales to Usama CRM'; }, 4000);
  });
  document.body.appendChild(btn);
  window.__usamaDxbCollect = collect; // for checking from the console
})();

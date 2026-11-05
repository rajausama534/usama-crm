(() => {
  // DXBinteract → Usama CRM.
  // 1) Manual: the "Send sales to Usama CRM" button reads the rows shown on the page you are viewing.
  // 2) Automatic: the CRM's Cluster Data page ("Update from DXB Interact") opens
  //    https://dxbinteract.com/dubai-house-prices#usama-fetch={id, project, community}.
  //    This script then searches that project, sets the date range to all years, reads every page of
  //    sales and hands the rows back to the CRM tab that opened it. It only runs in your own logged-in
  //    browser tab, only when the CRM asks, and the rows go straight to the CRM page (no other server).
  if (window.__usamaDxb) return;
  window.__usamaDxb = true;

  const CRM_ORIGINS = ['https://www.usamabinnusrat.com', 'https://usamabinnusrat.com'];
  let CRM = CRM_ORIGINS[0];
  try { const saved = sessionStorage.getItem('usama_crm_origin'); if (CRM_ORIGINS.includes(saved)) CRM = saved; } catch (_) {}
  const JOB_KEY = 'usamaCrmFetchJob';
  const clean = v => String(v ?? '').replace(/\s+/g, ' ').trim();
  const num = v => { const n = Number(String(v ?? '').replace(/[^\d.]/g, '')); return Number.isFinite(n) && n > 0 ? n : null; };
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const MONTHS = { Jan: 1, Feb: 2, Mar: 3, Apr: 4, May: 5, Jun: 6, Jul: 7, Aug: 8, Sep: 9, Oct: 10, Nov: 11, Dec: 12 };
  const MON = Object.keys(MONTHS);
  const DATE = /(\d{1,2}),\s*([A-Z][a-z]{2})\s+(\d{4})/;
  const LIST_CAP = 300; // DXB lists stop after 300 rows

  // ------------------------------------------------------------------ reading rows
  const isRow = el => {
    const t = el.innerText || '';
    return /AED\s*[\d,]+/.test(t) && /sqft/.test(t) && (t.match(new RegExp(DATE.source, 'g')) || []).length === 1;
  };
  const ROW = /^(.*?) (Ready|Offplan|Off-plan)\s*([\w-]+), No\. (.+?) AED ([\d,]+).*?AED [\d,]+ \/sqft (.*?) (\d{1,2}), (\w{3}) (\d{4}) (.*?) History$/;

  function parseRow(tr) {
    const text = clean(tr.innerText);
    const m = text.match(ROW);
    if (m) {
      const type = m[3];
      const specs = m[6];
      const bua = num((specs.match(/([\d,]+)\s*sqft\s*BUA/i) || [])[1]);
      const other = num((specs.replace(/([\d,]+)\s*sqft\s*BUA/ig, '').match(/([\d,]+)\s*sqft/i) || [])[1]);
      const flat = /apartment|flat|penthouse|duplex|hotel|office|shop/i.test(type);
      const beds = specs.match(/(\d+)\s*Beds?/i) || (/studio/i.test(specs) ? ['', 'Studio'] : null);
      const unitRaw = clean(m[4]);
      return {
        location: clean(m[1]), status_line: `${m[2]} ${type}, No. ${unitRaw}`, property_type: type,
        unit_no: /^\d+$/.test(unitRaw) ? String(Number(unitRaw)) : unitRaw,
        amount: num(m[5]),
        plot_sqft: flat ? null : other,
        bua_sqft: bua,
        area_sqft: flat ? other : null,
        beds: beds ? (beds[1] === 'Studio' ? 'Studio' : `${beds[1]}BR`) : null,
        date: `${m[9]}-${String(MONTHS[m[8]] || 0).padStart(2, '0')}-${m[7].padStart(2, '0')}`,
        sold_by: /developer/i.test(m[10]) ? 'Developer' : 'Resale',
        label: `${clean(m[1])} · ${m[2]} ${type}, No. ${unitRaw}`.slice(0, 200),
      };
    }
    return parseRowLoose(tr);
  }

  // Older, line-based reader (kept as a fallback when the row layout changes).
  function parseRowLoose(tr) {
    const lines = (tr.innerText || '').split('\n').map(clean).filter(Boolean);
    const location = lines[0] || '';
    const statusLine = lines.find(l => /,\s*No\.\s*\w+/i.test(l) || /^(Ready|Off-?plan|Offplan)/i.test(l)) || '';
    const unitMatch = statusLine.match(/No\.\s*0*(\d+)/i);
    const priceIdx = lines.findIndex(l => l === 'AED');
    const price = priceIdx >= 0 ? num(lines[priceIdx + 1]) : num((lines.find(l => /^AED\s*[\d,]+$/.test(l)) || '').replace('AED', ''));
    const specs = lines.find(l => /sqft/.test(l) && !/\/sqft/.test(l)) || '';
    const sizes = [...specs.matchAll(/([\d,]+)\s*sqft(\s*BUA)?/gi)].map(x => ({ v: num(x[1]), bua: !!x[2] }));
    const bua = sizes.find(s => s.bua)?.v || null;
    const first = sizes.find(s => !s.bua)?.v || null;
    const flat = /apartment|flat|penthouse/i.test(statusLine);
    const beds = (lines.find(l => /\b(\d+)\s*Beds?\b|Studio/i.test(l)) || '').match(/(\d+)\s*Beds?|Studio/i);
    const dateLine = lines.find(l => DATE.test(l)) || '';
    const dm = dateLine.match(DATE);
    const soldBy = lines[lines.indexOf(dateLine) + 1] || '';
    return {
      location, status_line: statusLine,
      unit_no: unitMatch ? unitMatch[1] : null,
      amount: price,
      plot_sqft: flat ? null : first,
      bua_sqft: bua,
      area_sqft: flat ? first : null,
      beds: beds ? (beds[1] ? `${beds[1]}BR` : 'Studio') : null,
      date: dm ? `${dm[3]}-${String(MONTHS[dm[2]] || 0).padStart(2, '0')}-${dm[1].padStart(2, '0')}` : null,
      sold_by: /developer/i.test(soldBy) ? 'Developer' : soldBy ? 'Resale' : null,
      label: `${location} · ${statusLine}`.slice(0, 200),
    };
  }

  const rowEls = () => [...document.querySelectorAll('tr')].filter(isRow).filter(tr => ![...tr.children].some(isRow));
  function collect() { return rowEls().map(parseRow).filter(r => r.amount && r.date); }

  // ------------------------------------------------------------------ manual button
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
    sendByAddress({ source: 'dxbinteract', page: location.href, captured_at: new Date().toISOString(), rows });
    btn.textContent = `Sent ${rows.length} sales (${withUnit} with unit no.)`;
    setTimeout(() => { btn.textContent = 'Send sales to Usama CRM'; }, 4000);
  });
  function sendByAddress(payload) {
    const encoded = encodeURIComponent(btoa(unescape(encodeURIComponent(JSON.stringify(payload)))));
    window.open(`${CRM}/#dxb=${encoded}`, '_blank', 'noopener');
  }
  window.__usamaDxbCollect = collect; // for checking from the console

  // ------------------------------------------------------------------ automatic mode
  const norm = s => { let n = String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '').replace(/lll/g, 'iii').replace(/ll/g, 'ii'); n = n.replace(/([a-z])iii$/, '$13').replace(/([a-z])ii$/, '$12'); return n === 'eliesaab' ? 'eliesaab1' : n; };
  const ymd = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const parseYmd = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
  const rangeText = ([a, b]) => { const f = s => { const d = parseYmd(s); return `${d.getDate()} ${MON[d.getMonth()]}, ${d.getFullYear()}`; }; return `${f(a)} to ${f(b)}`; };
  const loadJob = () => { try { return JSON.parse(sessionStorage.getItem(JOB_KEY) || 'null'); } catch (_) { return null; } };
  const saveJob = j => { try { sessionStorage.setItem(JOB_KEY, JSON.stringify(j)); } catch (_) {} };
  const dropJob = () => { try { sessionStorage.removeItem(JOB_KEY); } catch (_) {} };
  const fire = (el, types) => types.forEach(t => el.dispatchEvent(new (t.startsWith('pointer') ? PointerEvent : MouseEvent)(t, { bubbles: true, cancelable: true, view: window })));
  async function waitFor(fn, ms = 20000, step = 250) {
    const end = Date.now() + ms;
    while (Date.now() < end) { try { const v = fn(); if (v) return v; } catch (_) {} await sleep(step); }
    return null;
  }
  // Only the CRM origin that opened this tab receives the message; the others are dropped by the browser.
  const toCrm = msg => { try { if (window.opener) { CRM_ORIGINS.forEach(o => window.opener.postMessage(msg, o)); return true; } } catch (_) {} return false; };

  let box;
  function status(text, done) {
    if (!box) {
      box = document.createElement('div');
      Object.assign(box.style, {
        position: 'fixed', left: '20px', bottom: '20px', zIndex: 2147483647, maxWidth: '360px', padding: '14px 16px', borderRadius: '12px',
        background: '#111827', color: '#fff', font: '500 14px/1.45 Inter,system-ui,sans-serif', boxShadow: '0 10px 30px rgba(0,0,0,.3)',
      });
      document.body.appendChild(box);
    }
    box.innerHTML = `<div style="font-weight:700;margin-bottom:4px">Usama CRM ${done ? '✓' : '· reading sales…'}</div><div></div>`;
    box.lastChild.textContent = text;
  }
  function progress(job, text) {
    status(text);
    toCrm({ type: 'usama-dxb-progress', id: job.id, text, read: Object.keys(job.rows || {}).length });
  }
  function fail(job, text) {
    status(`Stopped: ${text}`, true);
    box.style.background = '#991b1b';
    toCrm({ type: 'usama-dxb-error', id: job.id, text });
    dropJob();
  }

  async function startJob() {
    const m = location.hash.match(/^#usama-fetch=(.+)$/);
    let job = loadJob();
    if (m) {
      let req;
      try { req = JSON.parse(decodeURIComponent(m[1])); } catch (_) { return; }
      history.replaceState(null, '', location.pathname + location.search);
      if (!req?.project) return;
      if (CRM_ORIGINS.includes(req.crm)) { CRM = req.crm; try { sessionStorage.setItem('usama_crm_origin', CRM); } catch (_) {} }
      const today = ymd(new Date());
      job = { id: String(req.id || Date.now()), project: String(req.project), community: String(req.community || ''),
              stage: 'search', ranges: [['2012-01-01', today]], ri: 0, split: false, totals: [], rows: {}, started: Date.now(), tries: 0 };
      saveJob(job);
    }
    if (!job) return;
    if (Date.now() - job.started > 30 * 60 * 1000) { dropJob(); return; }
    job.tries = (job.tries || 0) + 1;
    if (job.tries > 80) { fail(job, 'too many page loads, please try again.'); return; }
    saveJob(job);
    toCrm({ type: 'usama-dxb-hello', id: job.id });
    try { await step(job); } catch (e) { fail(job, e.message || String(e)); }
  }

  async function step(job) {
    if (job.stage === 'search') return doSearch(job);
    if (job.stage === 'range') return doRange(job);
    if (job.stage === 'read') return doRead(job);
  }

  // Search the project (removes whatever location is selected first) and submit. The page then reloads.
  async function doSearch(job) {
    progress(job, `Searching "${job.project}"…`);
    const input = await waitFor(() => document.querySelector('#SearchInput'));
    if (!input) throw new Error('DXB Interact search box not found. Are you logged in?');
    // The page wires up its search box a little after it appears: wait, then try a few times.
    await waitFor(() => document.querySelector('.AreasList article'), 15000);
    await sleep(2500);
    const findPick = () => {
      const list = [...document.querySelectorAll('.AreasList article')].map(a => ({ a, parts: clean(a.innerText).split(',').map(s => s.trim()) }))
        .filter(x => norm(x.parts[0]) === norm(job.project));
      if (!list.length) return null;
      const exact = list.filter(x => x.parts.slice(1).some(p => norm(p) === norm(job.community)));
      return (exact.length ? exact : list).length === 1 ? (exact.length ? exact : list)[0] : (exact[0] || null);
    };
    let pick = null;
    for (let attempt = 0; attempt < 5 && !pick; attempt++) {
      for (let i = 0; i < 6; i++) {
        const x = document.querySelector('#LocationsStack a.button svg');
        if (!x) break;
        fire(x, ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']);
        await sleep(500);
      }
      input.focus();
      input.value = '';
      input.dispatchEvent(new InputEvent('input', { bubbles: true }));
      await sleep(200);
      input.value = job.project;
      input.dispatchEvent(new InputEvent('input', { bubbles: true, data: job.project, inputType: 'insertText' }));
      input.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: job.project.slice(-1) }));
      input.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: job.project.slice(-1) }));
      pick = await waitFor(findPick, 5000);
      if (!pick) { progress(job, `Searching "${job.project}"… (try ${attempt + 2})`); await sleep(1500); }
    }
    if (!pick) throw new Error(`"${job.project}" was not found on DXB Interact.`);
    fire(pick.a, ['mousedown', 'mouseup', 'click']);
    await sleep(800);
    job.stage = 'range'; saveJob(job);
    return submitAndContinue(job);
  }

  // Press Search. DXB either reloads the page (this script then starts again on the new page) or swaps the
  // results in place and changes the address; in that case carry on here.
  async function submitAndContinue(job) {
    const before = location.pathname;
    document.querySelector('.search-choose-btns.submit-btn label').click();
    const moved = await waitFor(() => location.pathname !== before && /\/valuation\//.test(location.pathname), 30000);
    if (!moved) { location.reload(); return; }
    await waitFor(() => document.querySelector('.date-range-text') && /Transactions\s*\n+\s*[\d,]+/.test(document.body.innerText), 20000);
    await sleep(2500);
    return step(job);
  }

  // Set the date range of the current part (all years by default), then search again (page reloads).
  async function doRange(job) {
    const target = job.ranges[job.ri];
    const shown = await waitFor(() => document.querySelector('.date-range-text'));
    if (!shown) throw new Error('Date range not found on the page.');
    if (clean(shown.innerText) === rangeText(target) && locationOk(job)) { job.stage = 'read'; saveJob(job); return doRead(job); }
    progress(job, `Setting dates ${rangeText(target)}…`);
    shown.click();
    const host = await waitFor(() => document.querySelector('#drpHost select.drp-select') && document.getElementById('drpHost'));
    if (!host) throw new Error('Date picker did not open.');
    const sels = () => [...host.querySelectorAll('select.drp-select')];
    const set = (s, v) => { s.value = String(v); s.dispatchEvent(new Event('change', { bubbles: true })); };
    const cals = () => [...host.querySelectorAll('.drp-cal')];
    const clickDay = async (calIdx, d) => {
      set(sels()[calIdx * 2 + 1], d.getFullYear()); await sleep(250);
      set(sels()[calIdx * 2], d.getMonth()); await sleep(250);
      const cell = [...cals()[calIdx].querySelectorAll('.drp-cell:not(.other-month)')].find(c => clean(c.innerText) === String(d.getDate()));
      if (!cell) throw new Error('Could not pick a date.');
      fire(cell.querySelector('.drp-day') || cell, ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']);
      await sleep(350);
    };
    await clickDay(0, parseYmd(target[0]));
    await clickDay(1, parseYmd(target[1]));
    const label = (host.innerText.match(/Range:\s*(.*?)\s*\(/) || [])[1];
    if (label && label !== rangeText(target)) throw new Error(`Date picker shows ${label}.`);
    host.querySelector('.drp-btn-apply').click();
    await sleep(1500);
    job.stage = 'read'; saveJob(job);
    return submitAndContinue(job);
  }

  function locationOk(job) {
    const chip = clean(document.querySelector('#LocationsStack')?.innerText);
    return norm(chip.split(',')[0]) === norm(job.project);
  }

  const firstRowText = () => clean(rowEls()[0]?.innerText);
  function readVisible(job) {
    let added = 0;
    for (const r of collect()) {
      if (norm(r.location.split(',')[0]) !== norm(job.project)) continue;
      const k = `${r.unit_no}|${r.date}|${r.amount}`;
      if (!job.rows[k]) { job.rows[k] = r; added++; }
    }
    return added;
  }

  async function readAllPages(job, total, label) {
    let page = 1, seen = 0;
    for (;;) {
      await waitFor(() => rowEls().length, 15000);
      readVisible(job);
      seen += rowEls().length;
      saveJob(job);
      progress(job, `${label}: page ${page} · ${Object.keys(job.rows).length} of ${job.totals.reduce((s, t) => s + t.total, 0)} sales read`);
      if (seen >= Math.min(total, LIST_CAP)) return;
      const pager = [...document.querySelectorAll('.pagination a, .t-Report-pagination a, .t-Report-paginationText a')].filter(a => a.offsetParent);
      const next = pager.find(a => clean(a.innerText) === String(page + 1)) || pager.find(a => /^Next/i.test(clean(a.innerText)));
      if (!next) return;
      const before = firstRowText();
      next.click();
      const changed = await waitFor(() => rowEls().length && firstRowText() !== before, 20000);
      if (!changed) return;
      page++;
      await sleep(300);
    }
  }

  async function setSort(value) {
    const sel = document.querySelector('#P74_SORTING_DESKTOP');
    if (!sel || sel.value === value) return !!sel;
    const before = firstRowText();
    sel.value = value;
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    try { if (window.jQuery) window.jQuery(sel).trigger('change'); } catch (_) {}
    await waitFor(() => rowEls().length && firstRowText() !== before, 20000);
    await sleep(400);
    return true;
  }

  async function doRead(job) {
    const target = job.ranges[job.ri];
    const shown = await waitFor(() => document.querySelector('.date-range-text'));
    if (!shown || clean(shown.innerText) !== rangeText(target)) { job.stage = 'range'; saveJob(job); return doRange(job); }
    if (!locationOk(job)) throw new Error(`The page is not showing ${job.project}.`);
    const readTotal = () => (document.body.innerText.match(/Transactions\s*\n+\s*([\d,]+)/) || [])[1];
    let totalTxt = await waitFor(readTotal);
    for (let i = 0; i < 10; i++) { await sleep(1000); const t = readTotal(); if (t === totalTxt) break; totalTxt = t; }
    const total = num(totalTxt) || 0;
    // Too many for one list: split the period into single years (each year is read on its own).
    if (total > LIST_CAP * 2 && !job.split) {
      const from = parseYmd(target[0]).getFullYear(), to = parseYmd(target[1]).getFullYear();
      if (to > from) {
        const parts = [];
        for (let y = from; y <= to; y++) parts.push([y === from ? target[0] : `${y}-01-01`, y === to ? target[1] : `${y}-12-31`]);
        job.ranges.splice(job.ri, 1, ...parts); job.split = true; job.stage = 'range'; saveJob(job);
        progress(job, `${total} sales: reading one year at a time…`);
        return doRange(job);
      }
    }
    job.totals.push({ range: target, total });
    saveJob(job);
    if (total > 0) {
      await setSort('NEWEST');
      await readAllPages(job, total, `${rangeText(target)} (newest first)`);
      if (total > LIST_CAP) {
        await setSort('OLDEST');
        await readAllPages(job, total, `${rangeText(target)} (oldest first)`);
      }
    }
    job.ri++;
    if (job.ri < job.ranges.length) { job.stage = 'range'; saveJob(job); return doRange(job); }
    return finish(job);
  }

  function finish(job) {
    const rows = Object.values(job.rows);
    const total = job.totals.reduce((s, t) => s + t.total, 0);
    const msg = { type: 'usama-dxb-sales', id: job.id, project: job.project, community: job.community, total, rows, captured_at: new Date().toISOString() };
    dropJob();
    if (toCrm(msg)) {
      status(`Read ${rows.length} of ${total} sales for ${job.project} and sent them to the CRM. You can close this tab.`, true);
      setTimeout(() => { try { window.close(); } catch (_) {} }, 2500);
    } else {
      status(`Read ${rows.length} of ${total} sales. The CRM tab was closed, so a new CRM tab opens to import them.`, true);
      sendByAddress({ source: 'dxbinteract', page: location.href, captured_at: msg.captured_at, rows });
    }
  }

  // The manual button is not needed while the CRM is driving this tab.
  if (/^#usama-fetch=/.test(location.hash) || loadJob()) { startJob(); } else { document.body.appendChild(btn); }
})();

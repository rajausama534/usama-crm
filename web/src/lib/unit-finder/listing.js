// Unit Finder: read a Bayut / Dubizzle / Property Finder listing and return its details in one shape.
// The browser page (unit-finder.html) then matches those details against the CRM's own unit data.
//
// Input (POST JSON): { url, text? }
//   url  - the listing link
//   text - optional page text (from the Chrome extension, or pasted by the user). When given, the
//          page is not fetched; the text is parsed instead.
// Bayut and Dubizzle answer server requests with a bot "security check" page. When that happens we
// say so (blocked: true) and the page asks for the extension or pasted text. We do not try to get
// around those checks.

const SQM_TO_SQFT = 10.7639;

function cleanText(value) {
  if (value == null) return null;
  const s = String(value).replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
  return s || null;
}

function num(value) {
  if (value == null || value === '') return null;
  if (typeof value === 'object') value = value.value ?? value.amount ?? null;
  if (value == null) return null;
  const n = Number(String(value).replace(/[^\d.]/g, ''));
  return Number.isFinite(n) && n > 0 ? n : null;
}

function deepFind(obj, predicate, results = [], depth = 0) {
  if (!obj || typeof obj !== 'object' || depth > 40) return results;
  try { if (predicate(obj)) results.push(obj); } catch {}
  for (const v of Array.isArray(obj) ? obj : Object.values(obj)) deepFind(v, predicate, results, depth + 1);
  return results;
}

function platformOf(url) {
  if (/bayut\.com/i.test(url)) return 'Bayut';
  if (/dubizzle\.com/i.test(url)) return 'Dubizzle';
  if (/propertyfinder\.ae/i.test(url)) return 'Property Finder';
  return null;
}

function listingIdOf(url) {
  return url.match(/details-(\d+)\.html/i)?.[1]
    || url.match(/-(\d{6,})\.html/i)?.[1]
    || url.match(/---([0-9a-f]{16,})/i)?.[1]
    || url.match(/-(\d{1,4}-\d{2,})\/?(?:[?#]|$)/)?.[1]
    || url.match(/\/(\d{6,})\/?(?:[?#]|$)/)?.[1]
    || null;
}

// Words from the link itself (Dubizzle and Property Finder put location and beds in the slug).
function urlHints(url) {
  try {
    const u = new URL(url);
    const words = decodeURIComponent(u.pathname)
      .replace(/\.html$/i, '')
      .split('/')
      .filter(part => /[a-z]/i.test(part) && !/^(en|ar|plp|buy|rent|property|details|property-for-sale|property-for-rent|residential|villahouse|apartmentflat|townhouse)$/i.test(part))
      .join(' ')
      .replace(/[-_]+/g, ' ')
      .replace(/\b[0-9a-f]{16,}\b/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    return words || null;
  } catch { return null; }
}

// Every area mentioned in text: "8,637 sq.ft", "BUA: 3,720", "Plot 4,950 sqft", "350 sqm".
function extractSizes(text) {
  const sizes = [];
  const src = String(text || '');
  const add = (raw, unit, context) => {
    let v = Number(String(raw).replace(/,/g, ''));
    if (!Number.isFinite(v) || v <= 0) return;
    const u = String(unit || '').toLowerCase();
    if (/m/.test(u) && !/ft|feet|foot/.test(u)) v = v * SQM_TO_SQFT;
    v = Math.round(v);
    if (v < 300 || v > 60000) return;
    const c = String(context || '').toLowerCase();
    const label = /plot|land/.test(c) ? 'plot' : /bua|built|internal|living/.test(c) ? 'bua' : 'size';
    sizes.push({ sqft: v, label });
  };
  const unitRe = /(\d{1,2},\d{3}(?:\.\d+)?|\d{3,5}(?:\.\d+)?)\s*(sq\.?\s*ft\.?|sqft|square\s*f(?:ee|oo)t|sq\.?\s*m\b|sqm|m2|m²)/gi;
  let m;
  while ((m = unitRe.exec(src))) add(m[1], m[2], src.slice(Math.max(0, m.index - 30), m.index + m[0].length + 12));
  const labelRe = /(BUA|built[- ]?up(?:\s*area)?|plot(?:\s*(?:size|area))?|land\s*area)\s*(?:of|is|:|-|–)?\s*(?:approx\.?\s*)?(\d{1,2},\d{3}|\d{3,5})\b(?!\s*(?:sq|aed|bed|br))/gi;
  while ((m = labelRe.exec(src))) add(m[2], 'sqft', m[1]);
  const seen = new Set();
  return sizes.filter(s => { if (seen.has(s.sqft)) return false; seen.add(s.sqft); return true; });
}

// "Villa 123", "Unit No. 45", "Plot #12": numbers the agent may have mentioned.
function extractUnitHints(text) {
  const hints = new Set();
  const re = /\b(?:villa|unit|plot|house|townhouse|property|apartment|apt)\s*(?:no\.?|number|num|#)?\s*[:#-]?\s*(\d{1,4})(?![\d,.]|\s*(?:sq|bed|br|bath|bhk|b\/r|m\b|%|aed|k\b|million|years?|mins?|minutes|floors?|storey|x\b))/gi;
  let m;
  while ((m = re.exec(String(text || '')))) hints.add(String(Number(m[1])));
  return [...hints].slice(0, 10);
}

function firstMatch(text, patterns) {
  for (const p of patterns) {
    const m = String(text || '').match(p);
    if (m?.[1]) return cleanText(m[1]);
  }
  return null;
}

// Generic reader for page text (extension, pasted, or stripped HTML).
function parseText(text) {
  const t = String(text || '');
  const rent = /\bfor\s+rent\b|\byearly\b|\/\s*year\b|per\s+(?:year|annum)/i.test(t);
  const sale = /\bfor\s+sale\b/i.test(t);
  const bedsRaw = firstMatch(t, [/\b(\d{1,2})\s*(?:beds?|bedrooms?|br|bhk)\b/i, /\bbedrooms?\s*[:\n]?\s*(\d{1,2})\b/i]);
  return {
    purpose: sale ? 'sale' : rent ? 'rent' : null,
    propertyType: firstMatch(t, [/(?:Property\s*)?Type\s*[:\n]\s*(Villa|Townhouse|Apartment|Penthouse|Plot|Duplex)/i, /\b(Villa|Townhouse|Apartment|Penthouse)\b/i]),
    bedrooms: /\bstudio\b/i.test(t) && !bedsRaw ? '0' : bedsRaw,
    bathrooms: firstMatch(t, [/\b(\d{1,2})\s*(?:baths?|bathrooms?)\b/i, /\bbathrooms?\s*[:\n]?\s*(\d{1,2})\b/i]),
    price: num(firstMatch(t, [/AED\s*([\d,]{5,})/i, /([\d,]{6,})\s*AED/i, /price\s*[:\n]\s*([\d,]{5,})/i])),
    referenceNumber: firstMatch(t, [/Reference\s*(?:no\.?|number)?\s*[:\n#]?\s*((?:Bayut\s*-\s*)?[A-Z0-9][A-Z0-9_/-]{2,})/i]),
    permitNumber: firstMatch(t, [/(?:DLD\s*)?Permit\s*(?:No\.?|Number)?\s*[:\n#]?\s*(\d{6,})/i, /Trakheesi\s*(?:Permit)?\s*[:\n#]?\s*(\d{6,})/i]),
    floor: firstMatch(t, [/\bfloor\s*(?:no\.?|number)?\s*[:\n]\s*([A-Z0-9 ]{1,12})/i, /\b(\d{1,2})(?:st|nd|rd|th)\s+floor\b/i]),
    view: firstMatch(t, [/\b((?:park|pool|garden|golf|lake|community|road|green|lagoon|open|landscape|crystal lagoon)\s+(?:facing|view|views))\b/i]),
    position: firstMatch(t, [/\b(single[- ]row|corner(?:\s+unit|\s+plot)?|end[- ]unit|middle\s+unit|back[- ]to[- ]back|close\s+to\s+(?:the\s+)?(?:pool|park))\b/i])
  };
}

function propertyFinder(url, html) {
  const m = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/i);
  if (!m) return null;
  let p;
  try { p = JSON.parse(m[1])?.props?.pageProps?.propertyResult?.property; } catch { return null; }
  if (!p) return null;
  const tree = Array.isArray(p.location_tree) ? p.location_tree.map(x => x?.name).filter(Boolean) : [];
  const reg = {};
  for (const d of [...(p.regulatory_details || []), ...(p.property_details || [])]) {
    const v = d?.values?.primary?.value;
    const val = v?.localized_value?.en ?? v?.value ?? v;
    reg[d?.id] = typeof val === 'object' ? null : cleanText(val);
  }
  const sizes = [];
  if (num(p.size)) sizes.push({ sqft: Math.round(num(p.size)), label: 'size' });
  if (num(p.plot_size) && Math.round(num(p.plot_size)) !== Math.round(num(p.size) || 0)) sizes.push({ sqft: Math.round(num(p.plot_size)), label: 'plot' });
  const beds = p.bedrooms_value != null ? String(p.bedrooms_value) : (/studio/i.test(String(p.bedrooms)) ? '0' : String(p.bedrooms || '').replace(/\D/g, '') || null);
  return {
    listingId: String(p.id || listingIdOf(url) || ''),
    purpose: p.price?.period && p.price.period !== 'sell' ? 'rent' : 'sale',
    propertyType: p.property_type || null,
    title: cleanText(p.title_original || p.title),
    description: cleanText(p.description_original || p.description),
    locationNames: tree.length ? tree : [p.location?.full_name].filter(Boolean),
    locationText: p.location?.full_name || tree.join(', '),
    project: p.project?.title || null,
    bedrooms: beds,
    bathrooms: p.bathrooms_value != null ? String(p.bathrooms_value) : p.bathrooms || null,
    sizeSqft: num(p.size),
    plotSqft: num(p.plot_size),
    price: num(p.price),
    referenceNumber: p.reference || reg.regulatory_reference || null,
    permitNumber: p.rera?.number || Object.entries(reg).find(([k, v]) => /permit/i.test(k) && v)?.[1] || null,
    permitLink: p.rera?.permit_validation_url || reg.regulatory_validation_url || null,
    agency: p.broker?.name || p.client?.name || null,
    broker: p.agent?.name || null,
    upgraded: !!p.is_upgraded, extended: !!p.is_extended,
    structuredSizes: sizes
  };
}

// Bayut / Dubizzle pages, if a server request is let through: look for the listing object in the page data.
function genericStructured(url, html) {
  const blobs = [];
  for (const m of html.matchAll(/<script[^>]*id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/gi)) blobs.push(m[1]);
  for (const m of html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) blobs.push(m[1]);
  let best = null, bestScore = 0;
  for (const blob of blobs) {
    let data; try { data = JSON.parse(blob); } catch { continue; }
    const found = deepFind(data, x => (x.rooms != null || x.bedrooms != null || x.numberOfRooms != null) && (x.area != null || x.size != null || x.floorSize != null || x.price != null));
    for (const p of found) {
      const loc = Array.isArray(p.location) ? p.location.map(l => l?.name).filter(Boolean) : [];
      const c = {
        title: cleanText(p.title || p.name),
        description: cleanText(p.description),
        locationNames: loc.length ? loc : [p.address?.addressLocality, p.address?.streetAddress].filter(Boolean),
        bedrooms: p.rooms ?? p.bedrooms ?? p.numberOfRooms ?? null,
        bathrooms: p.baths ?? p.bathrooms ?? p.numberOfBathroomsTotal ?? null,
        sizeSqft: num(p.area ?? p.size ?? p.floorSize),
        plotSqft: num(p.plotArea ?? p.plot_area ?? p.plotSize),
        price: num(p.price ?? p.offers?.price),
        referenceNumber: p.referenceNumber || p.reference_number || null,
        permitNumber: p.permitNumber || p.permit_number || null,
        agency: p.agency?.name || null,
        broker: p.contactName || p.agent?.name || null
      };
      const s = Object.values(c).filter(v => v != null && !(Array.isArray(v) && !v.length)).length;
      if (s > bestScore) { best = c; bestScore = s; }
    }
  }
  if (best?.bedrooms != null) best.bedrooms = String(best.bedrooms).replace(/\D/g, '') || null;
  // Bayut keeps area in sqm in its page data.
  if (best && /bayut/i.test(url) && best.sizeSqft && best.sizeSqft < 2500) best.sizeSqft = Math.round(best.sizeSqft * SQM_TO_SQFT);
  return best;
}

function htmlToText(html) {
  return String(html || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<(br|\/p|\/div|\/li|\/h\d)[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n+/g, '\n')
    .trim();
}

function isBotWall(status, html) {
  return status === 403 || status === 429
    || /<title>\s*(Security check|Pardon Our Interruption|Just a moment|Access denied)/i.test(html)
    || (status >= 500 && /security check|captcha|pardon our interruption/i.test(html));
}

async function fetchPage(url, timeoutMs = 15000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const r = await fetch(url, {
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
        accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'accept-language': 'en-US,en;q=0.9'
      }
    });
    return { status: r.status, html: await r.text() };
  } finally { clearTimeout(timer); }
}

function finish(url, platform, structured, text, extra = {}) {
  const allText = [structured?.title, structured?.description, text].filter(Boolean).join('\n');
  const fromText = parseText(allText);
  const sizes = [...(structured?.structuredSizes || [])];
  const addSize = s => { if (s?.sqft && !sizes.some(x => x.sqft === s.sqft)) sizes.push(s); };
  if (structured?.sizeSqft) addSize({ sqft: Math.round(structured.sizeSqft), label: 'size' });
  if (structured?.plotSqft) addSize({ sqft: Math.round(structured.plotSqft), label: 'plot' });
  extractSizes(allText).forEach(addSize);
  const pick = k => structured?.[k] ?? fromText[k] ?? null;
  return {
    platform,
    url,
    listingId: structured?.listingId || listingIdOf(url),
    purpose: structured?.purpose || fromText.purpose || (/for-rent|\/rent\//i.test(url) ? 'rent' : /for-sale|\/buy\//i.test(url) ? 'sale' : null),
    propertyType: pick('propertyType'),
    title: structured?.title || null,
    description: structured?.description ? structured.description.slice(0, 4000) : null,
    locationNames: structured?.locationNames || [],
    locationText: structured?.locationText || (structured?.locationNames || []).join(', ') || null,
    urlWords: urlHints(url),
    project: structured?.project || null,
    bedrooms: pick('bedrooms'),
    bathrooms: pick('bathrooms'),
    sizeSqft: structured?.sizeSqft || sizes.find(s => s.label !== 'plot')?.sqft || null,
    plotSqft: structured?.plotSqft || sizes.find(s => s.label === 'plot')?.sqft || null,
    sizes: sizes.slice(0, 12),
    price: pick('price'),
    referenceNumber: pick('referenceNumber'),
    permitNumber: pick('permitNumber'),
    permitLink: structured?.permitLink || null,
    floor: fromText.floor,
    view: fromText.view,
    position: fromText.position,
    agency: structured?.agency || null,
    broker: structured?.broker || null,
    upgraded: Boolean(structured?.upgraded || /\bupgraded\b/i.test(allText)),
    extended: Boolean(structured?.extended || /\bextended\b/i.test(allText)),
    unitHints: extractUnitHints(allText),
    // The browser uses this to spot cluster and layout names.
    searchText: allText.slice(0, 12000),
    ...extra
  };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  const url = String(req.body?.url || '').trim();
  const text = req.body?.text ? String(req.body.text).slice(0, 60000) : '';
  if (url && !/^https?:\/\//i.test(url)) return res.status(400).json({ error: 'The link should start with https://' });
  const platform = platformOf(url) || (text ? 'Pasted text' : null);
  if (!platform) return res.status(400).json({ error: 'Paste a Bayut, Dubizzle or Property Finder listing link.' });

  if (text) return res.status(200).json(finish(url, platform, null, text, { source: 'page-text', blocked: false }));

  let page;
  try { page = await fetchPage(url); }
  catch (error) {
    return res.status(200).json(finish(url, platform, null, '', { source: 'link-only', blocked: true, note: `Could not open the listing (${error.name === 'AbortError' ? 'timed out' : error.message}).` }));
  }
  if (page.status === 404 || page.status === 410) {
    return res.status(200).json(finish(url, platform, null, '', { source: 'link-only', blocked: false, removed: true, note: 'The portal says this listing no longer exists.' }));
  }
  if (isBotWall(page.status, page.html)) {
    return res.status(200).json(finish(url, platform, null, '', {
      source: 'link-only', blocked: true,
      note: `${platform} only shows listings to a normal browser, so the CRM can't read this link by itself. Use the Chrome extension on the listing, or copy the listing page (Cmd+A, Cmd+C) and paste it below.`
    }));
  }
  if (platform === 'Property Finder') {
    const structured = propertyFinder(url, page.html);
    // The PF page text is full of similar listings; use only this listing's own data.
    if (structured) return res.status(200).json(finish(url, platform, structured, '', { source: 'portal-data', blocked: false }));
  }
  const structured = genericStructured(url, page.html);
  return res.status(200).json(finish(url, platform, structured, htmlToText(page.html).slice(0, 30000), { source: structured ? 'portal-data' : 'page-text', blocked: false }));
}

export { parseText, extractSizes, extractUnitHints, propertyFinder, finish, urlHints };

function deepFind(obj, predicate, results = []) {
  if (!obj || typeof obj !== 'object') return results;
  try { if (predicate(obj)) results.push(obj); } catch {}
  if (Array.isArray(obj)) obj.forEach(x => deepFind(x, predicate, results));
  else Object.values(obj).forEach(x => deepFind(x, predicate, results));
  return results;
}

function cleanNumber(value) {
  if (value == null) return null;
  const n = Number(String(value).replace(/[^\d.]/g, ''));
  return Number.isFinite(n) ? n : null;
}

function cleanText(value) {
  return value == null ? null : String(value).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() || null;
}

function locationNames(location) {
  if (!Array.isArray(location)) return [];
  return location.map(x => x?.name).filter(Boolean);
}

function firstMatch(text, patterns) {
  for (const pattern of patterns) {
    const match = String(text || '').match(pattern);
    if (match?.[1]) return cleanText(match[1]);
  }
  return null;
}

function parseJsonLd(html) {
  const blocks = [...String(html || '').matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)];
  const values = [];
  for (const block of blocks) {
    try {
      const parsed = JSON.parse(block[1]);
      values.push(...(Array.isArray(parsed) ? parsed : [parsed]));
    } catch {}
  }
  return values;
}

function normalizeFromObject(url, p) {
  const location = p?.location || p?.locationHierarchy || [];
  const names = locationNames(location);
  const rooms = p?.rooms ?? p?.bedrooms ?? p?.beds ?? p?.numberOfRooms ?? null;
  return {
    platform: 'Bayut',
    listingId: url.match(/details-(\d+)\.html/i)?.[1] || null,
    permitNumber: p?.permitNumber || p?.permit_number || p?.permit || null,
    referenceNumber: p?.referenceNumber || p?.reference_number || p?.externalID || p?.sku || null,
    title: p?.title || p?.shortTitle || p?.name || null,
    project: p?.projectName || p?.project || null,
    building: p?.buildingName || p?.building || null,
    area: names[names.length - 1] || p?.address?.addressLocality || null,
    locationPath: names.join(' > ') || p?.address?.streetAddress || null,
    bedrooms: rooms != null ? String(rooms).replace(/[^0-9]/g, '') : null,
    bathrooms: p?.baths || p?.bathrooms || p?.numberOfBathrooms || null,
    sizeSqft: cleanNumber(p?.area || p?.size || p?.plotArea || p?.floorSize?.value),
    price: cleanNumber(p?.price || p?.offers?.price),
    agency: p?.agency?.name || p?.agencyName || p?.seller?.name || null,
    broker: p?.contactName || p?.broker?.name || p?.ownerName || null
  };
}

function score(obj) {
  return ['permitNumber','referenceNumber','title','project','building','area','bedrooms','sizeSqft','price'].reduce((n,k)=>n+(obj?.[k]?1:0),0);
}

function parseHtml(url, html) {
  const candidates = [];
  const nextMatch = String(html || '').match(/<script[^>]+id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i);
  if (nextMatch) {
    try {
      const nextData = JSON.parse(nextMatch[1]);
      const possible = deepFind(nextData, x =>
        (x?.permitNumber || x?.permit_number || x?.referenceNumber || x?.reference_number || x?.title) &&
        (x?.area || x?.rooms || x?.price || x?.location || x?.locationHierarchy || x?.project)
      );
      possible.forEach(p => candidates.push(normalizeFromObject(url, p)));
    } catch {}
  }

  parseJsonLd(html).forEach(p => candidates.push(normalizeFromObject(url, p)));

  const text = String(html || '');
  const meta = {
    platform: 'Bayut',
    listingId: url.match(/details-(\d+)\.html/i)?.[1] || null,
    permitNumber: firstMatch(text, [
      /(?:Permit Number|Permit No\.?|permitNumber)["'\s:=><-]*([A-Z0-9-]{5,})/i,
      /"permitNumber"\s*:\s*"([^"]+)"/i
    ]),
    referenceNumber: firstMatch(text, [
      /(?:Reference Number|Reference No\.?|referenceNumber)["'\s:=><-]*([A-Z0-9_-]{3,})/i,
      /"referenceNumber"\s*:\s*"([^"]+)"/i
    ]),
    title: firstMatch(text, [
      /<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i,
      /<title>([^<]+)<\/title>/i
    ]),
    project: firstMatch(text, [/"projectName"\s*:\s*"([^"]+)"/i]),
    building: firstMatch(text, [/"buildingName"\s*:\s*"([^"]+)"/i]),
    area: firstMatch(text, [/"addressLocality"\s*:\s*"([^"]+)"/i]),
    locationPath: null,
    bedrooms: firstMatch(text, [/(\d+)\s*(?:Bedroom|Bedrooms|BR)\b/i]),
    bathrooms: firstMatch(text, [/(\d+)\s*(?:Bathroom|Bathrooms|Baths)\b/i]),
    sizeSqft: cleanNumber(firstMatch(text, [/([\d,.]+)\s*(?:sq\.?\s*ft|sqft)/i])),
    price: cleanNumber(firstMatch(text, [/(?:AED|د\.إ)\s*([\d,]+)/i, /"price"\s*:\s*"?([\d.]+)"?/i])),
    agency: firstMatch(text, [/"agencyName"\s*:\s*"([^"]+)"/i]),
    broker: firstMatch(text, [/"contactName"\s*:\s*"([^"]+)"/i])
  };
  candidates.push(meta);

  return candidates.sort((a,b)=>score(b)-score(a))[0] || meta;
}

async function fetchText(url, timeoutMs = 18000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
        'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'accept-language': 'en-US,en;q=0.9',
        'cache-control': 'no-cache',
        'pragma': 'no-cache'
      }
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.text();
  } finally {
    clearTimeout(timer);
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const url = String(req.body?.url || '').trim();
  if (!/^https?:\/\/(www\.)?bayut\.com\/property\/details-\d+\.html/i.test(url)) {
    return res.status(400).json({ error: 'Enter a valid Bayut property details link.' });
  }

  const attempts = [];
  let details = null;
  let source = null;

  try {
    const html = await fetchText(url);
    attempts.push('direct');
    details = parseHtml(url, html);
    if (score(details) >= 3) source = 'Bayut page';
  } catch (error) {
    attempts.push(`direct failed: ${error.message}`);
  }

  if (!source) {
    try {
      const proxyUrl = `https://r.jina.ai/http://${url.replace(/^https?:\/\//i, '')}`;
      const text = await fetchText(proxyUrl, 25000);
      attempts.push('reader fallback');
      const fallback = parseHtml(url, text);
      if (!details || score(fallback) > score(details)) details = fallback;
      if (score(details) >= 2) source = 'Reader fallback';
    } catch (error) {
      attempts.push(`reader failed: ${error.message}`);
    }
  }

  details ||= { platform: 'Bayut', listingId: url.match(/details-(\d+)\.html/i)?.[1] || null };

  return res.status(200).json({
    status: source ? 'EXTRACTED_ONLY' : 'PARTIAL',
    ...details,
    unitNumber: null,
    propertyNumber: null,
    landNumber: null,
    resolverConnected: false,
    extractionSource: source,
    note: source
      ? 'Public listing details extracted. Exact unit number requires an authorised DLD/Trakheesi resolver.'
      : 'Bayut blocked the listing details. The listing ID was captured; enter the permit number manually or connect an authorised DLD/Trakheesi resolver.',
    diagnostics: attempts
  });
}

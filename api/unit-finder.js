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

function locationNames(location) {
  if (!Array.isArray(location)) return [];
  return location.map(x => x?.name).filter(Boolean);
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  try {
    const url = String(req.body?.url || '').trim();
    if (!/^https?:\/\/(www\.)?bayut\.com\/property\/details-\d+\.html/i.test(url)) {
      return res.status(400).json({ error: 'Enter a valid Bayut property details link.' });
    }

    const response = await fetch(url, {
      headers: {
        'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36',
        'accept-language': 'en-US,en;q=0.9'
      }
    });
    if (!response.ok) throw new Error(`Bayut returned ${response.status}`);
    const html = await response.text();
    const match = html.match(/<script[^>]+id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i);
    if (!match) throw new Error('Bayut page data was not found or the request was blocked.');

    const nextData = JSON.parse(match[1]);
    const possible = deepFind(nextData, x =>
      (x?.permitNumber || x?.permit_number || x?.referenceNumber || x?.reference_number) &&
      (x?.area || x?.rooms || x?.price || x?.location || x?.locationHierarchy)
    ).sort((a,b) => Object.keys(b || {}).length - Object.keys(a || {}).length);
    const p = possible[0];
    if (!p) throw new Error('Listing details could not be identified.');

    const location = p.location || p.locationHierarchy || [];
    const names = locationNames(location);
    const rooms = p.rooms ?? p.bedrooms ?? p.beds ?? null;
    const listingId = url.match(/details-(\d+)\.html/i)?.[1] || null;

    return res.status(200).json({
      status: 'EXTRACTED_ONLY',
      platform: 'Bayut',
      listingId,
      permitNumber: p.permitNumber || p.permit_number || p.permit || null,
      referenceNumber: p.referenceNumber || p.reference_number || p.externalID || null,
      title: p.title || p.shortTitle || null,
      project: p.projectName || p.project || null,
      building: p.buildingName || p.building || null,
      area: names[names.length - 1] || null,
      locationPath: names.join(' > ') || null,
      bedrooms: rooms != null ? String(rooms).replace(/[^0-9]/g, '') : null,
      bathrooms: p.baths || p.bathrooms || null,
      sizeSqft: cleanNumber(p.area || p.size || p.plotArea),
      price: cleanNumber(p.price),
      agency: p.agency?.name || p.agencyName || null,
      broker: p.contactName || p.broker?.name || p.ownerName || null,
      unitNumber: null,
      propertyNumber: null,
      landNumber: null,
      resolverConnected: false,
      note: 'Public listing details extracted. Exact unit number requires an authorised DLD/Trakheesi resolver.'
    });
  } catch (error) {
    return res.status(500).json({ error: error.message || 'Could not analyse listing.' });
  }
}

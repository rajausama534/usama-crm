(() => {
  const text = () => document.body?.innerText || '';
  const clean = value => String(value ?? '').replace(/\s+/g, ' ').trim() || null;
  const number = value => {
    if (value == null) return null;
    const n = Number(String(value).replace(/[^\d.]/g, ''));
    return Number.isFinite(n) ? n : null;
  };
  const pick = (...values) => values.map(clean).find(Boolean) || null;
  const meta = key => document.querySelector(`meta[property="${key}"],meta[name="${key}"]`)?.content || null;
  const matchText = patterns => {
    const source = text();
    for (const pattern of patterns) {
      const match = source.match(pattern);
      if (match?.[1]) return clean(match[1]);
    }
    return null;
  };
  const parseJsonLd = () => {
    const items = [];
    document.querySelectorAll('script[type="application/ld+json"]').forEach(script => {
      try {
        const value = JSON.parse(script.textContent || '{}');
        if (Array.isArray(value)) items.push(...value); else items.push(value);
      } catch {}
    });
    return items.flatMap(item => item?.['@graph'] || item || []).filter(Boolean);
  };
  const findJsonLd = () => {
    const nodes = parseJsonLd();
    return nodes.find(node => /Product|Residence|Apartment|House|RealEstateListing/i.test(String(node?.['@type'] || ''))) || nodes[0] || {};
  };
  const listingId = () => {
    const url = location.href;
    return url.match(/details-(\d+)\.html/i)?.[1]
      || url.match(/-(\d{6,})\/?(?:\?|$)/)?.[1]
      || matchText([/Listing\s*ID\s*[:#]?\s*([A-Z0-9-]+)/i]);
  };
  const permit = () => matchText([
    /Permit\s*(?:No\.?|Number)?\s*[:#]?\s*([A-Z0-9-]{5,})/i,
    /DLD\s*Permit\s*[:#]?\s*([A-Z0-9-]{5,})/i,
    /Trakheesi\s*Permit\s*[:#]?\s*([A-Z0-9-]{5,})/i
  ]);
  const reference = () => matchText([
    /Reference\s*(?:No\.?|Number)?\s*[:#]?\s*([A-Z0-9_-]{3,})/i,
    /Property\s*Reference\s*[:#]?\s*([A-Z0-9_-]{3,})/i
  ]);
  const extract = () => {
    const ld = findJsonLd();
    const body = text();
    const priceText = pick(ld?.offers?.price, meta('product:price:amount'), matchText([/AED\s*([\d,]+)/i]));
    const sizeText = matchText([
      /([\d,]+(?:\.\d+)?)\s*(?:sq\.?\s*ft|sqft)/i,
      /Built[- ]?up\s*Area\s*[:#]?\s*([\d,]+)/i,
      /Plot\s*Area\s*[:#]?\s*([\d,]+)/i
    ]);
    const beds = matchText([/(\d+)\s*(?:Bed|Bedroom|BR)\b/i]);
    const baths = matchText([/(\d+)\s*(?:Bath|Bathroom)\b/i]);
    const title = pick(ld?.name, meta('og:title'), document.querySelector('h1')?.textContent, document.title);
    const locationText = pick(ld?.address?.addressLocality, ld?.address?.streetAddress, meta('og:locality'));
    const project = matchText([
      /Project\s*[:#]?\s*([^\n]+)/i,
      /Sub-project\s*[:#]?\s*([^\n]+)/i,
      /Community\s*[:#]?\s*([^\n]+)/i
    ]);
    const agency = matchText([/Agency\s*[:#]?\s*([^\n]+)/i]);
    const broker = matchText([/(?:Agent|Broker)\s*[:#]?\s*([^\n]+)/i]);
    return {
      source: 'browser-extension',
      platform: location.hostname.includes('bayut') ? 'Bayut' : location.hostname.includes('dubizzle') ? 'Dubizzle' : 'Property Finder',
      url: location.href,
      listingId: listingId(),
      permitNumber: permit(),
      referenceNumber: reference(),
      title,
      project,
      building: null,
      area: locationText,
      bedrooms: beds,
      bathrooms: baths,
      sizeSqft: number(sizeText),
      price: number(priceText),
      agency,
      broker,
      pageTextSample: body.slice(0, 5000)
    };
  };
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type !== 'USAMA_EXTRACT_LISTING') return;
    try { sendResponse({ ok: true, data: extract() }); }
    catch (error) { sendResponse({ ok: false, error: error.message || 'Extraction failed.' }); }
  });
})();

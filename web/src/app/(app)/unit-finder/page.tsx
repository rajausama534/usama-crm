"use client";

// Lives at /unit-finder (not under /market) because the Chrome extension only runs on that address.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useRef, useState } from "react";
import { Search, Loader2, Check } from "lucide-react";
import { useAuth } from "@/components/Providers";
import { Badge, Button, Card, Input, PageHeader, Textarea, buttonClass, cx, type Tone } from "@/components/ui";
import { fmt, isStrong, matchListing, money, type Candidate, type Listing } from "@/lib/unit-finder/match";

const MAP_KEY = "usama_crm_unit_mappings_v1";
type Saved = { unitNumber: string | null; cluster: string | null; community: string | null; propertyNumber: string | null; landNumber?: string | null; savedAt: string };

function getMappings(): Record<string, Saved> { try { return JSON.parse(localStorage.getItem(MAP_KEY) || "{}"); } catch { return {}; } }
const idFromUrl = (url: string) => url.match(/details-(\d+)\.html/i)?.[1] || url.match(/-(\d{6,})\.html/i)?.[1] || url.match(/---([0-9a-f]{16,})/i)?.[1] || url.match(/-(\d{1,4}-\d{2,})\/?(?:[?#]|$)/)?.[1] || url.match(/\/(\d{6,})\/?(?:[?#]|$)/)?.[1] || null;
const mapKey = (d: Listing | null) => (d?.listingId ? String(d.listingId) : d?.url || null);
const savedFor = (d: Listing | null) => { const k = mapKey(d); return k ? getMappings()[k] || null : null; };
const extVersion = () => document.documentElement.dataset.usamaExt || null;
const extCanRead = () => { const v = extVersion(); if (!v) return false; const [a, b] = v.split(".").map(Number); return a > 1 || (a === 1 && b >= 4); };

function readViaExtension(url: string) {
  return new Promise<any>((resolve, reject) => {
    const id = Math.random().toString(36).slice(2);
    const timer = setTimeout(() => { window.removeEventListener("message", on); reject(new Error("The extension took too long to read the listing.")); }, 60000);
    function on(e: MessageEvent) {
      const m = e.data;
      if (e.source !== window || !m || m.source !== "usama-ext" || m.type !== "READ_RESULT" || m.id !== id) return;
      clearTimeout(timer); window.removeEventListener("message", on);
      if (m.ok) resolve(m.data); else reject(new Error(m.error || "The extension could not read the listing."));
    }
    window.addEventListener("message", on);
    window.postMessage({ source: "usama-crm", type: "READ_LINK", url, id }, location.origin);
  });
}
async function readListing(url: string, text?: string): Promise<Listing> {
  const r = await fetch("/api/unit-finder", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url, text }) });
  const d = await r.json().catch(() => ({ error: "The server did not answer" }));
  if (!r.ok) throw new Error(d.error || "Could not read the listing");
  return d;
}

const STATUS_START = "Paste any Bayut, Dubizzle or Property Finder link. Bayut and Dubizzle links are opened through the Usama CRM Helper Chrome extension (v1.4).";

export default function UnitFinderPage() {
  const { session } = useAuth();
  const [url, setUrl] = useState("");
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteText, setPasteText] = useState("");
  const [status, setStatus] = useState<{ text: string; err?: boolean }>({ text: STATUS_START });
  const [busy, setBusy] = useState<"" | "link" | "paste">("");
  const [btnLabel, setBtnLabel] = useState("Analyse listing");
  const [listing, setListing] = useState<Listing | null>(null);
  const [saved, setSaved] = useState<Saved | null>(null);
  const [match, setMatch] = useState<{ title: string; badge: string; tone: Tone; note: string; list: Candidate[]; msg: string } | null>(null);
  const [mapUnit, setMapUnit] = useState("");
  const [mapCluster, setMapCluster] = useState("");
  const [mapProperty, setMapProperty] = useState("");
  const [saveMsg, setSaveMsg] = useState("");
  const didHash = useRef(false);

  function show(d: Listing) {
    const s = savedFor(d);
    setListing(d); setSaved(s); setSaveMsg("");
    setMapUnit(s?.unitNumber || ""); setMapCluster(s?.cluster || ""); setMapProperty(s?.propertyNumber || s?.landNumber || "");
  }

  async function runMatch(d: Listing) {
    setMatch({ title: "Likely units", badge: "MATCHING", tone: "neutral", note: "", list: [], msg: "Checking CRM units…" });
    if (!session) { setMatch({ title: "Likely units", badge: "SIGN IN NEEDED", tone: "neutral", note: "Sign in so the Unit Finder can check your unit and owner data.", list: [], msg: "" }); return; }
    try {
      if (!(d.sizes || []).length && !(d.unitHints || []).length) {
        setMatch({ title: "Likely units", badge: "NOT ENOUGH DATA", tone: "neutral", list: [], msg: "", note: d.blocked ? (d.note || "The listing details are needed to match a unit. Paste the listing page text above.") : "The listing shows no size and no unit number, so it can't be matched to a unit." });
        if (d.blocked) setPasteOpen(true);
        return;
      }
      const r = await matchListing(d);
      if (!r.candidates.length) {
        setMatch({ title: "Likely units", badge: "NO MATCH", tone: "neutral", note: r.note, list: [], msg: `No CRM unit matches this listing's size${d.unitHints?.length ? " or unit number" : ""}. The agent may have rounded the size, or the unit isn't in the CRM yet.` });
        return;
      }
      const t = r.candidates[0], strong = isStrong(r.candidates);
      setMatch({
        title: strong ? `Unit ${t.u.unit}, ${t.u.cluster}` : r.total > 5 ? `${r.total} possible units (top 5 shown)` : `${r.candidates.length} possible unit${r.candidates.length > 1 ? "s" : ""}`,
        badge: strong ? "STRONG MATCH" : "SHORTLIST", tone: strong ? "good" : "warn", note: r.note, list: r.candidates, msg: "",
      });
    } catch (e) { setMatch({ title: "Likely units", badge: "ERROR", tone: "bad", note: "", list: [], msg: `Could not check CRM units: ${(e as Error).message}` }); }
  }

  async function analysePasted(text: string, link: string, extra?: Listing, doneLabel = "Listing text read") {
    if (text.trim().length < 40) { setStatus({ text: "Paste the listing page text first.", err: true }); setPasteOpen(true); return; }
    setBusy("paste");
    try {
      const d = await readListing(link, text.trim());
      if (!d.listingId && link) d.listingId = idFromUrl(link);
      if (extra) for (const k of Object.keys(extra)) if (extra[k] != null && (d[k] == null || d[k] === "" || (Array.isArray(d[k]) && !d[k].length))) d[k] = extra[k];
      show(d); setStatus({ text: `${doneLabel}. Matching against CRM units…` });
      await runMatch(d);
      setStatus({ text: `${doneLabel} and matched against CRM units.` }); setPasteOpen(false);
    } catch (e) { setStatus({ text: (e as Error).message, err: true }); }
    finally { setBusy(""); }
  }

  const extraFrom = (data: any): Listing => ({ platform: data.platform, listingId: data.listingId, permitNumber: data.permitNumber, referenceNumber: data.referenceNumber, title: data.title, bedrooms: data.bedrooms, bathrooms: data.bathrooms, price: data.price, agency: data.agency, broker: data.broker, locationNames: data.locationNames || [], locationText: data.locationText || data.area || null });

  async function analyse() {
    const link = url.trim();
    if (!link) { setStatus({ text: "Paste a listing link.", err: true }); return; }
    setBusy("link"); setBtnLabel("Reading…"); setStatus({ text: "Reading the listing…" }); setListing(null); setMatch(null);
    try {
      const d = await readListing(link);
      if (d.blocked && !d.removed && extCanRead()) {
        setStatus({ text: `${d.platform} doesn't let the CRM server read listings, so your Chrome extension is opening it in a background tab…` });
        setBtnLabel("Opening listing…");
        try {
          const data = await readViaExtension(link);
          const text = data.pageText || data.pageTextSample || "";
          setPasteText(text);
          await analysePasted(text, link, extraFrom(data), "Listing read by your Chrome extension");
          return;
        } catch (e) { d.note = `The extension couldn't read it: ${(e as Error).message} Open the listing once in Chrome, then try again, or paste the page text below.`; }
      } else if (d.blocked && !d.removed) {
        d.note = `${d.platform} doesn't let the CRM server read listings. ${extVersion() ? "Reload the Usama CRM Helper extension (needs version 1.4) in chrome://extensions" : "Install the Usama CRM Helper extension (version 1.4)"} and links will be read automatically. For now, copy the listing page (Cmd+A, Cmd+C) and paste it below.`;
      }
      show(d);
      if (d.blocked) { setStatus({ text: (savedFor(d) ? "Saved unit mapping loaded. " : "") + (d.note || "The portal blocked automatic reading.") }); setPasteOpen(true); }
      else { setStatus({ text: d.removed ? d.note : "Listing read. Matching against CRM units…" }); setPasteOpen(false); }
      await runMatch(d);
      if (!d.blocked && !d.removed) setStatus({ text: "Listing read and matched against CRM units." });
    } catch (e) { setStatus({ text: (e as Error).message, err: true }); }
    finally { setBusy(""); setBtnLabel("Analyse listing"); }
  }

  function saveMapping(override?: { unit: string; cluster: string; community: string }) {
    if (!listing || !mapKey(listing)) { setSaveMsg("Analyse a listing first."); return; }
    const unit = (override?.unit ?? mapUnit).trim(), cluster = (override?.cluster ?? mapCluster).trim(), prop = mapProperty.trim();
    if (!unit && !prop) { setSaveMsg("Enter the unit number."); return; }
    const all = getMappings();
    all[mapKey(listing)!] = { unitNumber: unit || null, cluster: cluster || null, community: override?.community || null, propertyNumber: prop || null, savedAt: new Date().toISOString() };
    Object.assign(all[mapKey(listing)!], { platform: listing.platform, url: listing.url || null, permitNumber: listing.permitNumber || null, referenceNumber: listing.referenceNumber || null });
    try { localStorage.setItem(MAP_KEY, JSON.stringify(all)); } catch {}
    show(listing);
    if (override) { setMapUnit(unit); setMapCluster(cluster); }
    setSaveMsg(`Saved: unit ${unit}${cluster ? ` in ${cluster}` : ""}. Searching this listing again shows it instantly.`);
  }

  // Listings sent from the Chrome extension's popup arrive as #extension=… in the address.
  useEffect(() => {
    if (didHash.current || !session) return;
    const prefix = "#extension=";
    if (!location.hash.startsWith(prefix)) return;
    didHash.current = true;
    try {
      const bin = atob(decodeURIComponent(location.hash.slice(prefix.length)));
      const data = JSON.parse(new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0))));
      history.replaceState(null, "", location.pathname);
      setUrl(data.url || "");
      const text = data.pageText || data.pageTextSample || "";
      setPasteText(text);
      setStatus({ text: "Listing imported from the Chrome extension." });
      analysePasted(text, data.url || "", extraFrom(data), "Listing imported from the Chrome extension");
    } catch (e) { setStatus({ text: `Could not read extension data: ${(e as Error).message}`, err: true }); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session]);

  const d = listing;
  const sizes = (d?.sizes || []).map((s: any) => `${fmt(s.sqft)}${s.label !== "size" ? ` ${s.label.toUpperCase()}` : ""}`).join(" · ");
  const badge = !d ? "" : saved ? "SAVED MATCH" : d.blocked ? "LINK ONLY" : d.source === "page-text" ? "FROM PAGE TEXT" : "READ FROM PORTAL";
  const resolver = !d ? "" : saved ? `Saved CRM mapping for this listing: unit ${saved.unitNumber || "-"}${saved.cluster ? ` in ${saved.cluster}` : ""} (saved ${new Date(saved.savedAt).toLocaleDateString("en-GB")}).` : d.note || "";
  const cells: [string, unknown][] = !d ? [] : [
    ["Platform", d.platform], ["Listing ID", d.listingId], ["Purpose", d.purpose ? d.purpose[0].toUpperCase() + d.purpose.slice(1) : null], ["Type", d.propertyType],
    ["Location", d.locationText || d.urlWords], ["Bedrooms", d.bedrooms != null && d.bedrooms !== "" ? (String(d.bedrooms) === "0" ? "Studio" : `${d.bedrooms} BR`) : null], ["Bathrooms", d.bathrooms], ["Sizes (sqft)", sizes || null],
    ["Price", money(d.price)], ["Reference", d.referenceNumber], ["Permit", d.permitNumber], ["Agency / agent", [d.agency, d.broker].filter(Boolean).join(" · ") || null],
    ["Position / view", [d.position, d.view, d.floor ? `Floor ${d.floor}` : null].filter(Boolean).join(" · ") || null], ["Upgraded", d.upgraded || d.extended ? [d.upgraded ? "Upgraded" : null, d.extended ? "Extended" : null].filter(Boolean).join(", ") : null],
    ["Title", d.title], ["Saved unit", saved ? [saved.unitNumber, saved.cluster].filter(Boolean).join(" · ") : null],
  ];

  return (
    <div className="animate-in max-w-5xl mx-auto">
      <PageHeader title="Unit Finder" subtitle="Paste a Bayut, Dubizzle or Property Finder link. The CRM reads the listing and matches it against its own unit sizes, sales and owners." />

      <Card className="p-4">
        <div className="flex flex-col sm:flex-row gap-2">
          <div className="relative flex-1">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-3" />
            <Input value={url} onChange={(e) => setUrl(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") analyse(); }} placeholder="Bayut, Dubizzle or Property Finder listing link" className="pl-9" autoComplete="off" />
          </div>
          <Button variant="primary" onClick={analyse} disabled={!!busy}>{busy === "link" && <Loader2 size={15} className="animate-spin" />}{btnLabel}</Button>
        </div>
        <div className={cx("mt-3 text-[13px] leading-relaxed", status.err ? "text-bad" : "text-ink-2")}>
          {status.text}{status.text === STATUS_START && <> Without it, <button className="underline text-accent-text" onClick={() => setPasteOpen(true)}>paste the listing page text</button>.</>}
        </div>
      </Card>

      {pasteOpen && (
        <Card className="p-4 mt-4 animate-in">
          <p className="text-[13px] text-ink-2 mb-3">Open the listing in your browser, press <b>Cmd+A</b> then <b>Cmd+C</b>, and paste everything here. Keep the link above filled in if you have it.</p>
          <Textarea value={pasteText} onChange={(e) => setPasteText(e.target.value)} placeholder="Paste the listing page text here" rows={6} />
          <div className="mt-3 flex justify-end"><Button variant="primary" disabled={!!busy} onClick={() => analysePasted(pasteText, url.trim())}>{busy === "paste" && <Loader2 size={15} className="animate-spin" />}{busy === "paste" ? "Reading…" : "Read pasted listing"}</Button></div>
        </Card>
      )}

      {match && (
        <Card className="mt-4 overflow-hidden animate-in">
          <div className="flex items-center justify-between gap-3 flex-wrap px-5 py-4 border-b border-line">
            <div className="font-semibold text-ink">{match.title}</div><Badge tone={match.tone}>{match.badge}</Badge>
          </div>
          {match.note && <div className="mx-5 mt-4 rounded-xl bg-warn-soft px-4 py-3 text-[13px] text-ink">{match.note}</div>}
          <div className="p-5 space-y-3">
            {match.msg && <p className="text-[13px] text-ink-2">{match.msg}</p>}
            {match.list.map((r, i) => <CandidateCard key={r.u.cluster + r.u.unit} r={r} i={i} list={match.list} onUse={() => saveMapping({ unit: r.u.unit, cluster: r.u.cluster, community: r.u.community })} />)}
          </div>
        </Card>
      )}

      {d && (
        <Card className="mt-4 overflow-hidden animate-in">
          <div className="flex items-center justify-between gap-3 flex-wrap px-5 py-4 border-b border-line">
            <div className="font-semibold text-ink">Listing details</div><Badge>{badge}</Badge>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-px bg-line">
            {cells.map(([k, v]) => (
              <div key={k} className="bg-surface px-4 py-3 min-w-0">
                <div className="text-[11px] font-medium uppercase tracking-[0.04em] text-ink-3">{k}</div>
                <div className="mt-1 text-sm font-medium text-ink break-words">{v == null || v === "" ? "-" : String(v)}</div>
              </div>
            ))}
          </div>
          {resolver && <div className="mx-5 mt-4 rounded-xl bg-warn-soft px-4 py-3 text-[13px] text-ink">{resolver}</div>}
          <div className="p-5">
            <div className="font-semibold text-ink text-sm">Confirm and save the unit</div>
            <p className="text-xs text-ink-3 mt-0.5 mb-3">Enter or pick the confirmed unit. The next time this listing is searched, the saved unit appears instantly.</p>
            <div className="grid grid-cols-1 sm:grid-cols-[1fr_1fr_1fr_auto] gap-2">
              <Input value={mapUnit} onChange={(e) => setMapUnit(e.target.value)} placeholder="Unit number" />
              <Input value={mapCluster} onChange={(e) => setMapCluster(e.target.value)} placeholder="Cluster" />
              <Input value={mapProperty} onChange={(e) => setMapProperty(e.target.value)} placeholder="Property / land number" />
              <Button variant="primary" onClick={() => saveMapping()}>Save mapping</Button>
            </div>
            {saveMsg && <div className="mt-2 text-xs text-good inline-flex items-center gap-1"><Check size={13} /> {saveMsg}</div>}
          </div>
        </Card>
      )}
    </div>
  );
}

function CandidateCard({ r, i, list, onUse }: { r: Candidate; i: number; list: Candidate[]; onUse: () => void }) {
  const u = r.u, last = u.sales[0];
  const owners = [...u.owners].sort((a, b) => (b.is_primary ? 1 : 0) - (a.is_primary ? 1 : 0));
  const sizes = u.sizes.filter((s) => s.label !== "Area");
  const label: [string, Tone] = i === 0 && isStrong(list) ? ["Strong match", "good"] : r.score >= 40 ? ["Likely", "warn"] : ["Possible", "neutral"];
  return (
    <div className={cx("rounded-2xl border p-4", i === 0 ? "border-accent shadow-[0_0_0_3px_var(--accent-soft)]" : "border-line")}>
      <div className="flex items-center gap-2.5 flex-wrap">
        <span className="text-[20px] font-semibold text-ink num">Unit {u.unit}</span>
        <span className="text-[13px] text-ink-2">{u.cluster} · {u.community}</span>
        <Badge tone={label[1]}>{label[0]}</Badge>
        <span className="sm:ml-auto text-xs text-ink-3 num">score {Math.round(r.score)}</span>
      </div>
      <ul className="mt-2.5 mb-2 pl-4 list-disc text-[13px] leading-relaxed text-ink">{r.reasons.map((x) => <li key={x}>{x}</li>)}</ul>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-[12.5px] text-ink-2">
        {u.bedrooms && <span>Beds <b className="font-semibold text-ink">{u.bedrooms}</b></span>}
        {sizes.length > 0 && <span>{sizes.map((s, n) => <span key={s.label + s.v}>{n > 0 && " · "}{s.label} <b className="font-semibold text-ink num">{fmt(Math.round(s.v))}</b></span>)}</span>}
        {u.layout && <span>Layout <b className="font-semibold text-ink">{u.layout}</b></span>}
        {last && <span>Last sale <b className="font-semibold text-ink num">{money(last.amount)}</b> on {last.transaction_date}</span>}
        {owners.length ? <span>Owner <b className="font-semibold text-ink">{owners[0].owner || "-"}</b>{owners[0].status && owners[0].status !== "-" ? ` (${owners[0].status})` : ""}{owners.length > 1 ? ` +${owners.length - 1} more` : ""}</span> : <span>No owner in CRM</span>}
      </div>
      <button className={buttonClass("secondary", "sm", "mt-3")} onClick={onUse}>Use unit {u.unit}</button>
    </div>
  );
}

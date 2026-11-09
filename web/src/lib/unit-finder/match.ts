// Matches a listing against the CRM's own units. Same scoring as the old unit-finder.html.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { db } from "@/lib/supabase";
import { fetchAll } from "@/lib/tools";

export type Listing = Record<string, any>;
export type Unit = { community: string; cluster: string; unit: string; key: string; sizes: { v: number; label: string }[]; sales: any[]; owners: any[]; bedrooms: any; layout: string | null; obs: any };
export type Candidate = { u: Unit; score: number; reasons: string[]; strong: boolean; evidence: boolean; used?: Set<unknown> };
type Cat = { community: string; cluster: string; aliases: string[] };
type ClusterRef = { community: string; cluster: string };

export const fmt = (n: number | string) => Number(n).toLocaleString("en-US");
export const money = (n: number | null | undefined) => (n ? `AED ${fmt(n)}` : "-");

const norm = (s: unknown) => " " + String(s || "").toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, " ").replace(/\biv\b/g, "4").replace(/\biii\b/g, "3").replace(/\bii\b/g, "2").replace(/\bi\b/g, "1").replace(/\s+/g, " ").trim() + " ";
const reEsc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const unitKey = (u: unknown) => { const m = String(u || "").match(/(\d+)\D*$/); return m ? String(Number(m[1])) : String(u || "").trim().toLowerCase(); };

function aliasesFor(name: string) {
  const out = new Set<string>();
  const raw = String(name || "");
  const paren = raw.match(/\(([^)]+)\)/);
  if (paren) out.add(norm(paren[1]).trim());
  let a = norm(raw.replace(/\([^)]*\)/g, " "));
  a = a.replace(/ arabian ranches /g, " ").replace(/^ ar 2 /, " ").replace(/ community /g, " ").replace(/ by emaar /g, " ").replace(/\s+/g, " ").trim();
  if (a) out.add(a);
  return [...out].filter((x) => x.length >= 3);
}
function splitNum(alias: string) { const m = alias.match(/^(.*?)(?: (\d{1,2}))?$/)!; return { base: m[1], num: m[2] || "1" }; }

// position (1-based) where alias, with its number (default 1), appears in normalised text t; 0 if absent
function hasName(t: string, alias: string): 0 | { pos: number; explicit: boolean } {
  const { base, num } = splitNum(alias);
  const re = new RegExp(" " + reEsc(base) + "(?= )(?: (\\d{1,2})(?= )(?! (?:bed|beds|bedroom|bedrooms|br|bhk|bath|baths|bathroom|bathrooms|sq|sqft|sqm|m|years?|mins?|minutes|floors?|x) ))?", "g");
  let m: RegExpExecArray | null, found = 0;
  while ((m = re.exec(t))) { if ((m[1] || "1") === num) { if (m[1]) return { pos: m.index + 1, explicit: true }; found = found || m.index + 1; } }
  return found ? { pos: found, explicit: false } : 0;
}

let catalog: Cat[] | null = null;
async function loadCatalog() {
  if (catalog) return catalog;
  // clean names from the catalog plus the exact names the owner/unit data uses
  const [a, b] = await Promise.all([db.from("community_cluster_catalog").select("community,cluster"), db.rpc("crm_filter_options")]);
  if (a.error && b.error) throw new Error(a.error.message);
  const seen = new Set<string>(), list: Cat[] = [];
  for (const r of [...(b.data || []), ...(a.data || [])] as ClusterRef[]) {
    if (!r.community || !r.cluster) continue;
    const k = r.community + "|" + r.cluster;
    if (seen.has(k)) continue;
    seen.add(k);
    list.push({ community: r.community, cluster: r.cluster, aliases: aliasesFor(r.cluster) });
  }
  catalog = list;
  return list;
}

type Where = { how: "cluster" | "text" | "community" | "none"; community?: string; clusters: ClusterRef[] };
function resolveClusters(d: Listing, cat: Cat[]): Where {
  const sources = [
    { w: 3, t: norm((d.locationNames || []).join(" , ") + " , " + (d.locationText || "")) },
    { w: 2.5, t: norm(d.urlWords) },
    { w: 2, t: norm([d.title, d.project].join(" , ")) },
    { w: 1, t: norm(d.searchText) },
  ];
  const commHit: Record<string, number> = {};
  for (const c of new Set(cat.map((x) => x.community))) {
    const aliases = [...new Set([...aliasesFor(c), norm(c).trim()])];
    for (const s of sources) { if (aliases.some((a) => hasName(s.t, a))) commHit[c] = Math.max(commHit[c] || 0, s.w); }
  }
  type Hit = Cat & { sc: number; w: number; alias: string; pos: number; explicit: boolean; base: string };
  const hits: Hit[] = [];
  for (const row of cat) {
    let best: Omit<Hit, keyof Cat> | null = null;
    for (const s of sources) {
      for (const a of row.aliases) {
        const h = hasName(s.t, a);
        if (!h) continue;
        if (s.w < 2 && !commHit[row.community]) continue; // description-only mentions need the community too
        const sc = s.w * 100 + a.length + (h.explicit ? 5 : 0);
        if (!best || sc > best.sc) best = { sc, w: s.w, alias: a, pos: h.pos, explicit: h.explicit, base: splitNum(a).base };
      }
    }
    if (best) hits.push({ ...row, ...best });
  }
  // drop a shorter alias when a longer one in the same text covers it ("reem" inside "al reem")
  // and drop "Farm Grove" (no number) when the same text says "Farm Grove 2"
  const kept = hits.filter((h) => !hits.some((o) => o !== h && o.w >= h.w && ((o.alias.length > h.alias.length && (" " + o.alias + " ").includes(" " + h.alias + " ") && !(o.base === h.base && splitNum(o.alias).num === splitNum(h.alias).num)) || (!h.explicit && o.explicit && o.base === h.base && o.cluster !== h.cluster && splitNum(o.alias).num !== "1"))));
  kept.sort((a, b) => b.sc - a.sc);
  if (kept.length) {
    const topW = kept[0].w;
    let list = kept.filter((h) => h.w === topW);
    if (topW < 2) list = list.sort((a, b) => a.pos - b.pos);
    return { how: topW >= 2 ? "cluster" : "text", clusters: list.slice(0, 6).map((h) => ({ community: h.community, cluster: h.cluster })) };
  }
  const comms = Object.keys(commHit).filter((c) => commHit[c] >= 2);
  if (comms.length === 1) return { how: "community", community: comms[0], clusters: cat.filter((r) => r.community === comms[0]).map((r) => ({ community: r.community, cluster: r.cluster })) };
  return { how: "none", clusters: [] };
}

async function loadUnits(clusters: ClusterRef[]) {
  let names = clusters.map((c) => c.cluster);
  const pt = await fetchAll<any>(() => { const q = db.from("property_transactions").select("id,community,cluster,unit,transaction_date,amount,area_sqft,area_type,bua_sqft,bedrooms").order("id"); return names.length ? q.in("cluster", names) : q; });
  const ud = await fetchAll<any>(() => { const q = db.from("unit_details").select("community,cluster,unit,property_type,bedrooms,bua_sqft,plot_sqft,suite_sqft,layout").order("cluster").order("unit"); return names.length ? q.in("cluster", names) : q; });
  if (!names.length) names = [...new Set([...pt, ...ud].map((r) => r.cluster as string))];
  const ow = names.length ? await fetchAll<any>(() => db.from("owners").select("id,community,cluster,unit,owner,status,is_primary").in("cluster", names).order("id")) : [];
  let obs: any[] = [];
  try { obs = names.length ? await fetchAll<any>(() => db.from("unit_current_status").select("community,cluster,unit,status,observed_on").in("cluster", names).order("unit")) : []; } catch {}
  const units = new Map<string, Unit>();
  const get = (community: string, cluster: string, unit: unknown) => {
    const k = cluster + "|" + unitKey(unit);
    if (!units.has(k)) units.set(k, { community, cluster, unit: String(unit).trim(), key: unitKey(unit), sizes: [], sales: [], owners: [], bedrooms: null, layout: null, obs: null });
    return units.get(k)!;
  };
  for (const r of ud) {
    const u = get(r.community, r.cluster, r.unit);
    u.bedrooms = u.bedrooms || r.bedrooms; u.layout = r.layout;
    if (r.bua_sqft) u.sizes.push({ v: +r.bua_sqft, label: "BUA" });
    if (r.plot_sqft) u.sizes.push({ v: +r.plot_sqft, label: "Plot" });
    if (r.suite_sqft) u.sizes.push({ v: +r.suite_sqft, label: "Suite" });
  }
  for (const r of pt) {
    const u = get(r.community, r.cluster, r.unit);
    u.sales.push(r); u.bedrooms = u.bedrooms || r.bedrooms;
    if (r.area_sqft) u.sizes.push({ v: +r.area_sqft, label: r.area_type === "plot" ? "Plot" : "Area" });
    if (r.bua_sqft) u.sizes.push({ v: +r.bua_sqft, label: "BUA" });
  }
  for (const r of ow) { const k = r.cluster + "|" + unitKey(r.unit); (units.get(k) || get(r.community, r.cluster, r.unit)).owners.push(r); }
  for (const r of obs) { const u = units.get(r.cluster + "|" + unitKey(r.unit)); if (u) u.obs = r; }
  for (const u of units.values()) {
    const seen = new Set<number>();
    u.sizes = u.sizes.filter((s) => { const k = Math.round(s.v); if (seen.has(k)) return false; seen.add(k); return true; });
    u.sales.sort((a, b) => String(b.transaction_date).localeCompare(String(a.transaction_date)));
  }
  return { units: [...units.values()], names };
}

function scoreUnits(d: Listing, units: Unit[], primaryCluster: string | null) {
  const sizes: { sqft: number }[] = (d.sizes || []).slice(0, 8);
  const beds = d.bedrooms != null && d.bedrooms !== "" ? String(d.bedrooms) : null;
  const hints = new Set<string>(d.unitHints || []);
  const text = norm([d.title, d.description, d.searchText].join(" "));
  const res: Candidate[] = units.map((u) => ({ u, score: 0, reasons: [], strong: false, evidence: false }));
  type Size = Unit["sizes"][number];
  sizes.forEach((s, i) => {
    const w = i < 3 ? 1 : 0.4;
    const exact: [Candidate, Size][] = [], close: [Candidate, Size][] = [];
    for (const r of res) {
      let best: { kind: string; x: Size } | null = null;
      for (const x of r.u.sizes) {
        const diff = Math.abs(Math.round(x.v) - s.sqft);
        if (diff === 0) { best = { kind: "exact", x }; break; }
        if (!best && diff <= Math.max(3, s.sqft * 0.004)) best = { kind: "close", x };
      }
      if (best && (r.used || (r.used = new Set())).has(best.x)) best = null; // one unit size counts once
      if (best?.kind === "exact") exact.push([r, best.x]); else if (best) close.push([r, best.x]);
    }
    for (const [r, x] of [...exact, ...close]) r.used!.add(x);
    for (const [r, x] of exact) {
      const k = exact.length;
      r.score += w * (30 + 40 / k); r.evidence = true;
      if (k <= 3) r.strong = true;
      r.reasons.push(`${x.label} ${fmt(Math.round(x.v))} sqft matches the listing's ${fmt(s.sqft)} sqft exactly${k === 1 ? " (no other unit has this size)" : ` (${k} units share this size)`}`);
    }
    for (const [r, x] of close) {
      const k = close.length;
      r.score += w * (8 + 20 / k); r.evidence = true;
      r.reasons.push(`${x.label} ${fmt(Math.round(x.v))} sqft is within a few sqft of the listing's ${fmt(s.sqft)}${k > 1 ? ` (${k} units this close)` : ""}`);
    }
  });
  for (const r of res) {
    const u = r.u;
    const ub = u.bedrooms ? String(u.bedrooms).replace(/\D/g, "") : null;
    if (hints.has(u.key)) { r.score += 80; r.strong = true; r.evidence = true; r.reasons.unshift(`The listing text mentions unit/villa ${u.key}`); }
    if (!r.evidence) continue;
    if (beds && ub) { if (ub === beds) { r.score += 8; r.reasons.push(`${beds} bedrooms, same as the listing`); } else { r.score -= 20; r.reasons.push(`Has ${ub} bedrooms, listing says ${beds}`); } }
    if (u.layout && !/^standard$/i.test(u.layout) && u.layout.length >= 3 && text.includes(norm(u.layout))) { r.score += 12; r.reasons.push(`Layout "${u.layout}" is named in the listing`); }
    const st = u.owners.map((o) => o.status || "");
    if (d.purpose !== "rent" && st.includes("For Sale")) { r.score += 8; r.reasons.push("Owner is marked For Sale in the CRM"); }
    if (d.purpose === "rent" && st.includes("For Rent")) { r.score += 8; r.reasons.push("Owner is marked For Rent in the CRM"); }
    if (u.obs && ((d.purpose !== "rent" && /sale/i.test(u.obs.status)) || (d.purpose === "rent" && /rent/i.test(u.obs.status)))) { r.score += 8; r.reasons.push(`Field note: ${u.obs.status} (${u.obs.observed_on})`); }
    if (primaryCluster && u.cluster === primaryCluster) r.score += 4;
  }
  return res.filter((r) => r.evidence && r.score >= 20).sort((a, b) => b.score - a.score);
}

export function isStrong(list: Candidate[]) { const t = list[0]; return !!t && t.score >= 60 && (!list[1] || t.score - list[1].score >= 20); }

export type MatchResult = { candidates: Candidate[]; total: number; note: string; empty?: string; badge?: string };

export async function matchListing(d: Listing): Promise<MatchResult> {
  const cat = await loadCatalog();
  const where = resolveClusters(d, cat);
  const { units, names } = await loadUnits(where.clusters);
  const sized = new Set(units.filter((u) => u.sizes.length).map((u) => u.cluster));
  const primary = where.clusters.length === 1 ? where.clusters[0].cluster : null;
  const all = scoreUnits(d, units, primary);
  const notes: string[] = [];
  const withData = new Set(units.map((u) => u.cluster));
  const shown = where.clusters.map((c) => c.cluster).filter((c) => withData.has(c));
  if (where.how === "cluster" || where.how === "text") notes.push(shown.length ? `Searched ${shown.join(", ")}.` : `${where.clusters.map((c) => c.cluster).join(", ")} has no units in the CRM yet.`);
  else if (where.how === "community") notes.push(`The cluster wasn't clear, so all of ${where.community} was searched.`);
  else notes.push(`The location wasn't recognised, so every cluster with unit sizes in the CRM was searched (${names.length}).`);
  const unsized = shown.filter((c) => !sized.has(c));
  if (unsized.length && where.how !== "community") notes.push(`No unit sizes in the CRM yet for ${unsized.join(", ")}, so units there can only be found when the listing names the unit number.`);
  return { candidates: all.slice(0, 5), total: all.length, note: notes.join(" ") };
}

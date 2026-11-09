"use client";

/* eslint-disable @typescript-eslint/no-explicit-any */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Plus, RefreshCw, X, Map as MapIcon, Loader2 } from "lucide-react";
import { db } from "@/lib/supabase";
import { edge, natural as byName } from "@/lib/tools";
import { useConfirm } from "@/components/Confirm";
import { Badge, Button, Card, Empty, Field, Input, PageHeader, Select, Sheet, Skeleton, Textarea, Toast, cx } from "@/components/ui";

const API = "cluster-guide-api";
const fmt = (n: unknown) => Number(n || 0).toLocaleString("en-US");
const range = (a: any, b: any) => (a && b ? (a === b ? `${fmt(a)}` : `${fmt(a)} – ${fmt(b)}`) : a || b ? fmt(a || b) : "");
const aed = (n: any) => (n ? "AED " + fmt(Math.round(n)) : "");
const short = (n: any) => (!n ? "" : n >= 1e6 ? "AED " + Math.round(n / 1e4) / 100 + "M" : "AED " + Math.round(n / 1e3) + "K");
const day = (d: any) => (d ? new Date(String(d).slice(0, 10) + "T00:00:00").toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "");
const when = (d: any) => (d ? new Date(d).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "");
const sq = (a: any, b: any) => (a || b ? range(Math.round(a || b), Math.round(b || a)) + " sq ft" : "");
const pct = (now: any, then: any) => (now && then ? Math.round((now / then - 1) * 1000) / 10 : null);
const slugify = (t: unknown) => String(t || "").toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
const slugOf = (c: any) => { const n = slugify(c.name), m = slugify(c.community); return !m || n.startsWith(m) ? n : m + "-" + n; };

const Na = () => <span className="text-ink-3">—</span>;
const Sub = ({ children }: { children: React.ReactNode }) => <span className="block min-w-[110px] text-[11px] text-ink-2 mt-0.5">{children}</span>;
function Signed({ v }: { v: number | null | undefined }) {
  if (v == null) return <Na />;
  return <span className={cx("font-semibold", v >= 0 ? "text-good" : "text-bad")}>{v >= 0 ? "+" : ""}{v}%</span>;
}

// One row per bedroom type: researched launch price (else earliest recorded sales), CRM units and sizes, live market.
function bedroomRows(c: any) {
  const st = c.stats || {}, lp = c.launch_prices || [], lay = c.layouts || [];
  const keys = new Set<string>([...(st.bedrooms || []).map((x: any) => String(x.bedrooms)), ...lp.map((x: any) => String(x.bedrooms)), ...lay.map((x: any) => String(x.bedrooms)), ...(c.unit_mix || []).map((x: any) => String(x.bedrooms))].filter(Boolean));
  return [...keys].sort((a, b) => Number(a) - Number(b)).map((b) => {
    const s = (st.bedrooms || []).find((x: any) => String(x.bedrooms) === b) || {}, pub = lp.find((x: any) => String(x.bedrooms) === b);
    const ls = lay.filter((x: any) => String(x.bedrooms) === b), m = s.market;
    const devBua = ls.flatMap((x: any) => [x.bua_min_sqft || x.bua_sqft, x.bua_max_sqft || x.bua_sqft]).filter(Boolean);
    const devPlot = ls.flatMap((x: any) => [x.plot_min_sqft, x.plot_max_sqft]).filter(Boolean);
    const launch = pub ? { v: pub.aed, src: pub.source || "Published" } : s.first_sales ? { v: s.first_sales.min, src: `First recorded sales, ${day(s.first_sales.first_date)}` } : null;
    return {
      b, units: s.units || 0,
      bua: s.bua_min ? [s.bua_min, s.bua_max, "CRM"] : devBua.length ? [Math.min(...devBua), Math.max(...devBua), "Emaar plan"] : null,
      plot: s.plot_min ? [s.plot_min, s.plot_max, "CRM"] : devPlot.length ? [Math.min(...devPlot), Math.max(...devPlot), "Emaar plan"] : null,
      launch, m, trend: s.trend_pct, growth: m && launch ? pct(m.avg, launch.v) : null,
    };
  });
}
// One row per bedroom × layout: researched layouts merged with CRM-tagged units and their sales.
function layoutRows(c: any) {
  const st = c.stats || {}, rows = new Map<string, any>();
  (c.layouts || []).forEach((l: any) => { if (l.name) rows.set(`${l.bedrooms}|${l.name.toLowerCase()}`, { b: String(l.bedrooms), name: l.name, dev: l }); });
  (st.layouts || []).forEach((l: any) => { const k = `${l.bedrooms}|${String(l.layout).toLowerCase()}`; rows.set(k, { ...(rows.get(k) || { b: String(l.bedrooms), name: l.layout }), crm: l }); });
  return [...rows.values()].sort((x, y) => Number(x.b) - Number(y.b) || byName(x.name, y.name));
}

const TH = ({ children }: { children?: React.ReactNode }) => <th className="px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-[0.05em] text-ink-2 border-b border-line whitespace-nowrap">{children}</th>;
const TD = ({ children, className, colSpan }: { children?: React.ReactNode; className?: string; colSpan?: number }) => <td colSpan={colSpan} className={cx("px-3 py-2.5 border-b border-line align-top", className)}>{children}</td>;
const H2 = ({ children }: { children: React.ReactNode }) => <h2 className="mt-3 mb-2.5 text-xs font-semibold uppercase tracking-[0.08em] text-ink-2">{children}</h2>;
const Note = ({ children, pre }: { children: React.ReactNode; pre?: boolean }) => <div className={cx("rounded-xl border border-dashed border-line-strong px-3.5 py-3 text-[13px] text-ink-2", pre && "whitespace-pre-line")}>{children}</div>;

export default function ClusterGuidePage() {
  const [clusters, setClusters] = useState<any[]>([]);
  const [canEdit, setCanEdit] = useState(false);
  const [loadErr, setLoadErr] = useState("");
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [comm, setComm] = useState("");
  const [activeId, setActiveId] = useState<string | null>(null);
  const [cache, setCache] = useState<Record<string, any>>({});
  const [detailErr, setDetailErr] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [refreshNote, setRefreshNote] = useState("");
  const [editing, setEditing] = useState<any | null>(null);
  const [toast, setToast] = useState("");
  const [ownerCount, setOwnerCount] = useState<number | null | undefined>(undefined);
  const [ask, confirmNode] = useConfirm();
  const opening = useRef<string | null>(null);

  const open = useCallback(async (c: any) => {
    setActiveId(c.id); setDetailErr(""); setRefreshNote(""); opening.current = c.id;
    history.replaceState(null, "", location.pathname + "#" + slugOf(c));
    let found = false;
    setCache((m) => { found = !!m[c.id]; return m; });
    if (found) return;
    try {
      const r = await edge<{ cluster: any }>(API, "getCluster", { id: c.id });
      setCache((m) => ({ ...m, [c.id]: r.cluster }));
    } catch (e) { if (opening.current === c.id) setDetailErr((e as Error).message); }
  }, []);

  const load = useCallback(async () => {
    try {
      const r = await edge<{ clusters: any[]; canEdit: boolean }>(API, "listClusters");
      setClusters(r.clusters || []); setCanEdit(!!r.canEdit); setLoadErr("");
      return r.clusters || [];
    } catch (e) { setLoadErr((e as Error).message); return []; }
    finally { setLoading(false); }
  }, []);

  useEffect(() => {
    load().then((list) => {
      const h = decodeURIComponent(location.hash.slice(1));
      const hit = list.find((c) => c.id === h || slugOf(c) === h);
      if (hit) open(hit);
      else if (list[0]) open([...list].sort((a, b) => byName(a.community, b.community) || byName(a.name, b.name))[0]);
    });
  }, [load, open]);

  const active = activeId ? cache[activeId] : null;
  useEffect(() => {
    if (!active) return;
    setOwnerCount(undefined);
    db.from("owners").select("id", { count: "exact", head: true }).eq("community", active.community).eq("cluster", active.name).then(({ count }) => setOwnerCount(count));
  }, [active]);

  const communities = useMemo(() => [...new Set(clusters.map((c) => c.community))].sort(byName), [clusters]);
  const groups = useMemo(() => {
    const t = q.trim().toLowerCase();
    const rows = clusters.filter((c) => (!comm || c.community === comm) && (!t || `${c.name} ${c.community} ${c.developer || ""}`.toLowerCase().includes(t)));
    const g: Record<string, any[]> = {};
    rows.forEach((c) => (g[c.community] = g[c.community] || []).push(c));
    return Object.keys(g).sort(byName).map((k) => [k, g[k].sort((a, b) => byName(a.name, b.name))] as const);
  }, [clusters, q, comm]);

  async function refresh(c: any) {
    setRefreshing(true); setRefreshNote("");
    try {
      const r = await edge<any>(API, "refreshCluster", { id: c.id });
      setCache((m) => ({ ...m, [c.id]: r.cluster }));
      setRefreshNote(r.dld?.skipped ? "DLD was already fetched in the last hour" : r.dld?.error ? "DLD fetch failed: " + r.dld.error : r.dld?.mapped != null ? `${fmt(r.dld.mapped)} new DLD sales checked` : "");
    } catch (e) { setToast((e as Error).message); }
    setRefreshing(false);
  }
  async function remove(c: any) {
    if (!(await ask({ title: `Delete ${c.name}?`, hint: "This removes the guide for this cluster.", yes: "Delete", danger: true }))) return;
    try {
      await edge(API, "deleteCluster", { id: c.id });
      setCache((m) => { const n = { ...m }; delete n[c.id]; return n; });
      setActiveId(null); await load(); setToast("Deleted");
    } catch (e) { setToast((e as Error).message); }
  }

  return (
    <div className="animate-in">
      <PageHeader title="Cluster Guide" subtitle="Verified details for each project." actions={canEdit && <Button variant="primary" onClick={() => setEditing({})}><Plus size={16} /> Add cluster</Button>} />
      <div className="grid gap-4 lg:grid-cols-[300px_minmax(0,1fr)] items-start">
        <Card className="lg:sticky lg:top-20 flex flex-col overflow-hidden lg:max-h-[calc(100dvh-140px)]">
          <div className="p-3 border-b border-line grid gap-2">
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search project or community" autoComplete="off" />
            <Select value={comm} onChange={(e) => setComm(e.target.value)}>
              <option value="">All communities</option>
              {communities.map((c) => <option key={c}>{c}</option>)}
            </Select>
          </div>
          <div className="overflow-y-auto p-2 max-h-[40vh] lg:max-h-none">
            {loading ? <div className="space-y-3 p-2"><Skeleton /><Skeleton className="w-2/3" /><Skeleton /></div>
             : loadErr ? <div className="p-3 text-sm text-bad">{loadErr}</div>
             : groups.length === 0 ? <div className="p-6 text-center text-sm text-ink-3">No matching projects.</div>
             : groups.map(([g, list]) => (
              <div key={g}>
                <div className="mt-2 mb-1 px-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-3">{g}</div>
                {list.map((c) => (
                  <button key={c.id} onClick={() => open(c)} className={cx("w-full flex items-center justify-between gap-2 rounded-xl px-2.5 py-2 text-left text-sm transition-colors", c.id === activeId ? "bg-accent-soft text-ink" : "hover:bg-surface-2 text-ink")}>
                    <span className="font-medium">{c.name}</span>
                    <span className="text-xs text-ink-2 whitespace-nowrap">{c.bedrooms?.length ? `${c.bedrooms.join(", ")} BR` : ""}</span>
                  </button>
                ))}
              </div>
            ))}
          </div>
        </Card>

        <Card className="min-h-[60vh] min-w-0 overflow-hidden">
          {detailErr ? <div className="m-4 rounded-xl bg-bad-soft p-3 text-sm text-bad">{detailErr}</div>
           : !activeId ? <Empty icon={<MapIcon size={28} />} title="Choose a project" hint="Select a cluster to see its verified details." />
           : !active ? <div className="p-7 space-y-3"><Skeleton className="w-2/5 h-7" /><Skeleton /><Skeleton className="w-2/3" /></div>
           : <Detail c={active} canEdit={canEdit} refreshing={refreshing} refreshNote={refreshNote} ownerCount={ownerCount} onRefresh={() => refresh(active)} onEdit={() => setEditing(active)} onDelete={() => remove(active)} />}
        </Card>
      </div>

      <Editor cluster={editing} onClose={() => setEditing(null)} onError={setToast} onSaved={async (saved) => {
        setEditing(null);
        setCache((m) => { const n = { ...m }; delete n[saved.id]; return n; });
        await load(); open(saved);
      }} />
      {toast && <Toast message={toast} onClose={() => setToast("")} />}
      {confirmNode}
    </div>
  );
}

function Detail({ c, canEdit, refreshing, refreshNote, ownerCount, onRefresh, onEdit, onDelete }: { c: any; canEdit: boolean; refreshing: boolean; refreshNote: string; ownerCount: number | null | undefined; onRefresh: () => void; onEdit: () => void; onDelete: () => void }) {
  const st = c.stats || {}, lay = c.layouts || [], beds = bedroomRows(c), lrows = layoutRows(c);
  const layoutNames = [...new Set<string>(lay.map((l: any) => l.name).filter(Boolean))];
  const tot = beds.reduce((a, r) => a + r.units, 0);
  const lowCover = c.total_units && st.units_total && st.units_total < c.total_units * 0.8;
  const meta = [st.computed_at && `Figures worked out ${when(st.computed_at)}`, st.dld_last_fetch && `DLD sales fetched ${when(st.dld_last_fetch)}`, c.research_checked_on && `Launch facts checked ${day(c.research_checked_on)}`, refreshNote].filter(Boolean).join(" · ");
  const Fact = ({ label, value, sub }: { label: string; value?: React.ReactNode; sub?: React.ReactNode }) => (
    <div className="rounded-2xl border border-line bg-bg px-4 py-3 min-w-0">
      <div className="text-xs font-medium text-ink-2">{label}</div>
      {value ? <div className="mt-1 text-lg font-semibold text-ink num">{value}</div> : <div className="mt-1 text-sm text-ink-3">Not published</div>}
      {sub && <div className="mt-0.5 text-[11px] text-ink-2">{sub}</div>}
    </div>
  );
  return (
    <div>
      <div className="p-5 sm:p-7 border-b border-line">
        <div className="text-[13px] text-ink-2">{c.community}{c.developer ? ` · ${c.developer}` : ""}</div>
        <h2 className="mt-1 text-[26px] font-semibold tracking-tight text-ink">{c.name}</h2>
        <div className="flex flex-wrap gap-1.5 mt-2.5">
          {c.development_type && <Badge>{c.development_type}</Badge>}
          {beds.length > 0 && <Badge>{beds.map((r) => r.b).join(", ")} bedrooms</Badge>}
          {c.usp && <Badge>{c.usp}</Badge>}
        </div>
        <div className="flex flex-wrap gap-2 mt-4">
          <Button size="sm" variant="primary" onClick={onRefresh} disabled={refreshing}>{refreshing ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}{refreshing ? "Updating… (up to a minute)" : "Update info"}</Button>
          {canEdit && <><Button size="sm" onClick={onEdit}>Edit</Button><Button size="sm" variant="ghost" className="text-bad" onClick={onDelete}>Delete</Button></>}
        </div>
        {meta && <div className="mt-2.5 text-xs text-ink-3">{meta}</div>}
      </div>

      <div className="grid grid-cols-2 xl:grid-cols-3 gap-3 p-5 sm:px-7">
        <Fact label="Launched" value={c.launch_date} />
        <Fact label="Handover" value={c.handover_date} />
        <Fact label="Units in your CRM" value={st.units_total ? fmt(st.units_total) : ""} sub={c.total_units ? `Emaar total: ${fmt(c.total_units)}` : ""} />
        <Fact label="Layout types" value={layoutNames.length ? String(layoutNames.length) : ""} sub={layoutNames.join(", ")} />
        <Fact label="Bedroom types" value={beds.map((r) => r.b).join(", ")} />
        <Fact label="Owner records in your CRM" value={ownerCount === undefined ? "…" : ownerCount == null ? "—" : fmt(ownerCount)} />
      </div>
      {lowCover && <div className="px-5 sm:px-7"><div className="rounded-xl bg-warn-soft px-3.5 py-2.5 text-[13px] text-warn">Your CRM has {fmt(st.units_total)} of {fmt(c.total_units)} units here, so unit counts below may be low.</div></div>}

      <div className="px-5 sm:px-7 pb-5 pt-2">
        <H2>By bedroom type</H2>
        {beds.length ? (
          <div className="overflow-x-auto rounded-2xl border border-line">
            <table className="w-full text-[13px] num">
              <thead><tr>{["Type", "Units", "BUA", "Plot", "Launch price", "Current avg price", "Since launch", "Last 6 months"].map((h) => <TH key={h}>{h}</TH>)}</tr></thead>
              <tbody>
                {beds.map((r) => (
                  <tr key={r.b}>
                    <TD className="whitespace-nowrap"><b className="font-semibold">{r.b} BR</b></TD>
                    <TD>{r.units ? fmt(r.units) : <Na />}</TD>
                    <TD>{r.bua ? <>{sq(r.bua[0], r.bua[1])}<Sub>{r.bua[2]}</Sub></> : <Na />}</TD>
                    <TD>{r.plot ? <>{sq(r.plot[0], r.plot[1])}<Sub>{r.plot[2]}</Sub></> : <Na />}</TD>
                    <TD>{r.launch ? <><b className="font-semibold">{aed(r.launch.v)}</b><Sub>{r.launch.src}</Sub></> : <Na />}</TD>
                    <TD>{r.m ? <><b className="font-semibold">{aed(r.m.avg)}</b><Sub>{short(r.m.min)} – {short(r.m.max)}{r.m.psf ? ` · AED ${fmt(r.m.psf)}/sq ft` : ""}</Sub><Sub>{r.m.sales} sale{r.m.sales > 1 ? "s" : ""}, last {r.m.months} months · latest {day(r.m.last_date)}</Sub></> : <span className="text-ink-3">No sales in 12 months</span>}</TD>
                    <TD><Signed v={r.growth} /></TD>
                    <TD><Signed v={r.trend} /></TD>
                  </tr>
                ))}
                <tr className="bg-surface-2 font-semibold"><TD className="border-0">Total</TD><TD className="border-0">{fmt(tot)}{st.units_without_bedrooms ? <Sub>+{fmt(st.units_without_bedrooms)} without bedrooms</Sub> : null}</TD><TD colSpan={6} className="border-0" /></tr>
              </tbody>
            </table>
          </div>
        ) : <Note>No bedroom data yet.</Note>}

        <H2>By layout{layoutNames.length ? ` · ${layoutNames.length} layout type${layoutNames.length > 1 ? "s" : ""}` : ""}</H2>
        {lrows.length ? (
          <>
            <div className="overflow-x-auto rounded-2xl border border-line">
              <table className="w-full text-[13px] num">
                <thead><tr>{["Type", "Layout", "Units", "BUA", "Plot", "Launch price", "Current avg price"].map((h) => <TH key={h}>{h}</TH>)}</tr></thead>
                <tbody>
                  {lrows.map((r) => {
                    const dv = r.dev || {}, cr = r.crm || {};
                    const devBua = dv.bua_sqft || dv.bua_min_sqft ? sq(dv.bua_min_sqft || dv.bua_sqft, dv.bua_max_sqft || dv.bua_sqft) : "";
                    const launch = dv.launch_price_aed || cr.first_min;
                    return (
                      <tr key={r.b + r.name}>
                        <TD className="whitespace-nowrap"><b className="font-semibold">{r.b} BR</b></TD>
                        <TD>{r.name}{dv.note && <Sub>{dv.note}</Sub>}</TD>
                        <TD>{cr.units ? <>{fmt(cr.units)} <Badge className="ml-1">estimated</Badge></> : dv.units ? <>{fmt(dv.units)}<Sub>Emaar</Sub></> : <Na />}</TD>
                        <TD>{cr.bua_min ? <>{sq(cr.bua_min, cr.bua_max)}<Sub>CRM{devBua ? ` · Emaar plan ${devBua}` : ""}</Sub></> : devBua ? <>{devBua}<Sub>Emaar plan</Sub></> : <Na />}</TD>
                        <TD>{cr.plot_min ? <>{sq(cr.plot_min, cr.plot_max)}<Sub>CRM</Sub></> : dv.plot_min_sqft ? <>{sq(dv.plot_min_sqft, dv.plot_max_sqft)}<Sub>Emaar plan</Sub></> : <Na />}</TD>
                        <TD>{launch ? <><b className="font-semibold">{aed(launch)}</b><Sub>{dv.launch_price_aed ? "Published" : "First recorded sales"}</Sub></> : <Na />}</TD>
                        <TD>{cr.market_avg ? <><b className="font-semibold">{aed(cr.market_avg)}</b><Sub>{cr.market_sales} sale{cr.market_sales > 1 ? "s" : ""}, last 12 months</Sub></> : <Na />}</TD>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {st.units_without_layout ? <div className="mt-2.5 text-xs text-ink-3">{fmt(st.units_without_layout)} unit{st.units_without_layout > 1 ? "s" : ""} not matched to a layout yet (no BUA in your CRM, or layouts share the same size).</div> : null}
          </>
        ) : <Note>No layouts recorded yet.</Note>}

        {c.payment_plan && <><H2>Payment plan</H2><Note pre>{c.payment_plan}</Note></>}
        {c.original_price_note && <><H2>Price note</H2><Note>{c.original_price_note}</Note></>}
        <H2>Sources</H2>
        {(c.sources || []).length ? (
          <ul className="grid gap-2">
            {c.sources.map((s: any) => (
              <li key={s.url} className="rounded-2xl border border-line bg-bg px-3.5 py-3">
                <a href={s.url} target="_blank" rel="noopener noreferrer" className="font-semibold text-accent-text hover:underline">{s.label}</a>
                <span className="block text-xs text-ink-2 mt-0.5">{(s.fields || []).join(", ")}{s.checked ? ` · checked ${s.checked}` : ""}</span>
              </li>
            ))}
          </ul>
        ) : <Note>No sources recorded.</Note>}
        {c.open_questions && <div className="mt-2.5"><Note>{c.open_questions}</Note></div>}
      </div>
    </div>
  );
}

type Row = Record<string, any>;
const FIELDS: [string, string, string?, string?][] = [
  ["name", "Cluster"], ["community", "Community"], ["developer", "Developer"], ["development_type", "Property type"],
  ["launch_date", "Launched (shown)", "text", "Jan 2025"], ["launch_on", "Launch date (for first-sales price)", "date"],
  ["handover_date", "Handover"], ["total_units", "Total units (Emaar)", "number"], ["usp", "Design styles"],
];

function Editor({ cluster, onClose, onSaved, onError }: { cluster: any | null; onClose: () => void; onSaved: (c: any) => void; onError: (m: string) => void }) {
  const [form, setForm] = useState<Row>({});
  const [lay, setLay] = useState<Row[]>([]);
  const [lp, setLp] = useState<Row[]>([]);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!cluster) return;
    setForm(Object.fromEntries([...FIELDS.map((f) => f[0]), "original_price_note", "payment_plan", "open_questions"].map((k) => [k, cluster[k] ?? ""])));
    setLay((cluster.layouts?.length ? cluster.layouts : [{ bedrooms: "", name: "" }]).map((m: Row) => ({ ...m })));
    setLp((cluster.launch_prices || []).map((m: Row) => ({ ...m })));
  }, [cluster]);
  const setF = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const edit = (set: React.Dispatch<React.SetStateAction<Row[]>>, i: number, k: string, numeric?: boolean) => (e: React.ChangeEvent<HTMLInputElement>) => { const v = numeric ? Number(e.target.value || 0) : e.target.value; set((l) => l.map((m, n) => (n === i ? { ...m, [k]: v } : m))); };
  const cell = "h-8 min-w-16 px-2 text-[13px]";
  const num = (set: React.Dispatch<React.SetStateAction<Row[]>>, m: Row, i: number, k: string) => <td className="p-1"><Input type="number" className={cell} value={m[k] || ""} onChange={edit(set, i, k, true)} /></td>;
  const txt = (set: React.Dispatch<React.SetStateAction<Row[]>>, m: Row, i: number, k: string, ph = "") => <td className="p-1"><Input className={cell} value={m[k] || ""} placeholder={ph} onChange={edit(set, i, k)} /></td>;
  const rm = (set: React.Dispatch<React.SetStateAction<Row[]>>, i: number) => <td className="p-1"><button type="button" aria-label="Remove row" onClick={() => set((l) => l.filter((_, n) => n !== i))} className="p-1.5 rounded-full text-ink-3 hover:text-ink hover:bg-surface-2"><X size={14} /></button></td>;
  const Head = ({ cols }: { cols: string[] }) => <thead><tr>{cols.map((c, i) => <th key={i} className="px-1 py-1 text-left text-[11px] uppercase tracking-[0.05em] font-medium text-ink-2 whitespace-nowrap">{c}</th>)}</tr></thead>;

  async function save() {
    if (!String(form.name || "").trim()) { onError("Enter the cluster name."); return; }
    setBusy(true);
    try {
      const r = await edge<{ cluster: any }>(API, "saveCluster", { cluster: { ...cluster, ...form, total_units: Number(form.total_units || 0), layouts: lay.filter((m) => m.bedrooms || m.name), launch_prices: lp.filter((m) => m.bedrooms && m.aed) } });
      onSaved(r.cluster);
    } catch (e) { onError((e as Error).message); }
    setBusy(false);
  }

  return (
    <Sheet open={!!cluster} onClose={onClose} wide title={cluster?.id ? `Edit ${cluster.name}` : "Add cluster"} footer={<>
      <Button variant="ghost" onClick={onClose}>Cancel</Button>
      <Button variant="primary" onClick={save} disabled={busy}>{busy && <Loader2 size={15} className="animate-spin" />}Save</Button>
    </>}>
      <div className="grid gap-4">
        <div className="grid sm:grid-cols-2 gap-3">
          {FIELDS.map(([k, label, type, ph]) => <Field key={k} label={label}><Input type={type || "text"} placeholder={ph} value={form[k] ?? ""} onChange={setF(k)} /></Field>)}
        </div>
        <Field label="Price note"><Input value={form.original_price_note ?? ""} onChange={setF("original_price_note")} /></Field>
        <Field label="Payment plan"><Textarea value={form.payment_plan ?? ""} onChange={setF("payment_plan")} /></Field>
        <div>
          <div className="mb-1.5 text-xs font-medium text-ink-2">Layouts (one row per bedroom type and layout)</div>
          <div className="overflow-x-auto"><table className="w-full">
            <Head cols={["Beds", "Layout", "BUA", "Plot min", "Plot max", "Units", "Launch AED", "Note", ""]} />
            <tbody>{lay.map((m, i) => <tr key={i}>{txt(setLay, m, i, "bedrooms", "4")}{txt(setLay, m, i, "name", "Earth")}{num(setLay, m, i, "bua_sqft")}{num(setLay, m, i, "plot_min_sqft")}{num(setLay, m, i, "plot_max_sqft")}{num(setLay, m, i, "units")}{num(setLay, m, i, "launch_price_aed")}{txt(setLay, m, i, "note")}{rm(setLay, i)}</tr>)}</tbody>
          </table></div>
          <Button size="sm" className="mt-2" onClick={() => setLay((l) => [...l, { bedrooms: "", name: "" }])}><Plus size={14} /> Add layout</Button>
        </div>
        <div>
          <div className="mb-1.5 text-xs font-medium text-ink-2">Published launch prices (leave empty to use first recorded sales)</div>
          <div className="overflow-x-auto"><table className="w-full">
            <Head cols={["Beds", "From AED", "Source", "Link", ""]} />
            <tbody>{lp.map((m, i) => <tr key={i}>{txt(setLp, m, i, "bedrooms", "4")}{num(setLp, m, i, "aed")}{txt(setLp, m, i, "source", "Emaar launch, Jan 2025")}{txt(setLp, m, i, "url", "https://")}{rm(setLp, i)}</tr>)}</tbody>
          </table></div>
          <Button size="sm" className="mt-2" onClick={() => setLp((l) => [...l, { bedrooms: "", aed: 0 }])}><Plus size={14} /> Add launch price</Button>
        </div>
        <Field label="Open questions / unverified"><Textarea value={form.open_questions ?? ""} onChange={setF("open_questions")} /></Field>
      </div>
    </Sheet>
  );
}

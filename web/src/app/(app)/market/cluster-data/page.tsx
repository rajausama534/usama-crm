"use client";

// Pick a community, then a cluster: every unit with bedrooms, sizes, last price, sale count and owners, plus the newest
// official DLD sales. DLD open data has no unit numbers, so those sales are listed separately, never matched to a unit.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, ChevronUp, Loader2, RefreshCw, BarChart3 } from "lucide-react";
import { db } from "@/lib/supabase";
import { fetchAll, natural } from "@/lib/tools";
import { useAuth } from "@/components/Providers";
import { Badge, Button, Card, Empty, Input, ListSkeleton, PageHeader, Select, Sheet, Skeleton, Toast, cx } from "@/components/ui";
import { count, shortAED } from "@/lib/format";

const LAST_KEY = "crm_cluster_data_last";
const DXB_ORIGIN = "https://dxbinteract.com";
const num = (v: any) => (v ? Math.round(v).toLocaleString("en-US") : "");
const day = (d: any) => (d ? new Date(d + "T00:00:00").toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "");

type Opt = { community: string | null; cluster: string | null };
type UnitRow = { unit: string; owners: any[]; sales: any[]; type?: string; beds?: string; bua?: number; plot?: number; last?: any; lastPrice: number; lastDate: string; salesCount: number; statuses: Record<string, number> };
type SortKey = "unit" | "beds" | "bua" | "plot" | "lastPrice" | "lastDate" | "salesCount" | "owners" | "status";

async function loadUnits(community: string, cluster: string): Promise<UnitRow[]> {
  const [owners, details, tx] = await Promise.all([
    fetchAll<any>(() => db.from("owners").select("id,unit,owner,status").eq("community", community).eq("cluster", cluster).order("id")),
    fetchAll<any>(() => db.from("unit_details").select("unit,property_type,bedrooms,bua_sqft,plot_sqft").eq("community", community).eq("cluster", cluster)),
    fetchAll<any>(() => db.from("property_transactions").select("unit,transaction_date,amount,kind,sold_by,source").eq("community", community).eq("cluster", cluster)),
  ]);
  const byUnit = new Map<string, any>();
  const get = (u: unknown) => { const k = String(u ?? "").trim(); if (!byUnit.has(k)) byUnit.set(k, { unit: k, owners: [], sales: [] }); return byUnit.get(k); };
  owners.forEach((o) => get(o.unit).owners.push(o));
  details.forEach((d) => Object.assign(get(d.unit), { type: d.property_type, beds: (String(d.bedrooms || "").match(/\d+/) || [""])[0], bua: d.bua_sqft, plot: d.plot_sqft }));
  tx.filter((t) => t.kind === "Sold").forEach((t) => get(t.unit).sales.push(t));
  return [...byUnit.values()].filter((u) => u.unit).map((u) => {
    // Last price = newest sale by date from any source (same rule as the Owners table).
    const last = u.sales.slice().sort((a: any, b: any) => b.transaction_date.localeCompare(a.transaction_date) || (Number(/^DXB/i.test(b.source || "")) - Number(/^DXB/i.test(a.source || ""))))[0];
    const statuses: Record<string, number> = {};
    u.owners.forEach((o: any) => { statuses[o.status || "-"] = (statuses[o.status || "-"] || 0) + 1; });
    return { ...u, last, lastPrice: last?.amount || 0, lastDate: last?.transaction_date || "", salesCount: u.sales.length, statuses };
  });
}

export default function ClusterDataPage() {
  const { me } = useAuth();
  const [community, setCommunity] = useState("");
  const [cluster, setCluster] = useState("");
  const [restored, setRestored] = useState(false);
  const options = useQuery({ queryKey: ["cluster-data-options"], staleTime: 30 * 60_000, queryFn: async () => {
    const { data, error } = await db.rpc("crm_filter_options");
    if (error) throw new Error(error.message);
    return ((data || []) as Opt[]).filter((r) => r.community && r.cluster);
  } });
  const comms = useMemo(() => [...new Set((options.data || []).map((r) => r.community as string))].sort(natural), [options.data]);
  const clusters = useMemo(() => [...new Set((options.data || []).filter((r) => r.community === community).map((r) => r.cluster as string))].sort(natural), [options.data, community]);

  useEffect(() => {
    if (restored || !options.data) return;
    setRestored(true);
    try {
      const [c, k] = JSON.parse(localStorage.getItem(LAST_KEY) || "[]");
      if (c && comms.includes(c)) { setCommunity(c); if ((options.data || []).some((r) => r.community === c && r.cluster === k)) setCluster(k); }
    } catch {}
  }, [options.data, comms, restored]);

  return (
    <div className="animate-in">
      <PageHeader title="Cluster Data" subtitle="Choose a community, then a cluster." actions={
        <div className="flex flex-wrap gap-2">
          <Select className="w-auto min-w-44" aria-label="Community" value={community} onChange={(e) => { setCommunity(e.target.value); setCluster(""); }}>
            <option value="">Community…</option>{comms.map((c) => <option key={c}>{c}</option>)}
          </Select>
          <Select className="w-auto min-w-44" aria-label="Cluster" disabled={!clusters.length} value={cluster} onChange={(e) => { setCluster(e.target.value); if (e.target.value) { try { localStorage.setItem(LAST_KEY, JSON.stringify([community, e.target.value])); } catch {} } }}>
            <option value="">Cluster…</option>{clusters.map((c) => <option key={c}>{c}</option>)}
          </Select>
        </div>
      } />
      {options.error ? <Card><Empty title="Couldn’t load the list" hint={(options.error as Error).message} /></Card>
       : !cluster ? <Card><Empty icon={<BarChart3 size={28} />} title={community ? "Now pick a cluster" : "Pick a community and a cluster to see every unit"} /></Card>
       : <Body key={community + cluster} community={community} cluster={cluster} isAdmin={!!me?.isAdmin} />}
    </div>
  );
}

function Body({ community, cluster, isAdmin }: { community: string; cluster: string; isAdmin: boolean }) {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "unit", dir: 1 });
  const [toast, setToast] = useState("");
  const [fetching, setFetching] = useState(false);
  const [dxbOpen, setDxbOpen] = useState(false);
  const q = useQuery({ queryKey: ["cluster-data", community, cluster], queryFn: () => loadUnits(community, cluster) });
  const dld = useQuery({ queryKey: ["cluster-dld", community, cluster], queryFn: async () => {
    const { data, error } = await db.from("dld_transactions").select("transaction_date,procedure,is_offplan,property_type,property_sub_type,rooms,amount,area_sqft,dld_project")
      .eq("crm_community", community).eq("crm_cluster", cluster).order("transaction_date", { ascending: false }).limit(200);
    if (error) throw new Error(error.message);
    const { data: run } = await db.from("dld_sync_runs").select("started_at,finished_at,error").order("started_at", { ascending: false }).limit(1).maybeSingle();
    return { rows: (data || []) as any[], run };
  } });

  const units = useMemo(() => q.data || [], [q.data]);
  const list = useMemo(() => {
    const t = search.toLowerCase().trim();
    const val = (u: UnitRow, k: SortKey): string | number => (k === "owners" ? u.owners.length : k === "status" ? Object.keys(u.statuses).sort().join(",") : (u[k] as string | number) ?? "");
    return units.filter((u) => !t || [u.unit, ...u.owners.map((o) => o.owner), ...Object.keys(u.statuses)].join(" ").toLowerCase().includes(t))
      .sort((a, b) => { const x = val(a, sort.key), y = val(b, sort.key); return sort.dir * (typeof x === "number" && typeof y === "number" ? x - y : natural(x, y)); });
  }, [units, search, sort]);

  async function fetchLatest() {
    setFetching(true);
    try {
      const { data, error } = await db.functions.invoke("dld-sync", { body: { manual: true } });
      if (error) throw error;
      if (data?.skipped) setToast("Already fetched in the last hour. Showing the newest data.");
      else if (data?.error) setToast("DLD fetch failed: " + data.error);
      else setToast(`DLD checked: ${num(data?.mapped || 0) || "no"} sales matched your clusters`);
    } catch (e) { setToast("Could not reach the DLD sync: " + ((e as Error).message || e)); }
    setFetching(false);
    dld.refetch();
  }

  if (q.isLoading) return <ListSkeleton />;
  if (q.error) return <Card><Empty title="Could not load" hint={(q.error as Error).message} /></Card>;

  const withBeds = units.filter((u) => u.beds), priced = units.filter((u) => u.lastPrice);
  const bedMix: Record<string, number> = {};
  withBeds.forEach((u) => { bedMix[u.beds + "BR"] = (bedMix[u.beds + "BR"] || 0) + 1; });
  const prices = priced.map((u) => u.lastPrice).sort((a, b) => a - b), median = prices.length ? prices[Math.floor(prices.length / 2)] : 0;
  const latest = priced.slice().sort((a, b) => b.lastDate.localeCompare(a.lastDate))[0];
  const ownerCount = units.reduce((s, u) => s + u.owners.length, 0);
  const cards = [
    { l: "Units", v: num(units.length) || "0", h: `${num(ownerCount) || 0} owner records` },
    { l: "Bedrooms", v: Object.entries(bedMix).sort((a, b) => natural(a[0], b[0])).map(([k, n]) => `${k} ${n}`).join(" · ") || "—", h: `${withBeds.length} of ${units.length} units known`, small: true },
    { l: "Median last price", v: median ? `AED ${shortAED(median)}` : "—", h: `${priced.length} units with a sale` },
    { l: "Latest sale", v: latest ? `AED ${shortAED(latest.lastPrice)}` : "—", h: latest ? `Unit ${latest.unit} · ${day(latest.lastDate)}` : "" },
  ];
  const cols: [SortKey, string, boolean][] = [["unit", "Unit", false], ["beds", "BR", true], ["bua", "BUA", true], ["plot", "Plot", true], ["lastPrice", "Last price", true], ["lastDate", "Date", false], ["salesCount", "Sales", true], ["owners", "Owners", false], ["status", "Status", false]];
  const when = dld.data?.run?.finished_at || dld.data?.run?.started_at;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {cards.map((c) => (
          <Card key={c.l} className="p-4 min-w-0">
            <div className="text-xs font-medium text-ink-2">{c.l}</div>
            <div className={cx("mt-2 text-ink num", c.small ? "text-[15px] font-medium leading-snug" : "text-2xl")}>{c.v}</div>
            {c.h && <div className="mt-1 text-xs text-ink-3">{c.h}</div>}
          </Card>
        ))}
      </div>

      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 p-4 border-b border-line">
          <h2 className="font-semibold text-ink">{cluster} <span className="font-normal text-[13px] text-ink-3">{community}</span></h2>
          <div className="flex flex-wrap gap-2">
            <Input type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search unit, owner or status…" className="w-60" />
            {isAdmin && <Button variant="primary" onClick={() => setDxbOpen(true)}>Update from DXB Interact</Button>}
          </div>
        </div>
        <div className="overflow-x-auto max-h-[70vh]">
          <table className="w-full text-[13px] num">
            <thead className="sticky top-0 bg-surface-2 z-[1]">
              <tr>{cols.map(([k, label, right]) => (
                <th key={k} className={cx("px-3 py-2.5 text-xs font-semibold text-ink-2 whitespace-nowrap", right ? "text-right" : "text-left")}>
                  <button className="inline-flex items-center gap-0.5 hover:text-ink" onClick={() => setSort((s) => ({ key: k, dir: s.key === k ? (s.dir === 1 ? -1 : 1) : k === "unit" ? 1 : -1 }))}>
                    {label}{sort.key === k && (sort.dir === 1 ? <ChevronUp size={13} /> : <ChevronDown size={13} />)}
                  </button>
                </th>
              ))}</tr>
            </thead>
            <tbody>
              {list.map((u) => (
                <tr key={u.unit} onClick={() => { if (u.owners[0]?.id) router.push(`/owners?open=${u.owners[0].id}`); }} className={cx("border-b border-line last:border-0", u.owners[0]?.id && "cursor-pointer hover:bg-surface-2/60")}>
                  <td className="px-3 py-2.5"><b className="font-semibold text-ink">{u.unit}</b>{u.type && <span className="block text-[11px] text-ink-3">{u.type}</span>}</td>
                  <td className="px-3 py-2.5 text-right text-ink-2">{u.beds || "—"}</td>
                  <td className="px-3 py-2.5 text-right text-ink-2">{num(u.bua) || "—"}</td>
                  <td className="px-3 py-2.5 text-right text-ink-2">{num(u.plot) || "—"}</td>
                  <td className="px-3 py-2.5 text-right">{u.lastPrice ? <b className="font-semibold text-ink">{shortAED(u.lastPrice)}</b> : "—"}</td>
                  <td className="px-3 py-2.5 text-ink-2 whitespace-nowrap">{u.lastDate ? <>{day(u.lastDate)}<span className="block text-[11px] text-ink-3">{u.last?.sold_by || ""}</span></> : "—"}</td>
                  <td className="px-3 py-2.5 text-right text-ink-2">{u.salesCount || "—"}</td>
                  <td className="px-3 py-2.5 text-ink" title={u.owners.map((o) => o.owner).join(", ")}>{u.owners.length ? <>{u.owners[0].owner || "—"}{u.owners.length > 1 && <span className="text-[11px] text-ink-3"> +{u.owners.length - 1} more</span>}</> : "—"}</td>
                  <td className="px-3 py-2.5"><div className="flex flex-wrap gap-1">{Object.entries(u.statuses).map(([s, n]) => <Badge key={s}>{s}{n > 1 ? ` ×${n}` : ""}</Badge>)}</div></td>
                </tr>
              ))}
              {list.length === 0 && <tr><td colSpan={9} className="p-8 text-center text-ink-3">No units match.</td></tr>}
            </tbody>
          </table>
        </div>
      </Card>

      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-start justify-between gap-3 p-4 border-b border-line">
          <div>
            <h2 className="font-semibold text-ink">Latest DLD sales</h2>
            <p className="text-[13px] text-ink-2 mt-0.5">Official Dubai Land Department data for this cluster. DLD does not publish unit numbers.</p>
            {when && <p className="text-xs text-ink-3 mt-1">Last fetched {new Date(when).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}{dld.data?.run?.error ? " · last attempt failed" : ""}</p>}
          </div>
          <Button variant="primary" onClick={fetchLatest} disabled={fetching}>{fetching ? <Loader2 size={15} className="animate-spin" /> : <RefreshCw size={15} />}{fetching ? "Fetching from DLD…" : "Fetch latest"}</Button>
        </div>
        {dld.isLoading ? <div className="p-4 space-y-3"><Skeleton /><Skeleton className="w-2/3" /></div>
         : dld.error ? <div className="p-6 text-center text-sm text-bad">{(dld.error as Error).message}</div>
         : dld.data!.rows.length ? (
          <div className="overflow-x-auto max-h-[60vh]">
            <table className="w-full text-[13px] num">
              <thead className="sticky top-0 bg-surface-2"><tr className="text-xs text-ink-2">{[["Date"], ["Type"], ["BR"], ["Size sq ft", "r"], ["Price", "r"], ["Kind"]].map(([h, r]) => <th key={h} className={cx("px-3 py-2.5 font-semibold whitespace-nowrap", r ? "text-right" : "text-left")}>{h}</th>)}</tr></thead>
              <tbody>
                {dld.data!.rows.map((d, i) => (
                  <tr key={i} className="border-b border-line last:border-0">
                    <td className="px-3 py-2.5 text-ink-2 whitespace-nowrap">{day(d.transaction_date)}</td>
                    <td className="px-3 py-2.5 text-ink">{d.property_sub_type || d.property_type || "—"}</td>
                    <td className="px-3 py-2.5 text-ink-2">{String(d.rooms || "").replace(/ B\/R/i, "BR") || "—"}</td>
                    <td className="px-3 py-2.5 text-right text-ink-2">{num(d.area_sqft) || "—"}</td>
                    <td className="px-3 py-2.5 text-right"><b className="font-semibold text-ink">{shortAED(d.amount)}</b></td>
                    <td className="px-3 py-2.5 text-ink-2">{d.is_offplan ? "Off-plan" : "Ready"} · {d.procedure || ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <div className="p-8 text-center text-sm text-ink-3">No DLD sales recorded for this cluster yet.</div>}
      </Card>

      {dxbOpen && <DxbSheet community={community} cluster={cluster} onClose={() => setDxbOpen(false)} onDone={() => { q.refetch(); }} />}
      {toast && <Toast message={toast} onClose={() => setToast("")} />}
    </div>
  );
}

// Opens DXB Interact in a new tab; the "Usama CRM Helper" Chrome extension reads every sale of this cluster there and posts
// the rows back here. Then: save new sales (never duplicates) and fill bedrooms / sizes / notes / status from them.
function DxbSheet({ community, cluster, onClose, onDone }: { community: string; cluster: string; onClose: () => void; onDone: () => void }) {
  const [msg, setMsg] = useState("Opening DXB Interact in a new tab…");
  const [sub, setSub] = useState("Leave that tab open. It closes by itself when it is done (usually under a minute).");
  const [help, setHelp] = useState(false);
  const [summary, setSummary] = useState<{ lines: [number, string][]; notes: string[] } | null>(null);
  const started = useRef(false);
  const stopJob = useRef<() => void>(() => {});

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
    let heard = false, finished = false;
    const job = encodeURIComponent(JSON.stringify({ id, project: cluster, community, crm: location.origin }));
    const tab = window.open(`${DXB_ORIGIN}/dubai-house-prices#usama-fetch=${job}`, "_blank");
    if (!tab) { setMsg("Your browser blocked the new tab. Allow pop-ups for this site and press the button again."); setSub(""); return; }
    stopJob.current = () => stop();
    const timer = setTimeout(() => { if (heard || finished) return; stop(); setMsg("The CRM Helper extension did not answer."); setSub(""); setHelp(true); }, 30000);
    function stop() { finished = true; window.removeEventListener("message", onMsg); clearTimeout(timer); }
    async function onMsg(e: MessageEvent) {
      if (e.origin !== DXB_ORIGIN || !e.data || e.data.id !== id) return;
      heard = true;
      const d = e.data;
      if (d.type === "usama-dxb-hello" || d.type === "usama-dxb-progress") { if (d.text) setMsg(d.text); return; }
      if (d.type === "usama-dxb-error") { stop(); setMsg(`DXB Interact stopped: ${d.text}`); setSub("Nothing was changed in the CRM."); return; }
      if (d.type !== "usama-dxb-sales") return;
      stop();
      const rows = (d.rows || []).map((r: any) => ({ ...r, community, cluster }));
      setMsg(`Read ${num(rows.length)} sales from DXB Interact. Saving…`); setSub("");
      try {
        let imported = 0; const skipped: string[] = [];
        for (let i = 0; i < rows.length; i += 400) {
          const { data, error } = await db.rpc("crm_import_external_sales", { rows: rows.slice(i, i + 400), source: "dxbinteract", dry_run: false });
          if (error) throw new Error(error.message);
          ((data || []) as any[]).forEach((x) => { if (x.result === "imported") imported++; else if (/^skipped/.test(x.result)) skipped.push(x.result); });
        }
        setMsg("Filling bedrooms, sizes and notes…");
        const { data: s, error } = await db.rpc("crm_refresh_cluster_from_sales", { p_community: community, p_cluster: cluster });
        if (error) throw new Error(error.message);
        const notes: string[] = [];
        if (d.total && rows.length < d.total) notes.push(`DXB Interact shows ${num(d.total)} sales; ${num(rows.length)} could be read.`);
        if (s?.skipped_units?.length) notes.push(`Not filled because DXB sales disagree on bedrooms or size: unit ${s.skipped_units.join(", ")}.`);
        if (skipped.length) notes.push(`${skipped.length} sales had no matching unit in the CRM and were left out.`);
        setMsg(`${cluster} is up to date.`);
        setSummary({ lines: ([[imported, "new sales saved"], [s?.units_filled, "units got bedrooms / sizes"], [s?.notes_updated, "owner notes updated"], [s?.marked_sold, "owners marked Sold"], ...(s?.share_transfers ? [[s.share_transfers, "co-owner share transfers marked"]] : [])] as [number, string][]), notes });
        onDone();
      } catch (err) { setMsg(`Could not save: ${(err as Error).message}`); }
    }
    window.addEventListener("message", onMsg);
  }, [community, cluster, onDone]);
  const close = () => { stopJob.current(); onClose(); };

  return (
    <Sheet open onClose={close} title={`Update ${cluster} from DXB Interact`} footer={<Button onClick={close}>Close</Button>}>
      <div className="text-sm font-medium text-ink">{msg}</div>
      {sub && <div className="text-[13px] text-ink-2 mt-2">{sub}</div>}
      {summary && <>
        <ul className="mt-3 pl-4 list-disc text-sm text-ink space-y-1">{summary.lines.map(([n, t]) => <li key={t}><b className="font-semibold">{count(n || 0)}</b> {t}</li>)}</ul>
        {summary.notes.map((n) => <p key={n} className="text-[13px] text-ink-2 mt-2">{n}</p>)}
      </>}
      {help && (
        <div className="text-[13px] text-ink-2 mt-2">
          It is needed to read DXB Interact in your browser. To install it once:
          <ol className="mt-2 pl-4 list-decimal space-y-1">
            <li>In Chrome open <b>chrome://extensions</b> and switch on <b>Developer mode</b> (top right).</li>
            <li>Click <b>Load unpacked</b> and choose the folder <b>usama-crm › extension</b> on your Mac (or click the ↻ arrow on “Usama CRM Helper” if it is already there).</li>
            <li>Make sure you are logged in to DXB Interact, then press <b>Update from DXB Interact</b> again.</li>
          </ol>
        </div>
      )}
    </Sheet>
  );
}

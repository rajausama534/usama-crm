"use client";

import { Suspense, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowDownWideNarrow, ArrowUpNarrowWide, Home, ChevronLeft, ChevronRight, Download, MessageSquareText, MessageCircle, Plus, RotateCcw, UserRound, Loader2 } from "lucide-react";
import { db } from "@/lib/supabase";
import { useAuth } from "@/components/Providers";
import { OWNER_STATUSES, type Owner } from "@/lib/crm";
import { useDebounced } from "@/lib/hooks";
import { orSafe } from "@/components/shell/CommandPalette";
import { Badge, Button, Card, Empty, FilterSelect, ListSkeleton, PageHeader, SearchBox, Sheet, StatusChip, StatusSelect, Textarea, cx } from "@/components/ui";
import { CallButton, CopyButton, TemplateSheet, WaButton, useToast, useWaTemplate } from "@/components/ContactKit";
import { BROADCAST_IDS_KEY, downloadCSV, isSystemActivity, markOwnerContacted, ownerMessage } from "@/lib/contact";
import { count, fmtDate, todayDubai } from "@/lib/format";
import { OwnerSheet } from "./OwnerSheet";
import { AddOwnerSheet } from "./AddOwnerSheet";

const PAGE = 50;
type Opt = { community: string | null; cluster: string | null; data_source: string | null; records: number };
type Row = Owner & { __remark?: string; __units?: number; __coOwners?: number };
const SORTS = [
  { v: "unit", l: "Sort: Unit number" }, { v: "owner", l: "Sort: Owner name" }, { v: "community", l: "Sort: Community" },
  { v: "cluster", l: "Sort: Cluster" }, { v: "id", l: "Sort: Old / new" },
];

export default function OwnersPage() {
  return <Suspense><Owners /></Suspense>;
}

function Owners() {
  const { me } = useAuth();
  const router = useRouter();
  const params = useSearchParams();
  const qc = useQueryClient();
  const toast = useToast();
  const template = useWaTemplate();
  const openId = params.get("open");

  const [q, setQ] = useState("");
  const [unitNo, setUnitNo] = useState("");
  const [community, setCommunity] = useState("");
  const [cluster, setCluster] = useState("");
  const [source, setSource] = useState("");
  const [status, setStatus] = useState("");
  const [sort, setSort] = useState("unit");
  const [dir, setDir] = useState<"asc" | "desc">("asc");
  const [allRecords, setAllRecords] = useState(false);
  const [page, setPage] = useState(0);
  const [templateOpen, setTemplateOpen] = useState(false);
  const [remarkFor, setRemarkFor] = useState<Row | null>(null);
  const [exporting, setExporting] = useState(false);
  const [adding, setAdding] = useState(false);
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const term = orSafe(useDebounced(q, 300));
  const unit = useDebounced(unitNo.trim(), 300);

  const stats = useQuery({
    queryKey: ["dashboard-stats"],
    queryFn: async () => (await db.rpc("crm_dashboard_stats")).data as { owners: { records: number }; owner_status: Record<string, number> },
  });
  const options = useQuery({
    queryKey: ["owner-options"],
    staleTime: 30 * 60_000,
    queryFn: async () => ((await db.rpc("crm_filter_options")).data || []) as Opt[],
  });
  const { communities, clusters, sources } = useMemo(() => {
    const cm = new Map<string, number>(), cl = new Map<string, number>(), so = new Set<string>();
    for (const o of options.data || []) {
      if (o.community) cm.set(o.community, (cm.get(o.community) || 0) + Number(o.records));
      if (o.cluster && (!community || o.community === community)) cl.set(o.cluster, (cl.get(o.cluster) || 0) + Number(o.records));
      if (o.data_source) so.add(o.data_source);
    }
    const sorted = (m: Map<string, number>) => [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]));
    return { communities: sorted(cm), clusters: sorted(cl), sources: [...so].sort() };
  }, [options.data, community]);

  const key = ["owners", term, unit, community, cluster, source, status, sort, dir, allRecords, page] as const;
  const list = useQuery({
    queryKey: key,
    placeholderData: keepPreviousData,
    queryFn: async () => {
      let query = db.from("owners_list").select("*", { count: "exact" });
      if (term) {
        const digits = term.replace(/\D/g, "");
        const or = [`owner.ilike.%${term}%`, `unit.ilike.%${term}%`, `phone1.ilike.%${term}%`, `phone2.ilike.%${term}%`];
        if (digits.length >= 4 && digits !== term) or.push(`phone1.ilike.%${digits}%`, `phone2.ilike.%${digits}%`);
        query = query.or(or.join(","));
      }
      if (unit) query = query.eq("unit", unit);
      if (community) query = query.eq("community", community);
      if (cluster) query = query.eq("cluster", cluster);
      if (source) query = query.eq("data_source", source);
      if (status) query = query.eq("status", status);
      // One row per unit (owners.is_primary), as the old CRM; searching, a unit number or "every record" lists all.
      if (!term && !unit && !allRecords) query = query.eq("is_primary", true);
      const asc = dir === "asc";
      if (sort === "unit") query = query.order("community").order("cluster").order("unit_natural", { ascending: asc, nullsFirst: false });
      else query = query.order(sort, { ascending: asc, nullsFirst: false }).order("unit_natural", { nullsFirst: false });
      query = query.order("id").range(page * PAGE, page * PAGE + PAGE - 1);
      const { data, error, count } = await query;
      if (error) throw error;
      const rows = (data || []) as Row[];
      if (rows.length) await enrich(rows);
      return { rows, count: count || 0 };
    },
  });

  const rows = list.data?.rows || [];
  const total = list.data?.count || 0;
  const pages = Math.max(1, Math.ceil(total / PAGE));
  const reset = (fn: () => void) => { fn(); setPage(0); };
  const kpi = stats.data?.owner_status || {};

  function openOwner(id: number | null) {
    const sp = new URLSearchParams(params.toString());
    if (id) sp.set("open", String(id)); else sp.delete("open");
    router.replace(`/owners${sp.size ? `?${sp}` : ""}`, { scroll: false });
  }
  const refresh = () => { qc.invalidateQueries({ queryKey: ["owners"] }); qc.invalidateQueries({ queryKey: ["dashboard-stats"] }); };

  async function contact(row: Row, type: "WhatsApp" | "Call") {
    if (!me) return;
    await markOwnerContacted(row.id, type, me.email);
    refresh();
  }
  async function changeStatus(row: Row, s: string) {
    if (!me || s === row.status) return;
    const { error } = await db.from("owners").update({ status: s, last_contacted: todayDubai() }).eq("id", row.id);
    if (error) { toast(error.message); return; }
    await db.from("owner_activities").insert({ owner_id: String(row.id), activity_type: "Status changed", details: `Status changed from ${row.status || "-"} to ${s}.`, created_by: me.email });
    toast(); refresh();
  }
  async function exportCsv() {
    setExporting(true);
    const cols = ["community", "cluster", "unit", "owner", "phone1", "phone2", "remarks", "admin_remarks", "agent_remarks", "data_source", "status", "last_contacted"];
    const all: Record<string, unknown>[] = [];
    for (let from = 0; ; from += 1000) {
      let qq = db.from("owners").select(cols.join(",")).range(from, from + 999);
      if (community) qq = qq.eq("community", community);
      if (cluster) qq = qq.eq("cluster", cluster);
      if (status) qq = qq.eq("status", status);
      if (source) qq = qq.eq("data_source", source);
      const { data, error } = await qq;
      if (error || !data?.length) break;
      all.push(...(data as unknown as Record<string, unknown>[]));
      if (data.length < 1000) break;
    }
    downloadCSV("owner_database_export", cols, all);
    setExporting(false);
  }

  // Tick contacts here, or filter the list, then WhatsApp Broadcast picks them up.
  function broadcast() {
    if (picked.size) {
      try { sessionStorage.setItem(BROADCAST_IDS_KEY, JSON.stringify([...picked])); } catch {}
      router.push("/broadcast");
      return;
    }
    const sp = new URLSearchParams();
    if (community) sp.set("community", community);
    if (cluster) sp.set("cluster", cluster);
    if (status) sp.set("status", status);
    if (source) sp.set("source", source);
    router.push(`/broadcast${sp.size ? `?${sp}` : ""}`);
  }
  const toggle = (id: number) => setPicked((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const allOnPage = rows.length > 0 && rows.every((r) => picked.has(r.id));
  const canExport = me?.isAdmin || me?.permissions.has("export");
  const anyFilter = q || unitNo || community || cluster || source || status || allRecords;

  return (
    <div className="animate-in">
      <PageHeader title="Owner database" subtitle={list.data ? `${count(total)} ${allRecords || term || unit ? "records" : "units"}${cluster || community ? ` in ${cluster || community}` : ""}` : " "}
        actions={<>
          <Button onClick={() => setTemplateOpen(true)}><MessageSquareText size={16} /> WhatsApp message</Button>
          {me?.isAdmin && <Button onClick={broadcast}><MessageCircle size={16} /> WhatsApp Broadcast{picked.size ? ` (${picked.size})` : ""}</Button>}
          {me?.isAdmin && <Button variant="primary" onClick={() => setAdding(true)}><Plus size={16} /> Add owner</Button>}
          {canExport && <Button onClick={exportCsv} disabled={exporting}>{exporting ? <Loader2 size={16} className="animate-spin" /> : <Download size={16} />} Export CSV</Button>}
        </>} />

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 mb-5">
        {[
          { l: "Total records", v: stats.data?.owners.records, h: "All owners", s: "" },
          { l: "For Sale", v: kpi["For Sale"], h: "Sales stock", s: "For Sale" },
          { l: "For Rent", v: kpi["For Rent"], h: "Rental stock", s: "For Rent" },
          { l: "Call Back", v: kpi["Call Back"], h: "Follow-up needed", s: "Call Back" },
          { l: "No Response", v: kpi["No Response"], h: "Try later", s: "No Response" },
          { l: "Invalid", v: kpi["Invalid Number"], h: "Bad numbers", s: "Invalid Number" },
        ].map((k) => (
          <button key={k.l} onClick={() => reset(() => setStatus(status === k.s ? "" : k.s))}
            className={cx("text-left rounded-xl border bg-surface p-4 shadow-card transition-colors", status === k.s && k.s ? "border-accent" : "border-line hover:border-line-strong")}>
            <div className="text-xs font-semibold uppercase tracking-[0.06em] text-ink-2">{k.l}</div>
            <div className="mt-1.5 text-2xl font-bold text-ink num">{k.v == null ? "—" : count(k.v)}</div>
            <div className="text-xs text-ink-3 mt-0.5">{k.h}</div>
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2 mb-3">
        <SearchBox value={q} onChange={(v) => reset(() => setQ(v))} placeholder="Search owners…" />
        <FilterSelect aria-label="Community" value={community} onChange={(e) => reset(() => { setCommunity(e.target.value); setCluster(""); })}>
          <option value="">All communities</option>
          {communities.map(([c, n]) => <option key={c} value={c}>{c} ({count(n)})</option>)}
        </FilterSelect>
        <FilterSelect aria-label="Cluster" value={cluster} onChange={(e) => reset(() => setCluster(e.target.value))}>
          <option value="">All clusters</option>
          {clusters.map(([c, n]) => <option key={c} value={c}>{c} ({count(n)})</option>)}
        </FilterSelect>
        <input value={unitNo} onChange={(e) => reset(() => setUnitNo(e.target.value))} placeholder="Unit No." aria-label="Unit number"
          className={cx("field-sizing-content min-w-20 h-9 rounded-full border px-3.5 text-[13px] font-medium placeholder:text-ink-2 outline-none transition-colors focus:border-accent", unitNo ? "border-accent bg-accent-soft text-accent-text" : "border-line bg-surface text-ink-2 hover:border-line-strong")} />
        <FilterSelect aria-label="Source" value={source} onChange={(e) => reset(() => setSource(e.target.value))}>
          <option value="">All sources</option>
          {sources.map((s) => <option key={s}>{s}</option>)}
        </FilterSelect>
        <FilterSelect aria-label="Sort by" active={false} value={sort} onChange={(e) => reset(() => setSort(e.target.value))}>{SORTS.map((s) => <option key={s.v} value={s.v}>{s.l}</option>)}</FilterSelect>
        <Button className="w-9 !px-0" title={dir === "asc" ? "Ascending / oldest first" : "Descending / newest first"} aria-label="Change sort direction" onClick={() => reset(() => setDir(dir === "asc" ? "desc" : "asc"))}>
          {dir === "asc" ? <ArrowUpNarrowWide size={15} /> : <ArrowDownWideNarrow size={15} />}
        </Button>
        {anyFilter && <Button variant="ghost" onClick={() => reset(() => { setQ(""); setUnitNo(""); setCommunity(""); setCluster(""); setSource(""); setStatus(""); setAllRecords(false); })}><RotateCcw size={14} /> Reset</Button>}
      </div>
      <div className="flex flex-wrap items-center gap-1.5 mb-4">
        {OWNER_STATUSES.map((s) => <StatusChip key={s} status={s} label={s === "Invalid Number" ? "Invalid" : s} active={status === s} onClick={() => reset(() => setStatus(status === s ? "" : s))} />)}
        <label className="ml-auto inline-flex items-center gap-2 text-[13px] text-ink-2 cursor-pointer whitespace-nowrap">
          <input type="checkbox" className="accent-[var(--accent)]" checked={allRecords} onChange={(e) => reset(() => setAllRecords(e.target.checked))} /> Show every owner record
        </label>
      </div>

      {list.isLoading ? <ListSkeleton /> : list.error ? (
        <Card><Empty title="Couldn’t load owners" hint={(list.error as Error).message} /></Card>
      ) : rows.length === 0 ? (
        <Card><Empty icon={<Home size={28} />} title="No records found" hint="Try a different search or clear the filters." /></Card>
      ) : (
        <>
          <Card className="overflow-hidden">
            <div className="hidden lg:block overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-surface-2">
                  <tr className="text-left text-xs text-ink-2 border-b border-line">
                    {me?.isAdmin && <th className="pl-4 py-2.5 w-8"><input type="checkbox" aria-label="Tick all on this page" className="accent-[var(--accent)]" checked={allOnPage} onChange={() => setPicked((s) => { const n = new Set(s); rows.forEach((r) => { if (allOnPage) n.delete(r.id); else n.add(r.id); }); return n; })} /></th>}
                    {["Community", "Cluster", "Unit", "Owner name", "WhatsApp", "Status", "Latest remark", "Last contacted", "Actions"].map((h) => (
                      <th key={h} className="font-semibold px-3 py-2.5 whitespace-nowrap first:pl-4">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className={cx(list.isPlaceholderData && "opacity-60")}>
                  {rows.map((o) => (
                    <tr key={o.id} className="border-b border-line last:border-0 hover:bg-surface-2/60 align-top">
                      {me?.isAdmin && <td className="pl-4 py-3 w-8"><input type="checkbox" aria-label={`Tick ${o.owner || "owner"}`} className="accent-[var(--accent)]" checked={picked.has(o.id)} onChange={() => toggle(o.id)} /></td>}
                      <td className="pl-4 pr-3 py-3 text-ink-2 max-w-40">{o.community}</td>
                      <td className="px-3 py-3 text-ink-2 max-w-40">{o.cluster}</td>
                      <td className="px-3 py-3 font-semibold text-ink num whitespace-nowrap">{o.unit}</td>
                      <td className="px-3 py-3 min-w-44 max-w-72">
                        <div className="text-ink font-medium leading-snug">{o.owner || "—"}</div>
                        <div className="flex flex-wrap gap-1.5 mt-1.5">
                          <button onClick={() => openOwner(o.id)} className="inline-flex items-center gap-1 h-6 px-2 rounded-md bg-accent-soft text-accent-text text-xs font-medium hover:opacity-80"><UserRound size={12} /> Profile</button>
                          {!!o.__units && o.__units > 1 && <button onClick={() => openOwner(o.id)} className="h-6 px-2 rounded-md border border-line text-xs text-ink-2 hover:border-line-strong">{o.__units} units</button>}
                          {!!o.__coOwners && <span className="h-6 px-2 inline-flex items-center rounded-md bg-surface-2 text-xs text-ink-3">+{o.__coOwners} co-owner{o.__coOwners > 1 ? "s" : ""}</span>}
                        </div>
                      </td>
                      <td className="px-3 py-3"><WaButton phone={o.phone1 || o.phone2} text={ownerMessage(template, o)} onContact={() => contact(o, "WhatsApp")} /></td>
                      <td className="px-3 py-3"><StatusSelect value={o.status} options={OWNER_STATUSES} onChange={(s) => changeStatus(o, s)} /></td>
                      <td className="px-3 py-3 min-w-48 max-w-[420px]">
                        <button onClick={() => setRemarkFor(o)} title="Read or add a remark"
                          className="w-full text-left text-[13px] leading-snug text-ink-2 hover:text-ink whitespace-pre-line rounded-md hover:bg-surface-2 -m-1 p-1">
                          {o.__remark || <span className="text-ink-3">No remark yet</span>}
                        </button>
                      </td>
                      <td className="px-3 py-3 text-ink-2 num whitespace-nowrap">{fmtDate(o.last_contacted)}</td>
                      <td className="px-3 py-3"><div className="flex gap-1.5"><CallButton phone={o.phone1 || o.phone2} onContact={() => contact(o, "Call")} /><CopyButton value={o.phone1 || o.phone2} /></div></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Phone / tablet cards */}
            <div className="lg:hidden divide-y divide-line">
              {rows.map((o) => (
                <div key={o.id} className="p-4 space-y-3">
                  <div className="flex items-start justify-between gap-3">
                    {me?.isAdmin && <input type="checkbox" aria-label={`Tick ${o.owner || "owner"}`} className="accent-[var(--accent)] mt-1 shrink-0" checked={picked.has(o.id)} onChange={() => toggle(o.id)} />}
                    <button onClick={() => openOwner(o.id)} className="text-left min-w-0 flex-1">
                      <div className="font-semibold text-ink leading-snug">{o.owner || "—"}</div>
                      <div className="text-xs text-ink-3 mt-0.5">{o.community} · {o.cluster}</div>
                    </button>
                    <span className="shrink-0 rounded-lg bg-accent-soft text-accent-text text-sm font-bold px-2.5 py-1 num">Unit {o.unit}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <StatusSelect value={o.status} options={OWNER_STATUSES} onChange={(s) => changeStatus(o, s)} />
                    <span className="text-xs text-ink-3 ml-auto">Last contact {fmtDate(o.last_contacted)}</span>
                  </div>
                  <button onClick={() => setRemarkFor(o)} className="w-full text-left text-[13px] text-ink-2 rounded-lg bg-surface-2 px-3 py-2 whitespace-pre-line">
                    {o.__remark || <span className="text-ink-3">No remark yet — tap to add</span>}
                  </button>
                  <div className="flex items-center gap-2">
                    <WaButton phone={o.phone1 || o.phone2} text={ownerMessage(template, o)} onContact={() => contact(o, "WhatsApp")} />
                    <CallButton phone={o.phone1 || o.phone2} onContact={() => contact(o, "Call")} />
                    <CopyButton value={o.phone1 || o.phone2} />
                  </div>
                  {(!!o.__coOwners || (o.__units || 0) > 1) && (
                    <div className="flex gap-1.5 text-xs">
                      {(o.__units || 0) > 1 && <Badge>{o.__units} units</Badge>}
                      {!!o.__coOwners && <Badge>+{o.__coOwners} co-owners</Badge>}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </Card>
          <div className="flex items-center justify-between mt-3 text-sm text-ink-3">
            <span className="num">Showing {count(page * PAGE + 1)}–{count(Math.min(total, page * PAGE + PAGE))} of {count(total)}</span>
            <div className="flex items-center gap-1">
              <Button size="sm" variant="ghost" disabled={page === 0} onClick={() => setPage(page - 1)}><ChevronLeft size={16} /> Previous</Button>
              <span className="num px-2">{page + 1} / {pages}</span>
              <Button size="sm" variant="ghost" disabled={page + 1 >= pages} onClick={() => setPage(page + 1)}>Next <ChevronRight size={16} /></Button>
            </div>
          </div>
        </>
      )}

      <AddOwnerSheet open={adding} onClose={() => setAdding(false)} onSaved={(id) => { setAdding(false); refresh(); qc.invalidateQueries({ queryKey: ["owner-options"] }); openOwner(id); }} />
      <TemplateSheet open={templateOpen} onClose={() => setTemplateOpen(false)} />
      <RemarkSheet row={remarkFor} onClose={() => setRemarkFor(null)} onSaved={refresh} />
      <OwnerSheet id={openId ? Number(openId) : null} onClose={() => openOwner(null)} onOpen={openOwner} />
    </div>
  );

  /** Latest remark, number of units the same owner holds, and co-owners on the same unit — for the rows on screen. */
  async function enrich(rows: Row[]) {
    const ids = rows.map((r) => r.id);
    const units = [...new Set(rows.map((r) => r.unit).filter(Boolean))] as string[];
    const [acts, related, co] = await Promise.all([
      db.from("owner_activities").select("owner_id,activity_type,details,created_at").in("owner_id", ids.map(String)).order("created_at", { ascending: false }).limit(1500),
      db.rpc("crm_related_rows", { owner_ids: ids }),
      units.length ? db.from("owners").select("id,community,cluster,unit").in("unit", units).eq("is_primary", false).limit(2000) : Promise.resolve({ data: [] }),
    ]);
    const byOwner = new Map<string, { activity_type: string; details: string }[]>();
    for (const a of acts.data || []) {
      if (isSystemActivity(a)) continue;
      const l = byOwner.get(a.owner_id) || []; l.push(a); byOwner.set(a.owner_id, l);
    }
    const norm = (s: string | null) => String(s || "").toLowerCase().trim();
    const phone = (s: string | null) => String(s || "").replace(/\D/g, "").slice(-9);
    const rel = (related.data || []) as Owner[];
    for (const r of rows) {
      const list = byOwner.get(String(r.id)) || [];
      const manual = list.find((a) => norm(a.activity_type) !== "property transaction");
      const fallback = me?.isAdmin ? r.admin_remarks || r.remarks : r.agent_remarks;
      r.__remark = (manual?.details || list[0]?.details || fallback || "").trim();
      const name = norm(r.owner), phones = [phone(r.phone1), phone(r.phone2)].filter(Boolean);
      const mine = rel.filter((x) => (name && norm(x.owner) === name) || phones.includes(phone(x.phone1)) || phones.includes(phone(x.phone2)));
      r.__units = new Set(mine.map((x) => `${x.community}|${x.cluster}|${x.unit}`)).size;
      if (r.is_primary !== false) r.__coOwners = (co.data || []).filter((x) => x.unit === r.unit && x.cluster === r.cluster && x.community === r.community && x.id !== r.id).length;
    }
  }
}

function RemarkSheet({ row, onClose, onSaved }: { row: Row | null; onClose: () => void; onSaved: () => void }) {
  const { me } = useAuth();
  const toast = useToast();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  async function save() {
    if (!row || !me || !text.trim()) return;
    setBusy(true);
    await db.from("owner_activities").insert({ owner_id: String(row.id), activity_type: "Note", details: text.trim(), created_by: me.email });
    await db.from("owners").update({ last_contacted: todayDubai() }).eq("id", row.id);
    setBusy(false); setText(""); toast(); onSaved(); onClose();
  }
  return (
    <Sheet open={!!row} onClose={onClose} title={row ? <span className="num">{row.owner} · {row.cluster} {row.unit}</span> : ""} footer={<>
      <Button variant="ghost" onClick={onClose}>Close</Button>
      <Button variant="primary" onClick={save} disabled={busy || !text.trim()}>{busy && <Loader2 size={15} className="animate-spin" />}Save remark</Button>
    </>}>
      {row && (
        <div className="space-y-4">
          <div>
            <div className="text-xs font-semibold text-ink-2 mb-1.5">Latest remark</div>
            <div className="rounded-xl bg-surface-2 p-3.5 text-sm text-ink whitespace-pre-wrap">{row.__remark || "No remark yet"}</div>
          </div>
          <div>
            <div className="text-xs font-semibold text-ink-2 mb-1.5">New remark</div>
            <Textarea rows={5} value={text} onChange={(e) => setText(e.target.value)} placeholder="What did the owner say?" autoFocus />
            <div className="text-xs text-ink-3 mt-1.5">Saved to the owner’s history and shown as the latest remark.</div>
          </div>
        </div>
      )}
    </Sheet>
  );
}

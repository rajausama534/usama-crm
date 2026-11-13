"use client";

import { Suspense, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Handshake, Loader2, Plus, Trash2 } from "lucide-react";
import { db } from "@/lib/supabase";
import { useAuth } from "@/components/Providers";
import { useStaff, staffName } from "@/lib/hooks";
import { Badge, Button, Empty, Field, Input, ListSkeleton, PageHeader, SearchBox, Select, Sheet, Stat, StatusChip, Tabs, Textarea } from "@/components/ui";
import { useToast } from "@/components/ContactKit";
import { DataTable, DEAL_TONE, FormError, SetupNeeded, type Col } from "@/components/company/kit";
import { isFinance, useRefresh, useRows } from "@/lib/company/data";
import { COUNTED, DEAL_STATUS, DEAL_TYPES, dealMoney, monthStart, num, r2, slabTopUp, type Deal, type Developer, type Split } from "@/lib/company/calc";
import { aed, fmtDate, todayDubai } from "@/lib/format";
import { DealSheet } from "./DealSheet";

export default function DealsPage() {
  return <Suspense><Deals /></Suspense>;
}

function Deals() {
  const { me } = useAuth();
  const staff = useStaff();
  const router = useRouter();
  const params = useSearchParams();
  const finance = isFinance(me);
  const deals = useRows<Deal>("crm_deals", { order: "deal_date" });
  const splits = useRows<Split>("crm_deal_splits");
  const [tab, setTab] = useState<"deals" | "developers">("deals");
  const [status, setStatus] = useState("");
  const [q, setQ] = useState("");

  const open = params.get("open") || (params.get("new") ? "new" : null);
  const setOpen = (id: string | null) => router.replace(id ? `/deals?${id === "new" ? "new=1" : `open=${id}`}` : "/deals", { scroll: false });

  const rows = useMemo(() => deals.data || [], [deals.data]);
  const sp = useMemo(() => splits.data || [], [splits.data]);
  const byDeal = useMemo(() => { const m = new Map<string, Split[]>(); for (const s of sp) m.set(s.deal_id, [...(m.get(s.deal_id) || []), s]); return m; }, [sp]);
  const month = monthStart(todayDubai());

  const stats = useMemo(() => {
    const counted = rows.filter((d) => COUNTED.has(d.status));
    const thisMonth = counted.filter((d) => d.deal_date >= month);
    const sum = (l: Deal[], f: (d: Deal) => number) => r2(l.reduce((s, d) => s + f(d), 0));
    const company = (d: Deal) => num(d.office_commission) - (byDeal.get(d.id) || []).reduce((s, l) => s + num(l.amount), 0);
    const my = sp.filter((s) => s.email.toLowerCase() === me?.email);
    const countedIds = new Set(counted.map((d) => d.id));
    return {
      commission: sum(thisMonth, (d) => dealMoney(d).gross), company: sum(thisMonth, company), n: thisMonth.length,
      pending: rows.filter((d) => d.status === "pending").length, approved: counted.length,
      myEarned: r2(my.filter((s) => countedIds.has(s.deal_id)).reduce((s, l) => s + num(l.amount), 0)),
      myPaid: r2(my.reduce((s, l) => s + num(l.paid), 0)),
    };
  }, [rows, sp, byDeal, month, me?.email]);

  const shown = rows.filter((d) => (!status || d.status === status)
    && (!q || `${d.client_name} ${d.community || ""} ${d.cluster || ""} ${d.unit || ""} ${d.deal_no}`.toLowerCase().includes(q.toLowerCase())));
  const counts = rows.reduce<Record<string, number>>((m, d) => { m[d.status] = (m[d.status] || 0) + 1; return m; }, {});

  const cols: Col<Deal>[] = [
    { h: "#", cell: (d) => <span className="num text-ink-3">{d.deal_no}</span> },
    { h: "Date", cell: (d) => <span className="num whitespace-nowrap text-ink-2">{fmtDate(d.deal_date)}</span> },
    { h: "Client", cell: (d) => <div className="min-w-32"><div className="font-medium">{d.client_name}</div><div className="text-xs text-ink-3">{[d.community, d.cluster, d.unit].filter(Boolean).join(" · ")}</div></div> },
    { h: "Type", cell: (d) => <span className="whitespace-nowrap text-ink-2">{DEAL_TYPES[d.deal_type]?.label}</span> },
    { h: "Agents", cell: (d) => <span className="text-ink-2">{(byDeal.get(d.id) || []).filter((s) => s.kind === "agent").map((s) => staffName(staff.data, s.email)).join(", ") || (finance ? "Company" : "—")}</span> },
    { h: "Commission", right: true, cell: (d) => aed(dealMoney(d).gross) },
    finance
      ? { h: "Company share", right: true, cell: (d) => aed(r2(num(d.office_commission) - (byDeal.get(d.id) || []).reduce((s, l) => s + num(l.amount), 0))) }
      : { h: "My commission", right: true, cell: (d) => aed((byDeal.get(d.id) || []).filter((s) => s.email.toLowerCase() === me?.email).reduce((s, l) => s + num(l.amount), 0)) },
    { h: "Status", cell: (d) => <span className="flex items-center gap-1.5"><Badge tone={DEAL_TONE[d.status]}>{DEAL_STATUS[d.status]}</Badge>{d.goaml_status === "needed" && <Badge tone="bad">goAML</Badge>}</span> },
  ];

  if (deals.isLoading) return <><PageHeader title="Deals" /><ListSkeleton /></>;
  if (deals.data === null) return <><PageHeader title="Deals" /><SetupNeeded what="Deals and commission" /></>;

  return (
    <div className="animate-in">
      <PageHeader title="Deals" subtitle="Every deal: property, price, agents and commission. Billing is in Accounts."
        actions={<Button variant="primary" onClick={() => setOpen("new")}><Plus size={16} /> Record deal</Button>} />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
        {finance ? <>
          <Stat label="Commission this month" value={aed(stats.commission)} hint={`${stats.n} deal${stats.n === 1 ? "" : "s"}, before VAT`} />
          <Stat label="Company share this month" value={aed(stats.company)} tone="good" />
          <Stat label="Approved deals" value={String(stats.approved)} hint="All time" />
          <Stat label="Waiting for approval" value={String(stats.pending)} />
        </> : <>
          <Stat label="My commission earned" value={aed(stats.myEarned)} hint="Approved deals" />
          <Stat label="Paid to me" value={aed(stats.myPaid)} tone="good" />
          <Stat label="Still to come" value={aed(Math.max(0, r2(stats.myEarned - stats.myPaid)))} hint="Paid as the client's money arrives" />
          <Stat label="Waiting for approval" value={String(stats.pending)} />
        </>}
      </div>

      {finance && <Tabs className="mb-4" value={tab} onChange={setTab} options={[{ value: "deals", label: "Deals", n: rows.length }, { value: "developers", label: "Developers" }]} />}

      {tab === "deals" && <>
        <div className="flex flex-wrap items-center gap-2 mb-3">
          <SearchBox value={q} onChange={setQ} placeholder="Search client, unit or deal number" />
          <div className="flex gap-1.5 overflow-x-auto">
            <StatusChip status="All" label="All" n={rows.length} active={!status} onClick={() => setStatus("")} />
            {Object.entries(DEAL_STATUS).filter(([k]) => counts[k]).map(([k, label]) => <StatusChip key={k} status={label} n={counts[k]} active={status === k} onClick={() => setStatus(status === k ? "" : k)} />)}
          </div>
        </div>
        <DataTable cols={cols} rows={shown} onRow={(d) => setOpen(d.id)}
          empty={<Empty icon={<Handshake size={28} />} title={rows.length ? "No deals match" : "No deals yet"} hint={rows.length ? undefined : "Record a deal here, or move a lead to Won and press “Record deal”."} />} />
      </>}
      {tab === "developers" && finance && <Developers deals={rows} />}

      <DealSheet id={open} leadId={params.get("lead")} deals={rows} onClose={() => setOpen(null)} onCreated={(id) => setOpen(id)} />
    </div>
  );
}

/** Off-plan developers and their commission slabs. */
function Developers({ deals }: { deals: Deal[] }) {
  const list = useRows<Developer>("crm_developers", { order: "name", asc: true });
  const toast = useToast();
  const refresh = useRefresh();
  const [edit, setEdit] = useState<Developer | "new" | null>(null);
  const blank = { name: "", basis: "aed", period_start: "", period_end: "", pay_days: "60", notes: "" };
  const [f, setF] = useState(blank);
  const [slabs, setSlabs] = useState<{ from: string; pct: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  function start(d: Developer | "new") {
    setErr(""); setEdit(d);
    if (d === "new") { setF(blank); setSlabs([{ from: "0", pct: "" }]); return; }
    setF({ name: d.name, basis: d.basis, period_start: d.period_start || "", period_end: d.period_end || "", pay_days: String(d.pay_days), notes: d.notes || "" });
    setSlabs((d.slabs || []).map((s) => ({ from: String(s.from), pct: String(s.pct) })));
  }
  async function save() {
    if (!f.name.trim()) return setErr("Enter the developer's name.");
    setBusy(true); setErr("");
    const body = { name: f.name.trim(), basis: f.basis, period_start: f.period_start || null, period_end: f.period_end || null, pay_days: num(f.pay_days) || 60, notes: f.notes.trim() || null,
      slabs: slabs.filter((s) => s.pct !== "").map((s) => ({ from: num(s.from), pct: num(s.pct) })).sort((a, b) => a.from - b.from) };
    const r = edit === "new" ? await db.from("crm_developers").insert(body) : await db.from("crm_developers").update(body).eq("id", (edit as Developer).id);
    setBusy(false);
    if (r.error) return setErr(r.error.code === "23505" ? "A developer with this name already exists." : r.error.message);
    toast("Saved"); setEdit(null); refresh();
  }

  return (
    <>
      <div className="flex justify-end mb-3"><Button onClick={() => start("new")}><Plus size={15} /> Add developer</Button></div>
      <DataTable rows={list.data || []} onRow={start} empty={<Empty title="No developers yet" hint="Add each developer with their commission slabs. The system then suggests the % on every off-plan deal and shows the top-up to claim when a higher slab is reached." />} cols={[
        { h: "Developer", cell: (d) => <span className="font-medium">{d.name}</span> },
        { h: "Period", cell: (d) => <span className="text-ink-2 num whitespace-nowrap">{d.period_start ? `${fmtDate(d.period_start)} – ${fmtDate(d.period_end)}` : "All time"}</span> },
        { h: "Slabs", cell: (d) => <span className="text-ink-2">{(d.slabs || []).map((s) => `${s.pct}% from ${d.basis === "units" ? `${s.from} units` : aed(s.from)}`).join(" · ") || "—"}</span> },
        { h: "Sold this period", right: true, cell: (d) => { const t = slabTopUp(d, deals); return d.basis === "units" ? `${t.units} units` : aed(t.value); } },
        { h: "Slab now", right: true, cell: (d) => `${slabTopUp(d, deals).pct}%` },
        { h: "Top-up to claim", right: true, cell: (d) => { const t = slabTopUp(d, deals).topUp; return t > 0 ? <span className="text-good font-medium">{aed(t)}</span> : <span className="text-ink-3">—</span>; } },
      ]} />
      <div className="mt-2 text-xs text-ink-3">A top-up appears when a higher slab is reached: it applies to every unit in the period and is company income only.</div>

      <Sheet open={!!edit} onClose={() => setEdit(null)} title={edit === "new" ? "Add developer" : "Developer"} footer={<>
        <Button variant="ghost" onClick={() => setEdit(null)}>Cancel</Button>
        <Button variant="primary" onClick={save} disabled={busy}>{busy && <Loader2 size={15} className="animate-spin" />}Save</Button>
      </>}>
        <div className="grid sm:grid-cols-2 gap-3">
          <Field label="Developer name" className="sm:col-span-2"><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
          <Field label="Slabs counted by"><Select value={f.basis} onChange={(e) => setF({ ...f, basis: e.target.value })}><option value="aed">AED sold</option><option value="units">Units sold</option></Select></Field>
          <Field label="Pays after (days)"><Input inputMode="numeric" value={f.pay_days} onChange={(e) => setF({ ...f, pay_days: e.target.value })} /></Field>
          <Field label="Period from"><Input type="date" value={f.period_start} onChange={(e) => setF({ ...f, period_start: e.target.value })} /></Field>
          <Field label="Period to"><Input type="date" value={f.period_end} onChange={(e) => setF({ ...f, period_end: e.target.value })} /></Field>
        </div>
        <div className="mt-4 text-xs font-medium text-ink-2 mb-1.5">Slabs</div>
        <div className="space-y-2">
          {slabs.map((s, i) => (
            <div key={i} className="flex items-center gap-2">
              <span className="text-sm text-ink-3 w-10">From</span>
              <Input inputMode="decimal" value={s.from} onChange={(e) => setSlabs((l) => l.map((x, n) => (n === i ? { ...x, from: e.target.value } : x)))} placeholder={f.basis === "units" ? "units" : "AED"} />
              <Input className="w-24" inputMode="decimal" value={s.pct} onChange={(e) => setSlabs((l) => l.map((x, n) => (n === i ? { ...x, pct: e.target.value } : x)))} placeholder="%" />
              <button type="button" aria-label="Remove slab" onClick={() => setSlabs((l) => l.filter((_, n) => n !== i))} className="px-1 text-ink-3 hover:text-bad"><Trash2 size={16} /></button>
            </div>
          ))}
        </div>
        <button type="button" onClick={() => setSlabs((l) => [...l, { from: "", pct: "" }])} className="mt-2 inline-flex items-center gap-1 text-[13px] font-medium text-accent-text"><Plus size={14} /> Add slab</button>
        <Field label="Notes" className="mt-4"><Textarea rows={2} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></Field>
        <FormError>{err}</FormError>
      </Sheet>
    </>
  );
}

"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { ShieldCheck } from "lucide-react";
import { db } from "@/lib/supabase";
import { useAuth } from "@/components/Providers";
import { useStaff, staffName } from "@/lib/hooks";
import { Badge, Button, Empty, ListSkeleton, PageHeader, Sheet, Stat, Tabs, buttonClass } from "@/components/ui";
import { useToast } from "@/components/ContactKit";
import { DataTable, DEAL_TONE, SetupNeeded } from "@/components/company/kit";
import { KycParties, kycMissing, partyLabel, type Kyc } from "@/components/company/KycForm";
import { isCompliance, useRefresh, useRows } from "@/lib/company/data";
import { DEAL_STATUS, DEAL_TYPES, kycParties, type Deal } from "@/lib/company/calc";
import { aed, fmtDate } from "@/lib/format";

export default function CompliancePage() {
  const { me } = useAuth();
  const staff = useStaff();
  const toast = useToast();
  const refresh = useRefresh();
  const officer = isCompliance(me);
  const deals = useRows<Deal>("crm_deals", { order: "deal_date" });
  const kyc = useRows<Kyc>("crm_kyc");
  const [tab, setTab] = useState<"todo" | "goaml" | "all">("todo");
  const [open, setOpen] = useState<string | null>(null);

  const rows = useMemo(() => (deals.data || []).filter((d) => d.status !== "cancelled").map((d) => {
    const need = kycParties(d.deal_type);
    const mine = (kyc.data || []).filter((k) => k.deal_id === d.id);
    const missing = kycMissing(need, mine);
    return { ...d, need, missing };
  }), [deals.data, kyc.data]);
  const todo = rows.filter((d) => d.missing.length && ["pending", "rejected"].includes(d.status));
  const goaml = rows.filter((d) => d.goaml_status !== "not_needed");
  const shown = tab === "todo" ? todo : tab === "goaml" ? goaml : rows.filter((d) => d.need.length || d.goaml_status !== "not_needed");
  const deal = rows.find((d) => d.id === open);

  async function markReported(d: Deal) {
    const ref = window.prompt("goAML report reference number");
    if (!ref?.trim()) return;
    const r = await db.from("crm_deals").update({ goaml_status: "reported", goaml_ref: ref.trim() }).eq("id", d.id);
    if (r.error) toast(r.error.message); else { toast("Marked as reported"); refresh(); }
  }

  if (deals.isLoading) return <><PageHeader title="Compliance" /><ListSkeleton /></>;
  if (deals.data === null) return <><PageHeader title="Compliance" /><SetupNeeded what="Compliance" /></>;

  return (
    <div className="animate-in">
      <PageHeader title="Compliance" subtitle="KYC before a deal is approved, and goAML reports for cash deals of AED 55,000 or more" />
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
        <Stat label="Deals waiting for KYC" value={String(todo.length)} tone={todo.length ? "warn" : undefined} />
        <Stat label="goAML reports to file" value={String(goaml.filter((d) => d.goaml_status === "needed").length)} tone={goaml.some((d) => d.goaml_status === "needed") ? "bad" : undefined} />
        <Stat label="KYC completed" value={String((kyc.data || []).filter((k) => k.status === "complete").length)} tone="good" />
        <Stat label="goAML reported" value={String(goaml.filter((d) => d.goaml_status === "reported").length)} />
      </div>
      <Tabs className="mb-4" value={tab} onChange={setTab} options={[{ value: "todo", label: "KYC to complete", n: todo.length }, { value: "goaml", label: "goAML", n: goaml.length }, { value: "all", label: "All deals" }]} />
      <DataTable rows={shown} onRow={(d) => setOpen(d.id)}
        empty={<Empty icon={<ShieldCheck size={28} />} title={tab === "todo" ? "No KYC waiting" : tab === "goaml" ? "No cash deals over the limit" : "No deals yet"} hint={tab === "todo" ? "Every deal waiting for approval has its KYC complete." : undefined} />}
        cols={[
          { h: "#", cell: (d) => <span className="num text-ink-3">{d.deal_no}</span> },
          { h: "Date", cell: (d) => <span className="num whitespace-nowrap text-ink-2">{fmtDate(d.deal_date)}</span> },
          { h: "Client", cell: (d) => <div><div className="font-medium">{d.client_name}</div><div className="text-xs text-ink-3">{DEAL_TYPES[d.deal_type].label} · {staffName(staff.data, d.created_by)}</div></div> },
          { h: "KYC", cell: (d) => <span className="flex flex-wrap gap-1">{d.need.length ? d.need.map((p) => <Badge key={p} tone={d.missing.includes(p) ? "warn" : "good"}>{partyLabel(p)}{d.missing.includes(p) ? " pending" : " done"}</Badge>) : <span className="text-ink-3">Not needed</span>}</span> },
          { h: "Cash", right: true, cell: (d) => (Number(d.cash_amount) ? aed(d.cash_amount) : "—") },
          { h: "goAML", cell: (d) => d.goaml_status === "needed" ? <Badge tone="bad">Report needed</Badge> : d.goaml_status === "reported" ? <Badge tone="good">Reported · {d.goaml_ref}</Badge> : <span className="text-ink-3">—</span> },
          { h: "Deal", cell: (d) => <Badge tone={DEAL_TONE[d.status]}>{DEAL_STATUS[d.status]}</Badge> },
        ]} />

      <Sheet open={!!deal} onClose={() => setOpen(null)} large title={deal ? `KYC · deal #${deal.deal_no} · ${deal.client_name}` : "KYC"}
        footer={deal && <>
          {deal.goaml_status === "needed" && officer && <Button onClick={() => markReported(deal)}>Mark goAML reported</Button>}
          <Link href={`/deals?open=${deal.id}`} className={buttonClass("secondary")}>Open deal</Link>
        </>}>
        {deal && (
          <div className="space-y-3">
            {deal.goaml_status === "needed" && <div className="rounded-xl bg-bad-soft text-bad text-sm p-3">Cash of {aed(deal.cash_amount)}: file a goAML report (DPMSR) with the UAE FIU, then record the reference here.</div>}
            <KycParties dealId={deal.id} need={deal.need} rows={(kyc.data || []).filter((k) => k.deal_id === deal.id)}
              canEdit={deal.created_by.toLowerCase() === me?.email && ["pending", "rejected"].includes(deal.status)} open={["pending", "rejected"].includes(deal.status)} />
          </div>
        )}
      </Sheet>
    </div>
  );
}

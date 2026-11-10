"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Check, FileText, Loader2, Plus, Trash2, X } from "lucide-react";
import { db } from "@/lib/supabase";
import { useAuth } from "@/components/Providers";
import { can } from "@/lib/access";
import { useStaff, staffName } from "@/lib/hooks";
import { Badge, Button, Field, Input, Select, Sheet, Tabs, Textarea, buttonClass } from "@/components/ui";
import { useToast } from "@/components/ContactKit";
import { useConfirm } from "@/components/Confirm";
import { DEAL_TONE, FormError, Line, Section } from "@/components/company/kit";
import { KycForm, partyLabel, type Kyc } from "@/components/company/KycForm";
import { isCompliance, isFinance, requestApproval, useRefresh, useRows } from "@/lib/company/data";
import {
  DEAL_STATUS, DEAL_TYPES, GOAML_CASH_LIMIT, addDays, advancesOwed, dealMoney, kycParties, num, payableNow, r2, slabFor, splitDeal,
  type Deal, type DealPayment, type DealType, type Developer, type Expense, type Invoice, type Split, type Staff, type StaffRate,
} from "@/lib/company/calc";
import { aed, fmtDate, todayDubai } from "@/lib/format";

type AgentRow = { email: string; share_pct: string; rate_pct: string };
const blankForm = (email: string) => ({
  deal_type: "secondary" as DealType, client_name: "", client_phone: "", community: "", cluster: "", unit: "", developer_id: "", deal_date: todayDubai(),
  price: "", commission_pct: "2", commission: "", seller_fee: "", other_agency: "", other_agency_direction: "" as "" | "we_pay" | "they_pay", other_agency_amount: "",
  payment_method: "bank", cash_amount: "", expected_on: "", notes: "", lead_id: null as string | null, owner_id: null as number | null, _me: email,
});
type Form = ReturnType<typeof blankForm>;

export function DealSheet({ id, leadId, deals, onClose, onCreated }: { id: string | null; leadId?: string | null; deals: Deal[]; onClose: () => void; onCreated: (id: string) => void }) {
  const { me } = useAuth();
  const staff = useStaff();
  const toast = useToast();
  const refresh = useRefresh();
  const [ask, confirmNode] = useConfirm();
  const finance = isFinance(me), approver = can(me, "approve_deals"), officer = isCompliance(me);
  const isNew = id === "new";
  const deal = !isNew && id ? deals.find((d) => d.id === id) : undefined;
  const open = !!id;

  const staffRows = useRows<Staff>("crm_staff", { key: ["all"] });
  const developers = useRows<Developer>("crm_developers", { order: "name", asc: true });
  const splits = useRows<Split>("crm_deal_splits", { key: [id], enabled: !!deal, filter: (q) => q.eq("deal_id", id) });
  const payments = useRows<DealPayment>("crm_deal_payments", { key: [id], enabled: !!deal, filter: (q) => q.eq("deal_id", id), order: "paid_on" });
  const kyc = useRows<Kyc>("crm_kyc", { key: [id], enabled: !!deal, filter: (q) => q.eq("deal_id", id) });
  const invoices = useRows<Invoice>("crm_invoices", { key: ["deal", id], enabled: !!deal && finance, filter: (q) => q.eq("deal_id", id) });
  const advances = useRows<Expense>("crm_expenses", { key: ["advances"], enabled: !!deal && finance, filter: (q) => q.eq("kind", "advance").eq("status", "approved") });

  const [tab, setTab] = useState<"overview" | "money" | "kyc">("overview");
  const [editing, setEditing] = useState(false);
  const [f, setF] = useState<Form>(blankForm(""));
  const [agents, setAgents] = useState<AgentRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [pay, setPay] = useState<null | { kind: "received" | "payout"; email?: string; amount: string; date: string; method: string; note: string; recover: string; max?: number }>(null);

  // Start a new deal (optionally from a Won lead), or load the saved one for editing.
  useEffect(() => {
    if (!open) return;
    setErr(""); setTab("overview"); setPay(null);
    if (!isNew) { setEditing(false); return; }
    const base = blankForm(me?.email || "");
    setF(base); setEditing(true);
    setAgents(me && (me.role === "agent" || me.role === "team_leader") ? [{ email: me.email, share_pct: "100", rate_pct: "" }] : []);
    if (leadId) {
      db.from("leads").select("id,name,phone,project_inquired,assigned_to").eq("id", leadId).maybeSingle().then(({ data }) => {
        if (!data) return;
        setF((v) => ({ ...v, lead_id: data.id, client_name: data.name || "", client_phone: data.phone || "", community: data.project_inquired || "" }));
        if (data.assigned_to) setAgents([{ email: String(data.assigned_to).toLowerCase(), share_pct: "100", rate_pct: "" }]);
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, id, leadId]);

  function startEdit() {
    if (!deal) return;
    setF({
      ...blankForm(me?.email || ""), deal_type: deal.deal_type, client_name: deal.client_name, client_phone: deal.client_phone || "", community: deal.community || "",
      cluster: deal.cluster || "", unit: deal.unit || "", developer_id: deal.developer_id || "", deal_date: deal.deal_date, price: deal.price ? String(deal.price) : "",
      commission_pct: deal.commission_pct != null ? String(deal.commission_pct) : "", commission: String(deal.commission), seller_fee: deal.seller_fee ? String(deal.seller_fee) : "",
      other_agency: deal.other_agency || "", other_agency_direction: deal.other_agency_direction || "", other_agency_amount: deal.other_agency_amount ? String(deal.other_agency_amount) : "",
      payment_method: deal.payment_method || "bank", cash_amount: deal.cash_amount ? String(deal.cash_amount) : "", expected_on: deal.expected_on || "", notes: deal.notes || "",
      lead_id: deal.lead_id, owner_id: deal.owner_id,
    });
    setAgents((splits.data || []).filter((s) => s.kind === "agent").map((s) => ({ email: s.email, share_pct: String(s.share_pct), rate_pct: finance && s.rate_pct != null ? String(s.rate_pct) : "" })));
    setEditing(true);
  }

  const rates: StaffRate[] = useMemo(() => (staff.data || []).map((u) => {
    const s = (staffRows.data || []).find((x) => (x.email || "").toLowerCase() === u.email.toLowerCase());
    return { email: u.email, commission_rate: s ? num(s.commission_rate) : 50, tl_override_pct: s ? num(s.tl_override_pct) : 0, team_leader: u.team_leader };
  }), [staff.data, staffRows.data]);

  const set = (k: keyof Form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setF((v) => ({ ...v, [k]: e.target.value }));
  const type = DEAL_TYPES[f.deal_type];
  const dev = (developers.data || []).find((d) => d.id === f.developer_id);

  function setType(t: DealType) {
    setF((v) => {
      const pct = DEAL_TYPES[t].pct ? String(DEAL_TYPES[t].pct) : "";
      return { ...v, deal_type: t, commission_pct: pct, commission: pct && num(v.price) ? String(r2(num(v.price) * num(pct) / 100)) : v.commission, developer_id: t === "offplan" ? v.developer_id : "" };
    });
    if (t === "holiday_home") setAgents([]);
  }
  function setPrice(price: string) { setF((v) => ({ ...v, price, commission: num(v.commission_pct) && num(price) ? String(r2(num(price) * num(v.commission_pct) / 100)) : v.commission })); }
  function setPct(pct: string) { setF((v) => ({ ...v, commission_pct: pct, commission: num(v.price) ? String(r2(num(v.price) * num(pct) / 100)) : v.commission })); }
  function setCommission(c: string) { setF((v) => ({ ...v, commission: c, commission_pct: num(v.price) && num(c) ? String(Math.round(num(c) / num(v.price) * 100000) / 1000) : v.commission_pct })); }
  function pickDeveloper(devId: string) {
    const d = (developers.data || []).find((x) => x.id === devId);
    setF((v) => {
      if (!d) return { ...v, developer_id: "" };
      const mine = deals.filter((x) => x.developer_id === d.id && !["cancelled", "rejected"].includes(x.status) && x.id !== id
        && (!d.period_start || x.deal_date >= d.period_start) && (!d.period_end || x.deal_date <= d.period_end));
      const sold = d.basis === "units" ? mine.length + 1 : mine.reduce((s, x) => s + num(x.price), 0) + num(v.price);
      const pct = String(slabFor(d, sold).pct || "");
      return { ...v, developer_id: devId, commission_pct: pct, commission: pct && num(v.price) ? String(r2(num(v.price) * num(pct) / 100)) : v.commission,
        expected_on: v.expected_on || addDays(v.deal_date, d.pay_days) };
    });
  }

  const money = dealMoney({ commission: num(f.commission), seller_fee: num(f.seller_fee), other_agency_direction: f.other_agency_direction || null, other_agency_amount: num(f.other_agency_amount) });
  const preview = splitDeal(money.office, agents.filter((a) => a.email).map((a) => ({ email: a.email, share_pct: num(a.share_pct), rate_pct: a.rate_pct === "" ? null : num(a.rate_pct) })), rates);
  const goaml = num(f.cash_amount) >= GOAML_CASH_LIMIT;

  async function save() {
    if (!me) return;
    if (!f.client_name.trim()) return setErr("Enter the client's name.");
    if (!(num(f.commission) > 0)) return setErr("Enter the commission (before VAT).");
    const list = agents.filter((a) => a.email);
    if (new Set(list.map((a) => a.email)).size !== list.length) return setErr("The same person is listed twice.");
    if (list.length && Math.abs(preview.shareTotal - 100) > 0.001) return setErr(`The agents' shares add up to ${preview.shareTotal}%. They must total 100%.`);
    if (f.other_agency_direction === "we_pay" && num(f.other_agency_amount) > money.gross) return setErr("The other agency's share is more than the commission.");
    setBusy(true); setErr("");
    const body = {
      deal_type: f.deal_type, client_name: f.client_name.trim(), client_phone: f.client_phone.trim() || null, community: f.community.trim() || null, cluster: f.cluster.trim() || null,
      unit: f.unit.trim() || null, developer_id: f.developer_id || null, deal_date: f.deal_date, price: f.price ? num(f.price) : null, commission_pct: f.commission_pct ? num(f.commission_pct) : null,
      commission: num(f.commission), seller_fee: num(f.seller_fee), other_agency: f.other_agency.trim() || null, other_agency_direction: f.other_agency_direction || null,
      other_agency_amount: f.other_agency_direction ? num(f.other_agency_amount) : 0, payment_method: f.payment_method || null, cash_amount: num(f.cash_amount),
      expected_on: f.expected_on || null, notes: f.notes.trim() || null, lead_id: f.lead_id, owner_id: f.owner_id,
    };
    try {
      let dealId = deal?.id;
      if (deal) {
        const r = await db.from("crm_deals").update({ ...body, ...(deal.status === "rejected" ? { status: "pending" } : {}) }).eq("id", deal.id);
        if (r.error) throw new Error(r.error.message);
        const d = await db.from("crm_deal_splits").delete().eq("deal_id", deal.id).eq("paid", 0);
        if (d.error) throw new Error(d.error.message);
      } else {
        const r = await db.from("crm_deals").insert(body).select("id,deal_no").single();
        if (r.error) throw new Error(r.error.message);
        dealId = r.data.id as string;
        const parties = kycParties(f.deal_type);
        if (parties.length) {
          const k = await db.from("crm_kyc").insert(parties.map((party) => ({ deal_id: dealId, party, full_name: party === "buyer" || party === "tenant" ? body.client_name : null })));
          if (k.error) throw new Error(`The deal was saved, but the KYC forms could not be opened: ${k.error.message}`);
        }
      }
      if (list.length) {
        // Rates are left empty for the database to fill from each person's profile, unless Accounts typed one.
        const s = await db.from("crm_deal_splits").insert(list.map((a) => ({ deal_id: dealId, kind: "agent", email: a.email.toLowerCase(), share_pct: num(a.share_pct), rate_pct: finance && a.rate_pct !== "" ? num(a.rate_pct) : null })));
        if (s.error) throw new Error(`The deal was saved, but the agents could not be added: ${s.error.message}`);
      }
      if (!deal || deal.status === "rejected") {
        await requestApproval({
          kind: "deal", ref_table: "crm_deals", ref_id: dealId!, amount: money.gross,
          title: `${DEAL_TYPES[f.deal_type].label} · ${body.client_name}`,
          summary: [[body.community, body.cluster, body.unit].filter(Boolean).join(" · "), body.price ? `${DEAL_TYPES[f.deal_type].priceLabel} ${aed(body.price)}` : "", `Commission ${aed(money.gross)} + VAT ${aed(money.vat)}`,
            list.length ? `Agents: ${list.map((a) => `${staffName(staff.data, a.email)} ${a.share_pct}%`).join(", ")}` : "No agent share"].filter(Boolean).join("\n"),
        });
      }
      toast(deal ? "Deal updated" : "Deal sent for approval");
      refresh(); setEditing(false);
      if (!deal) onCreated(dealId!);
    } catch (x) { setErr((x as Error).message); }
    setBusy(false);
  }

  async function decide(approve: boolean) {
    if (!deal) return;
    if (!(await ask({ title: `${approve ? "Approve" : "Reject"} deal #${deal.deal_no}?`, hint: approve ? "It will count in the books from now on." : "The agent can correct it and send it again.", yes: approve ? "Approve" : "Reject", danger: !approve }))) return;
    const a = await db.from("crm_approvals").select("id").eq("ref_table", "crm_deals").eq("ref_id", deal.id).eq("status", "pending").maybeSingle();
    if (!a.data) { toast("No approval request found. Open Approvals."); return; }
    const r = await db.rpc("crm_decide_approval", { p_id: a.data.id, p_approve: approve, p_note: null });
    if (r.error) { toast(r.error.message); return; }
    toast(approve ? "Deal approved" : "Deal rejected"); refresh();
  }

  async function makeInvoice() {
    if (!deal) return;
    const developer = (developers.data || []).find((d) => d.id === deal.developer_id);
    const billTo = deal.deal_type === "offplan" && developer ? developer.name : deal.other_agency_direction === "they_pay" && deal.other_agency ? deal.other_agency : deal.client_name;
    const where = [deal.community, deal.cluster, deal.unit].filter(Boolean).join(", ");
    const lines = [{ description: `${DEAL_TYPES[deal.deal_type].label} commission${where ? ` — ${where}` : ""}`, amount: num(deal.commission) }];
    if (num(deal.seller_fee)) lines.push({ description: "Seller fee", amount: num(deal.seller_fee) });
    const sub = r2(lines.reduce((s, l) => s + l.amount, 0));
    const r = await db.from("crm_invoices").insert({ deal_id: deal.id, bill_to: billTo, issue_date: todayDubai(), due_date: deal.expected_on || addDays(todayDubai(), 7), lines, subtotal: sub, vat: r2(sub * 0.05) }).select("invoice_no").single();
    if (r.error) { toast(r.error.message); return; }
    toast(`Invoice ${r.data.invoice_no} created`); refresh();
  }

  async function savePayment() {
    if (!deal || !pay) return;
    const amount = num(pay.amount), recover = num(pay.recover);
    if (!(amount > 0)) return setErr("Enter the amount.");
    if (recover > amount) return setErr("The advance recovered cannot be more than the commission being paid.");
    setBusy(true); setErr("");
    const note = [pay.note.trim(), recover ? `AED ${recover.toLocaleString("en-US")} kept back against advance` : ""].filter(Boolean).join(" · ") || null;
    const r = await db.from("crm_deal_payments").insert({ deal_id: deal.id, kind: pay.kind, email: pay.kind === "payout" ? pay.email : null, amount, paid_on: pay.date, method: pay.method || null, note });
    if (r.error) { setBusy(false); return setErr(r.error.message); }
    if (pay.kind === "received") {
      // Keep the deal's tax invoice in step with the money received.
      const inv = (invoices.data || []).find((i) => i.status !== "cancelled");
      if (inv) { const paid = r2(num(inv.paid) + amount); await db.from("crm_invoices").update({ paid, status: paid >= num(inv.total) ? "paid" : "part_paid" }).eq("id", inv.id); }
    }
    if (recover && pay.email) {
      // Oldest advances first.
      let left = recover;
      for (const a of (advances.data || []).filter((x) => (x.staff_email || "").toLowerCase() === pay.email && num(x.amount) > num(x.recovered)).sort((x, y) => x.expense_date.localeCompare(y.expense_date))) {
        if (left <= 0) break;
        const take = Math.min(left, num(a.amount) - num(a.recovered));
        await db.from("crm_expenses").update({ recovered: r2(num(a.recovered) + take) }).eq("id", a.id);
        left = r2(left - take);
      }
    }
    setBusy(false); setPay(null);
    toast(pay.kind === "received" ? "Money received recorded" : "Payout recorded"); refresh();
  }

  async function cancelDeal() {
    if (!deal || !(await ask({ title: `Cancel deal #${deal.deal_no}?`, hint: "It stays in the records, marked Cancelled, and no longer counts.", yes: "Cancel deal", danger: true }))) return;
    const r = await db.from("crm_deals").update({ status: "cancelled" }).eq("id", deal.id);
    if (r.error) { toast(r.error.message); return; }
    const a = await db.from("crm_approvals").select("id,requested_by").eq("ref_table", "crm_deals").eq("ref_id", deal.id).eq("status", "pending").maybeSingle();
    if (a.data && a.data.requested_by?.toLowerCase() === me?.email) await db.rpc("crm_withdraw_approval", { p_id: a.data.id });
    toast("Deal cancelled"); refresh();
  }

  async function markGoaml() {
    if (!deal) return;
    const ref = window.prompt("goAML report reference number");
    if (!ref?.trim()) return;
    const r = await db.from("crm_deals").update({ goaml_status: "reported", goaml_ref: ref.trim() }).eq("id", deal.id);
    if (r.error) toast(r.error.message); else { toast("Marked as reported"); refresh(); }
  }

  const mine = deal?.created_by.toLowerCase() === me?.email;
  const canEdit = !!deal && ((mine && ["pending", "rejected"].includes(deal.status)) || (finance && !["cancelled"].includes(deal.status)));
  const dm = deal ? dealMoney(deal) : money;
  const sp = splits.data || [];
  const company = deal ? r2(num(deal.office_commission) - sp.reduce((s, l) => s + num(l.amount), 0)) : 0;
  const kycNeeded = deal ? kycParties(deal.deal_type) : [];
  const kycOpen = kycNeeded.filter((p) => (kyc.data || []).find((k) => k.party === p)?.status !== "complete");
  const active = deal && !["pending", "rejected", "cancelled"].includes(deal.status);

  const form = (
    <div className="space-y-5">
      <div className="grid sm:grid-cols-2 gap-3">
        <Field label="Deal type" className="sm:col-span-2">
          <Select value={f.deal_type} onChange={(e) => setType(e.target.value as DealType)} disabled={!!deal && deal.status !== "pending" && deal.status !== "rejected"}>
            {Object.entries(DEAL_TYPES).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
          </Select>
          <span className="mt-1 block text-xs text-ink-3">{type.hint}</span>
        </Field>
        <Field label="Client name"><Input value={f.client_name} onChange={set("client_name")} /></Field>
        <Field label="Client phone"><Input value={f.client_phone} onChange={set("client_phone")} /></Field>
        <Field label="Community / project"><Input value={f.community} onChange={set("community")} /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Cluster"><Input value={f.cluster} onChange={set("cluster")} /></Field>
          <Field label="Unit"><Input value={f.unit} onChange={set("unit")} /></Field>
        </div>
        <Field label="Deal date"><Input type="date" value={f.deal_date} onChange={set("deal_date")} /></Field>
        <Field label={type.priceLabel}><Input inputMode="decimal" value={f.price} onChange={(e) => setPrice(e.target.value)} placeholder="AED" /></Field>
        {f.deal_type === "offplan" && (
          <Field label="Developer" className="sm:col-span-2">
            <Select value={f.developer_id} onChange={(e) => pickDeveloper(e.target.value)}>
              <option value="">Choose…</option>
              {(developers.data || []).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </Select>
            {dev ? <span className="mt-1 block text-xs text-ink-3">Slab suggested from this period&apos;s sales. Usually pays {dev.pay_days} days after the buyer reaches 20%.</span>
              : <span className="mt-1 block text-xs text-ink-3">Developers and their slabs are added by Accounts in the Developers tab.</span>}
          </Field>
        )}
      </div>

      <Section title="Commission (before VAT)">
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          <Field label="%"><Input inputMode="decimal" value={f.commission_pct} onChange={(e) => setPct(e.target.value)} /></Field>
          <Field label="Commission AED"><Input inputMode="decimal" value={f.commission} onChange={(e) => setCommission(e.target.value)} /></Field>
          {f.deal_type === "secondary" && <Field label="Seller fee AED (optional)"><Input inputMode="decimal" value={f.seller_fee} onChange={set("seller_fee")} /></Field>}
        </div>
        <div className="grid sm:grid-cols-3 gap-3 mt-3">
          <Field label="Other agency">
            <Select value={f.other_agency_direction} onChange={set("other_agency_direction")}>
              <option value="">None</option>
              <option value="we_pay">We collect and pay them</option>
              <option value="they_pay">They collect and pay us</option>
            </Select>
          </Field>
          {f.other_agency_direction && <>
            <Field label="Agency name"><Input value={f.other_agency} onChange={set("other_agency")} /></Field>
            <Field label={f.other_agency_direction === "we_pay" ? "Their share AED" : "Their share AED (for the record)"}><Input inputMode="decimal" value={f.other_agency_amount} onChange={set("other_agency_amount")} /></Field>
          </>}
        </div>
        {f.other_agency_direction === "they_pay" && <div className="mt-2 text-xs text-ink-3">Type our agreed share as the commission above. We invoice the other agency for it.</div>}
      </Section>

      {f.deal_type !== "holiday_home" && (
        <Section title="Our agents" action={<button type="button" onClick={() => setAgents((a) => [...a, { email: "", share_pct: a.length ? "" : "100", rate_pct: "" }])} className="inline-flex items-center gap-1 text-[13px] font-medium text-accent-text"><Plus size={14} /> Add agent</button>}>
          {!agents.length && <div className="text-sm text-ink-3">No agent on this deal: the whole office commission is company income.</div>}
          <div className="space-y-2">
            {agents.map((a, i) => (
              <div key={i} className="flex items-end gap-2">
                <Field label={i ? "" : "Agent"} className="flex-1 min-w-0">
                  <Select value={a.email} onChange={(e) => setAgents((l) => l.map((x, n) => (n === i ? { ...x, email: e.target.value } : x)))}>
                    <option value="">Choose…</option>
                    {(staff.data || []).map((u) => <option key={u.email} value={u.email.toLowerCase()}>{u.name || u.email}</option>)}
                  </Select>
                </Field>
                <Field label={i ? "" : "% of deal"} className="w-24"><Input inputMode="decimal" value={a.share_pct} onChange={(e) => setAgents((l) => l.map((x, n) => (n === i ? { ...x, share_pct: e.target.value } : x)))} /></Field>
                {finance && <Field label={i ? "" : "Rate %"} className="w-24"><Input inputMode="decimal" value={a.rate_pct} placeholder={String(rates.find((r) => r.email.toLowerCase() === a.email)?.commission_rate ?? 50)} onChange={(e) => setAgents((l) => l.map((x, n) => (n === i ? { ...x, rate_pct: e.target.value } : x)))} /></Field>}
                <button type="button" aria-label="Remove agent" onClick={() => setAgents((l) => l.filter((_, n) => n !== i))} className="h-9 px-2 text-ink-3 hover:text-bad"><Trash2 size={16} /></button>
              </div>
            ))}
          </div>
        </Section>
      )}

      <div className="rounded-2xl bg-surface-2 p-4">
        <Line label="Commission before VAT" value={aed(money.gross)} />
        <Line label="VAT 5% (kept separate, never split)" value={aed(money.vat)} />
        <Line label={f.other_agency_direction === "they_pay" ? "To invoice the other agency" : "To collect from the client"} value={aed(money.due)} />
        {money.otherAgency > 0 && <Line label="Other agency's share" value={`− ${aed(money.otherAgency)}`} />}
        <Line label="Office commission" value={aed(money.office)} strong />
        {finance ? <>
          {preview.lines.map((l) => <Line key={l.kind + l.email} label={`${staffName(staff.data, l.email)} · ${l.kind === "agent" ? `${l.share_pct}% of deal × ${l.rate_pct}% rate` : `team leader ${l.rate_pct}% of company share`}`} value={aed(l.amount)} />)}
          <Line label="Company share" value={aed(preview.company)} strong tone="good" />
        </> : agents.length > 0 && <div className="mt-2 text-xs text-ink-3">Each agent&apos;s amount is worked out from their own rate when the deal is saved.</div>}
      </div>

      <div className="grid sm:grid-cols-3 gap-3">
        <Field label="How the client pays">
          <Select value={f.payment_method} onChange={set("payment_method")}><option value="bank">Bank transfer</option><option value="cheque">Cheque</option><option value="cash">Cash</option><option value="mortgage">Mortgage</option><option value="mixed">Mixed</option></Select>
        </Field>
        <Field label="Cash part of the deal AED"><Input inputMode="decimal" value={f.cash_amount} onChange={set("cash_amount")} placeholder="0" /></Field>
        <Field label="Commission expected on"><Input type="date" value={f.expected_on} onChange={set("expected_on")} /></Field>
      </div>
      {goaml && <div className="flex gap-2 rounded-xl bg-warn-soft text-warn text-sm p-3"><AlertTriangle size={16} className="shrink-0 mt-0.5" />Cash of AED 55,000 or more: this deal will be flagged for a goAML report.</div>}
      <Field label="Notes"><Textarea rows={2} value={f.notes} onChange={set("notes")} /></Field>
      <FormError>{err}</FormError>
    </div>
  );

  const overview = deal && (
    <div className="space-y-5">
      {deal.status === "pending" && kycOpen.length > 0 && (
        <div className="flex gap-2 rounded-xl bg-warn-soft text-warn text-sm p-3"><AlertTriangle size={16} className="shrink-0 mt-0.5" /><span>KYC still needed for the {kycOpen.map(partyLabel).join(" and ").toLowerCase()}. The deal cannot be approved until it is complete.</span></div>
      )}
      {deal.goaml_status === "needed" && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl bg-bad-soft text-bad text-sm p-3"><AlertTriangle size={16} /><span className="flex-1 min-w-48">Cash of {aed(deal.cash_amount)}: a goAML report is required.</span>{officer && <Button size="sm" onClick={markGoaml}>Mark reported</Button>}</div>
      )}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 text-sm">
        <div><div className="text-xs text-ink-3">Client</div><div className="text-ink">{deal.client_name}</div><div className="text-ink-3 num">{deal.client_phone}</div></div>
        <div><div className="text-xs text-ink-3">Property</div><div className="text-ink">{[deal.community, deal.cluster, deal.unit].filter(Boolean).join(" · ") || "—"}</div></div>
        <div><div className="text-xs text-ink-3">{DEAL_TYPES[deal.deal_type].priceLabel}</div><div className="text-ink num">{aed(deal.price)}</div></div>
        <div><div className="text-xs text-ink-3">Deal date</div><div className="text-ink num">{fmtDate(deal.deal_date)}</div></div>
        <div><div className="text-xs text-ink-3">Submitted by</div><div className="text-ink">{staffName(staff.data, deal.created_by)}</div></div>
        <div><div className="text-xs text-ink-3">Expected on</div><div className="text-ink num">{fmtDate(deal.expected_on)}</div></div>
        {deal.other_agency && <div className="col-span-2"><div className="text-xs text-ink-3">Other agency</div><div className="text-ink">{deal.other_agency} · {deal.other_agency_direction === "we_pay" ? `we pay them ${aed(deal.other_agency_amount)}` : "they collect and pay us"}</div></div>}
        {deal.goaml_ref && <div><div className="text-xs text-ink-3">goAML reference</div><div className="text-ink num">{deal.goaml_ref}</div></div>}
      </div>
      {deal.notes && <div className="text-sm text-ink-2 whitespace-pre-wrap">{deal.notes}</div>}

      <div className="rounded-2xl bg-surface-2 p-4">
        <Line label="Commission before VAT" value={aed(dm.gross)} />
        <Line label="VAT 5%" value={aed(dm.vat)} />
        {dm.otherAgency > 0 && <Line label="Other agency's share" value={`− ${aed(dm.otherAgency)}`} />}
        <Line label="Office commission" value={aed(dm.office)} strong />
        {sp.map((l) => (
          <Line key={l.id} label={`${staffName(staff.data, l.email)} · ${l.kind === "agent" ? `${num(l.share_pct)}% of deal × ${num(l.rate_pct)}% rate` : `team leader ${num(l.rate_pct)}% of company share`}`}
            hint={num(l.paid) ? `Paid ${aed(l.paid)}` : undefined} value={aed(l.amount)} />
        ))}
        {(finance || approver) && <Line label="Company share" value={aed(company)} strong tone="good" />}
      </div>
    </div>
  );

  const moneyTab = deal && (
    <div className="space-y-5">
      <div className="rounded-2xl bg-surface-2 p-4">
        <Line label="Due from the client (commission + VAT)" value={aed(dm.due)} />
        <Line label="Received so far" value={aed(deal.received)} tone={num(deal.received) >= dm.due ? "good" : undefined} />
        <Line label="Still to come" value={aed(Math.max(0, r2(dm.due - num(deal.received))))} strong />
      </div>
      {finance && active && (
        <div className="flex flex-wrap gap-2">
          {!(invoices.data || []).some((i) => i.status !== "cancelled") && <Button onClick={makeInvoice}><FileText size={15} /> Create tax invoice</Button>}
          <Button variant="primary" onClick={() => { setErr(""); setPay({ kind: "received", amount: String(Math.max(0, r2(dm.due - num(deal.received)))), date: todayDubai(), method: deal.payment_method || "bank", note: "", recover: "" }); }}><Plus size={15} /> Money received</Button>
        </div>
      )}
      {(invoices.data || []).map((i) => (
        <Link key={i.id} href={`/accounts?tab=invoices&open=${i.id}`} className="flex items-center justify-between gap-3 rounded-xl border border-line px-3 py-2.5 text-sm hover:border-line-strong">
          <span className="flex items-center gap-2 text-ink"><FileText size={15} className="text-ink-3" /> {i.invoice_no}</span><span className="num text-ink-2">{aed(i.total)} · {i.status.replace("_", " ")}</span>
        </Link>
      ))}

      <Section title="Commission to pay">
        {!sp.length ? <div className="text-sm text-ink-3">No agent share on this deal.</div> : (
          <div className="rounded-xl border border-line divide-y divide-line">
            {sp.map((l) => {
              const now = payableNow(deal, l), owed = advancesOwed(advances.data || [], l.email);
              return (
                <div key={l.id} className="flex flex-wrap items-center gap-3 px-3 py-2.5 text-sm">
                  <div className="flex-1 min-w-40"><div className="text-ink">{staffName(staff.data, l.email)}</div>
                    <div className="text-xs text-ink-3 num">{aed(l.amount)} earned · {aed(l.paid)} paid{owed > 0 && finance ? ` · advance outstanding ${aed(owed)}` : ""}</div></div>
                  {finance && active && now > 0 ? (
                    <Button size="sm" variant="primary" onClick={() => { setErr(""); setPay({ kind: "payout", email: l.email, amount: String(now), max: now, date: todayDubai(), method: "bank", note: "", recover: owed > 0 ? String(Math.min(owed, now)) : "" }); }}>Pay {aed(now)}</Button>
                  ) : <span className="text-xs text-ink-3">{num(l.paid) >= num(l.amount) && num(l.amount) > 0 ? "Paid in full" : "Paid as the client's money arrives"}</span>}
                </div>
              );
            })}
          </div>
        )}
      </Section>

      {pay && (
        <div className="rounded-2xl border border-accent/40 p-4">
          <div className="font-medium text-ink mb-3">{pay.kind === "received" ? "Money received from the client" : `Pay ${staffName(staff.data, pay.email)}`}</div>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <Field label="Amount AED"><Input inputMode="decimal" value={pay.amount} onChange={(e) => setPay({ ...pay, amount: e.target.value })} /></Field>
            <Field label="Date"><Input type="date" value={pay.date} onChange={(e) => setPay({ ...pay, date: e.target.value })} /></Field>
            <Field label="Method"><Select value={pay.method} onChange={(e) => setPay({ ...pay, method: e.target.value })}><option value="bank">Bank transfer</option><option value="cheque">Cheque</option><option value="cash">Cash</option></Select></Field>
            {pay.kind === "payout" && <Field label="Of which kept against advance"><Input inputMode="decimal" value={pay.recover} onChange={(e) => setPay({ ...pay, recover: e.target.value })} placeholder="0" /></Field>}
            <Field label="Note" className="col-span-2"><Input value={pay.note} onChange={(e) => setPay({ ...pay, note: e.target.value })} /></Field>
          </div>
          {pay.kind === "payout" && num(pay.recover) > 0 && <div className="mt-2 text-xs text-ink-3">Transfer to the agent: {aed(Math.max(0, r2(num(pay.amount) - num(pay.recover))))}</div>}
          <FormError>{err}</FormError>
          <div className="mt-3 flex justify-end gap-2"><Button variant="ghost" onClick={() => setPay(null)}>Cancel</Button><Button variant="primary" onClick={savePayment} disabled={busy}>{busy && <Loader2 size={15} className="animate-spin" />}Save</Button></div>
        </div>
      )}

      <Section title="History">
        {!(payments.data || []).length ? <div className="text-sm text-ink-3">No payments recorded yet.</div> : (
          <div className="rounded-xl border border-line divide-y divide-line">
            {(payments.data || []).map((p) => (
              <div key={p.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                <div><div className="text-ink">{p.kind === "received" ? "Received from client" : p.kind === "payout" ? `Paid to ${staffName(staff.data, p.email)}` : "Paid to other agency"}</div>
                  <div className="text-xs text-ink-3">{fmtDate(p.paid_on)}{p.method ? ` · ${p.method}` : ""}{p.note ? ` · ${p.note}` : ""}</div></div>
                <div className={`num ${p.kind === "received" ? "text-good" : "text-ink"}`}>{p.kind === "received" ? "+" : "−"} {aed(p.amount)}</div>
              </div>
            ))}
          </div>
        )}
      </Section>
    </div>
  );

  const kycTab = deal && (
    <div className="space-y-3">
      {!kycNeeded.length ? <div className="text-sm text-ink-3">This type of deal needs no KYC.</div>
        : kycNeeded.map((p) => <KycForm key={p} dealId={deal.id} party={p} row={(kyc.data || []).find((k) => k.party === p)} canEdit={mine && ["pending", "rejected"].includes(deal.status)} />)}
    </div>
  );

  const showForm = isNew || editing;
  return (
    <>
      <Sheet open={open} onClose={onClose} large
        title={isNew ? "Record a deal" : deal ? <span className="flex items-center gap-2 flex-wrap">Deal #{deal.deal_no} <Badge tone={DEAL_TONE[deal.status]}>{DEAL_STATUS[deal.status]}</Badge></span> : "Deal"}
        subheader={!showForm && deal ? <div className="px-5 pt-3"><Tabs value={tab} onChange={setTab} options={[{ value: "overview", label: "Overview" }, { value: "money", label: "Money" }, { value: "kyc", label: "KYC", n: kycOpen.length || undefined }]} /></div> : undefined}
        footer={showForm ? <>
          <Button variant="ghost" onClick={isNew ? onClose : () => { setEditing(false); setErr(""); }}>Cancel</Button>
          <Button variant="primary" onClick={save} disabled={busy}>{busy && <Loader2 size={15} className="animate-spin" />}{isNew ? "Send for approval" : deal?.status === "rejected" ? "Save and send again" : "Save changes"}</Button>
        </> : deal && tab === "overview" ? <>
          {(finance || (mine && deal.status === "pending")) && !["cancelled", "agents_paid"].includes(deal.status) && <Button variant="ghost" onClick={cancelDeal}><X size={15} /> Cancel deal</Button>}
          {canEdit && <Button onClick={startEdit}>Edit</Button>}
          {deal.status === "pending" && approver && (!mine || me?.isAdmin) && <>
            <Button onClick={() => decide(false)}>Reject</Button>
            <Button variant="primary" onClick={() => decide(true)}><Check size={15} /> Approve</Button>
          </>}
          {deal.status === "pending" && !approver && <Link href="/approvals" className={buttonClass("secondary")}>Waiting for approval</Link>}
        </> : undefined}>
        {showForm ? form : !deal ? <div className="text-sm text-ink-3">This deal was not found, or you don&apos;t have access to it.</div> : tab === "overview" ? overview : tab === "money" ? moneyTab : kycTab}
      </Sheet>
      {confirmNode}
    </>
  );
}

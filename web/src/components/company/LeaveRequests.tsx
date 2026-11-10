"use client";

import { useState } from "react";
import { Loader2, Palmtree, Plus } from "lucide-react";
import { db } from "@/lib/supabase";
import { useAuth } from "@/components/Providers";
import { Badge, Button, Empty, Field, Input, Select, Sheet, Textarea } from "@/components/ui";
import { useToast } from "@/components/ContactKit";
import { DataTable, FormError, SIMPLE_TONE } from "./kit";
import { isHr, requestApproval, useRefresh, useRows } from "@/lib/company/data";
import { LEAVE_TYPES, leaveBalance, leaveDays, type Leave, type Staff } from "@/lib/company/calc";
import { fmtDate, todayDubai } from "@/lib/format";

/** Leave requests: the person asks, their manager or HR approves. `mineOnly` = the signed-in person's own leave. */
export function LeaveRequests({ mineOnly }: { mineOnly?: boolean }) {
  const { me } = useAuth();
  const toast = useToast();
  const refresh = useRefresh();
  const hr = isHr(me) && !mineOnly;
  const staff = useRows<Staff>("crm_staff", { key: ["all"] });
  const leave = useRows<Leave>("crm_leave", { order: "start_date" });
  const myRecord = (staff.data || []).find((s) => (s.email || "").toLowerCase() === me?.email);
  const [open, setOpen] = useState(false);
  const blank = { staff_id: "", leave_type: "Annual", start_date: todayDubai(), end_date: todayDubai(), reason: "" };
  const [f, setF] = useState(blank);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const today = todayDubai();
  const name = (id: string) => (staff.data || []).find((s) => s.id === id)?.full_name || "—";
  const rows = (leave.data || []).filter((l) => !mineOnly || l.staff_id === myRecord?.id);
  const days = leaveDays(f.start_date, f.end_date);
  const who = hr ? (staff.data || []).find((s) => s.id === f.staff_id) : myRecord;
  const bal = who ? leaveBalance(who, (leave.data || []).filter((l) => l.staff_id === who.id), today) : null;

  async function save() {
    if (!who) return setErr(hr ? "Choose the person." : "Your staff record has not been set up yet. Ask HR to add it.");
    if (!days) return setErr("The last day must be on or after the first day.");
    setBusy(true); setErr("");
    const r = await db.from("crm_leave").insert({ staff_id: who.id, leave_type: f.leave_type, start_date: f.start_date, end_date: f.end_date, days, reason: f.reason.trim() || null, status: "pending" }).select("id").single();
    if (r.error) { setBusy(false); return setErr(r.error.message); }
    try {
      await requestApproval({ kind: "leave", ref_table: "crm_leave", ref_id: r.data.id, title: `${f.leave_type} leave · ${who.full_name}`,
        summary: `${fmtDate(f.start_date)} to ${fmtDate(f.end_date)} (${days} day${days === 1 ? "" : "s"})${f.reason.trim() ? `\n${f.reason.trim()}` : ""}` });
    } catch (x) { setBusy(false); return setErr(`Saved, but it could not be sent for approval: ${(x as Error).message}`); }
    setBusy(false); setOpen(false); toast("Leave request sent"); refresh();
  }
  async function cancel(l: Leave) {
    const a = await db.from("crm_approvals").select("id").eq("ref_table", "crm_leave").eq("ref_id", l.id).eq("status", "pending").maybeSingle();
    const r = a.data ? await db.rpc("crm_withdraw_approval", { p_id: a.data.id }) : await db.from("crm_leave").update({ status: "cancelled" }).eq("id", l.id);
    if (r.error) toast(r.error.message); else { toast("Request withdrawn"); refresh(); }
  }

  const myBal = mineOnly && myRecord ? leaveBalance(myRecord, rows, today) : null;
  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
        <div className="text-sm text-ink-2">{myBal ? <>Annual leave balance <span className="num font-semibold text-ink">{myBal.balance} days</span> <span className="text-ink-3">({myBal.earned} earned, {myBal.taken} taken)</span></> : mineOnly && !myRecord ? "Your staff record has not been set up yet." : ""}</div>
        <Button variant="primary" onClick={() => { setF(blank); setErr(""); setOpen(true); }}><Plus size={15} /> Request leave</Button>
      </div>
      <DataTable rows={rows} empty={<Empty icon={<Palmtree size={28} />} title="No leave requests" />} cols={[
        ...(mineOnly ? [] : [{ h: "Person", cell: (l: Leave) => <span className="font-medium">{name(l.staff_id)}</span> }]),
        { h: "Type", cell: (l) => l.leave_type },
        { h: "From", cell: (l) => <span className="num whitespace-nowrap">{fmtDate(l.start_date)}</span> },
        { h: "To", cell: (l) => <span className="num whitespace-nowrap">{fmtDate(l.end_date)}</span> },
        { h: "Days", right: true, cell: (l) => l.days },
        { h: "Reason", cell: (l) => <span className="text-ink-2">{l.reason}</span> },
        { h: "Status", cell: (l) => <span className="flex items-center gap-2"><Badge tone={SIMPLE_TONE[l.status]}>{l.status}</Badge>{l.status === "pending" && l.created_by.toLowerCase() === me?.email && <button className="text-xs text-ink-3 hover:text-ink" onClick={() => cancel(l)}>withdraw</button>}</span> },
      ]} />

      <Sheet open={open} onClose={() => setOpen(false)} title="Request leave" footer={<>
        <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
        <Button variant="primary" onClick={save} disabled={busy}>{busy && <Loader2 size={15} className="animate-spin" />}Send for approval</Button>
      </>}>
        <div className="grid sm:grid-cols-2 gap-3">
          {hr && <Field label="Person" className="sm:col-span-2"><Select value={f.staff_id} onChange={(e) => setF({ ...f, staff_id: e.target.value })}><option value="">Choose…</option>{(staff.data || []).filter((s) => s.status === "active").map((s) => <option key={s.id} value={s.id}>{s.full_name}</option>)}</Select></Field>}
          <Field label="Type" className="sm:col-span-2"><Select value={f.leave_type} onChange={(e) => setF({ ...f, leave_type: e.target.value })}>{LEAVE_TYPES.map((t) => <option key={t}>{t}</option>)}</Select></Field>
          <Field label="First day"><Input type="date" value={f.start_date} onChange={(e) => setF({ ...f, start_date: e.target.value, end_date: e.target.value > f.end_date ? e.target.value : f.end_date })} /></Field>
          <Field label="Last day"><Input type="date" value={f.end_date} onChange={(e) => setF({ ...f, end_date: e.target.value })} /></Field>
          <Field label="Reason" className="sm:col-span-2"><Textarea rows={2} value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} /></Field>
        </div>
        <div className="mt-3 text-sm text-ink-2">{days} calendar day{days === 1 ? "" : "s"}{bal && f.leave_type === "Annual" ? <> · balance now <span className="num text-ink font-medium">{bal.balance}</span>, after this <span className={`num font-medium ${bal.balance - days < 0 ? "text-bad" : "text-ink"}`}>{Math.round((bal.balance - days) * 10) / 10}</span></> : null}</div>
        <FormError>{err}</FormError>
      </Sheet>
    </>
  );
}

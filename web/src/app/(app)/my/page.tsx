"use client";

import { useState } from "react";
import { useAuth } from "@/components/Providers";
import { Badge, Card, PageHeader, Tabs } from "@/components/ui";
import { DataTable, FileField, SetupNeeded } from "@/components/company/kit";
import { Expenses } from "@/components/company/Expenses";
import { LeaveRequests } from "@/components/company/LeaveRequests";
import { useRows } from "@/lib/company/data";
import { expiryState, monthLabel, type PayrollLine, type PayrollRun, type Staff, type StaffDoc } from "@/lib/company/calc";
import { aed, fmtDate, todayDubai } from "@/lib/format";

/** Everyone's own corner: claim an expense, ask for an advance or leave, see their documents and payslips. */
export default function MyPage() {
  const { me } = useAuth();
  const [tab, setTab] = useState<"expenses" | "leave" | "documents" | "pay">("expenses");
  const staff = useRows<Staff>("crm_staff", { key: ["all"] });
  const docs = useRows<StaffDoc>("crm_staff_documents", { order: "expiry_date", asc: true });
  const runs = useRows<PayrollRun>("crm_payroll_runs", { order: "month" });
  const lines = useRows<PayrollLine>("crm_payroll_lines");
  const mine = (staff.data || []).find((s) => (s.email || "").toLowerCase() === me?.email);
  const today = todayDubai();

  if (staff.data === null) return <><PageHeader title="My requests" /><SetupNeeded what="This page" /></>;
  const payslips = (lines.data || []).filter((l) => l.staff_id === mine?.id).map((l) => ({ ...l, run: (runs.data || []).find((r) => r.id === l.run_id) })).filter((l) => l.run?.status === "final")
    .sort((a, b) => b.run!.month.localeCompare(a.run!.month));
  return (
    <div className="animate-in">
      <PageHeader title="My requests" subtitle="Expenses, advances, leave, and your own documents and pay" />
      <Tabs className="mb-4" value={tab} onChange={setTab} options={[{ value: "expenses", label: "Expenses & advances" }, { value: "leave", label: "Leave" }, { value: "documents", label: "My documents" }, { value: "pay", label: "My pay" }]} />
      {tab === "expenses" && <Expenses mineOnly />}
      {tab === "leave" && <LeaveRequests mineOnly />}
      {tab === "documents" && (!mine ? <Card className="p-6 text-sm text-ink-3">Your staff record has not been set up yet. HR adds it, with your visa, Emirates ID and other documents.</Card> : (
        <DataTable rows={(docs.data || []).filter((d) => d.staff_id === mine.id)} cols={[
          { h: "Document", cell: (d) => <span className="font-medium">{d.doc_type}</span> },
          { h: "Number", cell: (d) => <span className="num text-ink-2">{d.doc_number}</span> },
          { h: "Expires", cell: (d) => <span className="num whitespace-nowrap">{fmtDate(d.expiry_date)}</span> },
          { h: "", cell: (d) => { const s = expiryState(d.expiry_date, today); return <Badge tone={s.tone}>{s.text}</Badge>; } },
          { h: "Copy", cell: (d) => <FileField path={d.file_path} disabled onPick={async () => {}} /> },
        ]} />
      ))}
      {tab === "pay" && (
        <DataTable rows={payslips} cols={[
          { h: "Month", cell: (l) => <span className="font-medium">{monthLabel(l.run!.month)}</span> },
          { h: "Basic", right: true, cell: (l) => aed(l.basic) }, { h: "Allowances", right: true, cell: (l) => aed(l.allowances) }, { h: "Commission", right: true, cell: (l) => aed(l.commission) },
          { h: "Advance recovered", right: true, cell: (l) => aed(l.advance_recovery) }, { h: "Deductions", right: true, cell: (l) => aed(l.deductions) },
          { h: "Net pay", right: true, cell: (l) => <span className="font-semibold">{aed(l.net)}</span> },
          { h: "", cell: (l) => <Badge tone={l.paid ? "good" : "warn"}>{l.paid ? "Paid" : "Not paid yet"}</Badge> },
        ]} />
      )}
    </div>
  );
}

"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { BadgeCheck, Loader2, Plus, Trash2 } from "lucide-react";
import { db } from "@/lib/supabase";
import { useAuth } from "@/components/Providers";
import { useStaff } from "@/lib/hooks";
import { Avatar, Badge, Button, Empty, Field, Input, ListSkeleton, PageHeader, Select, Sheet, Stat, Tabs, Textarea } from "@/components/ui";
import { useToast } from "@/components/ContactKit";
import { useConfirm } from "@/components/Confirm";
import { DataTable, FileField, FormError, Line, Section, SetupNeeded, SIMPLE_TONE } from "@/components/company/kit";
import { LeaveRequests } from "@/components/company/LeaveRequests";
import { isFinance, uploadDoc, useRefresh, useRows } from "@/lib/company/data";
import {
  COUNTED, DOC_TYPES, PAY_METHODS, SALARY_TYPES, advancesOwed, expiryState, finalSettlement, gratuity, leaveBalance, num, r2,
  type Deal, type Expense, type Leave, type Split, type Staff, type StaffDoc,
} from "@/lib/company/calc";
import { aed, fmtDate, todayDubai } from "@/lib/format";
import { Payroll } from "./Payroll";
import { Recruitment } from "./Recruitment";

type Tab = "staff" | "documents" | "leave" | "payroll" | "recruitment";

export default function HrPage() {
  return <Suspense><Hr /></Suspense>;
}

function Hr() {
  const router = useRouter();
  const params = useSearchParams();
  const tab = (params.get("tab") as Tab) || "staff";
  const setTab = (t: Tab) => router.replace(t === "staff" ? "/hr" : `/hr?tab=${t}`, { scroll: false });
  const staff = useRows<Staff>("crm_staff", { key: ["all"], order: "full_name", asc: true });
  const docs = useRows<StaffDoc>("crm_staff_documents", { order: "expiry_date", asc: true });
  const leave = useRows<Leave>("crm_leave", { order: "start_date" });
  const [open, setOpen] = useState<string | null>(null);
  const today = todayDubai();

  const people = useMemo(() => staff.data || [], [staff.data]);
  const expiring = useMemo(() => (docs.data || []).map((d) => ({ ...d, state: expiryState(d.expiry_date, today), person: people.find((s) => s.id === d.staff_id) }))
    .filter((d) => d.person?.status === "active" && (d.state.tone === "bad" || d.state.tone === "warn")), [docs.data, people, today]);
  const onLeave = (leave.data || []).filter((l) => l.status === "approved" && l.start_date <= today && l.end_date >= today);

  if (staff.isLoading) return <><PageHeader title="HR" /><ListSkeleton /></>;
  if (staff.data === null) return <><PageHeader title="HR" /><SetupNeeded what="HR" /></>;

  return (
    <div className="animate-in">
      <PageHeader title="HR" subtitle="Staff, documents, leave, payroll and recruitment"
        actions={tab === "staff" && <Button variant="primary" onClick={() => setOpen("new")}><Plus size={16} /> Add staff</Button>} />
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
        <Stat label="Active staff" value={String(people.filter((s) => s.status === "active").length)} />
        <Stat label="Documents expiring or expired" value={String(expiring.length)} tone={expiring.some((d) => d.state.tone === "bad") ? "bad" : expiring.length ? "warn" : undefined} hint="Within 30 days" />
        <Stat label="Leave requests waiting" value={String((leave.data || []).filter((l) => l.status === "pending").length)} />
        <Stat label="On leave today" value={String(onLeave.length)} />
      </div>
      <Tabs className="mb-4" value={tab} onChange={setTab} options={[
        { value: "staff", label: "Staff", n: people.length }, { value: "documents", label: "Documents", n: expiring.length || undefined }, { value: "leave", label: "Leave" },
        { value: "payroll", label: "Payroll" }, { value: "recruitment", label: "Recruitment" },
      ]} />

      {tab === "staff" && (
        <DataTable rows={people} onRow={(s) => setOpen(s.id)} empty={<Empty icon={<BadgeCheck size={28} />} title="No staff records yet" hint="Add each person with their salary type, commission rate and documents." />} cols={[
          { h: "Name", cell: (s) => <span className="flex items-center gap-2.5"><Avatar name={s.full_name} size={28} /><span><span className="font-medium block">{s.full_name}</span><span className="text-xs text-ink-3">{s.job_title}</span></span></span> },
          { h: "Joined", cell: (s) => <span className="num whitespace-nowrap text-ink-2">{fmtDate(s.join_date)}</span> },
          { h: "Salary", cell: (s) => <span className="text-ink-2 whitespace-nowrap">{SALARY_TYPES[s.salary_type]}</span> },
          { h: "Basic", right: true, cell: (s) => (num(s.basic_salary) ? aed(s.basic_salary) : "—") },
          { h: "Commission rate", right: true, cell: (s) => `${num(s.commission_rate)}%` },
          { h: "Paid by", cell: (s) => <span className="text-ink-2 whitespace-nowrap">{PAY_METHODS[s.pay_method]}</span> },
          { h: "Leave balance", right: true, cell: (s) => `${leaveBalance(s, (leave.data || []).filter((l) => l.staff_id === s.id), today).balance} d` },
          { h: "Status", cell: (s) => <Badge tone={SIMPLE_TONE[s.status]}>{s.status}</Badge> },
        ]} />
      )}
      {tab === "documents" && (
        <DataTable rows={(docs.data || []).map((d) => ({ ...d, state: expiryState(d.expiry_date, today), person: people.find((s) => s.id === d.staff_id) })).filter((d) => d.person)}
          onRow={(d) => setOpen(d.staff_id)} empty={<Empty title="No documents yet" hint="Open a staff record and add their visa, Emirates ID, passport, RERA card, contract and insurance." />} cols={[
            { h: "Person", cell: (d) => <span className="font-medium">{d.person?.full_name}</span> },
            { h: "Document", cell: (d) => d.doc_type },
            { h: "Number", cell: (d) => <span className="num text-ink-2">{d.doc_number}</span> },
            { h: "Expires", cell: (d) => <span className="num whitespace-nowrap">{fmtDate(d.expiry_date)}</span> },
            { h: "", cell: (d) => <Badge tone={d.state.tone}>{d.state.text}</Badge> },
          ]} />
      )}
      {tab === "leave" && <LeaveRequests />}
      {tab === "payroll" && <Payroll />}
      {tab === "recruitment" && <Recruitment onStaff={(id) => { setTab("staff"); setOpen(id); }} />}

      <StaffSheet id={open} staff={people} docs={docs.data || []} leave={leave.data || []} onClose={() => setOpen(null)} onSaved={setOpen} />
    </div>
  );
}

const blankStaff = { email: "", full_name: "", job_title: "", nationality: "", phone: "", join_date: "", end_date: "", status: "active", salary_type: "commission_only", basic_salary: "", allowances: "",
  commission_rate: "50", tl_override_pct: "0", pay_method: "bank", iban: "", bank_code: "", labour_no: "", annual_leave_days: "30", notes: "" };

function StaffSheet({ id, staff, docs, leave, onClose, onSaved }: { id: string | null; staff: Staff[]; docs: StaffDoc[]; leave: Leave[]; onClose: () => void; onSaved: (id: string) => void }) {
  const { me } = useAuth();
  const logins = useStaff();
  const toast = useToast();
  const refresh = useRefresh();
  const [ask, confirmNode] = useConfirm();
  const finance = isFinance(me);
  const s = id && id !== "new" ? staff.find((x) => x.id === id) : undefined;
  const [tab, setTab] = useState<"details" | "documents" | "end">("details");
  const [f, setF] = useState(blankStaff);
  const [doc, setDoc] = useState({ doc_type: "Visa", doc_number: "", issue_date: "", expiry_date: "", file_path: null as string | null });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const today = todayDubai();
  const splits = useRows<Split>("crm_deal_splits", { enabled: !!s && finance });
  const deals = useRows<Deal>("crm_deals", { enabled: !!s && finance });
  const advances = useRows<Expense>("crm_expenses", { key: ["advances"], enabled: !!s && finance, filter: (q) => q.eq("kind", "advance").eq("status", "approved") });

  useEffect(() => {
    if (!id) return;
    setErr(""); setTab("details");
    setF(s ? { email: s.email || "", full_name: s.full_name, job_title: s.job_title || "", nationality: s.nationality || "", phone: s.phone || "", join_date: s.join_date || "", end_date: s.end_date || "", status: s.status,
      salary_type: s.salary_type, basic_salary: num(s.basic_salary) ? String(s.basic_salary) : "", allowances: num(s.allowances) ? String(s.allowances) : "", commission_rate: String(num(s.commission_rate)),
      tl_override_pct: String(num(s.tl_override_pct)), pay_method: s.pay_method, iban: s.iban || "", bank_code: s.bank_code || "", labour_no: s.labour_no || "", annual_leave_days: String(s.annual_leave_days), notes: s.notes || "" } : blankStaff);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, s?.id]);
  const set = (k: keyof typeof blankStaff) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setF((v) => ({ ...v, [k]: e.target.value }));

  async function save() {
    if (!f.full_name.trim()) return setErr("Enter the person's name.");
    setBusy(true); setErr("");
    const body = { email: f.email.trim().toLowerCase() || null, full_name: f.full_name.trim(), job_title: f.job_title.trim() || null, nationality: f.nationality.trim() || null, phone: f.phone.trim() || null,
      join_date: f.join_date || null, end_date: f.end_date || null, status: f.status, salary_type: f.salary_type, basic_salary: num(f.basic_salary), allowances: num(f.allowances), commission_rate: num(f.commission_rate),
      tl_override_pct: num(f.tl_override_pct), pay_method: f.pay_method, iban: f.iban.trim() || null, bank_code: f.bank_code.trim() || null, labour_no: f.labour_no.trim() || null, annual_leave_days: num(f.annual_leave_days) || 30, notes: f.notes.trim() || null };
    const r = s ? await db.from("crm_staff").update(body).eq("id", s.id).select("id").single() : await db.from("crm_staff").insert(body).select("id").single();
    setBusy(false);
    if (r.error) return setErr(r.error.code === "23505" ? "Another staff record already uses this login." : r.error.message);
    toast("Saved"); refresh(); if (!s) onSaved(r.data.id);
  }
  async function addDoc() {
    if (!s) return;
    const r = await db.from("crm_staff_documents").insert({ staff_id: s.id, doc_type: doc.doc_type, doc_number: doc.doc_number.trim() || null, issue_date: doc.issue_date || null, expiry_date: doc.expiry_date || null, file_path: doc.file_path });
    if (r.error) return toast(r.error.message);
    setDoc({ doc_type: "Visa", doc_number: "", issue_date: "", expiry_date: "", file_path: null }); toast("Document added"); refresh();
  }
  async function removeDoc(d: StaffDoc) {
    if (!(await ask({ title: `Remove this ${d.doc_type}?`, hint: "Use this when it has been replaced by a renewed one.", yes: "Remove", danger: true }))) return;
    const r = await db.from("crm_staff_documents").delete().eq("id", d.id);
    if (r.error) toast(r.error.message); else refresh();
  }

  const myDocs = docs.filter((d) => d.staff_id === s?.id);
  const myLeave = leave.filter((l) => l.staff_id === s?.id);
  const end = f.end_date || today;
  const commissionDue = useMemo(() => {
    if (!s?.email) return 0;
    const ok = new Set((deals.data || []).filter((d) => COUNTED.has(d.status)).map((d) => d.id));
    return r2((splits.data || []).filter((x) => x.email.toLowerCase() === s.email!.toLowerCase() && ok.has(x.deal_id)).reduce((t, x) => t + num(x.amount) - num(x.paid), 0));
  }, [s?.email, splits.data, deals.data]);
  const fs = s ? finalSettlement({ ...s, basic_salary: num(f.basic_salary) }, { leave: myLeave, unpaidSalary: 0, commissionDue, advances: s.email ? advancesOwed(advances.data || [], s.email) : 0 }, end) : null;
  const bal = s ? leaveBalance(s, myLeave, today) : null;

  return (
    <>
      <Sheet open={!!id} onClose={onClose} large title={s ? s.full_name : "Add staff"}
        subheader={s ? <div className="px-5 pt-3"><Tabs value={tab} onChange={setTab} options={[{ value: "details", label: "Details" }, { value: "documents", label: "Documents", n: myDocs.length || undefined }, { value: "end", label: "Leave & end of service" }]} /></div> : undefined}
        footer={tab === "details" ? <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={save} disabled={busy}>{busy && <Loader2 size={15} className="animate-spin" />}{s ? "Save changes" : "Add staff"}</Button>
        </> : undefined}>
        {tab === "details" && (
          <div className="space-y-5">
            <div className="grid sm:grid-cols-2 gap-3">
              <Field label="Full name"><Input value={f.full_name} onChange={set("full_name")} /></Field>
              <Field label="Job title"><Input value={f.job_title} onChange={set("job_title")} /></Field>
              <Field label="System login">
                <Select value={f.email} onChange={set("email")}><option value="">No login yet</option>{f.email && !(logins.data || []).some((u) => u.email.toLowerCase() === f.email) && <option value={f.email}>{f.email}</option>}
                  {(logins.data || []).map((u) => <option key={u.email} value={u.email.toLowerCase()}>{u.name || u.email} ({u.email})</option>)}</Select>
              </Field>
              <Field label="Phone"><Input value={f.phone} onChange={set("phone")} /></Field>
              <Field label="Nationality"><Input value={f.nationality} onChange={set("nationality")} /></Field>
              <Field label="Joined on"><Input type="date" value={f.join_date} onChange={set("join_date")} /></Field>
            </div>
            <Section title="Pay">
              <div className="grid sm:grid-cols-3 gap-3">
                <Field label="Salary type"><Select value={f.salary_type} onChange={set("salary_type")}>{Object.entries(SALARY_TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field>
                <Field label="Basic salary / month"><Input inputMode="decimal" value={f.basic_salary} onChange={set("basic_salary")} placeholder="0" /></Field>
                <Field label="Allowances / month"><Input inputMode="decimal" value={f.allowances} onChange={set("allowances")} placeholder="0" /></Field>
                <Field label="Commission rate %"><Input inputMode="decimal" value={f.commission_rate} onChange={set("commission_rate")} /></Field>
                <Field label="Team-leader override %"><Input inputMode="decimal" value={f.tl_override_pct} onChange={set("tl_override_pct")} /></Field>
                <Field label="Annual leave days"><Input inputMode="numeric" value={f.annual_leave_days} onChange={set("annual_leave_days")} /></Field>
                <Field label="Paid by"><Select value={f.pay_method} onChange={set("pay_method")}>{Object.entries(PAY_METHODS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field>
                <Field label="IBAN"><Input value={f.iban} onChange={set("iban")} /></Field>
                {f.pay_method === "wps" && <>
                  <Field label="Their bank's routing code"><Input value={f.bank_code} onChange={set("bank_code")} placeholder="9 digits" /></Field>
                  <Field label="MOHRE personal number"><Input value={f.labour_no} onChange={set("labour_no")} placeholder="14 digits" /></Field>
                </>}
              </div>
              <div className="mt-2 text-xs text-ink-3">Commission rate = their part of the office commission on their deals. Override = a team leader&apos;s % of the company share on their team&apos;s deals.</div>
            </Section>
            {s && <div className="grid sm:grid-cols-2 gap-3">
              <Field label="Status"><Select value={f.status} onChange={set("status")}><option value="active">Active</option><option value="left">Left the company</option></Select></Field>
              <Field label="Last working day"><Input type="date" value={f.end_date} onChange={set("end_date")} /></Field>
            </div>}
            <Field label="Notes"><Textarea rows={2} value={f.notes} onChange={set("notes")} /></Field>
            <FormError>{err}</FormError>
          </div>
        )}

        {tab === "documents" && s && (
          <div className="space-y-4">
            <div className="rounded-xl border border-line divide-y divide-line">
              {!myDocs.length && <div className="px-3 py-3 text-sm text-ink-3">No documents yet.</div>}
              {myDocs.map((d) => { const st = expiryState(d.expiry_date, today); return (
                <div key={d.id} className="flex flex-wrap items-center gap-3 px-3 py-2.5 text-sm">
                  <div className="flex-1 min-w-40"><div className="text-ink font-medium">{d.doc_type}</div><div className="text-xs text-ink-3 num">{[d.doc_number, d.expiry_date ? `expires ${fmtDate(d.expiry_date)}` : ""].filter(Boolean).join(" · ")}</div></div>
                  <Badge tone={st.tone}>{st.text}</Badge>
                  <FileField path={d.file_path} disabled onPick={async () => {}} />
                  <button aria-label="Remove document" onClick={() => removeDoc(d)} className="p-1 text-ink-3 hover:text-bad"><Trash2 size={15} /></button>
                </div>
              ); })}
            </div>
            <div className="rounded-2xl border border-line p-4">
              <div className="font-medium text-ink mb-3">Add a document</div>
              <div className="grid sm:grid-cols-2 gap-3">
                <Field label="Type"><Select value={doc.doc_type} onChange={(e) => setDoc({ ...doc, doc_type: e.target.value })}>{DOC_TYPES.map((t) => <option key={t}>{t}</option>)}</Select></Field>
                <Field label="Number"><Input value={doc.doc_number} onChange={(e) => setDoc({ ...doc, doc_number: e.target.value })} /></Field>
                <Field label="Issued"><Input type="date" value={doc.issue_date} onChange={(e) => setDoc({ ...doc, issue_date: e.target.value })} /></Field>
                <Field label="Expires"><Input type="date" value={doc.expiry_date} onChange={(e) => setDoc({ ...doc, expiry_date: e.target.value })} /></Field>
                <Field label="Copy" className="sm:col-span-2"><FileField path={doc.file_path} label="Upload copy" onPick={async (file) => setDoc({ ...doc, file_path: await uploadDoc("hr", file) })} /></Field>
              </div>
              <div className="mt-3 flex justify-end"><Button variant="primary" onClick={addDoc}><Plus size={15} /> Add document</Button></div>
            </div>
          </div>
        )}

        {tab === "end" && s && bal && fs && (
          <div className="space-y-4">
            <div className="rounded-2xl bg-surface-2 p-4">
              <Section title="Annual leave">
                <Line label="Earned so far" value={`${bal.earned} days`} /><Line label="Taken (approved)" value={`${bal.taken} days`} /><Line label="Balance" value={`${bal.balance} days`} strong />
                <div className="mt-1 text-xs text-ink-3">UAE Labour Law: 2 days a month after 6 months, {s.annual_leave_days} days a year after the first year.</div>
              </Section>
            </div>
            <div className="rounded-2xl bg-surface-2 p-4">
              <Section title={`Gratuity and final settlement · as of ${fmtDate(end)}`}>
                <Line label={`Gratuity (${fs.years} years of service)`} value={aed(fs.gratuity)} hint={num(f.basic_salary) ? `On basic salary ${aed(num(f.basic_salary))}: 21 days a year for the first 5 years, 30 after` : "No basic salary: commission-only staff earn no gratuity on commission"} />
                <Line label={`Unused leave paid out (${fs.leaveDays} days)`} value={aed(fs.leavePay)} />
                {finance && <Line label="Commission still due" value={aed(fs.commissionDue)} hint="Paid when the client's money arrives, also after they leave" />}
                {finance && fs.advances > 0 && <Line label="Advances to recover" value={`− ${aed(fs.advances)}`} />}
                <Line label="Final settlement" value={aed(fs.total)} strong />
                <div className="mt-1 text-xs text-ink-3">Unpaid salary for the last month is added through payroll. Gratuity under 1 year of service is nil; the total is capped at two years&apos; pay.</div>
              </Section>
            </div>
            <div className="text-xs text-ink-3">Running gratuity today: {aed(gratuity(num(s.basic_salary), s.join_date, today).amount)}. Set the last working day in Details to work out a leaver&apos;s settlement.</div>
          </div>
        )}
      </Sheet>
      {confirmNode}
    </>
  );
}

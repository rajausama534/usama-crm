"use client";

import { useState } from "react";
import { Loader2, Plus, UserPlus } from "lucide-react";
import { db } from "@/lib/supabase";
import { Badge, Button, Empty, Field, Input, Select, Sheet, StatusChip, Textarea } from "@/components/ui";
import { useToast } from "@/components/ContactKit";
import { DataTable, FileField, FormError, Section, SIMPLE_TONE } from "@/components/company/kit";
import { uploadDoc, useRefresh, useRows } from "@/lib/company/data";
import { CANDIDATE_STAGES, ONBOARDING, type Candidate } from "@/lib/company/calc";
import { fmtDate, todayDubai } from "@/lib/format";

const SOURCES = ["LinkedIn", "Referral", "Indeed", "Bayt", "Walk-in", "Instagram", "Other"];

/** Candidates from application to joining, with the onboarding checklist that ends in a staff record. */
export function Recruitment({ onStaff }: { onStaff: (id: string) => void }) {
  const toast = useToast();
  const refresh = useRefresh();
  const list = useRows<Candidate>("crm_candidates", { order: "created_at" });
  const [stage, setStage] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const blank = { full_name: "", phone: "", email: "", role: "Property consultant", source: "LinkedIn", stage: "Applied", notes: "", cv_path: null as string | null, checklist: {} as Record<string, boolean> };
  const [f, setF] = useState(blank);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const c = open && open !== "new" ? (list.data || []).find((x) => x.id === open) : undefined;

  function start(x: Candidate | "new") {
    setErr(""); setOpen(x === "new" ? "new" : x.id);
    setF(x === "new" ? blank : { full_name: x.full_name, phone: x.phone || "", email: x.email || "", role: x.role || "", source: x.source || "Other", stage: x.stage, notes: x.notes || "", cv_path: x.cv_path, checklist: x.checklist || {} });
  }
  async function save(extra: Partial<typeof blank> = {}) {
    const v = { ...f, ...extra };
    if (!v.full_name.trim()) return setErr("Enter the candidate's name.");
    setBusy(true); setErr("");
    const body = { full_name: v.full_name.trim(), phone: v.phone.trim() || null, email: v.email.trim() || null, role: v.role.trim() || null, source: v.source, stage: v.stage, notes: v.notes.trim() || null, cv_path: v.cv_path, checklist: v.checklist };
    const r = c ? await db.from("crm_candidates").update(body).eq("id", c.id) : await db.from("crm_candidates").insert(body);
    setBusy(false);
    if (r.error) return setErr(r.error.message);
    toast("Saved"); refresh(); if (!c) setOpen(null);
  }
  /** The last onboarding step: the candidate becomes a staff record (salary and documents are then added in Staff). */
  async function makeStaff() {
    if (!c) return;
    setBusy(true);
    const s = await db.from("crm_staff").insert({ full_name: c.full_name, phone: c.phone, job_title: c.role, join_date: todayDubai(), notes: c.email ? `Personal email: ${c.email}` : null }).select("id").single();
    if (s.error) { setBusy(false); return setErr(s.error.message); }
    await db.from("crm_candidates").update({ stage: "Joined", staff_id: s.data.id }).eq("id", c.id);
    setBusy(false); setOpen(null); toast("Staff record created"); refresh(); onStaff(s.data.id);
  }

  const rows = (list.data || []).filter((x) => !stage || x.stage === stage);
  const counts = (list.data || []).reduce<Record<string, number>>((m, x) => { m[x.stage] = (m[x.stage] || 0) + 1; return m; }, {});
  const done = ONBOARDING.filter((k) => f.checklist[k]).length;
  return (
    <>
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <div className="flex gap-1.5 overflow-x-auto flex-1">
          <StatusChip status="All" label="All" n={(list.data || []).length} active={!stage} onClick={() => setStage("")} />
          {CANDIDATE_STAGES.map((s) => <StatusChip key={s} status={s} n={counts[s] || 0} active={stage === s} onClick={() => setStage(stage === s ? "" : s)} />)}
        </div>
        <Button variant="primary" onClick={() => start("new")}><Plus size={15} /> Add candidate</Button>
      </div>
      <DataTable rows={rows} onRow={start} empty={<Empty icon={<UserPlus size={28} />} title="No candidates" hint="Add people who applied, with their CV and where they came from." />} cols={[
        { h: "Name", cell: (x) => <div><div className="font-medium">{x.full_name}</div><div className="text-xs text-ink-3 num">{[x.phone, x.email].filter(Boolean).join(" · ")}</div></div> },
        { h: "Role", cell: (x) => <span className="text-ink-2">{x.role}</span> },
        { h: "Source", cell: (x) => <span className="text-ink-2">{x.source}</span> },
        { h: "Added", cell: (x) => <span className="num whitespace-nowrap text-ink-2">{fmtDate(x.created_at)}</span> },
        { h: "Stage", cell: (x) => <Badge tone={SIMPLE_TONE[x.stage]}>{x.stage}</Badge> },
      ]} />

      <Sheet open={!!open} onClose={() => setOpen(null)} wide title={c ? c.full_name : "Add candidate"} footer={<>
        <Button variant="ghost" onClick={() => setOpen(null)}>Cancel</Button>
        <Button variant="primary" onClick={() => save()} disabled={busy}>{busy && <Loader2 size={15} className="animate-spin" />}Save</Button>
      </>}>
        <div className="grid sm:grid-cols-2 gap-3">
          <Field label="Full name"><Input value={f.full_name} onChange={(e) => setF({ ...f, full_name: e.target.value })} /></Field>
          <Field label="Role applied for"><Input value={f.role} onChange={(e) => setF({ ...f, role: e.target.value })} /></Field>
          <Field label="Phone"><Input value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></Field>
          <Field label="Email"><Input type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></Field>
          <Field label="Source"><Select value={f.source} onChange={(e) => setF({ ...f, source: e.target.value })}>{SOURCES.map((s) => <option key={s}>{s}</option>)}</Select></Field>
          <Field label="Stage"><Select value={f.stage} onChange={(e) => setF({ ...f, stage: e.target.value })}>{CANDIDATE_STAGES.map((s) => <option key={s}>{s}</option>)}</Select></Field>
          <Field label="CV" className="sm:col-span-2"><FileField path={f.cv_path} label="Upload CV" onPick={async (file) => { const p = await uploadDoc("cv", file); setF((v) => ({ ...v, cv_path: p })); }} /></Field>
          <Field label="Notes (interview, offer)" className="sm:col-span-2"><Textarea rows={3} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></Field>
        </div>
        {c && ["Offer", "Joined"].includes(f.stage) && (
          <Section title={`Onboarding checklist · ${done} of ${ONBOARDING.length}`} className="mt-5">
            <div className="rounded-xl border border-line divide-y divide-line">
              {ONBOARDING.map((k) => (
                <label key={k} className="flex items-center gap-2.5 px-3 py-2 text-sm text-ink"><input type="checkbox" className="accent-[var(--accent)]" checked={!!f.checklist[k]} onChange={(e) => setF((v) => ({ ...v, checklist: { ...v.checklist, [k]: e.target.checked } }))} />{k}</label>
              ))}
            </div>
            <div className="mt-3">
              {c.staff_id ? <Button onClick={() => { setOpen(null); onStaff(c.staff_id!); }}>Open staff record</Button>
                : <Button variant="primary" onClick={makeStaff} disabled={busy}><UserPlus size={15} /> Create staff record</Button>}
            </div>
          </Section>
        )}
        <FormError>{err}</FormError>
      </Sheet>
    </>
  );
}

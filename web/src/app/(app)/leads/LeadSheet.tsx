"use client";

import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Mail, CalendarPlus, Trophy, Loader2 } from "lucide-react";
import { CallButton, CopyButton, WaButton, useWaTemplate } from "@/components/ContactKit";
import { leadMessage, markLeadContacted } from "@/lib/contact";
import { db } from "@/lib/supabase";
import { useAuth } from "@/components/Providers";
import { BEDROOMS, LEAD_SOURCES, LEAD_STAGES, PROPERTY_TYPES, STAGE_TONE, type Lead, type Activity, type CrmEvent, logLeadActivity } from "@/lib/crm";
import { useStaff, staffName, useProjects } from "@/lib/hooks";
import { Badge, Button, Field, Input, Select, Sheet, Skeleton, Textarea, cx } from "@/components/ui";
import { fmtDateTime, todayDubai } from "@/lib/format";
import { EventForm } from "../calendar/EventForm";

const SOURCES = LEAD_SOURCES;
const EDITABLE = ["name", "phone", "email", "project_inquired", "budget", "property_type", "bedroom", "source", "status", "lead_receive_date", "notes", "assigned_to"] as const;
type Draft = Partial<Record<(typeof EDITABLE)[number], string | null>>;

export function LeadSheet({ id, onClose, onCreated }: { id: string | null; onClose: () => void; onCreated: (id: string) => void }) {
  const isNew = id === "new";
  const { me } = useAuth();
  const qc = useQueryClient();
  const staff = useStaff();
  const projects = useProjects();
  const [draft, setDraft] = useState<Draft>({});
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");
  const [tab, setTab] = useState<"details" | "activity">("activity");
  const [scheduling, setScheduling] = useState(false);

  const lead = useQuery({
    queryKey: ["lead", id],
    enabled: !!id && !isNew,
    queryFn: async () => {
      const [l, acts, evs] = await Promise.all([
        db.from("leads").select("*").eq("id", id!).maybeSingle(),
        db.from("lead_activities").select("id,activity_type,details,created_by,created_at").eq("lead_id", id!).order("created_at", { ascending: false }).limit(100),
        db.from("crm_events").select("*").eq("lead_id", id!).eq("status", "Scheduled").order("starts_at"),
      ]);
      return { lead: l.data as Lead | null, activities: (acts.data || []) as Activity[], events: (evs.data || []) as CrmEvent[] };
    },
  });

  useEffect(() => {
    setErr(""); setScheduling(false);
    if (isNew) { setDraft({ status: "New", lead_receive_date: todayDubai(), assigned_to: me?.isAdmin ? "" : me?.email || "" }); setTab("details"); }
    else if (lead.data?.lead) { const l = lead.data.lead; setDraft(Object.fromEntries(EDITABLE.map((k) => [k, (l[k] as string | null) ?? ""]))); }
  }, [isNew, id, lead.data, me]);

  useEffect(() => { if (!isNew) setTab("activity"); }, [id, isNew]);

  const set = (k: keyof Draft) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setDraft((d) => ({ ...d, [k]: e.target.value }));

  async function save() {
    if (!me) return;
    if (!draft.name?.trim() && !draft.phone?.trim()) { setErr("Add at least a name or a phone number."); return; }
    setSaving(true); setErr("");
    const payload: Record<string, string | null> = {};
    for (const k of EDITABLE) payload[k] = (draft[k] ?? "").toString().trim() || null;
    if (!me.isAdmin) { if (isNew) payload.assigned_to = me.email; else delete payload.assigned_to; }
    if (isNew) {
      const { data, error } = await db.from("leads").insert(payload).select("id").single();
      setSaving(false);
      if (error) { setErr(error.message); return; }
      await logLeadActivity(data.id, "Lead Created", "Lead added to the CRM.", me.email);
      qc.invalidateQueries({ queryKey: ["leads"] }); qc.invalidateQueries({ queryKey: ["dashboard-stats"] });
      onCreated(data.id);
      return;
    }
    const old = lead.data?.lead;
    const { error } = await db.from("leads").update(payload).eq("id", id!);
    setSaving(false);
    if (error) { setErr(error.message); return; }
    if (old && old.status !== payload.status) await logLeadActivity(id!, "Status Change", `Status changed from ${old.status || "-"} to ${payload.status || "-"}.`, me.email);
    qc.invalidateQueries({ queryKey: ["leads"] }); qc.invalidateQueries({ queryKey: ["lead", id] }); qc.invalidateQueries({ queryKey: ["dashboard-stats"] });
    setTab("activity");
  }

  const l = lead.data?.lead;
  const template = useWaTemplate();
  async function contacted() { if (l && me) { await markLeadContacted(l.id, me.email); qc.invalidateQueries({ queryKey: ["lead", id] }); qc.invalidateQueries({ queryKey: ["leads"] }); } }
  const title = isNew ? "New lead" : l ? (l.name || "Unnamed lead") : "Lead";
  const dirty = !isNew && l && EDITABLE.some((k) => ((l[k] as string | null) ?? "") !== (draft[k] ?? ""));

  return (
    <Sheet open={!!id} onClose={onClose} wide title={
      <span className="flex items-center gap-2">{title}{l?.status && <Badge tone={STAGE_TONE[l.status] || "neutral"}>{l.status}</Badge>}</span>
    } footer={(isNew || tab === "details") && <>
      <Button variant="ghost" onClick={isNew ? onClose : () => setTab("activity")}>Cancel</Button>
      <Button variant="primary" onClick={save} disabled={saving || (!isNew && !dirty)}>{saving && <Loader2 size={15} className="animate-spin" />}{isNew ? "Add lead" : "Save changes"}</Button>
    </>}>
      {!isNew && lead.isLoading ? <div className="space-y-3"><Skeleton className="w-1/2" /><Skeleton /><Skeleton className="w-2/3" /></div> :
       !isNew && !l ? <div className="text-sm text-ink-3">This lead was not found, or you don’t have access to it.</div> : (
        <div className="space-y-5">
          {l && (
            <>
              <div className="flex flex-wrap gap-2">
                <WaButton phone={l.phone} text={leadMessage(template, l)} onContact={contacted} />
                <CallButton phone={l.phone} onContact={contacted} />
                <CopyButton value={l.phone} />
                {l.email && <a href={`mailto:${l.email}`}><Button size="sm"><Mail size={14} /> Email</Button></a>}
                <Button size="sm" onClick={() => setScheduling(true)}><CalendarPlus size={14} /> Schedule</Button>
              </div>
              <div>
                <div className="text-xs font-medium text-ink-3 mb-1.5">Stage</div>
                <div className="flex flex-wrap gap-1.5">
                  {LEAD_STAGES.map((s) => (
                    <button key={s} onClick={async () => {
                      if (!me || s === l.status) return;
                      const { error } = await db.from("leads").update({ status: s, last_contacted: todayDubai() }).eq("id", l.id);
                      if (error) { setErr(error.message); return; }
                      await logLeadActivity(l.id, "Status Change", `Status changed from ${l.status || "-"} to ${s}.`, me.email);
                      qc.invalidateQueries({ queryKey: ["lead", id] }); qc.invalidateQueries({ queryKey: ["leads"] }); qc.invalidateQueries({ queryKey: ["dashboard-stats"] });
                    }} className={cx("h-7 px-2.5 rounded-md text-xs font-medium border transition-colors",
                      s === l.status ? "bg-ink text-bg border-ink" : "border-line text-ink-2 hover:border-line-strong bg-surface")}>{s}</button>
                  ))}
                </div>
              </div>
              {l.status === "Won" && (
                <div className="flex items-start gap-3 rounded-xl border border-good/30 bg-good-soft p-3.5 text-sm">
                  <Trophy size={18} className="text-good mt-0.5 shrink-0" />
                  <div><div className="font-medium text-ink">Deal won</div><div className="text-ink-2">Recording the deal and its commission arrives in Step 2 (Deals).</div></div>
                </div>
              )}
              {scheduling && me && (
                <div className="rounded-xl border border-line p-4 bg-surface-2/50">
                  <div className="text-sm font-medium text-ink mb-3">Schedule for {l.name || "this lead"}</div>
                  <EventForm leadId={l.id} leadName={l.name} onDone={() => { setScheduling(false); qc.invalidateQueries({ queryKey: ["lead", id] }); }} onCancel={() => setScheduling(false)} />
                </div>
              )}
              {lead.data!.events.length > 0 && (
                <div className="space-y-1.5">
                  <div className="text-xs font-medium text-ink-3">Coming up</div>
                  {lead.data!.events.map((e) => (
                    <div key={e.id} className="flex items-center gap-3 text-sm rounded-lg border border-line px-3 py-2">
                      <Badge tone={new Date(e.starts_at) < new Date() ? "bad" : "accent"}>{e.event_type}</Badge>
                      <span className="flex-1 truncate text-ink">{e.title}</span>
                      <span className="text-xs text-ink-3 num">{fmtDateTime(e.starts_at)}</span>
                    </div>
                  ))}
                </div>
              )}
              <div className="flex gap-4 border-b border-line text-sm">
                {(["activity", "details"] as const).map((t) => (
                  <button key={t} onClick={() => setTab(t)} className={cx("pb-2 -mb-px border-b-2 capitalize", tab === t ? "border-accent text-ink font-medium" : "border-transparent text-ink-3 hover:text-ink")}>{t}</button>
                ))}
              </div>
            </>
          )}

          {(isNew || tab === "details") && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Field label="Name"><Input value={draft.name ?? ""} onChange={set("name")} autoFocus={isNew} /></Field>
              <Field label="Phone"><Input value={draft.phone ?? ""} onChange={set("phone")} inputMode="tel" placeholder="9715xxxxxxx" /></Field>
              <Field label="Email"><Input value={draft.email ?? ""} onChange={set("email")} type="email" /></Field>
              <Field label="Project">
                <Select value={draft.project_inquired ?? ""} onChange={set("project_inquired")}>
                  <option value="">—</option>
                  {draft.project_inquired && !projects.data?.includes(draft.project_inquired) && <option>{draft.project_inquired}</option>}
                  {projects.data?.map((p) => <option key={p}>{p}</option>)}
                </Select>
              </Field>
              <Field label="Budget"><Input value={draft.budget ?? ""} onChange={set("budget")} placeholder="e.g. 4M" /></Field>
              <Field label="Property type">
                <Select value={draft.property_type ?? ""} onChange={set("property_type")}>
                  <option value="">—</option>
                  {draft.property_type && !PROPERTY_TYPES.includes(draft.property_type) && <option>{draft.property_type}</option>}
                  {PROPERTY_TYPES.map((s) => <option key={s}>{s}</option>)}
                </Select>
              </Field>
              <Field label="Bedrooms">
                <Select value={draft.bedroom ?? ""} onChange={set("bedroom")}>
                  <option value="">—</option>
                  {draft.bedroom && !BEDROOMS.includes(draft.bedroom) && <option>{draft.bedroom}</option>}
                  {BEDROOMS.map((s) => <option key={s}>{s}</option>)}
                </Select>
              </Field>
              <Field label="Source">
                <Select value={draft.source ?? ""} onChange={set("source")}>
                  <option value="">—</option>
                  {draft.source && !SOURCES.includes(draft.source) && <option>{draft.source}</option>}
                  {SOURCES.map((s) => <option key={s}>{s}</option>)}
                </Select>
              </Field>
              {isNew && <Field label="Stage"><Select value={draft.status ?? "New"} onChange={set("status")}>{LEAD_STAGES.map((s) => <option key={s}>{s}</option>)}</Select></Field>}
              <Field label="Received on"><Input type="date" value={draft.lead_receive_date ?? ""} onChange={set("lead_receive_date")} /></Field>
              {me?.isAdmin && (
                <Field label="Assigned to">
                  <Select value={draft.assigned_to ?? ""} onChange={set("assigned_to")}>
                    <option value="">Unassigned</option>
                    {staff.data?.map((s) => <option key={s.email} value={s.email}>{s.name || s.email}</option>)}
                  </Select>
                </Field>
              )}
              <Field label="Notes" className="sm:col-span-2"><Textarea value={draft.notes ?? ""} onChange={set("notes")} rows={4} /></Field>
            </div>
          )}

          {!isNew && tab === "activity" && l && <ActivityLog leadId={l.id} items={lead.data!.activities} staff={staff.data} />}
          {err && <div className="text-sm text-bad">{err}</div>}
        </div>
      )}
    </Sheet>
  );
}

function ActivityLog({ leadId, items, staff }: { leadId: string; items: Activity[]; staff?: { email: string; name: string | null }[] }) {
  const { me } = useAuth();
  const qc = useQueryClient();
  const [type, setType] = useState("Call");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  async function add() {
    if (!text.trim() || !me) return;
    setBusy(true);
    await logLeadActivity(leadId, type, text.trim(), me.email);
    await db.from("leads").update({ last_contacted: todayDubai() }).eq("id", leadId);
    setBusy(false); setText("");
    qc.invalidateQueries({ queryKey: ["lead", leadId] });
  }
  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-line p-3 space-y-2">
        <div className="flex gap-1.5">
          {["Call", "WhatsApp", "Meeting", "Note"].map((t) => (
            <button key={t} onClick={() => setType(t)} className={cx("h-7 px-2.5 rounded-md text-xs font-medium", type === t ? "bg-accent-soft text-accent-text" : "text-ink-3 hover:text-ink")}>{t}</button>
          ))}
        </div>
        <Textarea value={text} onChange={(e) => setText(e.target.value)} placeholder="What was discussed?" rows={2} className="min-h-14" />
        <div className="flex justify-end"><Button size="sm" variant="primary" onClick={add} disabled={busy || !text.trim()}>Add to history</Button></div>
      </div>
      <ol className="relative border-l border-line ml-1.5 space-y-4">
        {items.map((a) => (
          <li key={a.id} className="pl-4 relative">
            <span className="absolute -left-[5px] top-1.5 size-2.5 rounded-full bg-surface border-2 border-accent" />
            <div className="flex items-baseline gap-2 text-xs text-ink-3">
              <span className="font-medium text-ink-2">{a.activity_type}</span>
              <span>{fmtDateTime(a.created_at)}</span>
              {a.created_by && <span>· {staffName(staff, a.created_by)}</span>}
            </div>
            {a.details && <div className="text-sm text-ink mt-0.5 whitespace-pre-wrap">{a.details}</div>}
          </li>
        ))}
        {items.length === 0 && <li className="pl-4 text-sm text-ink-3">No history yet.</li>}
      </ol>
    </div>
  );
}

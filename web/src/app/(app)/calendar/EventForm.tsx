"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { db } from "@/lib/supabase";
import { useAuth } from "@/components/Providers";
import { EVENT_TYPES, type CrmEvent } from "@/lib/crm";
import { useStaff } from "@/lib/hooks";
import { Button, Field, Input, Select, Textarea } from "@/components/ui";
import { todayDubai } from "@/lib/format";

/** Dubai wall-clock date + time -> ISO timestamp. */
export function dubaiISO(date: string, time: string) {
  return new Date(`${date}T${time || "10:00"}:00+04:00`).toISOString();
}
export function dubaiParts(iso: string) {
  const d = new Date(iso);
  const date = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Dubai" }).format(d);
  const time = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Dubai", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(d);
  return { date, time };
}

export function EventForm({ leadId, leadName, event, defaultDate, defaultTime, onDone, onCancel }: {
  leadId?: string | null; leadName?: string | null; event?: CrmEvent; defaultDate?: string; defaultTime?: string; onDone: () => void; onCancel: () => void;
}) {
  const { me } = useAuth();
  const qc = useQueryClient();
  const staff = useStaff();
  const start = event ? dubaiParts(event.starts_at) : { date: defaultDate || todayDubai(), time: defaultTime || "10:00" };
  const [type, setType] = useState(event?.event_type || "Follow-Up");
  const [title, setTitle] = useState(event?.title || "");
  const [date, setDate] = useState(start.date);
  const [time, setTime] = useState(start.time);
  const [notes, setNotes] = useState(event?.notes || "");
  const [remind, setRemind] = useState(String(event?.remind_minutes ?? 30));
  const [assignee, setAssignee] = useState(event?.assigned_to || me?.email || "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function save() {
    setBusy(true); setErr("");
    const payload = {
      event_type: type,
      title: title.trim() || `${type}${leadName ? ` — ${leadName}` : ""}`,
      starts_at: dubaiISO(date, time),
      notes: notes.trim() || null,
      remind_minutes: Number(remind),
      assigned_to: me?.isAdmin ? assignee || me.email : me?.email,
      lead_id: event ? event.lead_id : leadId || null,
    };
    const res = event ? await db.from("crm_events").update(payload).eq("id", event.id) : await db.from("crm_events").insert(payload);
    setBusy(false);
    if (res.error) { setErr(res.error.message); return; }
    qc.invalidateQueries({ queryKey: ["events"] }); qc.invalidateQueries({ queryKey: ["notifications"] }); qc.invalidateQueries({ queryKey: ["leads"] });
    onDone();
  }

  return (
    <div className="grid grid-cols-2 gap-3">
      <Field label="Type"><Select value={type} onChange={(e) => setType(e.target.value)}>{EVENT_TYPES.map((t) => <option key={t}>{t}</option>)}</Select></Field>
      <Field label="Remind me"><Select value={remind} onChange={(e) => setRemind(e.target.value)}>
        {[[0, "At the time"], [15, "15 min before"], [30, "30 min before"], [60, "1 hour before"], [1440, "1 day before"]].map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </Select></Field>
      <Field label="Title" className="col-span-2"><Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={`${type}${leadName ? ` — ${leadName}` : ""}`} /></Field>
      <Field label="Date"><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
      <Field label="Time"><Input type="time" value={time} onChange={(e) => setTime(e.target.value)} /></Field>
      {me?.isAdmin && (
        <Field label="For" className="col-span-2">
          <Select value={assignee} onChange={(e) => setAssignee(e.target.value)}>
            {staff.data?.map((s) => <option key={s.email} value={s.email}>{s.name || s.email}</option>)}
          </Select>
        </Field>
      )}
      <Field label="Notes" className="col-span-2"><Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} className="min-h-14" /></Field>
      {err && <div className="col-span-2 text-sm text-bad">{err}</div>}
      <div className="col-span-2 flex justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={onCancel}>Cancel</Button>
        <Button variant="primary" size="sm" onClick={save} disabled={busy}>{busy && <Loader2 size={14} className="animate-spin" />}{event ? "Save" : "Schedule"}</Button>
      </div>
    </div>
  );
}

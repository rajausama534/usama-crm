"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, Plus, Check, X, Pencil, Loader2, MapPin } from "lucide-react";
import { db } from "@/lib/supabase";
import { useAuth } from "@/components/Providers";
import { LOCATION_EVENTS, readLocation, type CrmEvent } from "@/lib/crm";
import { useStaff, staffName } from "@/lib/hooks";
import { Badge, Button, Card, Empty, PageHeader, Sheet, Textarea, cx } from "@/components/ui";
import { fmtTime, todayDubai } from "@/lib/format";
import { EventForm, dubaiParts } from "./EventForm";

type Ev = CrmEvent & { leads: { name: string | null } | null };
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function ymd(d: Date) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; }

export default function CalendarPage() {
  const { me } = useAuth();
  const staff = useStaff();
  const today = todayDubai();
  const [cursor, setCursor] = useState(() => { const [y, m] = today.split("-").map(Number); return new Date(y, m - 1, 1); });
  const [selected, setSelected] = useState(today);
  const [editing, setEditing] = useState<Ev | "new" | null>(null);
  const [completing, setCompleting] = useState<Ev | null>(null);

  // Grid: Monday-start weeks covering the month.
  const days = useMemo(() => {
    const first = new Date(cursor);
    const offset = (first.getDay() + 6) % 7;
    const start = new Date(first); start.setDate(1 - offset);
    return Array.from({ length: 42 }, (_, i) => { const d = new Date(start); d.setDate(start.getDate() + i); return d; });
  }, [cursor]);

  const range = { from: `${ymd(days[0])}T00:00:00+04:00`, to: `${ymd(days[41])}T23:59:59+04:00` };
  const events = useQuery({
    queryKey: ["events", range.from],
    queryFn: async () => {
      const { data, error } = await db.from("crm_events").select("*, leads(name)").gte("starts_at", range.from).lte("starts_at", range.to).neq("status", "Cancelled").order("starts_at");
      if (error) throw error;
      return (data || []) as Ev[];
    },
  });
  const overdue = useQuery({
    queryKey: ["events", "overdue"],
    queryFn: async () => {
      const { data } = await db.from("crm_events").select("*, leads(name)").eq("status", "Scheduled").lt("starts_at", new Date().toISOString()).order("starts_at", { ascending: false }).limit(50);
      return (data || []) as Ev[];
    },
  });

  const byDay = useMemo(() => {
    const m: Record<string, Ev[]> = {};
    for (const e of events.data || []) (m[dubaiParts(e.starts_at).date] ||= []).push(e);
    return m;
  }, [events.data]);
  const dayEvents = byDay[selected] || [];

  return (
    <div className="animate-in">
      <PageHeader title="Calendar" subtitle={overdue.data?.length ? <span className="text-bad">{overdue.data.length} overdue</span> : "Calls, viewings and meetings"}
        actions={<Button variant="primary" onClick={() => setEditing("new")}><Plus size={16} /> New event</Button>} />

      <div className="grid lg:grid-cols-[1fr_360px] gap-5">
        <Card className="p-4">
          <div className="flex items-center justify-between mb-3">
            <div className="font-semibold text-ink">{cursor.toLocaleDateString("en-GB", { month: "long", year: "numeric" })}</div>
            <div className="flex gap-1">
              <Button size="sm" variant="ghost" onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1))}><ChevronLeft size={16} /></Button>
              <Button size="sm" variant="ghost" onClick={() => { const [y, m] = today.split("-").map(Number); setCursor(new Date(y, m - 1, 1)); setSelected(today); }}>Today</Button>
              <Button size="sm" variant="ghost" onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1))}><ChevronRight size={16} /></Button>
            </div>
          </div>
          <div className="grid grid-cols-7 text-center text-[11px] font-medium text-ink-3 mb-1">{WEEKDAYS.map((d) => <div key={d}>{d}</div>)}</div>
          <div className="grid grid-cols-7 gap-px rounded-lg overflow-hidden bg-line border border-line">
            {days.map((d) => {
              const key = ymd(d);
              const evs = byDay[key] || [];
              const inMonth = d.getMonth() === cursor.getMonth();
              return (
                <button key={key} onClick={() => setSelected(key)}
                  className={cx("bg-surface min-h-14 sm:min-h-24 p-1.5 text-left align-top transition-colors hover:bg-surface-2", selected === key && "ring-2 ring-inset ring-accent", !inMonth && "bg-surface-2/50")}>
                  <div className={cx("text-xs num size-6 grid place-items-center rounded-full", key === today ? "bg-accent text-white font-semibold" : inMonth ? "text-ink" : "text-ink-3")}>{d.getDate()}</div>
                  <div className="hidden sm:block space-y-0.5 mt-0.5">
                    {evs.slice(0, 3).map((e) => (
                      <div key={e.id} className={cx("text-[11px] truncate rounded px-1", e.status === "Completed" ? "text-ink-3 line-through" : "bg-accent-soft text-accent-text")}>
                        {fmtTime(e.starts_at)} {e.leads?.name || e.title}
                      </div>
                    ))}
                    {evs.length > 3 && <div className="text-[11px] text-ink-3 px-1">+{evs.length - 3} more</div>}
                  </div>
                  {evs.length > 0 && <div className="sm:hidden mt-1 flex gap-0.5">{evs.slice(0, 3).map((e) => <span key={e.id} className="size-1.5 rounded-full bg-accent" />)}</div>}
                </button>
              );
            })}
          </div>
        </Card>

        <div className="space-y-5">
          <Card className="p-4">
            <div className="text-sm font-semibold text-ink mb-3">{new Date(`${selected}T12:00:00`).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" })}</div>
            {dayEvents.length === 0 ? <Empty title="Nothing scheduled" action={<Button size="sm" onClick={() => setEditing("new")}><Plus size={14} /> Add</Button>} /> :
              <div className="space-y-2">{dayEvents.map((e) => <EventRow key={e.id} e={e} who={me?.isAdmin ? staffName(staff.data, e.assigned_to) : undefined} onEdit={() => setEditing(e)} onDone={() => setCompleting(e)} />)}</div>}
          </Card>
          {!!overdue.data?.length && (
            <Card className="p-4">
              <div className="text-sm font-semibold text-bad mb-3">Overdue</div>
              <div className="space-y-2">{overdue.data.slice(0, 10).map((e) => <EventRow key={e.id} e={e} showDate who={me?.isAdmin ? staffName(staff.data, e.assigned_to) : undefined} onEdit={() => setEditing(e)} onDone={() => setCompleting(e)} />)}</div>
            </Card>
          )}
        </div>
      </div>

      <Sheet open={!!editing} onClose={() => setEditing(null)} title={editing === "new" ? "New event" : "Edit event"}>
        {editing && <EventForm event={editing === "new" ? undefined : editing} defaultDate={selected} onDone={() => setEditing(null)} onCancel={() => setEditing(null)} />}
      </Sheet>
      <CompleteSheet ev={completing} onClose={() => setCompleting(null)} />
    </div>
  );
}

function EventRow({ e, onEdit, onDone, showDate, who }: { e: Ev; onEdit: () => void; onDone: () => void; showDate?: boolean; who?: string }) {
  const done = e.status === "Completed";
  return (
    <div className={cx("rounded-lg border border-line p-3", done && "opacity-60")}>
      <div className="flex items-start gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 text-xs text-ink-3 num">
            {showDate ? new Date(e.starts_at).toLocaleDateString("en-GB", { day: "numeric", month: "short" }) + " · " : ""}{fmtTime(e.starts_at)}
            <Badge tone={done ? "good" : "accent"}>{done ? "Done" : e.event_type}</Badge>
            {who && <span className="truncate">· {who}</span>}
          </div>
          <div className={cx("text-sm text-ink mt-1", done && "line-through")}>{e.title}</div>
          {e.lead_id && <Link href={`/leads?open=${e.lead_id}`} className="text-xs text-accent-text hover:underline">{e.leads?.name || "Open lead"}</Link>}
          {e.outcome && <div className="text-xs text-ink-2 mt-1">{e.outcome}</div>}
        </div>
        {!done && (
          <div className="flex gap-0.5">
            <button onClick={onEdit} className="p-1.5 rounded-md text-ink-3 hover:text-ink hover:bg-surface-2" title="Edit"><Pencil size={14} /></button>
            <button onClick={onDone} className="p-1.5 rounded-md text-good hover:bg-good-soft" title="Mark done"><Check size={15} /></button>
          </div>
        )}
      </div>
    </div>
  );
}

function CompleteSheet({ ev, onClose }: { ev: Ev | null; onClose: () => void }) {
  const qc = useQueryClient();
  const [outcome, setOutcome] = useState("");
  const [busy, setBusy] = useState<"" | "done" | "cancel">("");
  const [err, setErr] = useState("");
  const needsLocation = ev ? LOCATION_EVENTS.has(ev.event_type) : false;

  async function finish(status: "Completed" | "Cancelled") {
    if (!ev) return;
    setBusy(status === "Completed" ? "done" : "cancel"); setErr("");
    const patch: Record<string, unknown> = { status, outcome: outcome.trim() || null };
    if (status === "Completed") {
      patch.completed_at = new Date().toISOString();
      if (needsLocation) {
        const loc = await readLocation();
        patch.done_location_status = loc.status;
        if (loc.status === "captured") { patch.done_lat = loc.lat; patch.done_lng = loc.lng; patch.done_accuracy_m = loc.acc; }
      }
    }
    const { error } = await db.from("crm_events").update(patch).eq("id", ev.id);
    setBusy("");
    if (error) { setErr(error.message); return; }
    setOutcome("");
    qc.invalidateQueries({ queryKey: ["events"] }); qc.invalidateQueries({ queryKey: ["notifications"] }); qc.invalidateQueries({ queryKey: ["lead"] });
    onClose();
  }

  return (
    <Sheet open={!!ev} onClose={onClose} title={ev ? `Finish: ${ev.title}` : ""} footer={<>
      <Button variant="ghost" onClick={() => finish("Cancelled")} disabled={!!busy}>{busy === "cancel" ? <Loader2 size={15} className="animate-spin" /> : <X size={15} />} Cancel event</Button>
      <Button variant="primary" onClick={() => finish("Completed")} disabled={!!busy}>{busy === "done" ? <Loader2 size={15} className="animate-spin" /> : <Check size={15} />} Mark done</Button>
    </>}>
      <div className="space-y-3">
        <div className="text-sm text-ink-2">What happened?</div>
        <Textarea value={outcome} onChange={(e) => setOutcome(e.target.value)} rows={4} placeholder="e.g. Client liked the unit, wants a second viewing with spouse" />
        {needsLocation && <div className="flex items-center gap-2 text-xs text-ink-3"><MapPin size={14} /> Your location is recorded when you mark a {ev?.event_type.toLowerCase()} done.</div>}
        {err && <div className="text-sm text-bad">{err}</div>}
      </div>
    </Sheet>
  );
}

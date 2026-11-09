"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Check, ChevronLeft, ChevronRight, Loader2, MapPin, Pencil, Plus, X } from "lucide-react";
import { db } from "@/lib/supabase";
import { useAuth } from "@/components/Providers";
import { LOCATION_EVENTS, readLocation, type CrmEvent } from "@/lib/crm";
import { useStaff, staffName } from "@/lib/hooks";
import { Avatar, Badge, Button, Card, Empty, PageHeader, Segmented, Sheet, Textarea, Toast, cx } from "@/components/ui";
import { fmtTime, initials, todayDubai } from "@/lib/format";
import { EventForm, dubaiISO, dubaiParts } from "./EventForm";

type Ev = CrmEvent & { leads: { name: string | null } | null };
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const HOURS = Array.from({ length: 15 }, (_, i) => i + 7);
type View = "month" | "week" | "day";

// Colour shows the kind of event, the same four colours in the legend, the pills and the totals.
const GROUPS = [
  { cls: "ev-1", label: "Viewings & meetings", types: ["Property Viewing", "Meeting"] },
  { cls: "ev-2", label: "Calls", types: ["Phone Call", "Call Back"] },
  { cls: "ev-3", label: "Follow-ups", types: ["Follow-Up"] },
  { cls: "ev-4", label: "Tasks & reminders", types: ["Reminder", "Task", "Other"] },
];
const groupOf = (type: string) => GROUPS.find((g) => g.types.includes(type)) || GROUPS[3];

function ymd(d: Date) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; }
const niceDay = (key: string) => new Date(`${key}T12:00:00`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });

/** Events for the same person whose times overlap (30 minutes if no end time is set). */
function findClashes(events: Ev[]) {
  const ids = new Set<string>();
  const live = events.filter((e) => e.status === "Scheduled").sort((a, b) => a.starts_at.localeCompare(b.starts_at));
  const end = (e: Ev) => (e.ends_at ? new Date(e.ends_at).getTime() : new Date(e.starts_at).getTime() + 30 * 60_000);
  for (let i = 0; i < live.length; i++) {
    for (let j = i + 1; j < live.length; j++) {
      if (new Date(live[j].starts_at).getTime() >= end(live[i])) break;
      if (live[i].assigned_to.toLowerCase() === live[j].assigned_to.toLowerCase()) { ids.add(live[i].id); ids.add(live[j].id); }
    }
  }
  return ids;
}

type DragState = { ev: Ev; x: number; y: number; width: number; offX: number; offY: number; over: string | null };
type ToastState = { message: string; undo?: () => void };

export default function CalendarPage() {
  const { me } = useAuth();
  const staff = useStaff();
  const qc = useQueryClient();
  const today = todayDubai();
  const [cursor, setCursor] = useState(() => { const [y, m] = today.split("-").map(Number); return new Date(y, m - 1, 1); });
  const [direction, setDirection] = useState<"next" | "prev">("next");
  const [selected, setSelected] = useState(today);
  const [view, setView] = useState<View>("month");
  const [editing, setEditing] = useState<Ev | "new" | null>(null);
  // A reminder pop-up sends people here with ?edit=<id> or ?complete=<id>, or says so with an event when already here.
  useEffect(() => {
    const open = (id: string, complete: boolean) => {
      db.from("crm_events").select("*,leads(name)").eq("id", id).maybeSingle().then(({ data }) => {
        if (!data) return;
        if (complete) setCompleting(data as Ev); else setEditing(data as Ev);
      });
    };
    const sp = new URLSearchParams(location.search);
    const id = sp.get("complete") || sp.get("edit");
    if (id) { open(id, sp.has("complete")); history.replaceState(null, "", location.pathname); }
    const onOpen = (e: Event) => { const d = (e as CustomEvent<{ id: string; complete: boolean }>).detail; open(d.id, d.complete); };
    window.addEventListener("crm:open-event", onOpen);
    return () => window.removeEventListener("crm:open-event", onOpen);
  }, []);
  const [newTime, setNewTime] = useState<string | undefined>();
  const [completing, setCompleting] = useState<Ev | null>(null);
  const [drag, setDrag] = useState<DragState | null>(null);
  const [toast, setToast] = useState<ToastState | null>(null);
  const closeToast = useCallback(() => setToast(null), []);
  const justDragged = useRef(false);

  function go(delta: number) {
    setDirection(delta > 0 ? "next" : "prev");
    if (view === "month") { setCursor((c) => new Date(c.getFullYear(), c.getMonth() + delta, 1)); return; }
    const [y, m, d] = selected.split("-").map(Number);
    const next = new Date(y, m - 1, d + delta * (view === "week" ? 7 : 1));
    setSelected(ymd(next));
    setCursor(new Date(next.getFullYear(), next.getMonth(), 1));
  }

  // Grid: Monday-start weeks covering the month, only as many rows as the month needs.
  const days = useMemo(() => {
    if (view !== "month") {
      const [y, m, d] = selected.split("-").map(Number);
      const base = new Date(y, m - 1, d);
      if (view === "day") return [base];
      const monday = new Date(y, m - 1, d - ((base.getDay() + 6) % 7));
      return Array.from({ length: 7 }, (_, i) => new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + i));
    }
    const first = new Date(cursor);
    const offset = (first.getDay() + 6) % 7;
    const inMonth = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0).getDate();
    const cells = Math.ceil((offset + inMonth) / 7) * 7;
    const start = new Date(first); start.setDate(1 - offset);
    return Array.from({ length: cells }, (_, i) => { const d = new Date(start); d.setDate(start.getDate() + i); return d; });
  }, [cursor, view, selected]);

  const range = { from: `${ymd(days[0])}T00:00:00+04:00`, to: `${ymd(days[days.length - 1])}T23:59:59+04:00` };
  const queryKey = useMemo(() => ["events", range.from, range.to], [range.from, range.to]);
  const events = useQuery({
    queryKey,
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
  const clashes = useMemo(() => findClashes(events.data || []), [events.data]);
  const dayEvents = byDay[selected] || [];

  const monthKey = ymd(cursor).slice(0, 7);
  const monthEvents = useMemo(() => (events.data || []).filter((e) => dubaiParts(e.starts_at).date.startsWith(monthKey)), [events.data, monthKey]);
  const gridKey = view === "month" ? monthKey : `${view}-${ymd(days[0])}`;
  const heading = view === "month"
    ? cursor.toLocaleDateString("en-GB", { month: "long", year: "numeric" })
    : view === "week" ? `${niceDay(ymd(days[0]))} – ${niceDay(ymd(days[6]))}`
      : days[0].toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  const rangeCount = view === "month" ? monthEvents.length : (events.data || []).length;
  const rangeLabel = view === "month" ? `in ${cursor.toLocaleDateString("en-GB", { month: "long" })}` : view === "week" ? "this week" : "on this day";
  const upNext = useMemo(() => {
    const now = new Date().toISOString();
    return (events.data || []).filter((e) => e.status === "Scheduled" && e.starts_at >= now).slice(0, 4);
  }, [events.data]);

  /** Moves an event to another day, same time. The grid updates at once and goes back if the save fails. */
  async function moveEvent(ev: Ev, toDate: string, toTime?: string, withUndo = true) {
    const { date: fromDate, time: fromTime } = dubaiParts(ev.starts_at);
    if (fromDate === toDate && (!toTime || toTime === fromTime)) return;
    const startsAt = dubaiISO(toDate, toTime || fromTime);
    const shift = new Date(startsAt).getTime() - new Date(ev.starts_at).getTime();
    const endsAt = ev.ends_at ? new Date(new Date(ev.ends_at).getTime() + shift).toISOString() : null;
    const patch = { starts_at: startsAt, ...(endsAt ? { ends_at: endsAt } : {}) };

    const before = qc.getQueryData<Ev[]>(queryKey);
    qc.setQueryData<Ev[]>(queryKey, (list) => list?.map((e) => (e.id === ev.id ? { ...e, ...patch } : e)));
    setSelected(toDate);

    const { data, error } = await db.from("crm_events").update(patch).eq("id", ev.id).select("id");
    if (error || !data?.length) {
      qc.setQueryData(queryKey, before);
      setToast({ message: error ? `Could not move it: ${error.message}` : "You don’t have access to move this event." });
      return;
    }
    qc.invalidateQueries({ queryKey: ["events"] });
    qc.invalidateQueries({ queryKey: ["notifications"] });
    setToast({ message: `Moved to ${niceDay(toDate)}${toTime ? ` at ${toTime}` : ""}`, undo: withUndo ? () => moveEvent({ ...ev, ...patch } as Ev, fromDate, fromTime, false) : undefined });
  }

  /** Agents move their own events, team leaders also their team's, admins anyone's. The database has the final say. */
  function canMove(ev: Ev) {
    if (ev.status !== "Scheduled" || !me) return false;
    if (me.isAdmin) return true;
    const owner = ev.assigned_to.toLowerCase();
    if (owner === me.email.toLowerCase()) return true;
    if (me.role !== "team_leader") return false;
    const member = staff.data?.find((s) => s.email.toLowerCase() === owner);
    return member?.team_leader?.toLowerCase() === me.email.toLowerCase();
  }

  function startPress(e: React.PointerEvent<HTMLDivElement>, ev: Ev) {
    if (e.button !== 0 || e.pointerType === "touch" || !canMove(ev)) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const startX = e.clientX, startY = e.clientY;
    let current: DragState | null = null;

    const dayAt = (x: number, y: number) => {
      const cell = document.elementFromPoint(x, y)?.closest<HTMLElement>("[data-day]");
      return cell ? `${cell.dataset.day}|${cell.dataset.time || ""}` : null;
    };
    const finish = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("keydown", key);
      setDrag(null);
    };
    const move = (m: PointerEvent) => {
      if (!current && Math.hypot(m.clientX - startX, m.clientY - startY) < 5) return;
      current = { ev, x: m.clientX, y: m.clientY, width: rect.width, offX: startX - rect.left, offY: startY - rect.top, over: dayAt(m.clientX, m.clientY) };
      setDrag(current);
    };
    const up = () => {
      finish();
      if (!current) return;
      justDragged.current = true;
      setTimeout(() => { justDragged.current = false; }, 0);
      if (current.over) { const [day, time] = current.over.split("|"); moveEvent(ev, day, time || undefined); }
    };
    const key = (k: KeyboardEvent) => { if (k.key === "Escape") { current = null; finish(); } };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("keydown", key);
  }

  const person = (e: Ev) => staffName(staff.data, e.assigned_to);

  const pill = (e: Ev, index: number, showTime = false) => {
    const done = e.status === "Completed";
    const who = person(e);
    return (
      <div key={e.id} title={`${fmtTime(e.starts_at)} · ${e.leads?.name || e.title} · ${who}`}
        onPointerDown={(p) => startPress(p, e)}
        className={cx("pill flex items-center gap-1 h-[22px] rounded-[7px] pl-0.5 pr-1.5 text-[11px] font-medium select-none", groupOf(e.event_type).cls,
          done ? "opacity-45 line-through" : canMove(e) && "pill-grab", clashes.has(e.id) && "pill-clash", drag?.ev.id === e.id && "pill-placeholder")}
        style={{ ["--i" as string]: index }}>
        <span className="grid place-items-center size-[18px] shrink-0 rounded-full bg-black/15 text-[8px] font-semibold">{initials(who)}</span>
        {showTime && <span className="shrink-0 num opacity-80">{fmtTime(e.starts_at)}</span>}
        <span className="truncate">{e.leads?.name || e.title}</span>
      </div>
    );
  };

  return (
    <div className={cx("animate-in", drag && "select-none")}>
      <PageHeader title="Calendar"
        subtitle={<>{rangeCount} event{rangeCount === 1 ? "" : "s"} {rangeLabel}{overdue.data?.length ? <span className="text-bad"> · {overdue.data.length} overdue</span> : null}</>}
        actions={<Button variant="primary" onClick={() => { setNewTime(undefined); setEditing("new"); }}><Plus size={16} /> New event</Button>} />

      <div className="grid lg:grid-cols-[1fr_340px] gap-5 items-start">
        <div className="space-y-5 min-w-0">
          <Card className="p-4 sm:p-5">
            <div className="flex flex-wrap items-start justify-between gap-2 mb-3">
              <div>
                <div className="font-medium text-ink">{heading}</div>
                <div className="text-xs text-ink-3 mt-0.5">Colour shows the type.<span className="hidden sm:inline"> Drag an event to move it to another day.</span></div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
              <Segmented value={view} onChange={setView} options={[{ value: "month", label: "Month" }, { value: "week", label: "Week" }, { value: "day", label: "Day" }]} />
              <div className="flex items-center gap-0.5 rounded-full bg-surface-2 border border-line p-0.5">
                <button onClick={() => go(-1)} aria-label="Previous" className="p-1.5 rounded-full text-ink-2 hover:text-ink hover:bg-surface transition-colors"><ChevronLeft size={15} /></button>
                <button onClick={() => { const [y, m] = today.split("-").map(Number); const t = new Date(y, m - 1, 1); setDirection(t < cursor ? "prev" : "next"); setCursor(t); setSelected(today); }}
                  className="h-7 px-3 rounded-full text-[13px] font-medium text-ink-2 hover:text-ink hover:bg-surface transition-colors">Today</button>
                <button onClick={() => go(1)} aria-label="Next" className="p-1.5 rounded-full text-ink-2 hover:text-ink hover:bg-surface transition-colors"><ChevronRight size={15} /></button>
              </div>
              </div>
            </div>

            <div className="flex flex-wrap gap-x-4 gap-y-1 mb-3">
              {GROUPS.map((g) => <span key={g.cls} className="inline-flex items-center gap-1.5 text-xs text-ink-2"><span className={cx("size-2 rounded-full", `dot-${g.cls}`)} /> {g.label}</span>)}
            </div>

            {view !== "month" ? (
              <div className="rounded-2xl overflow-x-auto border border-line">
                <div style={{ minWidth: view === "week" ? 620 : 0 }}>
                  <div className="grid bg-surface-2 border-b border-line text-[11px] font-medium text-ink-2" style={{ gridTemplateColumns: `52px repeat(${days.length}, minmax(0, 1fr))` }}>
                    <div />{days.map((d) => <div key={ymd(d)} className={cx("px-2 py-2", ymd(d) === today && "text-accent-text font-semibold")}>{niceDay(ymd(d))}</div>)}
                  </div>
                  <div key={gridKey} className={cx("grid gap-px bg-line", direction === "next" ? "month-next" : "month-prev")} style={{ gridTemplateColumns: `52px repeat(${days.length}, minmax(0, 1fr))` }}>
                    {HOURS.map((h) => [
                      <div key={h} className="bg-surface px-1.5 py-1.5 text-[10.5px] text-ink-3 num">{String(h).padStart(2, "0")}:00</div>,
                      ...days.map((d) => {
                        const key = ymd(d);
                        const time = `${String(h).padStart(2, "0")}:00`;
                        const list = (byDay[key] || []).filter((e) => { const eh = Number(dubaiParts(e.starts_at).time.slice(0, 2)); return h === 7 ? eh <= 7 : h === 21 ? eh >= 21 : eh === h; });
                        return (
                          <div key={key + h} data-day={key} data-time={time} role="button" tabIndex={0} aria-label={`${niceDay(key)} ${time}`}
                            onClick={() => { if (justDragged.current) return; setSelected(key); setNewTime(time); setEditing("new"); }}
                            onKeyDown={(e) => { if (e.key === "Enter") { setSelected(key); setNewTime(time); setEditing("new"); } }}
                            className={cx("day-cell bg-surface hover:bg-surface-2/60 min-h-10 p-1 space-y-1 cursor-pointer", drag?.over === `${key}|${time}` && "day-drop")}>
                            {list.map((e, i) => <div key={e.id} onClick={(c) => { c.stopPropagation(); setSelected(key); }}>{pill(e, i, true)}</div>)}
                          </div>
                        );
                      }),
                    ])}
                  </div>
                </div>
              </div>
            ) : (
            <div className="rounded-2xl overflow-hidden border border-line">
              <div className="grid grid-cols-7 bg-surface-2 border-b border-line text-[11px] font-medium text-ink-2">{WEEKDAYS.map((d) => <div key={d} className="px-2 py-2">{d}</div>)}</div>
              <div key={gridKey} className={cx("grid grid-cols-7 gap-px bg-line", direction === "next" ? "month-next" : "month-prev")}>
                {days.map((d, cellIndex) => {
                  const key = ymd(d);
                  const evs = byDay[key] || [];
                  const inMonth = d.getMonth() === cursor.getMonth();
                  const isToday = key === today;
                  const hasClash = evs.some((e) => clashes.has(e.id));
                  const isDrop = drag?.over?.split("|")[0] === key && dubaiParts(drag.ev.starts_at).date !== key;
                  return (
                    <div key={key} data-day={key} role="button" tabIndex={0} aria-label={niceDay(key)} aria-pressed={selected === key}
                      onClick={() => { if (!justDragged.current) setSelected(key); }}
                      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setSelected(key); } }}
                      className={cx("day-cell relative min-h-14 sm:min-h-[104px] p-1.5 text-left cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent",
                        inMonth ? "bg-surface hover:bg-surface-2/60" : "bg-surface-2",
                        selected === key && "ring-[1.5px] ring-inset ring-accent",
                        isDrop && "day-drop")}>
                      <div className="flex items-center justify-between gap-1">
                        <span className={cx("text-xs num size-6 grid place-items-center rounded-full", isToday ? "font-semibold" : inMonth ? "text-ink" : "text-ink-3")}
                          style={isToday ? { background: "var(--today)", color: "var(--today-text)" } : undefined}>{d.getDate()}</span>
                        {hasClash
                          ? <span className="hidden sm:inline-flex items-center gap-0.5 text-[10px] font-medium text-bad pr-0.5"><AlertTriangle size={10} /> Clash</span>
                          : isToday && <span className="hidden sm:block text-[10px] font-medium text-ink-2 pr-0.5">Today</span>}
                      </div>
                      <div className="hidden sm:block space-y-1 mt-1">
                        {evs.slice(0, 3).map((e, i) => pill(e, cellIndex + i))}
                        {evs.length > 3 && <div className="text-[11px] text-ink-3 px-1">+{evs.length - 3} more</div>}
                      </div>
                      {evs.length > 0 && <div className="sm:hidden mt-1 flex justify-center gap-0.5">{evs.slice(0, 3).map((e) => <span key={e.id} className={cx("size-1.5 rounded-full", `dot-${groupOf(e.event_type).cls}`)} />)}</div>}
                    </div>
                  );
                })}
              </div>
            </div>
            )}
          </Card>

          {view === "month" && <div className="grid sm:grid-cols-2 gap-5">
            <Card className="p-5">
              <div className="text-sm font-medium text-ink">This month</div>
              <div className="text-xs text-ink-3 mt-0.5">{monthEvents.filter((e) => e.status === "Completed").length} of {monthEvents.length} done</div>
              <div className="mt-4 space-y-3">
                {GROUPS.map((g, i) => {
                  const inGroup = monthEvents.filter((e) => groupOf(e.event_type).cls === g.cls);
                  const done = inGroup.filter((e) => e.status === "Completed").length;
                  return (
                    <div key={g.cls}>
                      <div className="flex justify-between text-xs"><span className="text-ink-2">{g.label}</span><span className="text-ink num">{done} / {inGroup.length}</span></div>
                      <div className="mt-1.5 h-1.5 rounded-full bg-surface-2 overflow-hidden">
                        <div key={monthKey} className={cx("grow-x h-full rounded-full", `dot-${g.cls}`)} style={{ width: `${inGroup.length ? (done / inGroup.length) * 100 : 0}%`, ["--i" as string]: i }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            </Card>
            <Card className="p-5">
              <div className="text-sm font-medium text-ink">Up next</div>
              {upNext.length === 0 ? <div className="text-sm text-ink-3 py-8 text-center">Nothing coming up this month.</div> : (
                <div className="mt-3 space-y-3">
                  {upNext.map((e) => (
                    <button key={e.id} onClick={() => setSelected(dubaiParts(e.starts_at).date)} className="w-full flex items-center gap-2.5 text-left group">
                      <Avatar name={e.leads?.name || e.title} size={30} />
                      <span className="flex-1 min-w-0">
                        <span className="block text-[13px] font-medium text-ink truncate group-hover:text-accent-text transition-colors">{e.leads?.name || e.title}</span>
                        <span className="block text-xs text-ink-3 truncate">{e.event_type}{me?.isAdmin ? ` · ${person(e)}` : ""}</span>
                      </span>
                      <span className="text-xs text-ink-2 num text-right whitespace-nowrap">{niceDay(dubaiParts(e.starts_at).date).replace(/^\w+ /, "")}<br /><span className="text-ink-3">{fmtTime(e.starts_at)}</span></span>
                    </button>
                  ))}
                </div>
              )}
            </Card>
          </div>}
        </div>

        <div className="space-y-5">
          <Card className="p-4">
            <div className="text-sm font-medium text-ink mb-3">{new Date(`${selected}T12:00:00`).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" })}</div>
            {dayEvents.length === 0 ? <Empty title="Nothing scheduled" action={<Button size="sm" onClick={() => { setNewTime(undefined); setEditing("new"); }}><Plus size={14} /> Add</Button>} /> :
              <div key={selected} className="stagger space-y-2">{dayEvents.map((e) => <EventRow key={e.id} e={e} clash={clashes.has(e.id)} who={me?.isAdmin ? person(e) : undefined} onEdit={() => setEditing(e)} onDone={() => setCompleting(e)} />)}</div>}
          </Card>
          {!!overdue.data?.length && (
            <Card className="p-4">
              <div className="text-sm font-medium text-bad mb-3">Overdue</div>
              <div className="space-y-2">{overdue.data.slice(0, 10).map((e) => <EventRow key={e.id} e={e} showDate who={me?.isAdmin ? person(e) : undefined} onEdit={() => setEditing(e)} onDone={() => setCompleting(e)} />)}</div>
            </Card>
          )}
        </div>
      </div>

      {drag && (
        <div className={cx("pill-ghost flex items-center gap-1 h-[22px] rounded-[7px] pl-0.5 pr-1.5 text-[11px] font-medium", groupOf(drag.ev.event_type).cls)}
          style={{ left: drag.x - drag.offX, top: drag.y - drag.offY, width: drag.width }}>
          <span className="grid place-items-center size-[18px] shrink-0 rounded-full bg-black/15 text-[8px] font-semibold">{initials(person(drag.ev))}</span>
          <span className="truncate">{drag.ev.leads?.name || drag.ev.title}</span>
        </div>
      )}

      {toast && <Toast message={toast.message} actionLabel={toast.undo ? "Undo" : undefined} onAction={toast.undo} onClose={closeToast} />}

      <Sheet open={!!editing} onClose={() => setEditing(null)} title={editing === "new" ? "New event" : "Edit event"}>
        {editing && <EventForm event={editing === "new" ? undefined : editing} defaultDate={selected} defaultTime={newTime} onDone={() => setEditing(null)} onCancel={() => setEditing(null)} />}
      </Sheet>
      <CompleteSheet ev={completing} onClose={() => setCompleting(null)} />
    </div>
  );
}

function EventRow({ e, onEdit, onDone, showDate, who, clash }: { e: Ev; onEdit: () => void; onDone: () => void; showDate?: boolean; who?: string; clash?: boolean }) {
  const done = e.status === "Completed";
  return (
    <div className={cx("rounded-2xl border border-line p-3 transition-colors hover:border-line-strong", done && "opacity-60")}>
      <div className="flex items-start gap-2">
        <span className={cx("mt-1 size-2 rounded-full shrink-0", `dot-${groupOf(e.event_type).cls}`)} />
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-ink-3 num">
            {showDate ? new Date(e.starts_at).toLocaleDateString("en-GB", { day: "numeric", month: "short" }) + " · " : ""}{fmtTime(e.starts_at)}
            <Badge tone={done ? "good" : "accent"}>{done ? "Done" : e.event_type}</Badge>
            {clash && <Badge tone="bad"><AlertTriangle size={10} /> Clash</Badge>}
            {who && <span className="truncate">· {who}</span>}
          </div>
          <div className={cx("text-sm text-ink mt-1", done && "line-through")}>{e.title}</div>
          {e.lead_id && <Link href={`/leads?open=${e.lead_id}`} className="text-xs text-accent-text hover:underline">{e.leads?.name || "Open lead"}</Link>}
          {e.outcome && <div className="text-xs text-ink-2 mt-1">{e.outcome}</div>}
        </div>
        {!done && (
          <div className="flex gap-0.5">
            <button onClick={onEdit} className="p-1.5 rounded-full text-ink-3 hover:text-ink hover:bg-surface-2 transition-colors" title="Edit"><Pencil size={14} /></button>
            <button onClick={onDone} className="p-1.5 rounded-full text-good hover:bg-good-soft transition-colors" title="Mark done"><Check size={15} /></button>
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

  useEffect(() => { setErr(""); }, [ev]);

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

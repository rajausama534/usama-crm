import { EVENT_TYPES } from "@/lib/crm";
import { ToolError, type BuntyModule, type BuntyTool, type BuntyCtx } from "../types";
import { dubaiIso, fmtDubai, must } from "../util";

const EV_COLS = "id,event_type,title,notes,starts_at,ends_at,status,completed_at,assigned_to,created_by,lead_id,outcome,leads(name)";

async function loadEvent(ctx: BuntyCtx, id: string) {
  const ev = must(await ctx.db.from("crm_events").select(EV_COLS).eq("id", id).maybeSingle(), "Event");
  if (!ev) throw new ToolError("Event not found (or you cannot see it).");
  return ev as unknown as Record<string, unknown> & { leads: { name: string | null } | null };
}

const listEvents: BuntyTool<{ from?: string; to?: string; assigned_to?: string; type?: string; status?: string }> = {
  name: "list_events",
  kind: "read",
  description: "Calendar events (viewings, meetings, calls, follow-ups, tasks) between two dates in Dubai time (default: today). Up to 50.",
  input_schema: {
    type: "object",
    properties: {
      from: { type: "string", format: "date" },
      to: { type: "string", format: "date", description: "Inclusive" },
      assigned_to: { type: "string", maxLength: 120 },
      type: { type: "string", enum: EVENT_TYPES },
      status: { type: "string", enum: ["Scheduled", "Completed", "Cancelled"] },
    },
    additionalProperties: false,
  },
  async run(ctx, i) {
    const from = i.from || ctx.today, to = i.to || from;
    let q = ctx.db.from("crm_events").select(EV_COLS).gte("starts_at", dubaiIso(from, "00:00")).lte("starts_at", `${to}T23:59:59+04:00`).order("starts_at").limit(50);
    if (i.assigned_to) q = q.ilike("assigned_to", i.assigned_to);
    if (i.type) q = q.eq("event_type", i.type);
    if (i.status) q = q.eq("status", i.status);
    const rows = must(await q, "Calendar") as unknown as Record<string, unknown>[];
    return rows.map((e) => ({ ...e, when: fmtDubai(e.starts_at as string) }));
  },
};

const createEvent: BuntyTool<{ type: string; title: string; date: string; time?: string; duration_minutes?: number; notes?: string; lead_id?: string; assigned_to?: string; remind_minutes?: number }> = {
  name: "create_event",
  kind: "write",
  description: "Book a viewing, meeting, call, follow-up, reminder or task in the calendar (Dubai time). Can be linked to a lead.",
  input_schema: {
    type: "object",
    properties: {
      type: { type: "string", enum: EVENT_TYPES },
      title: { type: "string", maxLength: 200 },
      date: { type: "string", format: "date" },
      time: { type: "string", format: "time", description: "24h HH:MM, Dubai" },
      duration_minutes: { type: "integer", minimum: 5, maximum: 600 },
      notes: { type: "string", maxLength: 2000 },
      lead_id: { type: "string" },
      assigned_to: { type: "string", maxLength: 120, description: "Staff email; default the person asking" },
      remind_minutes: { type: "integer", minimum: 0, maximum: 10080 },
    },
    required: ["type", "title", "date"], additionalProperties: false,
  },
  async preview(ctx, i) {
    let lead = "";
    if (i.lead_id) {
      const l = await ctx.db.from("leads").select("name").eq("id", i.lead_id).maybeSingle();
      if (!l.data) throw new ToolError("Lead not found");
      lead = (l.data as { name: string }).name;
    }
    const start = dubaiIso(i.date, i.time || "09:00");
    return {
      title: `Book ${i.type.toLowerCase()}: ${i.title}`,
      lines: [
        `When: ${fmtDubai(start)}${i.duration_minutes ? ` for ${i.duration_minutes} min` : ""}`,
        ...(lead ? [`Lead: ${lead}`] : []),
        `For: ${i.assigned_to || ctx.me.name}`,
        ...(i.notes ? [`Notes: ${i.notes}`] : []),
      ],
    };
  },
  async run(ctx, i) {
    const starts_at = dubaiIso(i.date, i.time || "09:00");
    const ends_at = i.duration_minutes ? new Date(Date.parse(starts_at) + i.duration_minutes * 60000).toISOString() : null;
    const row = must(await ctx.db.from("crm_events").insert({
      event_type: i.type, title: i.title, starts_at, ends_at, notes: i.notes || null, lead_id: i.lead_id || null,
      assigned_to: (i.assigned_to || ctx.me.email).toLowerCase(), remind_minutes: i.remind_minutes ?? 30,
    }).select("id").single(), "Book event") as { id: string };
    if (i.lead_id) {
      await ctx.db.from("lead_activities").insert({ lead_id: i.lead_id, activity_type: i.type, details: `${i.type} booked for ${fmtDubai(starts_at)}: ${i.title}.`, created_by: ctx.actor });
    }
    return { ok: true, id: row.id, link: "/calendar" };
  },
};

const updateEvent: BuntyTool<{ id: string; status?: string; date?: string; time?: string; outcome?: string; title?: string }> = {
  name: "update_event",
  kind: "write",
  description: "Mark an event done or cancelled, move it to another date/time, rename it, or record its outcome.",
  input_schema: {
    type: "object",
    properties: {
      id: { type: "string" },
      status: { type: "string", enum: ["Scheduled", "Completed", "Cancelled"] },
      date: { type: "string", format: "date" },
      time: { type: "string", format: "time" },
      title: { type: "string", maxLength: 200 },
      outcome: { type: "string", maxLength: 1000 },
    },
    required: ["id"], additionalProperties: false,
  },
  async preview(ctx, i) {
    const ev = await loadEvent(ctx, i.id);
    const lines: string[] = [];
    if (i.status && i.status !== ev.status) lines.push(`Status: ${ev.status} → ${i.status}`);
    if (i.date || i.time) {
      const cur = new Date(ev.starts_at as string);
      const d = i.date || new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Dubai" }).format(cur);
      const t = i.time || new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Dubai", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(cur);
      lines.push(`When: ${fmtDubai(ev.starts_at as string)} → ${fmtDubai(dubaiIso(d, t))}`);
    }
    if (i.title) lines.push(`Title: ${ev.title} → ${i.title}`);
    if (i.outcome) lines.push(`Outcome: ${i.outcome}`);
    return { title: `${ev.event_type}: ${ev.title}${ev.leads?.name ? ` (${ev.leads.name})` : ""}`, lines: lines.length ? lines : ["No change"] };
  },
  async run(ctx, i) {
    const ev = await loadEvent(ctx, i.id);
    const patch: Record<string, unknown> = {};
    if (i.status) { patch.status = i.status; patch.completed_at = i.status === "Completed" ? new Date().toISOString() : null; }
    if (i.title) patch.title = i.title;
    if (i.outcome) patch.outcome = i.outcome;
    if (i.date || i.time) {
      const cur = new Date(ev.starts_at as string);
      const d = i.date || new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Dubai" }).format(cur);
      const t = i.time || new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Dubai", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(cur);
      patch.starts_at = dubaiIso(d, t);
      if (ev.ends_at) patch.ends_at = new Date(Date.parse(patch.starts_at as string) + (Date.parse(ev.ends_at as string) - Date.parse(ev.starts_at as string))).toISOString();
    }
    must(await ctx.db.from("crm_events").update(patch).eq("id", i.id).select("id").single(), "Update event");
    if (ev.lead_id && (i.status || i.outcome)) {
      await ctx.db.from("lead_activities").insert({
        lead_id: ev.lead_id, activity_type: ev.event_type as string,
        details: `${ev.event_type} “${ev.title}” ${i.status ? i.status.toLowerCase() : "updated"}${i.outcome ? `: ${i.outcome}` : ""}.`, created_by: ctx.actor,
      });
    }
    return { ok: true, link: "/calendar" };
  },
};

export const calendar: BuntyModule = {
  department: "tasks",
  tools: [listEvents, createEvent, updateEvent],
  guide: `Calendar event types: ${EVENT_TYPES.join(", ")}. All times are Dubai time (UTC+4). "My tasks" = the asking person's own calendar.`,
  async pending(ctx) {
    const rows = must(await ctx.db.from("crm_events").select("id,event_type,title,starts_at,leads(name)")
      .eq("status", "Scheduled").ilike("assigned_to", ctx.me.email)
      .gte("starts_at", dubaiIso(ctx.today, "00:00")).lte("starts_at", `${ctx.today}T23:59:59+04:00`).order("starts_at").limit(20), "Calendar") as unknown as
      { event_type: string; title: string; starts_at: string; leads: { name: string | null } | null }[];
    const overdue = await ctx.db.from("crm_events").select("id", { count: "exact", head: true })
      .eq("status", "Scheduled").ilike("assigned_to", ctx.me.email).lt("starts_at", dubaiIso(ctx.today, "00:00"));
    const time = (iso: string) => new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Dubai", hour: "numeric", minute: "2-digit", hour12: true }).format(new Date(iso));
    const items = rows.slice(0, 5).map((e) => ({ text: `${time(e.starts_at)} · ${e.event_type}: ${e.title}${e.leads?.name ? ` (${e.leads.name})` : ""}`, tone: "info" as const }));
    if (overdue.count) items.unshift({ text: `${overdue.count} earlier event${overdue.count > 1 ? "s" : ""} not marked done`, tone: "bad" as never });
    const count = rows.length + (overdue.count || 0);
    if (!items.length) items.push({ text: "Nothing in your calendar today.", tone: "good" as never });
    return { count, title: count ? `My tasks · ${rows.length} today` : "My tasks · all done", items, actions: ["What's on today?", "Book a viewing"] };
  },
};

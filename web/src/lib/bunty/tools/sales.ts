// Sales: leads and owners. Owner records are never deleted or merged by Bunty, and owner names/phones are not
// changed here: only status, follow-up date and notes (notes are added, never overwritten).

import { BEDROOMS, LEAD_SOURCES, LEAD_STAGES, OWNER_STATUSES, PROPERTY_TYPES, loadOwnerStatuses } from "@/lib/crm";
import { ToolError, type BuntyModule, type BuntyTool, type BuntyCtx } from "../types";
import { changeLines, cut, must, orSafe } from "../util";

const LEAD_COLS = "id,name,phone,email,project_inquired,budget,property_type,bedroom,source,status,follow_up_date,follow_up_time,last_contacted,assigned_to,created_at";
const OWNER_COLS = "id,community,cluster,unit,owner,phone1,phone2,email,status,last_contacted,follow_up_date,assigned_to,remarks,is_primary";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function loadLead(ctx: BuntyCtx, id: string) {
  if (!UUID.test(id)) throw new ToolError("That is not a lead id. Search for the lead first.");
  const row = must(await ctx.db.from("leads").select(LEAD_COLS).eq("id", id).maybeSingle(), "Lead");
  if (!row) throw new ToolError("Lead not found (or you cannot see it).");
  return row as Record<string, string | null>;
}
async function loadOwner(ctx: BuntyCtx, id: number) {
  const row = must(await ctx.db.from("owners").select(OWNER_COLS).eq("id", id).maybeSingle(), "Owner");
  if (!row) throw new ToolError("Owner not found (or you cannot see it).");
  return row as Record<string, string | number | boolean | null>;
}
const leadLabel = (l: Record<string, unknown>) => `${l.name || "Unnamed lead"}${l.project_inquired ? ` (${l.project_inquired})` : ""}`;
const ownerLabel = (o: Record<string, unknown>) => `${o.owner || "Unknown owner"} · ${[o.community, o.cluster, o.unit].filter(Boolean).join(" ")}`;

// ---------------------------------------------------------------- leads
const searchLeads: BuntyTool<{ query?: string; status?: string; assigned_to?: string; follow_up?: string; limit?: number }> = {
  name: "search_leads",
  kind: "read",
  description: "Find leads by name, phone or project, and/or filter by stage, assigned agent email, or follow-up timing (overdue / today / next_7_days / none). Returns up to 25 leads, newest first, plus the total count.",
  input_schema: {
    type: "object",
    properties: {
      query: { type: "string", maxLength: 80, description: "Name, phone digits or project name" },
      status: { type: "string", enum: LEAD_STAGES },
      assigned_to: { type: "string", maxLength: 120, description: "Agent email" },
      follow_up: { type: "string", enum: ["overdue", "today", "next_7_days", "none"] },
      limit: { type: "integer", minimum: 1, maximum: 25 },
    },
    additionalProperties: false,
  },
  async run(ctx, i) {
    let q = ctx.db.from("leads").select(LEAD_COLS, { count: "exact" }).order("created_at", { ascending: false }).limit(i.limit || 15);
    const term = orSafe(i.query || "");
    if (term) {
      const digits = term.replace(/\D/g, "");
      const ors = [`name.ilike.%${term}%`, `project_inquired.ilike.%${term}%`];
      if (digits.length >= 4) ors.push(`phone.ilike.%${digits.slice(-9)}%`);
      q = q.or(ors.join(","));
    }
    if (i.status) q = q.eq("status", i.status);
    if (i.assigned_to) q = q.ilike("assigned_to", orSafe(i.assigned_to));
    const in7 = new Date(Date.parse(ctx.today) + 7 * 864e5).toISOString().slice(0, 10);
    if (i.follow_up === "overdue") q = q.lt("follow_up_date", ctx.today).not("status", "in", "(Won,Lost)");
    if (i.follow_up === "today") q = q.eq("follow_up_date", ctx.today);
    if (i.follow_up === "next_7_days") q = q.gte("follow_up_date", ctx.today).lte("follow_up_date", in7);
    if (i.follow_up === "none") q = q.is("follow_up_date", null).not("status", "in", "(Won,Lost)");
    const res = await q;
    must(res, "Leads");
    return { total: res.count, leads: res.data };
  },
};

const getLead: BuntyTool<{ id: string }> = {
  name: "get_lead",
  kind: "read",
  description: "Full details of one lead: fields, the last 15 notes/history entries and upcoming calendar events.",
  input_schema: { type: "object", properties: { id: { type: "string", description: "Lead id (uuid)" } }, required: ["id"], additionalProperties: false },
  async run(ctx, i) {
    const lead = await loadLead(ctx, i.id);
    const [acts, evs, full] = await Promise.all([
      ctx.db.from("lead_activities").select("activity_type,details,created_by,created_at").eq("lead_id", i.id).order("created_at", { ascending: false }).limit(15),
      ctx.db.from("crm_events").select("id,event_type,title,starts_at,status,assigned_to").eq("lead_id", i.id).order("starts_at", { ascending: false }).limit(10),
      ctx.db.from("leads").select("notes").eq("id", i.id).maybeSingle(),
    ]);
    return {
      lead: { ...lead, notes: cut((full.data as { notes?: string } | null)?.notes, 800) },
      history: (acts.data || []).map((a) => ({ ...a, details: cut(a.details as string, 400) })),
      events: evs.data || [],
    };
  },
};

type LeadFields = {
  name?: string; phone?: string; email?: string; project_inquired?: string; budget?: string; property_type?: string; bedroom?: string;
  source?: string; status?: string; follow_up_date?: string; follow_up_time?: string; assigned_to?: string;
};
const leadFieldProps = {
  name: { type: "string", maxLength: 120 },
  phone: { type: "string", maxLength: 40 },
  email: { type: "string", maxLength: 120 },
  project_inquired: { type: "string", maxLength: 120 },
  budget: { type: "string", maxLength: 60 },
  property_type: { type: "string", enum: PROPERTY_TYPES },
  bedroom: { type: "string", enum: BEDROOMS },
  source: { type: "string", enum: LEAD_SOURCES },
  status: { type: "string", enum: LEAD_STAGES },
  follow_up_date: { type: "string", format: "date" },
  follow_up_time: { type: "string", format: "time" },
  assigned_to: { type: "string", maxLength: 120, description: "Agent email (use list_staff)" },
} as const;
const LEAD_LABELS: Record<string, string> = {
  name: "Name", phone: "Phone", email: "Email", project_inquired: "Project", budget: "Budget", property_type: "Type", bedroom: "Bedrooms",
  source: "Source", status: "Stage", follow_up_date: "Follow-up date", follow_up_time: "Follow-up time", assigned_to: "Agent",
};

const createLead: BuntyTool<LeadFields> = {
  name: "create_lead",
  kind: "write",
  description: "Add a new lead. Search first to avoid duplicates (same phone). Stage defaults to New and the agent to the person asking.",
  input_schema: { type: "object", properties: { ...leadFieldProps }, required: ["name"], additionalProperties: false },
  async preview(_ctx, i) {
    return { title: `Add lead ${i.name}`, lines: Object.entries(i).filter(([k]) => k !== "name").map(([k, v]) => `${LEAD_LABELS[k] || k}: ${v}`) };
  },
  async run(ctx, i) {
    const payload = { status: "New", assigned_to: ctx.me.email, lead_receive_date: ctx.today, ...i };
    const row = must(await ctx.db.from("leads").insert(payload).select("id,name").single(), "Add lead") as { id: string; name: string };
    await ctx.db.from("lead_activities").insert({ lead_id: row.id, activity_type: "Lead Created", details: "Lead added by Bunty.", created_by: ctx.actor });
    return { ok: true, id: row.id, link: `/leads?open=${row.id}` };
  },
};

const updateLead: BuntyTool<LeadFields & { id: string }> = {
  name: "update_lead",
  kind: "write",
  description: "Change fields of an existing lead (stage, follow-up date/time, agent, budget, project…). Only the fields given are changed.",
  input_schema: { type: "object", properties: { id: { type: "string" }, ...leadFieldProps }, required: ["id"], additionalProperties: false },
  async preview(ctx, { id, ...patch }) {
    const lead = await loadLead(ctx, id);
    const lines = changeLines(lead, patch, LEAD_LABELS);
    return { title: `Update lead ${leadLabel(lead)}`, lines: lines.length ? lines : ["No change"] };
  },
  async run(ctx, { id, ...patch }) {
    const lead = await loadLead(ctx, id);
    must(await ctx.db.from("leads").update(patch).eq("id", id).select("id").single(), "Update lead");
    const lines = changeLines(lead, patch, LEAD_LABELS);
    if (lines.length) {
      const type = patch.status && patch.status !== lead.status ? "Status Change" : "Lead updated";
      await ctx.db.from("lead_activities").insert({ lead_id: id, activity_type: type, details: lines.join("; ") + ".", created_by: ctx.actor });
    }
    return { ok: true, changed: lines, link: `/leads?open=${id}` };
  },
};

const NOTE_TYPES = ["Note", "Call", "WhatsApp", "Meeting", "Viewing", "Email"] as const;
const addLeadNote: BuntyTool<{ id: string; text: string; type?: string }> = {
  name: "add_lead_note",
  kind: "write",
  description: "Add a note to a lead's history (never overwrites earlier notes) and mark the lead as contacted today.",
  input_schema: {
    type: "object",
    properties: { id: { type: "string" }, text: { type: "string", maxLength: 2000 }, type: { type: "string", enum: NOTE_TYPES } },
    required: ["id", "text"], additionalProperties: false,
  },
  async preview(ctx, i) {
    const lead = await loadLead(ctx, i.id);
    return { title: `Add ${(i.type || "note").toLowerCase()} to ${leadLabel(lead)}`, lines: [`“${i.text}”`] };
  },
  async run(ctx, i) {
    await loadLead(ctx, i.id);
    must(await ctx.db.from("lead_activities").insert({ lead_id: i.id, activity_type: i.type || "Note", details: i.text, created_by: ctx.actor }).select("id").single(), "Add note");
    await ctx.db.from("leads").update({ last_contacted: ctx.today }).eq("id", i.id);
    return { ok: true, link: `/leads?open=${i.id}` };
  },
};

// ---------------------------------------------------------------- owners
const searchOwners: BuntyTool<{ query?: string; community?: string; cluster?: string; unit?: string; status?: string; bedrooms?: string; follow_up?: string; limit?: number }> = {
  name: "search_owners",
  kind: "read",
  description: "Find property owners by name, phone or unit, and/or filter by community, cluster (sub-community / project), unit, status, bedrooms (from unit details, e.g. \"4\"), or follow-up timing. Returns up to 25 owners plus the total count.",
  input_schema: {
    type: "object",
    properties: {
      query: { type: "string", maxLength: 80, description: "Owner name, phone digits or unit number" },
      community: { type: "string", maxLength: 80, description: "e.g. The Valley, Arabian Ranches 3" },
      cluster: { type: "string", maxLength: 80, description: "e.g. Alana, Golf Homes" },
      unit: { type: "string", maxLength: 40 },
      status: { type: "string", maxLength: 40, description: "Owner status (standard or the admin's custom ones)" },
      bedrooms: { type: "string", maxLength: 10 },
      follow_up: { type: "string", enum: ["overdue", "today"] },
      limit: { type: "integer", minimum: 1, maximum: 25 },
    },
    additionalProperties: false,
  },
  async run(ctx, i) {
    type UnitRow = { community: string; cluster: string; unit: string; bedrooms: string | null };
    let units: UnitRow[] | null = null as UnitRow[] | null;
    if (i.bedrooms) {
      let u = ctx.db.from("unit_details").select("community,cluster,unit,bedrooms").ilike("bedrooms", `${orSafe(i.bedrooms)}%`).limit(1000);
      if (i.community) u = u.ilike("community", `%${orSafe(i.community)}%`);
      if (i.cluster) u = u.ilike("cluster", `%${orSafe(i.cluster)}%`);
      units = must(await u, "Unit details") as unknown as UnitRow[];
      if (!units!.length) return { total: 0, owners: [], note: "No units with that bedroom count are recorded in unit details." };
    }
    let q = ctx.db.from("owners").select(OWNER_COLS, { count: "exact" }).order("community").order("cluster").order("unit").limit(i.limit || 15);
    const term = orSafe(i.query || "");
    if (term) {
      const digits = term.replace(/\D/g, "");
      const ors = [`owner.ilike.%${term}%`, `unit.ilike.${term}`];
      if (digits.length >= 4) ors.push(`phone1.ilike.%${digits.slice(-9)}%`, `phone2.ilike.%${digits.slice(-9)}%`);
      q = q.or(ors.join(","));
    }
    if (i.community) q = q.ilike("community", `%${orSafe(i.community)}%`);
    if (i.cluster) q = q.ilike("cluster", `%${orSafe(i.cluster)}%`);
    if (i.unit) q = q.ilike("unit", orSafe(i.unit));
    if (i.status) q = q.eq("status", i.status);
    if (i.follow_up === "overdue") q = q.lt("follow_up_date", ctx.today);
    if (i.follow_up === "today") q = q.eq("follow_up_date", ctx.today);
    if (units) q = q.in("unit", [...new Set(units.map((u) => u.unit))].slice(0, 300));
    const res = await q;
    must(res, "Owners");
    let rows = (res.data || []) as Record<string, unknown>[];
    if (units) {
      const key = (c: unknown, cl: unknown, un: unknown) => `${c}|${cl}|${un}`.toLowerCase();
      const beds = new Map(units.map((u) => [key(u.community, u.cluster, u.unit), u.bedrooms]));
      rows = rows.filter((r) => beds.has(key(r.community, r.cluster, r.unit))).map((r) => ({ ...r, bedrooms: beds.get(key(r.community, r.cluster, r.unit)) }));
    }
    return { total: units ? rows.length : res.count, owners: rows.map((r) => ({ ...r, remarks: cut(r.remarks as string, 200) })) };
  },
};

const getOwner: BuntyTool<{ id: number }> = {
  name: "get_owner",
  kind: "read",
  description: "Full details of one owner record: contact fields, remarks, unit details, the last 15 notes and other owners of the same unit.",
  input_schema: { type: "object", properties: { id: { type: "integer", description: "Owner id" } }, required: ["id"], additionalProperties: false },
  async run(ctx, i) {
    const o = await loadOwner(ctx, i.id);
    const [acts, same, ud] = await Promise.all([
      ctx.db.from("owner_activities").select("activity_type,details,created_by,created_at").eq("owner_id", String(i.id)).order("created_at", { ascending: false }).limit(15),
      ctx.db.from("owners").select("id,owner,phone1,status,is_primary").eq("community", o.community as string).eq("cluster", o.cluster as string).eq("unit", o.unit as string).neq("id", i.id).limit(10),
      ctx.db.from("unit_details").select("property_type,bedrooms,bua_sqft,plot_sqft").eq("community", o.community as string).eq("cluster", o.cluster as string).eq("unit", o.unit as string).maybeSingle(),
    ]);
    return {
      owner: { ...o, remarks: cut(o.remarks as string, 800) },
      unit_details: ud.data,
      other_owners_same_unit: same.data || [],
      history: (acts.data || []).map((a) => ({ ...a, details: cut(a.details as string, 400) })),
    };
  },
};

const updateOwner: BuntyTool<{ id: number; status?: string; follow_up_date?: string }> = {
  name: "update_owner",
  kind: "write",
  description: "Change an owner record's status and/or follow-up date. (Names, phones and remarks are not changed by Bunty; add a note instead.)",
  input_schema: {
    type: "object",
    properties: { id: { type: "integer" }, status: { type: "string", maxLength: 40, description: "Owner status (standard or the admin's custom ones)" }, follow_up_date: { type: "string", format: "date" } },
    required: ["id"], additionalProperties: false,
  },
  async preview(ctx, { id, ...patch }) {
    await checkOwnerStatus(ctx, patch.status);
    const o = await loadOwner(ctx, id);
    const lines = changeLines(o, patch, { status: "Status", follow_up_date: "Follow-up date" });
    return { title: `Update owner ${ownerLabel(o)}`, lines: lines.length ? lines : ["No change"] };
  },
  async run(ctx, { id, ...patch }) {
    if (!Object.keys(patch).length) throw new ToolError("Nothing to change");
    await checkOwnerStatus(ctx, patch.status);
    const o = await loadOwner(ctx, id);
    const lines = changeLines(o, patch, { status: "Status", follow_up_date: "Follow-up date" });
    must(await ctx.db.from("owners").update(patch).eq("id", id).select("id").single(), "Update owner");
    if (lines.length) {
      const type = patch.status ? "Status changed" : "Owner details updated";
      await ctx.db.from("owner_activities").insert({ owner_id: String(id), activity_type: type, details: lines.join("; ") + ".", created_by: ctx.actor });
    }
    return { ok: true, changed: lines, link: `/owners?open=${id}` };
  },
};

async function checkOwnerStatus(ctx: BuntyCtx, status?: string) {
  if (status == null) return;
  const all = await loadOwnerStatuses(ctx.db);
  if (!all.includes(status)) throw new ToolError(`Unknown owner status "${status}". Use one of: ${all.join(", ")}`);
}

const addOwnerNote: BuntyTool<{ id: number; text: string; type?: string }> = {
  name: "add_owner_note",
  kind: "write",
  description: "Add a note to an owner's history (never overwrites earlier notes or remarks) and mark them as contacted today.",
  input_schema: {
    type: "object",
    properties: { id: { type: "integer" }, text: { type: "string", maxLength: 2000 }, type: { type: "string", enum: NOTE_TYPES } },
    required: ["id", "text"], additionalProperties: false,
  },
  async preview(ctx, i) {
    const o = await loadOwner(ctx, i.id);
    return { title: `Add ${(i.type || "note").toLowerCase()} to ${ownerLabel(o)}`, lines: [`“${i.text}”`] };
  },
  async run(ctx, i) {
    await loadOwner(ctx, i.id);
    must(await ctx.db.from("owner_activities").insert({ owner_id: String(i.id), activity_type: i.type || "Note", details: i.text, created_by: ctx.actor }).select("id").single(), "Add note");
    await ctx.db.from("owners").update({ last_contacted: ctx.today }).eq("id", i.id);
    return { ok: true, link: `/owners?open=${i.id}` };
  },
};

const listStaff: BuntyTool<Record<string, never>> = {
  name: "list_staff",
  kind: "read",
  description: "Names, emails and roles of active staff (to assign leads or events).",
  input_schema: { type: "object", properties: {}, additionalProperties: false },
  async run(ctx) {
    const dir = await ctx.db.rpc("crm_staff_directory");
    if (!dir.error) return dir.data;
    return must(await ctx.db.from("user_access").select("email,name,role,active").eq("active", true).order("name"), "Staff");
  },
};

export const sales: BuntyModule = {
  department: "sales",
  tools: [searchLeads, getLead, createLead, updateLead, addLeadNote, searchOwners, getOwner, updateOwner, addOwnerNote, listStaff],
  guide: "Sales covers leads (buyers/tenants asking about property) and owners (the owner database by community → cluster → unit). " +
    `Lead stages: ${LEAD_STAGES.join(", ")}. Owner statuses: ${OWNER_STATUSES.join(", ")}, plus any custom ones the admin added (an unknown one is refused with the full list). Never delete or merge owner records.`,
  async pending(ctx) {
    const [over, today, ownersToday, noFollow] = await Promise.all([
      ctx.db.from("leads").select("id,name", { count: "exact" }).lt("follow_up_date", ctx.today).not("status", "in", "(Won,Lost)").order("follow_up_date").limit(3),
      ctx.db.from("leads").select("id", { count: "exact", head: true }).eq("follow_up_date", ctx.today),
      ctx.db.from("owners").select("id", { count: "exact", head: true }).lte("follow_up_date", ctx.today).gte("follow_up_date", new Date(Date.parse(ctx.today) - 30 * 864e5).toISOString().slice(0, 10)),
      ctx.db.from("leads").select("id", { count: "exact", head: true }).eq("status", "New").lt("created_at", new Date(Date.now() - 2 * 864e5).toISOString()),
    ]);
    const items: { text: string; tone: "bad" | "warn" | "info" | "good" }[] = [];
    const names = (over.data || []).map((l) => l.name).filter(Boolean).join(", ");
    if (over.count) items.push({ text: `${over.count} lead follow-up${over.count > 1 ? "s" : ""} overdue${names ? ` — ${names}${over.count > 3 ? "…" : ""}` : ""}`, tone: "bad" });
    if (today.count) items.push({ text: `${today.count} lead follow-up${today.count > 1 ? "s" : ""} due today`, tone: "warn" });
    if (ownersToday.count) items.push({ text: `${ownersToday.count} owner call-back${ownersToday.count > 1 ? "s" : ""} due`, tone: "warn" });
    if (noFollow.count) items.push({ text: `${noFollow.count} new lead${noFollow.count > 1 ? "s" : ""} not contacted for 2+ days`, tone: "bad" });
    const count = (over.count || 0) + (today.count || 0) + (ownersToday.count || 0) + (noFollow.count || 0);
    if (!items.length) items.push({ text: "No follow-ups waiting. Nice.", tone: "good" });
    return { count, title: count ? `Sales · ${count} pending` : "Sales · all clear", items, actions: ["Show overdue follow-ups", "Add a lead"] };
  },
};

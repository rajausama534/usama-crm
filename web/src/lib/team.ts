"use client";

// Team performance: what each person did (calls, WhatsApp, notes, status updates, viewings, deals, revenue)
// in a period. Everything is read with the viewer's own access (Row Level Security): admins see everyone,
// team leaders their team, agents themselves.
import { useQuery } from "@tanstack/react-query";
import { db } from "@/lib/supabase";
import { useAuth } from "@/components/Providers";
import { COUNTED, dealMoney, num, r2, type Deal, type Split } from "@/lib/company/calc";
import { isMissing } from "@/lib/company/data";

export type PeriodKey = "today" | "week" | "month" | "30d" | "year";
export const PERIODS: { value: PeriodKey; label: string }[] = [
  { value: "today", label: "Today" }, { value: "week", label: "This week" }, { value: "month", label: "This month" },
  { value: "30d", label: "30 days" }, { value: "year", label: "This year" },
];

const dubaiDay = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Dubai" }).format(d);
const addDays = (day: string, n: number) => { const d = new Date(`${day}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

/** First and last Dubai day of the period (weeks start Monday). */
export function periodRange(p: PeriodKey): { from: string; to: string; days: string[] } {
  const today = dubaiDay(new Date());
  let from = today;
  if (p === "week") { const wd = (new Date(`${today}T12:00:00Z`).getUTCDay() + 6) % 7; from = addDays(today, -wd); }
  else if (p === "month") from = `${today.slice(0, 7)}-01`;
  else if (p === "30d") from = addDays(today, -29);
  else if (p === "year") from = `${today.slice(0, 4)}-01-01`;
  const days: string[] = [];
  for (let d = from; d <= today; d = addDays(d, 1)) days.push(d);
  return { from, to: today, days };
}
const startOf = (day: string) => new Date(`${day}T00:00:00+04:00`).toISOString();
const endOf = (day: string) => new Date(`${day}T23:59:59.999+04:00`).toISOString();

export type Person = {
  id: string | null; email: string; name: string; role: string; team_leader: string | null; user_id: string | null;
  areas: string[]; active: boolean;
};
export type Act = { kind: "owner" | "lead"; ref: string; type: string; details: string | null; by: string; at: string };
export type Ev = { id: string; event_type: string; title: string; status: string; starts_at: string; completed_at: string | null; assigned_to: string; outcome: string | null; lead_id: string | null };
export type LeadLite = { id: string; name: string | null; status: string | null; assigned_to: string | null; created_at: string; follow_up_date: string | null; source: string | null; project_inquired: string | null };

export type Kind = "call" | "whatsapp" | "note" | "status" | "lead" | "event" | "other";
/** Groups the free-text activity types the CRM writes into a few buckets. */
export function kindOf(type: string): Kind {
  const t = type.toLowerCase();
  if (t.includes("whatsapp")) return "whatsapp";
  if (t === "call" || t.includes("phone call") || t === "called") return "call";
  if (t.includes("status")) return "status";
  if (t.includes("note") || t.includes("remark")) return "note";
  if (t.includes("lead created")) return "lead";
  if (t.startsWith("scheduled") || t.startsWith("completed")) return "event";
  return "other";
}

export type Metrics = {
  calls: number; whatsapp: number; notes: number; statusChanges: number; leadsAdded: number; other: number; touches: number;
  ownersReached: number; leadsWorked: number; activeDays: number; lastActive: string | null;
  viewingsDone: number; meetingsDone: number; eventsDone: number; eventsOverdue: number;
  leadsTotal: number; leadsActive: number; leadsWon: number; leadsLost: number; leadsNew: number; followupsOverdue: number; followupsToday: number;
  deals: number; dealValue: number; revenue: number; earned: number;
  perDay: Record<string, { call: number; whatsapp: number; other: number }>;
};
const blank = (): Metrics => ({
  calls: 0, whatsapp: 0, notes: 0, statusChanges: 0, leadsAdded: 0, other: 0, touches: 0, ownersReached: 0, leadsWorked: 0, activeDays: 0, lastActive: null,
  viewingsDone: 0, meetingsDone: 0, eventsDone: 0, eventsOverdue: 0, leadsTotal: 0, leadsActive: 0, leadsWon: 0, leadsLost: 0, leadsNew: 0,
  followupsOverdue: 0, followupsToday: 0, deals: 0, dealValue: 0, revenue: 0, earned: 0, perDay: {},
});

async function pageAll<T>(build: (from: number, to: number) => PromiseLike<{ data: unknown; error: { message: string } | null }>, cap = 20000): Promise<T[] | null> {
  const out: T[] = [];
  for (let from = 0; from < cap; from += 1000) {
    const { data, error } = await build(from, from + 999);
    if (error) { if (isMissing(error.message)) return null; throw new Error(error.message); }
    const rows = (data || []) as T[];
    out.push(...rows);
    if (rows.length < 1000) break;
  }
  return out;
}

/** People to report on: everyone the viewer can see in Users & access (admins), else the staff directory. */
export function usePeople() {
  const { me } = useAuth();
  return useQuery({
    queryKey: ["team-people"],
    enabled: !!me,
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<Person[]> => {
      const full = await db.from("user_access").select("id,email,name,role,active,team_leader,user_id,assigned_communities,assigned_clusters").order("name");
      const rows = (full.data || []) as { id: string; email: string; name: string | null; role: string | null; active: boolean | null; team_leader: string | null; user_id: string | null; assigned_communities: string[] | null; assigned_clusters: string[] | null }[];
      let people: Person[] = rows.map((u) => ({
        id: u.id, email: u.email.toLowerCase(), name: u.name || u.email.split("@")[0], role: (u.role || "agent").toLowerCase(),
        team_leader: u.team_leader?.toLowerCase() || null, user_id: u.user_id, active: u.active !== false,
        areas: [...(u.assigned_communities || []), ...(u.assigned_clusters || [])],
      }));
      if (rows.length <= 1) {
        // Not an admin: user_access only returns the viewer's own row, so take colleagues' names from the directory.
        const dir = await db.rpc("crm_staff_directory");
        for (const d of (dir.data || []) as { email: string; name: string | null; role: string | null; team_leader: string | null }[]) {
          if (people.some((p) => p.email === d.email)) continue;
          people.push({ id: null, email: d.email, name: d.name || d.email.split("@")[0], role: (d.role || "agent").toLowerCase(), team_leader: d.team_leader, user_id: null, active: true, areas: [] });
        }
      }
      // The read-only Bunty login is not a person.
      people = people.filter((p) => !p.email.includes("+bunty"));
      return people;
    },
  });
}

/** Everything that happened in the period, plus open leads and follow-ups (which are "now", not periodic). */
export function useTeamData(period: PeriodKey) {
  const { me } = useAuth();
  const range = periodRange(period);
  return useQuery({
    queryKey: ["team-data", period, range.from, range.to],
    enabled: !!me,
    staleTime: 60_000,
    queryFn: async () => {
      const from = startOf(range.from), to = endOf(range.to);
      const [oa, la, ev, leads, deals, splits] = await Promise.all([
        pageAll<{ owner_id: string; activity_type: string; details: string | null; created_by: string; created_at: string }>((a, b) =>
          db.from("owner_activities").select("owner_id,activity_type,details,created_by,created_at").gte("created_at", from).lte("created_at", to).like("created_by", "%@%").order("created_at", { ascending: false }).range(a, b)),
        pageAll<{ lead_id: string; activity_type: string; details: string | null; created_by: string; created_at: string }>((a, b) =>
          db.from("lead_activities").select("lead_id,activity_type,details,created_by,created_at").gte("created_at", from).lte("created_at", to).like("created_by", "%@%").order("created_at", { ascending: false }).range(a, b)),
        pageAll<Ev>((a, b) => db.from("crm_events").select("id,event_type,title,status,starts_at,completed_at,assigned_to,outcome,lead_id").or(`and(starts_at.gte.${from},starts_at.lte.${to}),and(status.eq.Scheduled,starts_at.lt.${from})`).range(a, b)),
        pageAll<LeadLite>((a, b) => db.from("leads").select("id,name,status,assigned_to,created_at,follow_up_date,source,project_inquired").range(a, b)),
        pageAll<Deal>((a, b) => db.from("crm_deals").select("*").neq("status", "cancelled").range(a, b)),
        pageAll<Split>((a, b) => db.from("crm_deal_splits").select("*").range(a, b)),
      ]);
      const acts: Act[] = [
        ...(oa || []).map((r) => ({ kind: "owner" as const, ref: String(r.owner_id), type: r.activity_type, details: r.details, by: r.created_by.toLowerCase(), at: r.created_at })),
        ...(la || []).map((r) => ({ kind: "lead" as const, ref: String(r.lead_id), type: r.activity_type, details: r.details, by: r.created_by.toLowerCase(), at: r.created_at })),
      ].sort((a, b) => b.at.localeCompare(a.at));
      return { range, acts, events: ev || [], leads: leads || [], deals: deals, splits: splits };
    },
  });
}
export type TeamData = NonNullable<ReturnType<typeof useTeamData>["data"]>;

/** Each person's figures for the period. Deals count for the agents on the split, by their share. */
export function computeMetrics(data: TeamData, emails: string[]): Map<string, Metrics> {
  const { range } = data;
  const today = range.to;
  const out = new Map<string, Metrics>(emails.map((e) => [e, blank()]));
  const get = (e: string | null | undefined) => (e ? out.get(e.toLowerCase()) : undefined);
  const owners = new Map<string, Set<string>>(), leadsW = new Map<string, Set<string>>(), days = new Map<string, Set<string>>();
  const add = (m: Map<string, Set<string>>, k: string, v: string) => { if (!m.has(k)) m.set(k, new Set()); m.get(k)!.add(v); };

  for (const a of data.acts) {
    const m = get(a.by); if (!m) continue;
    const k = kindOf(a.type);
    const day = dubaiDay(new Date(a.at));
    m.perDay[day] ||= { call: 0, whatsapp: 0, other: 0 };
    if (k === "call") { m.calls++; m.perDay[day].call++; }
    else if (k === "whatsapp") { m.whatsapp++; m.perDay[day].whatsapp++; }
    else { m.perDay[day].other++; if (k === "note") m.notes++; else if (k === "status") m.statusChanges++; else if (k === "lead") m.leadsAdded++; else m.other++; }
    m.touches++;
    if (!m.lastActive || a.at > m.lastActive) m.lastActive = a.at;
    // "Reached" means real contact work (call, message, note, status), not data entry such as sale records.
    if (a.kind === "lead") add(leadsW, a.by, a.ref);
    else if (k === "call" || k === "whatsapp" || k === "note" || k === "status") add(owners, a.by, a.ref);
    add(days, a.by, day);
  }
  for (const [e, s] of owners) { const m = get(e); if (m) m.ownersReached = s.size; }
  for (const [e, s] of leadsW) { const m = get(e); if (m) m.leadsWorked = s.size; }
  for (const [e, s] of days) { const m = get(e); if (m) m.activeDays = s.size; }

  for (const ev of data.events) {
    const m = get(ev.assigned_to); if (!m) continue;
    const day = dubaiDay(new Date(ev.starts_at));
    if (ev.status === "Completed" && day >= range.from) {
      m.eventsDone++;
      if (ev.event_type === "Property Viewing") m.viewingsDone++;
      if (ev.event_type === "Meeting") m.meetingsDone++;
    }
    if (ev.status === "Scheduled" && new Date(ev.starts_at) < new Date()) m.eventsOverdue++;
  }

  for (const l of data.leads) {
    const m = get(l.assigned_to); if (!m) continue;
    m.leadsTotal++;
    if (l.status === "Won") m.leadsWon++; else if (l.status === "Lost") m.leadsLost++; else {
      m.leadsActive++;
      if (l.follow_up_date && l.follow_up_date < today) m.followupsOverdue++;
      if (l.follow_up_date === today) m.followupsToday++;
    }
    if (dubaiDay(new Date(l.created_at)) >= range.from) m.leadsNew++;
  }

  const deals = (data.deals || []).filter((d) => COUNTED.has(d.status) && d.deal_date >= range.from && d.deal_date <= range.to);
  for (const d of deals) {
    const agents = (data.splits || []).filter((s) => s.deal_id === d.id && s.kind === "agent");
    const gross = dealMoney(d).gross;
    const list = agents.length ? agents : [{ email: d.created_by, share_pct: 100, amount: 0, kind: "agent" } as Split];
    for (const s of list) {
      const m = get(s.email); if (!m) continue;
      const share = num(s.share_pct || 100) / 100;
      m.deals += share; m.dealValue = r2(m.dealValue + num(d.price) * share); m.revenue = r2(m.revenue + gross * share);
    }
    for (const s of (data.splits || []).filter((x) => x.deal_id === d.id)) { const m = get(s.email); if (m) m.earned = r2(m.earned + num(s.amount)); }
  }
  for (const m of out.values()) m.deals = Math.round(m.deals * 100) / 100;
  return out;
}

/** Sum of everyone's figures (for the team totals strip). */
export function totals(list: Metrics[]): Metrics {
  const t = blank();
  for (const m of list) for (const k of Object.keys(t) as (keyof Metrics)[]) {
    if (typeof t[k] === "number") (t[k] as number) += m[k] as number;
  }
  t.lastActive = list.map((m) => m.lastActive).filter(Boolean).sort().pop() || null;
  return t;
}

export const ROLE_NAME: Record<string, string> = {
  super_admin: "Super Admin", admin: "Admin", team_leader: "Team Leader", agent: "Agent", accounts: "Accounts", hr: "Admin / HR / Operations",
};
/** People who sell (they get a row in the team table). */
export const isSalesPerson = (p: Person) => ["agent", "team_leader", "admin", "super_admin"].includes(p.role.replace(/[\s/-]+/g, "_"));

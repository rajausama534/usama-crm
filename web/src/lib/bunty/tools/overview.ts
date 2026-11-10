import type { BuntyModule, BuntyTool } from "../types";
import { must } from "../util";

const companyOverview: BuntyTool<Record<string, never>> = {
  name: "get_company_overview",
  kind: "read",
  description: "Whole-company numbers the person can see: owners database size and contact activity, leads by stage and source, new leads per week, follow-ups due/overdue, today's calendar count. Sales side only: use the accounts, deals, HR and listings tools for the rest.",
  input_schema: { type: "object", properties: {}, additionalProperties: false },
  async run(ctx) {
    const [stats, today] = await Promise.all([
      ctx.db.rpc("crm_dashboard_stats"),
      ctx.db.from("crm_events").select("id", { count: "exact", head: true }).eq("status", "Scheduled")
        .gte("starts_at", `${ctx.today}T00:00:00+04:00`).lte("starts_at", `${ctx.today}T23:59:59+04:00`),
    ]);
    return { ...(must(stats, "Dashboard") as object), events_today: today.count, more: "For money use get_accounts_summary and list_deals; for staff list_staff and list_expiring_documents; for adverts list_listings." };
  },
};

export const overview: BuntyModule = {
  department: "overview",
  tools: [companyOverview],
};

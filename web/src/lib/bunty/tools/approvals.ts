import { ToolError, type BuntyModule, type BuntyTool, type BuntyCtx } from "../types";
import { must } from "../util";

const missing = (m: string) => /relation|does not exist|schema cache|Could not find/i.test(m);
const NOT_READY = "The approvals inbox is not switched on in the database yet (step-1 database update pending Usama's OK).";

async function loadApproval(ctx: BuntyCtx, id: string) {
  const r = await ctx.db.from("crm_approvals").select("*").eq("id", id).maybeSingle();
  if (r.error) throw new ToolError(missing(r.error.message) ? NOT_READY : r.error.message);
  if (!r.data) throw new ToolError("Approval not found (or you cannot see it).");
  return r.data as Record<string, unknown>;
}

const listApprovals: BuntyTool<{ status?: string; kind?: string }> = {
  name: "list_approvals",
  kind: "read",
  description: "Items in the approvals inbox (deals, expenses, advances, leave, listings). Default: pending.",
  input_schema: {
    type: "object",
    properties: {
      status: { type: "string", enum: ["pending", "approved", "rejected", "withdrawn"] },
      kind: { type: "string", enum: ["deal", "expense", "advance", "leave", "listing"] },
    },
    additionalProperties: false,
  },
  async run(ctx, i) {
    let q = ctx.db.from("crm_approvals").select("id,kind,title,summary,amount,requested_by,requested_at,status,decided_by,decided_at,decision_note")
      .eq("status", i.status || "pending").order("requested_at", { ascending: false }).limit(50);
    if (i.kind) q = q.eq("kind", i.kind);
    const r = await q;
    if (r.error) return missing(r.error.message) ? { note: NOT_READY, items: [] } : must(r, "Approvals");
    return { items: r.data };
  },
};

const decideApproval: BuntyTool<{ id: string; approve: boolean; note?: string }> = {
  name: "decide_approval",
  kind: "write",
  description: "Approve or reject one item in the approvals inbox, with an optional note.",
  input_schema: {
    type: "object",
    properties: { id: { type: "string" }, approve: { type: "boolean" }, note: { type: "string", maxLength: 2000 } },
    required: ["id", "approve"], additionalProperties: false,
  },
  async preview(ctx, i) {
    const a = await loadApproval(ctx, i.id);
    return {
      title: `${i.approve ? "Approve" : "Reject"}: ${a.title}`,
      lines: [
        ...(a.summary ? [String(a.summary)] : []),
        ...(a.amount ? [`Amount: AED ${Number(a.amount).toLocaleString("en-US")}`] : []),
        `Requested by ${a.requested_by}`,
        ...(i.note ? [`Note: ${i.note}`] : []),
      ],
      danger: !i.approve,
    };
  },
  async run(ctx, i) {
    const note = `${i.note ? i.note + " " : ""}(${ctx.actor})`;
    const r = await ctx.db.rpc("crm_decide_approval", { p_id: i.id, p_approve: i.approve, p_note: note });
    if (r.error) throw new ToolError(missing(r.error.message) ? NOT_READY : r.error.message);
    return { ok: true, status: (r.data as { status?: string })?.status, link: "/approvals" };
  },
};

export const approvals: BuntyModule = {
  department: "approvals",
  tools: [listApprovals, decideApproval],
  guide: "Approvals: requests by staff that need a yes/no. Only people with the matching approve tick (or Super Admin) can decide. Nobody approves their own request.",
  async pending(ctx) {
    const r = await ctx.db.from("crm_approvals").select("kind,title", { count: "exact" }).eq("status", "pending").order("requested_at", { ascending: false }).limit(4);
    if (r.error) return { count: 0, title: "Approvals", items: [{ text: missing(r.error.message) ? "Inbox switches on with the step-1 database update." : r.error.message, tone: "info" }] };
    const items = (r.data || []).map((a) => ({ text: `${a.kind[0].toUpperCase()}${a.kind.slice(1)}: ${a.title}`, tone: "warn" as const }));
    if (!items.length) items.push({ text: "Nothing waiting for approval.", tone: "good" as never });
    return { count: r.count || 0, title: r.count ? `Approvals · ${r.count} waiting` : "Approvals · all clear", items, actions: ["Open approvals"] };
  },
};

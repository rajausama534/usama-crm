// Bunty's departments and abilities. Every department of the company plan has a module here; a new feature ships
// with its own tools in ./tools.

import type { BuntyCtx, BuntyModule, BuntyTool, Department, DepartmentKey, PendingSummary } from "./types";
import { sales } from "./tools/sales";
import { calendar } from "./tools/calendar";
import { approvals } from "./tools/approvals";
import { overview } from "./tools/overview";
import { accounts, commission, compliance, documents, hr, listings, vat } from "./tools/company";

export const DEPARTMENTS: Department[] = [
  { key: "overview", name: "Overview" },
  { key: "sales", name: "Sales" },
  { key: "commission", name: "Commission" },
  { key: "accounts", name: "Accounts" },
  { key: "vat", name: "VAT & tax" },
  { key: "hr", name: "HR" },
  { key: "documents", name: "Documents" },
  { key: "compliance", name: "Compliance" },
  { key: "listings", name: "Listings" },
  { key: "approvals", name: "Approvals" },
  { key: "tasks", name: "My tasks" },
];

// New modules go at the end so the tool order (and the prompt cache) stays stable.
export const MODULES: BuntyModule[] = [overview, sales, calendar, approvals, commission, compliance, accounts, vat, hr, documents, listings];

/** Tools in a fixed order (keeps the prompt cache stable). Later: filter by the person's role/ticks. */
export function toolsFor(): BuntyTool[] {
  return MODULES.flatMap((m) => m.tools);
}

export function findTool(name: string) {
  return toolsFor().find((t) => t.name === name);
}

export async function pendingByDepartment(ctx: BuntyCtx): Promise<Record<DepartmentKey, PendingSummary | null>> {
  const out = Object.fromEntries(DEPARTMENTS.map((d) => [d.key, null])) as Record<DepartmentKey, PendingSummary | null>;
  await Promise.all(MODULES.filter((m) => m.pending).map(async (m) => {
    try { out[m.department] = await m.pending!(ctx); }
    catch (e) { out[m.department] = { count: 0, title: m.department, items: [{ text: `Could not load: ${(e as Error).message}`, tone: "info" }] }; }
  }));
  const parts = MODULES.filter((m) => m.department !== "overview").map((m) => out[m.department]).filter(Boolean) as PendingSummary[];
  const total = parts.reduce((s, p) => s + p.count, 0);
  out.overview = {
    count: 0,
    title: total ? `${total} thing${total > 1 ? "s" : ""} need you today` : "All clear today",
    items: parts.flatMap((p) => p.items.filter((i) => i.tone === "bad" || i.tone === "warn").slice(0, 2)).slice(0, 6),
    actions: ["Company numbers", "What's on today?"],
  };
  if (!out.overview.items.length) out.overview.items.push({ text: "Nothing urgent. Ask me anything.", tone: "good" });
  return out;
}

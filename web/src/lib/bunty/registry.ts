// Bunty's departments and abilities. Each later build step adds a module here (deals → "commission"/"compliance",
// accounts → "accounts"/"vat", HR → "hr"/"documents", listings → "listings") and removes its `soon` tag.

import type { BuntyCtx, BuntyModule, BuntyTool, Department, DepartmentKey, PendingSummary } from "./types";
import { sales } from "./tools/sales";
import { calendar } from "./tools/calendar";
import { approvals } from "./tools/approvals";
import { overview } from "./tools/overview";

export const DEPARTMENTS: Department[] = [
  { key: "overview", name: "Overview" },
  { key: "sales", name: "Sales" },
  { key: "commission", name: "Commission", soon: "Step 2" },
  { key: "accounts", name: "Accounts", soon: "Step 3" },
  { key: "vat", name: "VAT & tax", soon: "Step 3" },
  { key: "hr", name: "HR", soon: "Step 4" },
  { key: "documents", name: "Documents", soon: "Step 4" },
  { key: "compliance", name: "Compliance", soon: "Step 2" },
  { key: "listings", name: "Listings", soon: "Step 5" },
  { key: "approvals", name: "Approvals" },
  { key: "tasks", name: "My tasks" },
];

export const MODULES: BuntyModule[] = [overview, sales, calendar, approvals];

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

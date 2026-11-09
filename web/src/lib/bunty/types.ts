// Bunty's tool layer. Every ability Bunty has is one BuntyTool: a fixed, reviewed server action that runs
// with the asking person's own database permissions (Row Level Security). Bunty never gets raw SQL.
//
// Adding a department later = add a file in ./tools exporting a BuntyModule and list it in ./registry.ts.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Me } from "@/lib/access";

export type JsonSchema = {
  type: "object";
  properties: Record<string, PropSchema>;
  required?: string[];
  additionalProperties?: false;
};
export type PropSchema =
  | { type: "string"; description?: string; enum?: readonly string[]; maxLength?: number; format?: "date" | "time" | "date-time" }
  | { type: "integer" | "number"; description?: string; minimum?: number; maximum?: number }
  | { type: "boolean"; description?: string }
  | { type: "array"; description?: string; items: { type: "string" }; maxItems?: number };

/** Everything a tool needs: the person's own database connection and who they are. */
export type BuntyCtx = {
  db: SupabaseClient;
  me: Me;
  /** "Bunty, for Usama": written as the author of every note/history entry Bunty makes. */
  actor: string;
  /** Today in Dubai, YYYY-MM-DD. */
  today: string;
};

/** What the confirm card shows before a change happens. */
export type ConfirmCard = { title: string; lines: string[]; danger?: boolean };

export type BuntyTool<I = Record<string, unknown>> = {
  name: string;
  /** Read tools run at once. Write tools (anything that changes data, approves, sends or deletes) need a confirm. */
  kind: "read" | "write";
  description: string;
  input_schema: JsonSchema;
  /** Write tools only: describe the change in plain words (may read the current record to show before → after). */
  preview?: (ctx: BuntyCtx, input: I) => Promise<ConfirmCard>;
  run: (ctx: BuntyCtx, input: I) => Promise<unknown>;
};

export type DepartmentKey =
  | "overview" | "sales" | "commission" | "accounts" | "vat" | "hr" | "documents"
  | "compliance" | "listings" | "approvals" | "tasks";

export type Department = {
  key: DepartmentKey;
  name: string;
  /** Build step in which Bunty gets this department ("Soon" until then). */
  soon?: string;
};

/** Pending items for a department (badge number + short lines for the department card). */
export type PendingSummary = { count: number; title: string; items: { text: string; tone: "bad" | "warn" | "info" | "good" }[]; actions?: string[] };

export type BuntyModule = {
  department: DepartmentKey;
  tools: BuntyTool<any>[]; // eslint-disable-line @typescript-eslint/no-explicit-any
  pending?: (ctx: BuntyCtx) => Promise<PendingSummary>;
  /** A few lines added to Bunty's instructions about this department. */
  guide?: string;
};

export class ToolError extends Error {}
